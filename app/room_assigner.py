"""Room assignment logic with priority rules."""
import re
from collections import defaultdict
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple, Any, Set

from app.models import RoomAssignment
from app.room_occupancy import physical_busy_segments_ts
from sqlalchemy.orm import Session

# Service title chunks that are room/masseuse-neutral (Square time-neutral add-ons only).
_ROOM_NEUTRAL_CHUNK_MARKERS = (
    "pain relief",
    "舒缓精油",
    "cupping",
    "aromatherapy",
    "tea tree",
    "teatree",
    "collagen sock",  # retail add-on booked as own line; shares main massage room
)
# If the same chunk names a real massage/facial, it still needs a room.
_ROOM_NEUTRAL_CHUNK_BLOCKWORDS = (
    "massage",
    "facial",
    "couple",
    "couples",
    "swedish",
    "deep tissue",
    "reflexology",
    "treatment",
    "package",
)


def booking_is_room_neutral_addon_only(service: Optional[str]) -> bool:
    """
    True when every comma/semicolon-separated part of the service line is only a time-neutral add-on
    (e.g. duplicated Pain Relief Oil segments). Such bookings must not consume a massage room or
    masseuse capacity on the calendar.
    """
    if not (service or "").strip():
        return False
    parts = re.split(r"[,;]", service)
    chunks = [p.strip() for p in parts if p.strip()]
    if not chunks:
        return False
    for chunk in chunks:
        cl = chunk.lower()
        if any(b in cl for b in _ROOM_NEUTRAL_CHUNK_BLOCKWORDS):
            return False
        if "eye" in cl and "spa" in cl:
            return False
        if not any(m in cl for m in _ROOM_NEUTRAL_CHUNK_MARKERS):
            return False
    return True

# Physical rooms tracked for occupancy (02D maps to 0+2 when marking busy).
_ROOM_OCCUPANCY_KEYS = ("0", "1", "2", "3", "4", "5", "6")


def _parse_iso_timestamp(iso: str) -> float:
    s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
    return datetime.fromisoformat(s).timestamp()


# End/start from Square can differ by a few seconds on logically back-to-back appointments.
# Strict float inequality (a1 <= b0) can falsely show overlap when one booking ends at 11:00:02
# and the next starts at 11:00:00 — conflict cleanup then unassigns a couple even though Rm 5 is free.
_OCCUPANCY_MIN_OVERLAP_SEC = 2.0


def _intervals_overlap(a0: float, a1: float, b0: float, b1: float) -> bool:
    """
    True if [a0, a1) and [b0, b1) overlap by strictly more than
    _OCCUPANCY_MIN_OVERLAP_SEC seconds. Touching boundaries (a1 == b0) or tiny
    API clock crumbs under that width do not count — avoids false double-booking
    and bogus UNASSIGNED (e.g. couple when Rm 5 is actually free back-to-back).
    """
    if a1 <= a0 or b1 <= b0:
        return False
    return (min(a1, b1) - max(a0, b0)) > _OCCUPANCY_MIN_OVERLAP_SEC


_COUPLE_SLOT_TAG_RE = re.compile(r"\bcouples?\s*#\s*\d+\b", re.I)


def _booking_has_couples_slot_tag(booking: Dict) -> bool:
    """Notes contain couples#2 / couples#3 — separate couple appointment; do not merge via note-pair room logic."""
    return bool(_COUPLE_SLOT_TAG_RE.search(_couple_room_note_text(booking)))


def _couple_room_note_text(booking: Dict) -> str:
    parts = [
        str(booking.get("seller_note") or ""),
        str(booking.get("customer_note") or ""),
        str(booking.get("addon_note") or ""),
    ]
    return " ".join(parts).lower()


def _booking_requests_shared_couple_room(booking: Dict) -> bool:
    """True if notes ask to use one couple room for two people (Square often creates two single appts)."""
    if _booking_has_couples_slot_tag(booking):
        return False
    b = _couple_room_note_text(booking)
    for phrase in (
        "couple room",
        "couples room",
        "couple's room",
        "couples' room",
        "couple-room",
        "in a couple room",
        # e.g. "Couples Massage, Same room" — same customer + same slot → one double (5/6/02D)
        "same room",
        "same-room",
        "in the same room",
        "one room",
        "share a room",
        "shared room",
    ):
        if phrase in b:
            if phrase in (
                "same room",
                "same-room",
                "in the same room",
                "one room",
                "share a room",
                "shared room",
            ):
                if "couple" not in b and "couples" not in b:
                    continue
            return True
    return False


def _mentions_back_walking(text: str) -> bool:
    """Customer/staff text mentions walking on the client's back (needs bar fixtures in Rm 1/3/4)."""
    t = (text or "").lower()
    if not t:
        return False
    if "back walking" in t or "back-walking" in t:
        return True
    if "back walk" in t or "backwalk" in t or "back-walk" in t:
        return True
    if "walk on back" in t or "walking on back" in t or "walks on back" in t:
        return True
    return False


def booking_requires_back_walking_bar_room(booking: Dict) -> bool:
    """
    Singles only: notes or Exclusive (package/service/display) mention back walking → must use Rm 1, 3, or 4
    (ceiling bars). Couple massages skip this — double rooms have no bar setup.
    """
    if str(booking.get("type") or "single").lower() == "couple":
        return False
    notes = " ".join(
        [
            str(booking.get("customer_note") or ""),
            str(booking.get("seller_note") or ""),
            str(booking.get("addon_note") or ""),
        ]
    )
    notes_l = notes.lower()
    if _mentions_back_walking(notes_l):
        return True
    srv = (booking.get("service") or "").strip().lower()
    disp = (booking.get("display_service") or "").strip().lower()
    pkg = str(booking.get("package_type") or "").strip().lower()
    combined = f"{srv} {disp} {notes_l}".strip()
    if not combined:
        return False
    if (pkg == "exclusive" or "exclusive" in srv or "exclusive" in disp) and _mentions_back_walking(combined):
        return True
    return False


def _booking_service_looks_like_facial(booking: Dict) -> bool:
    """True when the Square service line is a facial (single-room try order prefers 4/0/2; Rm 3 last)."""
    s = (booking.get("service") or "").strip().lower()
    d = (booking.get("display_service") or "").strip().lower()
    return (bool(s) and "facial" in s) or (bool(d) and "facial" in d)


# Single facial: best 4 → 0 → 2, then Rm 1, then couple-capable 6/5; Rm 3 last. (Couple facials use 02D / 5 / 6 elsewhere.)
_FACIAL_SINGLE_TRY_ORDER = ("4", "0", "2", "1", "6", "5")


def _single_room_order_deprioritize_room3_for_facial(booking: Dict, base_order: List[str]) -> List[str]:
    """
    Non-facials: unchanged base_order.
    Facials: try rooms in spa preference (4, 0, 2 best; 1 ok; 6/5 if in list), then any other allowed rooms,
    then Rm 3 last when it is an option.
    """
    order = list(base_order)
    if not _booking_service_looks_like_facial(booking):
        return order
    allowed = set(order)
    ranked = [r for r in _FACIAL_SINGLE_TRY_ORDER if r in allowed]
    rest = [r for r in order if r not in ranked and r != "3"]
    if "3" in allowed:
        return ranked + rest + ["3"]
    return ranked + rest


# Single-only physical rooms (no 5/6 doubles); used for couple lookahead + rebalance moves.
_BASE_SINGLE_PHYSICAL_ORDER = ["1", "3", "4", "2", "0"]


def _pair_customer_key(booking: Dict) -> Optional[str]:
    cid = (booking.get("customer_id") or "").strip()
    if cid:
        return f"id:{cid}"
    c = (booking.get("customer") or "").strip().lower()
    if not c:
        return None
    return f"n:{re.sub(r'\\s+', ' ', c)}"


def _customer_first_name_lower(booking: Dict) -> str:
    name = (booking.get("customer") or "").strip()
    if not name:
        return ""
    parts = re.split(r"\s+", name)
    if not parts:
        return ""
    return (parts[0] or "").strip().lower()


_COUPLES_WITH_RE = re.compile(
    r"(?i)\bcouples?\s+with\s+([A-Za-z\u00C0-\u024f][A-Za-z\u00C0-\u024f'\.\-]{0,50})"
)


def _partner_first_name_from_couples_with_notes(booking: Dict) -> Optional[str]:
    """
    Extract partner first name from notes like "couples with Jenny".
    Returns lowercased first-name token or None.
    """
    b = _couple_room_note_text(booking)
    if not b:
        return None
    m = _COUPLES_WITH_RE.search(b)
    if not m:
        return None
    raw = (m.group(1) or "").strip()
    if not raw:
        return None
    tok = re.split(r"\s+", raw)[0].strip().lower()
    return tok or None


def _find_couple_room_note_pair_groups(
    sorted_bookings: List[Dict], existing_assignments: Dict
) -> List[frozenset]:
    """
    Find disjoint pairs of bookings to share one couple room (5/6/02D). Neither booking may have a
    manager/frozen room row in existing_assignments.

    Two supported patterns:
    - Same customer + same start/end, at least one note mentions a shared couple room ("couple room", "same room", ...).
    - Notes say "couples with <first name>" and there exists exactly one matching booking at the same start/end
      whose customer first name equals that token (case-insensitive). Either side may contain the phrase.
    """
    def eligible(b: Dict) -> bool:
        if (b.get("type") or "single") == "couple":
            return False
        bid = b.get("booking_id")
        if not bid or bid in existing_assignments:
            return False
        st = (b.get("start_at") or "").strip()
        en = (b.get("end_at") or "").strip()
        if not st or not en:
            return False
        return True

    eligible_bookings = [b for b in sorted_bookings if eligible(b)]

    by_start_end: Dict[Tuple[str, str], List[Dict]] = defaultdict(list)
    for b in eligible_bookings:
        st = (b.get("start_at") or "").strip()
        en = (b.get("end_at") or "").strip()
        by_start_end[(st, en)].append(b)

    candidates: List[Tuple[str, str]] = []

    # 1) Same-customer pattern (Square sometimes creates two singles).
    same_customer_groups: Dict[Tuple[str, str, str], List[Dict]] = defaultdict(list)
    for b in eligible_bookings:
        ck = _pair_customer_key(b)
        if not ck:
            continue
        st = (b.get("start_at") or "").strip()
        en = (b.get("end_at") or "").strip()
        same_customer_groups[(ck, st, en)].append(b)

    for lst in same_customer_groups.values():
        if len(lst) != 2:
            continue
        a, b2 = lst[0], lst[1]
        ida, idb = a["booking_id"], b2["booking_id"]
        if not (_booking_requests_shared_couple_room(a) or _booking_requests_shared_couple_room(b2)):
            continue
        candidates.append((ida, idb))

    # 2) "Couples with <first name>" pattern (two different customers).
    for (st, en), lst in by_start_end.items():
        if len(lst) < 2:
            continue
        first_name_to_bookings: Dict[str, List[Dict]] = defaultdict(list)
        for b in lst:
            fn = _customer_first_name_lower(b)
            if fn:
                first_name_to_bookings[fn].append(b)

        for b in lst:
            bid = b.get("booking_id")
            if not bid:
                continue
            want = _partner_first_name_from_couples_with_notes(b)
            if not want:
                continue
            matches = [m for m in (first_name_to_bookings.get(want, []) or []) if m.get("booking_id") != bid]
            if len(matches) != 1:
                continue
            other = matches[0]
            other_id = other.get("booking_id")
            if not other_id:
                continue
            if _booking_has_couples_slot_tag(b) or _booking_has_couples_slot_tag(other):
                continue
            candidates.append((bid, other_id))

    # Produce disjoint pairs (stable).
    used: Set[str] = set()
    out: List[frozenset] = []
    for ida, idb in candidates:
        if ida == idb:
            continue
        if ida in used or idb in used:
            continue
        if ida in existing_assignments or idb in existing_assignments:
            continue
        used.add(ida)
        used.add(idb)
        out.append(frozenset({ida, idb}))
    return out


class RoomAssigner:
    """Handles automatic room assignment based on priority rules."""
    
    # Room setup
    SINGLE_ROOMS = ['1', '3', '4']  # Fixed single rooms
    DOUBLE_ROOMS = ['5', '6']  # Fixed double rooms (can be single)
    CONVERTIBLE_ROOMS = ['0', '2']  # Can be single or merged into "02D"
    
    # Priority for COUPLE appointments
    COUPLE_PRIORITY = ['5', '6', '02D']
    # Priority for SINGLE appointments (single-only 1,3,4 and convertible 2,0 before couple rooms 6,5
    # so that when we sort same-start singles by duration desc, longer sessions get single-only rooms and free 6,5 earlier)
    SINGLE_PRIORITY = ['1', '3', '4', '2', '0', '6', '5']
    # Try 5/6 before singles only when a couples booking starts soon after this single ends; otherwise
    # late singles (e.g. Carmen until 4:30) would still "prefer double" for a far-future couple and
    # steal Rm 5/6 from a couple at 4:00 (Kyle) on the same afternoon.
    PREFER_DOUBLE_MAX_GAP_BEFORE_NEXT_COUPLE_SEC = 3600  # 1 hour
    
    def __init__(self, db: Session):
        """Initialize room assigner with database session."""
        self.db = db
    
    def assign_rooms(
        self, 
        bookings: List[Dict], 
        date: str,
        protected_booking_ids: Optional[set] = None,
        freeze_room_booking_ids: Optional[set] = None,
        overrides_by_booking: Optional[Dict[str, Any]] = None,
    ) -> List[Dict]:
        """
        Assign rooms to bookings using greedy algorithm.
        
        Args:
            bookings: List of booking dicts with start_at, end_at, type, etc.
            date: Date string in YYYY-MM-DD format
            protected_booking_ids: If set, these booking IDs must never be moved to UNASSIGNED (checked-in or finished).
            freeze_room_booking_ids: Past (ended) or session started — treat existing DB room like manager for this pass
                so auto-assign does not reshuffle rooms after start. Early check-in alone should NOT be listed here.
            
        Returns:
            List of bookings with room assignments added
        """
        protected_booking_ids = protected_booking_ids or set()
        freeze_room_booking_ids = freeze_room_booking_ids or set()
        ov_map: Dict[str, Any] = overrides_by_booking if overrides_by_booking is not None else {}
        # Get existing manual assignments (don't overwrite)
        existing_assignments = {
            row.booking_id: row
            for row in self.db.query(RoomAssignment).filter(
                RoomAssignment.date == date,
                RoomAssignment.assigned_by == 'manager'
            ).all()
        }
        # Preserve DB room past/started only (not early check-in) so future appointments can still be re-optimized
        if freeze_room_booking_ids:
            for bid in freeze_room_booking_ids:
                if bid in existing_assignments:
                    continue
                row = self.db.query(RoomAssignment).filter(
                    RoomAssignment.date == date,
                    RoomAssignment.booking_id == bid,
                ).first()
                if row and row.room and row.room != 'UNASSIGNED':
                    existing_assignments[bid] = row

        # Manager + frozen rooms: never move these in the rebalance pass below.
        room_locked_booking_ids = set(existing_assignments.keys())
        
        # Per-room booked intervals (start_ts, end_ts). A single scalar "busy until" is wrong when a
        # later manual booking (e.g. 5pm in Rm 6) is applied in the first pass before auto-assign runs:
        # it would make Rm 6 look busy all day for earlier starts. Intervals fix that.
        room_intervals: Dict[str, List[Tuple[float, float]]] = {k: [] for k in _ROOM_OCCUPANCY_KEYS}
        
        # Sort bookings by start time, then by duration descending (longest first)
        # So at 6 PM: 90-min single gets first pick → single-only room (1,3,4); 60-min singles get 2,0,6,5 → couples room 6 free at 7 PM
        def get_start_time(booking):
            start_str = booking['start_at']
            if start_str.endswith('Z'):
                start_str = start_str.replace('Z', '+00:00')
            return datetime.fromisoformat(start_str)
        
        def get_duration_minutes(booking):
            start_str = booking['start_at']
            end_str = booking['end_at']
            if start_str.endswith('Z'):
                start_str = start_str.replace('Z', '+00:00')
            if end_str.endswith('Z'):
                end_str = end_str.replace('Z', '+00:00')
            try:
                s = datetime.fromisoformat(start_str)
                e = datetime.fromisoformat(end_str)
                return int((e - s).total_seconds() / 60)
            except Exception:
                return 0
        
        sorted_bookings = sorted(
            bookings,
            key=lambda b: (get_start_time(b), -get_duration_minutes(b))
        )
        
        # IMPORTANT: First pass - apply all manual assignments and mark rooms as busy
        # This ensures manual assignments are respected and rooms are properly blocked
        # Also validate that manual assignments don't conflict with each other
        import logging
        logger = logging.getLogger(__name__)
        
        # Validate manual assignments don't conflict with each other
        manual_conflicts = []
        for i, booking1 in enumerate(sorted_bookings):
            booking1_id = booking1['booking_id']
            if booking1_id not in existing_assignments:
                continue
            
            room1 = existing_assignments[booking1_id].room
            if room1 == 'UNASSIGNED':
                continue
            
            start1 = get_start_time(booking1)
            end1 = datetime.fromisoformat(booking1['end_at'].replace('Z', '+00:00') if booking1['end_at'].endswith('Z') else booking1['end_at'])
            
            # Check against other manual assignments
            for booking2 in sorted_bookings[i+1:]:
                booking2_id = booking2['booking_id']
                if booking2_id not in existing_assignments:
                    continue
                
                room2 = existing_assignments[booking2_id].room
                if room2 == 'UNASSIGNED':
                    continue
                
                segs1 = physical_busy_segments_ts({**booking1, "room": room1}, ov_map.get(booking1_id))
                segs2 = physical_busy_segments_ts({**booking2, "room": room2}, ov_map.get(booking2_id))
                clash = False
                for r1, t1a, t1b in segs1:
                    for r2, t2a, t2b in segs2:
                        if r1 != r2:
                            continue
                        if _intervals_overlap(t1a, t1b, t2a, t2b):
                            clash = True
                            break
                    if clash:
                        break
                if clash:
                    manual_conflicts.append({
                        'booking1_id': booking1_id,
                        'booking2_id': booking2_id,
                        'room': room1,
                        'time1': f"{start1} - {end1}",
                        'time2': f"{get_start_time(booking2)} - {datetime.fromisoformat(booking2['end_at'].replace('Z', '+00:00') if booking2['end_at'].endswith('Z') else booking2['end_at'])}"
                    })
        
        if manual_conflicts:
            conflict_msg = "; ".join([
                f"Bookings {c['booking1_id'][:10]}... and {c['booking2_id'][:10]}... both use room {c['room']} at overlapping times ({c['time1']} vs {c['time2']})"
                for c in manual_conflicts
            ])
            logger.error(f"Manual assignment conflicts detected for {date}: {conflict_msg}")
            # Don't raise error - just log it, as we still want to proceed with assignment
        
        # Apply manual assignments and mark rooms as busy
        for booking in sorted_bookings:
            booking_id = booking['booking_id']
            
            # Check if there's a manual assignment
            if booking_id in existing_assignments:
                existing = existing_assignments[booking_id]
                booking['room'] = existing.room
                booking['reason'] = existing.reason
                # Mark room as busy BEFORE auto-assigning others (skip UNASSIGNED)
                if existing.room != 'UNASSIGNED':
                    self._mark_room_busy(
                        existing.room,
                        booking,
                        room_intervals,
                        ov_map.get(booking_id),
                    )
        
        # Second pass - assign rooms for bookings without manual assignments
        import logging
        logger = logging.getLogger(__name__)

        # Bounds of every couple appointment (manual + auto) for single-room lookahead
        couple_time_bounds: List[Tuple[float, float]] = [
            self._booking_time_bounds(b)
            for b in sorted_bookings
            if (b.get('type') or 'single') == 'couple'
        ]

        # Two Square "single" appts, same customer + same slot, notes say "couple room" → one shared double (5/6/02D).
        pair_groups = _find_couple_room_note_pair_groups(sorted_bookings, existing_assignments)
        pair_group_by_id: Dict[str, frozenset] = {}
        pair_auto_assigned: Set[str] = set()
        for g in pair_groups:
            for bid in g:
                pair_group_by_id[bid] = g

        for g in pair_groups:
            ids = tuple(g)
            ida, idb = ids[0], ids[1]
            primary_id = min(ida, idb)
            secondary_id = idb if primary_id == ida else ida
            b_primary = next(x for x in sorted_bookings if x["booking_id"] == primary_id)
            b_secondary = next(x for x in sorted_bookings if x["booking_id"] == secondary_id)
            fake_couple = {**b_primary, "type": "couple"}
            room, reason = self._find_available_room(
                fake_couple,
                room_intervals,
                couple_time_bounds=couple_time_bounds,
            )
            b_primary["room"] = room
            b_secondary["room"] = room
            b_primary["reason"] = reason
            b_secondary["reason"] = reason
            if room != "UNASSIGNED":
                self._mark_room_busy(room, b_primary, room_intervals, ov_map.get(primary_id))
                self._persist_auto_assignment(primary_id, room, reason, date)
                self._persist_auto_assignment(secondary_id, room, reason, date)
                logger.info(
                    "Couple-room note pair: %s + %s → shared %s",
                    primary_id[:14],
                    secondary_id[:14],
                    room,
                )
            else:
                self._persist_auto_assignment(primary_id, room, reason, date)
                self._persist_auto_assignment(secondary_id, room, reason, date)
            pair_auto_assigned.add(primary_id)
            pair_auto_assigned.add(secondary_id)
        
        for booking in sorted_bookings:
            booking_id = booking['booking_id']
            
            # Skip if already assigned a physical / virtual room (manager or frozen auto).
            # Exception: DB row UNASSIGNED + add-on-only service → assign ADDON below (fixes stuck oil rows).
            if booking_id in existing_assignments:
                ex_row = existing_assignments[booking_id]
                if ex_row.room != "UNASSIGNED":
                    continue
                if not booking_is_room_neutral_addon_only((booking.get("service") or "").strip()):
                    continue
            if booking_id in pair_auto_assigned:
                continue

            if booking_is_room_neutral_addon_only((booking.get("service") or "").strip()):
                booking["room"] = "ADDON"
                booking["reason"] = None
                self._persist_auto_assignment(booking_id, "ADDON", None, date)
                continue
            
            # Try to assign room automatically
            room, reason = self._find_available_room(
                booking,
                room_intervals,
                couple_time_bounds=couple_time_bounds,
            )
            
            booking['room'] = room
            booking['reason'] = reason
            
            if room == 'UNASSIGNED':
                start_time = get_start_time(booking)
                logger.warning(
                    f"Could not assign room for booking {booking_id[:20]}... "
                    f"(type: {booking.get('type', 'single')}, "
                    f"time: {start_time}, reason: {reason})"
                )
                st = start_time.timestamp()
                et = _parse_iso_timestamp(booking["end_at"])
                busy_state_str = ", ".join(
                    f"Room {r}: {len(iv)} block(s)"
                    for r, iv in sorted(room_intervals.items())
                )
                logger.warning(f"  Occupancy at {start_time.strftime('%H:%M')}: {busy_state_str}")
                if self._room_free_for_interval(room_intervals, "5", st, et):
                    logger.error(
                        "  ⚠ CRITICAL BUG: Room 5 has no overlap with this slot but booking was UNASSIGNED — "
                        "check _find_available_room couple/single logic"
                    )
                
                # Don't mark UNASSIGNED as busy - it doesn't block any room
                continue
            
            # Mark room as busy
            self._mark_room_busy(room, booking, room_intervals, ov_map.get(booking_id))
            
            self._persist_auto_assignment(booking_id, room, reason, date)
        
        # Greedy pass can leave a later couple UNASSIGNED while singles sit in 5/6. Try moving one
        # auto-assigned single into 1,3,4,2,0 only to free a double room for that couple.
        for _ in range(32):
            if not self._rebalance_one_unassigned_couple(
                sorted_bookings,
                room_locked_booking_ids,
                protected_booking_ids,
                ov_map,
                date,
            ):
                break

        unassigned_count = sum(1 for b in sorted_bookings if b.get('room') == 'UNASSIGNED')
        
        self.db.commit()
        
        if unassigned_count > 0:
            logger.warning(
                f"Room assignment completed with {unassigned_count} unassigned bookings for {date}. "
                f"This may indicate a capacity issue or algorithm problem."
            )
        
        # Validate: Check for room conflicts (overbooking) on physical rooms
        # Check for overlaps on each physical room (02D may split: 0 free during facial)
        conflicts = []
        phys_intervals: Dict[str, List[Tuple[float, float, str]]] = {k: [] for k in _ROOM_OCCUPANCY_KEYS}
        for b in sorted_bookings:
            b_room = b.get('room')
            if not b_room or b_room == 'UNASSIGNED':
                continue
            for phys_r, stf, etf in physical_busy_segments_ts({**b, "room": b_room}, ov_map.get(b['booking_id'])):
                if phys_r in phys_intervals:
                    phys_intervals[phys_r].append((stf, etf, b['booking_id']))
        for r, ivals in phys_intervals.items():
            for i, (s1, e1, id1) in enumerate(ivals):
                for s2, e2, id2 in ivals[i + 1 :]:
                    if id1 == id2:
                        continue
                    if _intervals_overlap(s1, e1, s2, e2):
                        g1 = pair_group_by_id.get(id1)
                        g2 = pair_group_by_id.get(id2)
                        if g1 is not None and g1 == g2:
                            continue
                        conflicts.append({
                            'room': r,
                            'booking1': id1,
                            'booking2': id2,
                            'time1': f"{s1}-{e1}",
                            'time2': f"{s2}-{e2}",
                        })
        
        if conflicts:
            logger.warning(f"Room assignment conflicts detected for {date}:")
            for conflict in conflicts:
                logger.warning(f"  Room {conflict['room']} overbooked: {conflict['booking1'][:20]}... and {conflict['booking2'][:20]}...")
                logger.warning(f"    Times: {conflict['time1']} vs {conflict['time2']}")

                bid_a, bid_b = conflict["booking1"], conflict["booking2"]
                oa = ov_map.get(bid_a)
                ob = ov_map.get(bid_b)
                if (oa and getattr(oa, "room_placement_override", False)) or (
                    ob and getattr(ob, "room_placement_override", False)
                ):
                    # Manager confirmed placement despite calendar occupancy; do not delete either assignment
                    # or the next get_day will re–auto-assign (e.g. couple back to Rm 5) while OVR stays set.
                    logger.info(
                        "  Skipping conflict cleanup: room_placement_override on one booking (%s vs %s)",
                        bid_a[:16],
                        bid_b[:16],
                    )
                    continue
                
                # Fix conflicts: Manager assignments have priority
                # If one is manager-assigned and the other is auto-assigned, unassign the auto one
                b1 = next((b for b in sorted_bookings if b['booking_id'] == conflict['booking1']), None)
                b2 = next((b for b in sorted_bookings if b['booking_id'] == conflict['booking2']), None)
                
                if b1 and b2:
                    # Check assignment types
                    b1_assignment = self.db.query(RoomAssignment).filter(
                        RoomAssignment.booking_id == conflict['booking1']
                    ).first()
                    b2_assignment = self.db.query(RoomAssignment).filter(
                        RoomAssignment.booking_id == conflict['booking2']
                    ).first()
                    
                    b1_is_manager = b1_assignment and b1_assignment.assigned_by == 'manager'
                    b2_is_manager = b2_assignment and b2_assignment.assigned_by == 'manager'
                    b1_protected = conflict['booking1'] in protected_booking_ids
                    b2_protected = conflict['booking2'] in protected_booking_ids
                    
                    # Both manager-placed: never auto-unassign one. Swaps and manual doubles often overlap
                    # physically until the second move; GET /api/day re-runs assign_rooms and used to delete
                    # the "second" booking here, so the UI looked like changes "reverted".
                    if b1_is_manager and b2_is_manager:
                        logger.info(
                            "  Skipping conflict cleanup: both bookings are manager-assigned (%s vs %s)",
                            conflict['booking1'][:16],
                            conflict['booking2'][:16],
                        )
                        continue
                    
                    # Choose victim: manager > auto; if both auto, unassign b2. NEVER unassign protected (checked-in or finished).
                    if b1_is_manager:
                        victim_b, victim_assignment, victim_booking_id = b2, b2_assignment, conflict['booking2']
                    elif b2_is_manager:
                        victim_b, victim_assignment, victim_booking_id = b1, b1_assignment, conflict['booking1']
                    else:
                        victim_b, victim_assignment, victim_booking_id = b2, b2_assignment, conflict['booking2']
                    
                    if victim_booking_id in protected_booking_ids:
                        victim_b, victim_assignment, victim_booking_id = (b1, b1_assignment, conflict['booking1']) if victim_booking_id == conflict['booking2'] else (b2, b2_assignment, conflict['booking2'])
                    if victim_booking_id in protected_booking_ids:
                        logger.error(f"  Both bookings are protected (checked-in or finished); cannot unassign either. Conflict left unresolved.")
                        continue
                    
                    keeper_id = conflict['booking2'] if victim_booking_id == conflict['booking1'] else conflict['booking1']
                    logger.info(f"  Resolving conflict: keeping {keeper_id[:20]}..., unassigning {victim_booking_id[:20]}...")
                    if victim_assignment:
                        self.db.delete(victim_assignment)
                    victim_b['room'] = 'UNASSIGNED'
                    victim_b['reason'] = f"Conflict with booking {keeper_id[:20]}..."
            
            self.db.commit()

        # Conflict cleanup can unassign the "auto" side even when other single rooms are still free
        # (e.g. false overlap on one physical key while 1/3/4/2/0 remain open). Re-try placement from
        # a fresh occupancy map so victims land in a real free room when one exists.
        self._repair_unassigned_bookings_after_conflicts(
            sorted_bookings,
            room_locked_booking_ids,
            protected_booking_ids,
            pair_auto_assigned,
            ov_map,
            date,
            couple_time_bounds,
        )

        return sorted_bookings

    def _repair_unassigned_bookings_after_conflicts(
        self,
        sorted_bookings: List[Dict],
        room_locked_booking_ids: set,
        protected_booking_ids: set,
        pair_auto_assigned: Set[str],
        ov_map: Dict[str, Any],
        date: str,
        couple_time_bounds: List[Tuple[float, float]],
    ) -> None:
        """Re-run auto room pick for UNASSIGNED bookings after conflict resolution."""
        import logging

        logger = logging.getLogger(__name__)

        def build_ri() -> Dict[str, List[Tuple[float, float]]]:
            ri: Dict[str, List[Tuple[float, float]]] = {k: [] for k in _ROOM_OCCUPANCY_KEYS}
            for b in sorted_bookings:
                r = b.get("room")
                if not r or r in ("UNASSIGNED", "ADDON"):
                    continue
                self._mark_room_busy(r, b, ri, ov_map.get(b["booking_id"]))
            return ri

        ri = build_ri()
        candidates = [
            b
            for b in sorted_bookings
            if b.get("room") == "UNASSIGNED"
            and b["booking_id"] not in room_locked_booking_ids
            and b["booking_id"] not in protected_booking_ids
            and b["booking_id"] not in pair_auto_assigned
            and not booking_is_room_neutral_addon_only((b.get("service") or "").strip())
            and not (
                ov_map.get(b["booking_id"])
                and getattr(ov_map[b["booking_id"]], "room_placement_override", False)
            )
            and (b.get("type") or "single") in ("single", "couple")
        ]
        candidates.sort(key=self._booking_time_bounds)
        repaired = False
        for b in candidates:
            room, reason = self._find_available_room(
                b, ri, couple_time_bounds=couple_time_bounds
            )
            if room == "UNASSIGNED":
                continue
            b["room"] = room
            b["reason"] = reason
            self._mark_room_busy(room, b, ri, ov_map.get(b["booking_id"]))
            self._persist_auto_assignment(b["booking_id"], room, reason, date)
            repaired = True
            logger.info(
                "Repair after conflicts: booking %s → room %s",
                b["booking_id"][:18],
                room,
            )
        if repaired:
            try:
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise

    @staticmethod
    def _room_free_for_interval(
        room_intervals: Dict[str, List[Tuple[float, float]]],
        room: str,
        start_ts: float,
        end_ts: float,
    ) -> bool:
        for s, e in room_intervals.get(room, []):
            if _intervals_overlap(s, e, start_ts, end_ts):
                return False
        return True

    @staticmethod
    def _blocking_interval_end(
        room_intervals: Dict[str, List[Tuple[float, float]]],
        room: str,
        start_ts: float,
        end_ts: float,
    ) -> Optional[float]:
        """Latest end time among intervals on room that overlap [start_ts, end_ts)."""
        latest = None
        for s, e in room_intervals.get(room, []):
            if _intervals_overlap(s, e, start_ts, end_ts):
                latest = e if latest is None else max(latest, e)
        return latest

    def _room_assignment_row_for_booking(self, booking_id: str) -> Optional[RoomAssignment]:
        """DB row or pending RoomAssignment in this session (get() alone can miss session.new in some cases)."""
        row = self.db.get(RoomAssignment, booking_id)
        if row is not None:
            return row
        for obj in tuple(self.db.new):
            if isinstance(obj, RoomAssignment) and obj.booking_id == booking_id:
                return obj
        return None

    def _persist_auto_assignment(
        self, booking_id: str, room: str, reason: Optional[str], date: str
    ) -> None:
        existing = self._room_assignment_row_for_booking(booking_id)
        if not existing:
            self.db.add(
                RoomAssignment(
                    booking_id=booking_id,
                    room=room,
                    assigned_by='auto',
                    date=date,
                    reason=reason,
                )
            )
        elif existing.assigned_by == 'auto':
            existing.room = room
            existing.reason = reason
            existing.date = date
            existing.updated_at = datetime.now()

    @staticmethod
    def _booking_time_bounds(booking: Dict) -> Tuple[float, float]:
        start_str = booking['start_at']
        end_str = booking['end_at']
        if start_str.endswith('Z'):
            start_str = start_str.replace('Z', '+00:00')
        if end_str.endswith('Z'):
            end_str = end_str.replace('Z', '+00:00')
        s = datetime.fromisoformat(start_str).timestamp()
        e = datetime.fromisoformat(end_str).timestamp()
        return s, e

    @staticmethod
    def _intervals_overlap_bookings(a: Dict, b: Dict) -> bool:
        a0, a1 = RoomAssigner._booking_time_bounds(a)
        b0, b1 = RoomAssigner._booking_time_bounds(b)
        return _intervals_overlap(a0, a1, b0, b1)

    @staticmethod
    def _booking_duration_minutes(booking: Dict) -> int:
        try:
            a0, a1 = RoomAssigner._booking_time_bounds(booking)
            return max(0, int(round((a1 - a0) / 60.0)))
        except Exception:
            return 0

    def _build_occupancy_intervals_excluding_set(
        self,
        bookings: List[Dict],
        exclude_booking_ids: set,
        ov_map: Dict[str, Any],
    ) -> Dict[str, List[Tuple[float, float]]]:
        ri: Dict[str, List[Tuple[float, float]]] = {k: [] for k in _ROOM_OCCUPANCY_KEYS}
        for b in bookings:
            if b['booking_id'] in exclude_booking_ids:
                continue
            r = b.get('room')
            if not r or r == 'UNASSIGNED':
                continue
            self._mark_room_busy(r, b, ri, ov_map.get(b['booking_id']))
        return ri

    def _build_occupancy_intervals_excluding(
        self,
        bookings: List[Dict],
        exclude_booking_id: str,
        ov_map: Dict[str, Any],
    ) -> Dict[str, List[Tuple[float, float]]]:
        return self._build_occupancy_intervals_excluding_set(bookings, {exclude_booking_id}, ov_map)

    def _find_available_room_for_single_priority(
        self,
        booking: Dict,
        room_intervals: Dict[str, List[Tuple[float, float]]],
        room_order: List[str],
    ) -> Tuple[str, Optional[str]]:
        start_str = booking['start_at']
        end_str = booking['end_at']
        if start_str.endswith('Z'):
            start_str = start_str.replace('Z', '+00:00')
        if end_str.endswith('Z'):
            end_str = end_str.replace('Z', '+00:00')
        start_ts = datetime.fromisoformat(start_str).timestamp()
        end_ts = datetime.fromisoformat(end_str).timestamp()
        for room in room_order:
            if self._room_free_for_interval(room_intervals, room, start_ts, end_ts):
                return room, None
        return 'UNASSIGNED', 'No single/convertible room free for this slot'

    def _movable_for_rebalance(
        self,
        b: Dict,
        room_locked_booking_ids: set,
        protected_booking_ids: set,
        ov_map: Dict[str, Any],
    ) -> bool:
        bid = b['booking_id']
        if bid in room_locked_booking_ids or bid in protected_booking_ids:
            return False
        ov = ov_map.get(bid)
        if ov and getattr(ov, 'room_placement_override', False):
            return False
        return True

    def _rebalance_one_unassigned_couple(
        self,
        sorted_bookings: List[Dict],
        room_locked_booking_ids: set,
        protected_booking_ids: set,
        ov_map: Dict[str, Any],
        date: str,
    ) -> bool:
        """
        If a couple booking is still UNASSIGNED, try to free Rm 5 or 6 by moving an overlapping
        auto single into fixed/convertible singles only (1,3,4,2,0).

        Also try to free merged 02D (physical 0+2): a single in Rm 0 or Rm 2 blocks the whole 02D
        double even when Rm 5/6 are still free — move that single (e.g. 2→5) so the couple can take 02D.

        Depth-2: if that single is blocked on the only free single slot by another auto single
        (e.g. Anwar cannot take Rm 2 while Emily is still there until 3:30), move the blocker first
        — including into the couple room if it is back-to-back with the couple (no time overlap).
        """
        import logging

        logger = logging.getLogger(__name__)

        couple = None
        for b in sorted_bookings:
            if (b.get('type') or 'single') == 'couple' and b.get('room') == 'UNASSIGNED':
                couple = b
                break
        if not couple:
            return False

        c0, c1 = self._booking_time_bounds(couple)

        for double_room in ['5', '6']:
            candidates: List[Dict] = []
            for b in sorted_bookings:
                if b is couple:
                    continue
                if (b.get('type') or 'single') == 'couple':
                    continue
                if b.get('room') != double_room:
                    continue
                if not self._intervals_overlap_bookings(couple, b):
                    continue
                if not self._movable_for_rebalance(b, room_locked_booking_ids, protected_booking_ids, ov_map):
                    continue
                candidates.append(b)

            candidates.sort(key=self._booking_duration_minutes)

            for s in candidates:
                ri = self._build_occupancy_intervals_excluding(sorted_bookings, s['booking_id'], ov_map)
                if not self._room_free_for_interval(ri, double_room, c0, c1):
                    continue
                if booking_requires_back_walking_bar_room(s):
                    s_order = _single_room_order_deprioritize_room3_for_facial(s, ["1", "3", "4"])
                else:
                    s_order = _single_room_order_deprioritize_room3_for_facial(s, list(_BASE_SINGLE_PHYSICAL_ORDER))
                new_room, new_reason = self._find_available_room_for_single_priority(s, ri, s_order)
                if new_room == 'UNASSIGNED':
                    continue

                old = s['room']
                s['room'] = new_room
                s['reason'] = new_reason
                couple['room'] = double_room
                couple['reason'] = None

                self._persist_auto_assignment(s['booking_id'], new_room, new_reason, date)
                self._persist_auto_assignment(couple['booking_id'], double_room, None, date)

                logger.info(
                    "Rebalance: single %s %s→%s so couple %s can use %s",
                    s['booking_id'][:18],
                    old,
                    new_room,
                    couple['booking_id'][:18],
                    double_room,
                )
                return True

            # Depth-2 chain: move blocker off a single room so the overlapping single on 5/6 can take it,
            # then place the couple on 5/6 (e.g. Emily 2→5 before Shawn 3:30, Anwar 5→2).
            for s in candidates:
                ri_b = self._build_occupancy_intervals_excluding_set(
                    sorted_bookings, {s['booking_id']}, ov_map
                )
                if not self._room_free_for_interval(ri_b, double_room, c0, c1):
                    continue
                b0, b1 = self._booking_time_bounds(s)
                if booking_requires_back_walking_bar_room(s):
                    s_try_rooms = _single_room_order_deprioritize_room3_for_facial(s, ["1", "3", "4"])
                else:
                    s_try_rooms = _single_room_order_deprioritize_room3_for_facial(s, list(_BASE_SINGLE_PHYSICAL_ORDER))
                for r in s_try_rooms:
                    if self._room_free_for_interval(ri_b, r, b0, b1):
                        continue
                    occupiers = [
                        e
                        for e in sorted_bookings
                        if e is not couple
                        and e['booking_id'] != s['booking_id']
                        and e.get('room') == r
                        and (e.get('type') or 'single') != 'couple'
                        and self._intervals_overlap_bookings(s, e)
                        and self._movable_for_rebalance(
                            e, room_locked_booking_ids, protected_booking_ids, ov_map
                        )
                    ]
                    occupiers.sort(key=self._booking_duration_minutes)
                    for e in occupiers:
                        ri_be = self._build_occupancy_intervals_excluding_set(
                            sorted_bookings, {s['booking_id'], e['booking_id']}, ov_map
                        )
                        if not self._room_free_for_interval(ri_be, double_room, c0, c1):
                            continue
                        e0, e1 = self._booking_time_bounds(e)
                        e_singles = (
                            ["1", "3", "4"]
                            if booking_requires_back_walking_bar_room(e)
                            else list(_BASE_SINGLE_PHYSICAL_ORDER)
                        )
                        r2_order = ["5", "6"] + _single_room_order_deprioritize_room3_for_facial(e, e_singles)
                        for r2 in r2_order:
                            if r2 == r:
                                continue
                            if r2 == double_room and self._intervals_overlap_bookings(e, couple):
                                continue
                            if not self._room_free_for_interval(ri_be, r2, e0, e1):
                                continue
                            if not self._room_free_for_interval(ri_be, r, b0, b1):
                                continue
                            if not self._room_free_for_interval(ri_be, double_room, c0, c1):
                                continue

                            e_old, s_old = e['room'], s['room']
                            e['room'] = r2
                            e['reason'] = None
                            s['room'] = r
                            s['reason'] = None
                            couple['room'] = double_room
                            couple['reason'] = None

                            self._persist_auto_assignment(e['booking_id'], r2, None, date)
                            self._persist_auto_assignment(s['booking_id'], r, None, date)
                            self._persist_auto_assignment(couple['booking_id'], double_room, None, date)

                            logger.info(
                                "Rebalance chain: %s %s→%s, %s %s→%s, couple %s→%s",
                                e['booking_id'][:16],
                                e_old,
                                r2,
                                s['booking_id'][:16],
                                s_old,
                                r,
                                couple['booking_id'][:16],
                                double_room,
                            )
                            return True

        # Free merged 02D: singles on physical 0 or 2 block the couple double; allow any free room
        # including 5/6 as destinations (unlike the 5/6 rebalance above, which only frees doubles).
        conv_candidates: List[Dict] = []
        for b in sorted_bookings:
            if b is couple:
                continue
            if (b.get("type") or "single") == "couple":
                continue
            if b.get("room") not in ("0", "2"):
                continue
            if not self._intervals_overlap_bookings(couple, b):
                continue
            if not self._movable_for_rebalance(b, room_locked_booking_ids, protected_booking_ids, ov_map):
                continue
            conv_candidates.append(b)
        conv_candidates.sort(key=self._booking_duration_minutes)
        for s in conv_candidates:
            ri = self._build_occupancy_intervals_excluding(sorted_bookings, s["booking_id"], ov_map)
            if not self._room_free_for_interval(ri, "0", c0, c1):
                continue
            if not self._room_free_for_interval(ri, "2", c0, c1):
                continue
            old = s["room"]
            if booking_requires_back_walking_bar_room(s):
                s_order = _single_room_order_deprioritize_room3_for_facial(s, ["1", "3", "4"])
            else:
                s_order = _single_room_order_deprioritize_room3_for_facial(s, list(self.SINGLE_PRIORITY))
            s_order = [r for r in s_order if r != old]
            if not s_order:
                continue
            new_room, new_reason = self._find_available_room_for_single_priority(s, ri, s_order)
            if new_room == "UNASSIGNED":
                continue
            s["room"] = new_room
            s["reason"] = new_reason
            couple["room"] = "02D"
            couple["reason"] = None
            self._persist_auto_assignment(s["booking_id"], new_room, new_reason, date)
            self._persist_auto_assignment(couple["booking_id"], "02D", None, date)
            logger.info(
                "Rebalance 02D: single %s %s→%s so couple %s can use 02D",
                s["booking_id"][:18],
                old,
                new_room,
                couple["booking_id"][:18],
            )
            return True

        return False
    
    def _single_should_try_double_rooms_first(
        self,
        start_ts: float,
        end_ts: float,
        couple_time_bounds: List[Tuple[float, float]],
    ) -> bool:
        """
        True if the earliest couple that starts at or after this single ends does so within
        PREFER_DOUBLE_MAX_GAP_BEFORE_NEXT_COUPLE_SEC (same-day runway for back-to-back double room).

        If we only required "some couple later today", a 3:30–4:30 single would still prefer 5/6
        because of a 7pm couple, blocking a 4:00 couples appointment (Kyle) that needs Rm 5/6.
        """
        following_starts = [c0 for c0, _c1 in couple_time_bounds if end_ts <= c0]
        if not following_starts:
            return False
        c0_min = min(following_starts)
        gap = c0_min - end_ts
        if gap >= self.PREFER_DOUBLE_MAX_GAP_BEFORE_NEXT_COUPLE_SEC:
            return False
        return True

    def _find_available_room(
        self,
        booking: Dict,
        room_intervals: Dict[str, List[Tuple[float, float]]],
        couple_time_bounds: Optional[List[Tuple[float, float]]] = None,
    ) -> Tuple[str, Optional[str]]:
        """
        Find an available room for a booking.
        
        Returns:
            Tuple of (room, reason) where reason is None if assigned successfully
        """
        import logging
        logger = logging.getLogger(__name__)
        
        # Parse datetime, handling both with and without timezone
        start_str = booking['start_at']
        end_str = booking['end_at']
        
        if start_str.endswith('Z'):
            start_str = start_str.replace('Z', '+00:00')
        if end_str.endswith('Z'):
            end_str = end_str.replace('Z', '+00:00')
        
        start_dt = datetime.fromisoformat(start_str)
        end_dt = datetime.fromisoformat(end_str)
        start_ts = start_dt.timestamp()
        end_ts = end_dt.timestamp()
        
        booking_id = booking.get('booking_id', 'unknown')[:20]
        booking_type = booking.get('type', 'single')
        
        logger.debug(f"Finding room for booking {booking_id} (type: {booking_type}, time: {start_dt.strftime('%H:%M')}-{end_dt.strftime('%H:%M')})")
        occ_dbg = ", ".join(
            f"{r}:{len(iv)}" for r, iv in sorted(room_intervals.items()) if iv
        )
        logger.debug(f"Current room interval counts: {occ_dbg or 'none'}")

        def is_free(room: str) -> bool:
            """True if [start_ts, end_ts) does not overlap any booking on this room."""
            ok = self._room_free_for_interval(room_intervals, room, start_ts, end_ts)
            if not ok:
                be = self._blocking_interval_end(room_intervals, room, start_ts, end_ts)
                if be is not None:
                    logger.debug(
                        f"  Room {room} BUSY (conflict through {datetime.fromtimestamp(be).strftime('%H:%M')})"
                    )
            else:
                logger.debug(f"  Room {room} FREE for this slot")
            return ok

        def can_use_02d() -> bool:
            """Merged 02D: both physical rooms must be free for the whole slot."""
            return is_free("0") and is_free("2")
        
        if booking_type == 'couple':
            # COUPLE priority: 5 -> 6 -> 02D
            logger.debug(f"  Checking couple rooms in priority order: 5, 6, 02D")
            for room in ['5', '6']:
                if is_free(room):
                    logger.info(f"  ✓ Assigned room {room} to couple booking {booking_id}")
                    return room, None
            
            # Try merged room 0+2 (HARD RULE: both must be free for entire duration)
            # If either 0 or 2 is used by a single, 02D CANNOT be used
            if can_use_02d():
                logger.info(f"  ✓ Assigned room 02D to couple booking {booking_id}")
                return '02D', None
            
            reasons = []
            for label, r in [("Room 5", "5"), ("Room 6", "6"), ("Room 0", "0"), ("Room 2", "2")]:
                if not self._room_free_for_interval(room_intervals, r, start_ts, end_ts):
                    be = self._blocking_interval_end(room_intervals, r, start_ts, end_ts)
                    if be is not None:
                        reasons.append(f"{label} blocked until {datetime.fromtimestamp(be).strftime('%H:%M')}")
                    else:
                        reasons.append(f"{label} blocked for this slot")
            
            logger.warning(f"  ✗ Could not assign couple room to {booking_id}. Reasons: {'; '.join(reasons)}")
            return 'UNASSIGNED', f"No double room available. {'; '.join(reasons)}"
        
        else:  # single
            # Back walking (notes or Exclusive + back walk in service): only Rm 1, 3, 4 have bars — never 0/2/5/6.
            # Couple massages skip this (handled in couple branch above).
            bw_bar = booking_requires_back_walking_bar_room(booking)
            if bw_bar:
                room_order = _single_room_order_deprioritize_room3_for_facial(booking, ["1", "3", "4"])
            else:
                # Default: 1 -> 3 -> 4 -> 2 -> 0 -> 6 -> 5 (longer same-start singles grab 1,3,4 first).
                # Lookahead: when a couple starts soon after this single ends, we may try 5 -> 6 before
                # re-checking 1,3,4,2,0 — but ONLY if every fixed/convertible single room is already busy.
                room_order = list(self.SINGLE_PRIORITY)
                if couple_time_bounds and self._single_should_try_double_rooms_first(
                    start_ts, end_ts, couple_time_bounds
                ):
                    single_suitable = ('1', '3', '4', '2', '0')
                    any_single_free = any(
                        self._room_free_for_interval(room_intervals, r, start_ts, end_ts)
                        for r in single_suitable
                    )
                    if not any_single_free:
                        room_order = ['5', '6'] + [r for r in self.SINGLE_PRIORITY if r not in ('5', '6')]
                room_order = _single_room_order_deprioritize_room3_for_facial(booking, room_order)
            logger.debug(f"  Checking single rooms in priority order: {', '.join(room_order)}")
            for room in room_order:
                if is_free(room):
                    logger.info(f"  ✓ Assigned room {room} to single booking {booking_id}")
                    return room, None
            
            # If no room available, check if 02D is blocking 0 and 2
            # If so, we might be able to use 6 or 5 (but they're already checked)
            # Build detailed reason
            reasons = []
            for room in room_order:
                if not is_free(room):
                    be = self._blocking_interval_end(room_intervals, room, start_ts, end_ts)
                    if be is not None:
                        reasons.append(f"Room {room} blocked until {datetime.fromtimestamp(be).strftime('%H:%M')}")
                    else:
                        reasons.append(f"Room {room} blocked for this slot")

            logger.warning(f"  ✗ Could not assign single room to {booking_id}. Reasons: {'; '.join(reasons)}")
            if bw_bar:
                return (
                    "UNASSIGNED",
                    f"No bar room (Rm 1, 3, or 4) free for back walking. {'; '.join(reasons)}",
                )
            if self._room_free_for_interval(room_intervals, "5", start_ts, end_ts):
                logger.error(
                    f"  ⚠ BUG DETECTED: Room 5 is free for this slot but was not assigned "
                    f"({start_dt.strftime('%H:%M')}-{end_dt.strftime('%H:%M')})"
                )
                logger.error(f"  🔧 FIXING: Assigning room 5 to {booking_id}")
                return "5", "Room 5 was available but not checked properly - fixed"
            return 'UNASSIGNED', f"No room available. {'; '.join(reasons)}"
    
    def _mark_room_busy(
        self,
        room: str,
        booking: Dict,
        room_intervals: Dict[str, List[Tuple[float, float]]],
        ov: Any = None,
    ):
        """Record occupancy on physical room(s); 02D uses split intervals when couple single-facial override is set."""
        bseg = {**booking, "room": room}
        for phys_r, stf, etf in physical_busy_segments_ts(bseg, ov):
            if phys_r in room_intervals:
                room_intervals[phys_r].append((stf, etf))

