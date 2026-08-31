"""Automatic second-therapist blocking for couples massages (module M10).

Replaces the manual front-desk flow: when a couples massage is booked in Square with only one
therapist, this poller finds a free second therapist and creates a placeholder booking in Square
so her time can't be double-booked. The placeholder is attached to the shared "AUTO BLOCK"
customer (distinguishable at a glance on the Square calendar) and its seller_note carries the
real customer's first name, e.g. "AUTO-BLOCK: John".

Mappings are persisted in the couple_second_blocks table so restarts never orphan blocks
(the old booking_sync.py kept them in memory - its known flaw).

Dry-run (default): computes and reports what it would do, writes nothing to Square.
"""
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from config import Config
from app.database import SessionLocal
from app.models import CoupleSecondBlock

logger = logging.getLogger(__name__)

# Last poll summary for GET /api/couple-autoblock/status (guarded by _state_lock).
_state_lock = threading.Lock()
_last_run: Dict = {}

_CANCELLED_STATUSES = {'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED', 'NO_SHOW'}


def _field(booking, name, default=None):
    if isinstance(booking, dict):
        return booking.get(name, default)
    return getattr(booking, name, default) or default


def _booking_id(b) -> str:
    return str(_field(b, 'id', '') or '')


def _booking_status(b) -> str:
    v = _field(b, 'status', '')
    if hasattr(v, 'value'):
        v = v.value
    return str(v or '')


def _segments(b) -> List:
    return _field(b, 'appointment_segments', None) or []


def _seg_field(seg, name, default=None):
    if isinstance(seg, dict):
        return seg.get(name, default)
    return getattr(seg, name, default) or default


def _primary_segment_info(b) -> Dict:
    segs = _segments(b)
    if not segs:
        return {}
    s = segs[0]
    return {
        'team_member_id': str(_seg_field(s, 'team_member_id', '') or ''),
        'service_variation_id': str(_seg_field(s, 'service_variation_id', '') or ''),
        'service_variation_version': int(_seg_field(s, 'service_variation_version', 1) or 1),
        'duration_minutes': int(_seg_field(s, 'duration_minutes', 60) or 60),
    }


def _distinct_team_members(b) -> set:
    out = set()
    for s in _segments(b):
        tid = str(_seg_field(s, 'team_member_id', '') or '')
        if tid:
            out.add(tid)
    return out


def _is_our_block(b) -> bool:
    note = str(_field(b, 'seller_note', '') or '')
    return note.startswith(Config.COUPLE_AUTOBLOCK_MARKER)


def _first_name(full_name: str) -> str:
    name = (full_name or '').strip()
    return name.split()[0] if name else ''


def _parse_ts(iso: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(iso.replace('Z', '+00:00'))
    except Exception:
        return None


def _overlaps(s1: datetime, e1: datetime, s2: datetime, e2: datetime) -> bool:
    return s1 < e2 and s2 < e1


def _cancel_square_booking(client, booking_id: str) -> bool:
    booking = client.get_booking(booking_id)
    if not booking:
        return False
    if _booking_status(booking) in _CANCELLED_STATUSES:
        return True
    version = _field(booking, 'version', 0) or 0
    return client.cancel_booking(booking_id, version) is not None


def run_once(square_service) -> Dict:
    """One poll pass. Returns a summary dict (also stored for the status endpoint)."""
    summary = {
        'ran_at': datetime.now(timezone.utc).isoformat(),
        'dry_run': Config.COUPLE_AUTOBLOCK_DRY_RUN,
        'couples_found': 0,
        'blocks_planned': [],   # dry-run: what would be created
        'blocks_created': [],
        'blocks_cancelled': [],
        'no_therapist_available': [],
        'errors': [],
    }
    client = getattr(square_service, 'client', None)
    if client is None:
        summary['errors'].append('Square API not configured (mock mode) - autoblock idle')
        _store(summary)
        return summary

    now = datetime.now(timezone.utc)
    start_min = now.isoformat().replace('+00:00', 'Z')
    start_max = (now + timedelta(days=Config.COUPLE_AUTOBLOCK_LOOKAHEAD_DAYS)).isoformat().replace('+00:00', 'Z')

    bookings = client.list_bookings_two_pass_location_merge(start_min, start_max)
    by_id = {_booking_id(b): b for b in bookings if _booking_id(b)}

    db = SessionLocal()
    try:
        rows = db.query(CoupleSecondBlock).all()
        active_rows = {r.primary_booking_id: r for r in rows if r.status == 'created'}
        known_block_ids = {r.block_booking_id for r in rows if r.block_booking_id}

        # 1. Sync existing blocks with their primary bookings (cancel / reschedule).
        for primary_id, row in list(active_rows.items()):
            primary = by_id.get(primary_id)
            if primary is None:
                continue  # primary outside the poll window (e.g. already started); leave the block alone
            status = _booking_status(primary)
            start_at = str(_field(primary, 'start_at', '') or '')
            seg = _primary_segment_info(primary)
            if status in _CANCELLED_STATUSES:
                _cancel_block(client, db, row, summary, reason='primary cancelled')
                del active_rows[primary_id]
            elif start_at and (start_at != row.start_at or seg.get('duration_minutes') != row.duration_minutes):
                # Rescheduled: drop the old block; the creation pass below makes a fresh one.
                _cancel_block(client, db, row, summary, reason='primary rescheduled')
                del active_rows[primary_id]

        # 2. Create blocks for couples bookings that don't have one yet.
        # Track therapists claimed this pass: in dry-run (and before Square reflects a new
        # booking) the availability check can't see blocks planned moments earlier, so two
        # same-time couples would otherwise get the same second therapist.
        claimed: List[Dict] = [
            {'member_id': r.second_team_member_id,
             'start': _parse_ts(r.start_at),
             'end': (_parse_ts(r.start_at) + timedelta(minutes=r.duration_minutes)) if _parse_ts(r.start_at) else None}
            for r in active_rows.values()
        ]
        for bid, b in by_id.items():
            if _booking_status(b) in _CANCELLED_STATUSES or _is_our_block(b) or bid in known_block_ids:
                continue
            try:
                if square_service.get_booking_type(b) != 'couple':
                    continue
            except Exception as e:
                summary['errors'].append(f'booking_type failed for {bid[:12]}: {e}')
                continue
            summary['couples_found'] += 1
            if bid in active_rows:
                continue  # already blocked
            if len(_distinct_team_members(b)) >= 2:
                continue  # Square booking already holds two therapists
            seg = _primary_segment_info(b)
            start_at = str(_field(b, 'start_at', '') or '')
            if not seg.get('team_member_id') or not start_at:
                continue

            first_name = ''
            try:
                first_name = _first_name(square_service.get_customer_name(b))
            except Exception:
                pass
            slot_start = _parse_ts(start_at)
            slot_end = slot_start + timedelta(minutes=seg['duration_minutes']) if slot_start else None
            claimed_here = set()
            if slot_start and slot_end:
                claimed_here = {
                    c['member_id'] for c in claimed
                    if c['start'] and c['end'] and _overlaps(slot_start, slot_end, c['start'], c['end'])
                }
            member = client.get_available_team_member(
                start_at=start_at,
                duration_minutes=seg['duration_minutes'],
                exclude_team_member_id=seg['team_member_id'],
                exclude_team_member_ids=claimed_here,
            )
            if not member:
                summary['no_therapist_available'].append({'primary_booking_id': bid, 'start_at': start_at})
                continue
            member_id = member.get('id') if isinstance(member, dict) else getattr(member, 'id', None)
            plan = {
                'primary_booking_id': bid,
                'customer_first_name': first_name,
                'second_team_member_id': member_id,
                'start_at': start_at,
                'duration_minutes': seg['duration_minutes'],
            }
            claimed.append({'member_id': str(member_id), 'start': slot_start, 'end': slot_end})
            if Config.COUPLE_AUTOBLOCK_DRY_RUN:
                summary['blocks_planned'].append(plan)
                logger.info('[AUTOBLOCK dry-run] would block %s for %s (%s, %s min)',
                            member_id, first_name or bid[:12], start_at, seg['duration_minutes'])
                continue

            seller_note = f"{Config.COUPLE_AUTOBLOCK_MARKER} {first_name}".strip()
            customer_id = client.find_or_create_autoblock_customer()
            created = client.create_autoblock_booking(
                team_member_id=member_id,
                start_at=start_at,
                service_variation_id=seg['service_variation_id'],
                service_variation_version=seg['service_variation_version'],
                duration_minutes=seg['duration_minutes'],
                seller_note=seller_note,
                customer_id=customer_id,
            )
            if created:
                row = CoupleSecondBlock(
                    primary_booking_id=bid,
                    block_booking_id=_booking_id(created),
                    second_team_member_id=str(member_id),
                    start_at=start_at,
                    duration_minutes=seg['duration_minutes'],
                    customer_first_name=first_name,
                    status='created',
                )
                db.add(row)
                db.commit()
                active_rows[bid] = row
                known_block_ids.add(row.block_booking_id)
                plan['block_booking_id'] = row.block_booking_id
                summary['blocks_created'].append(plan)
            else:
                summary['errors'].append(f'create block failed for primary {bid[:12]}')

        # 3. Orphan cleanup: our marker-tagged bookings in Square that no active row claims.
        if not Config.COUPLE_AUTOBLOCK_DRY_RUN:
            claimed = {r.block_booking_id for r in active_rows.values() if r.block_booking_id}
            for bid, b in by_id.items():
                if not _is_our_block(b) or _booking_status(b) in _CANCELLED_STATUSES:
                    continue
                if bid not in claimed:
                    if _cancel_square_booking(client, bid):
                        summary['blocks_cancelled'].append({'block_booking_id': bid, 'reason': 'orphan'})
                    else:
                        summary['errors'].append(f'orphan cancel failed for {bid[:12]}')
    except Exception as e:
        logger.exception('Autoblock poll failed')
        summary['errors'].append(str(e))
    finally:
        db.close()

    _store(summary)
    return summary


def _cancel_block(client, db, row: CoupleSecondBlock, summary: Dict, reason: str):
    if Config.COUPLE_AUTOBLOCK_DRY_RUN:
        summary['blocks_cancelled'].append({
            'block_booking_id': row.block_booking_id, 'reason': f'{reason} (dry-run, not executed)'
        })
        return
    ok = _cancel_square_booking(client, row.block_booking_id) if row.block_booking_id else True
    if ok:
        row.status = 'cancelled'
        db.commit()
        summary['blocks_cancelled'].append({'block_booking_id': row.block_booking_id, 'reason': reason})
    else:
        row.last_error = f'cancel failed ({reason})'
        db.commit()
        summary['errors'].append(f'cancel block {str(row.block_booking_id)[:12]} failed ({reason})')


def _store(summary: Dict):
    global _last_run
    with _state_lock:
        _last_run = summary


def get_status() -> Dict:
    """Snapshot for the status endpoint: config + last poll summary + active block rows."""
    with _state_lock:
        last = dict(_last_run)
    db = SessionLocal()
    try:
        rows = (
            db.query(CoupleSecondBlock)
            .filter(CoupleSecondBlock.status == 'created')
            .order_by(CoupleSecondBlock.start_at)
            .all()
        )
        active = [
            {
                'primary_booking_id': r.primary_booking_id,
                'block_booking_id': r.block_booking_id,
                'second_team_member_id': r.second_team_member_id,
                'start_at': r.start_at,
                'duration_minutes': r.duration_minutes,
                'customer_first_name': r.customer_first_name,
            }
            for r in rows
        ]
    finally:
        db.close()
    return {
        'enabled': Config.COUPLE_AUTOBLOCK_ENABLED,
        'dry_run': Config.COUPLE_AUTOBLOCK_DRY_RUN,
        'poll_minutes': Config.COUPLE_AUTOBLOCK_POLL_MINUTES,
        'lookahead_days': Config.COUPLE_AUTOBLOCK_LOOKAHEAD_DAYS,
        'last_run': last or None,
        'active_blocks': active,
    }
