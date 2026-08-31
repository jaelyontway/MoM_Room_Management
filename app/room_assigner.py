"""
Room assignment: business rules + one-shot CP-SAT day solve.

Replaces the old greedy assignment with its rebalance / conflict-cleanup /
repair patch passes. The whole day is solved atomically in app/room_solver.py:
if an all-assigned solution exists it is found, so the "room free but
UNASSIGNED" class of bugs cannot occur by construction.
"""
import logging
import re
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from app.models import RoomAssignment
from app.room_constants import (
    BACK_WALKING_BAR_ROOMS,
    COUPLE_PRIORITY,
    FACIAL_SINGLE_TRY_ORDER,
    SINGLE_PRIORITY,
    intervals_overlap as _intervals_overlap,
)
from app.room_occupancy import physical_busy_segments_ts
from app.room_solver import RoomRequest, Segment, segments_conflict, solve_day

logger = logging.getLogger(__name__)

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


def _parse_iso_timestamp(iso: str) -> float:
    s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
    return datetime.fromisoformat(s).timestamp()


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
    ranked = [r for r in FACIAL_SINGLE_TRY_ORDER if r in allowed]
    rest = [r for r in order if r not in ranked and r != "3"]
    if "3" in allowed:
        return ranked + rest + ["3"]
    return ranked + rest


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


def _booking_time_bounds(booking: Dict) -> Tuple[float, float]:
    return (
        _parse_iso_timestamp(booking["start_at"]),
        _parse_iso_timestamp(booking["end_at"]),
    )


def _booking_duration_minutes(booking: Dict) -> int:
    try:
        s, e = _booking_time_bounds(booking)
        return max(0, int(round((e - s) / 60.0)))
    except Exception:
        return 0


def _sort_key(booking: Dict) -> Tuple[float, int]:
    """Start ascending, duration descending (same order the greedy used)."""
    try:
        s, e = _booking_time_bounds(booking)
    except Exception:
        return (float("inf"), 0)
    return (s, -int((e - s) / 60))


class RoomAssigner:
    """Automatic room assignment based on priority rules (CP-SAT day solve)."""

    COUPLE_PRIORITY = list(COUPLE_PRIORITY)
    SINGLE_PRIORITY = list(SINGLE_PRIORITY)

    def __init__(self, db: Session):
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
        Assign rooms to bookings by solving the whole day at once.

        Args:
            bookings: List of booking dicts with start_at, end_at, type, etc.
            date: Date string in YYYY-MM-DD format
            protected_booking_ids: These booking IDs must never end UNASSIGNED (checked-in or finished).
            freeze_room_booking_ids: Past (ended) or session started — treat existing DB room like manager
                so auto-assign does not reshuffle rooms after start. Early check-in alone should NOT be listed here.

        Returns:
            List of bookings (sorted) with room assignments added.
        """
        protected_booking_ids = protected_booking_ids or set()
        freeze_room_booking_ids = freeze_room_booking_ids or set()
        ov_map: Dict[str, Any] = overrides_by_booking if overrides_by_booking is not None else {}

        locked_rows = self._load_locked_rows(date, freeze_room_booking_ids, ov_map)

        sorted_bookings = sorted(bookings, key=_sort_key)
        by_id = {b["booking_id"]: b for b in sorted_bookings}

        # Locked rooms (manager / frozen / placement-override) are applied as-is.
        for b in sorted_bookings:
            row = locked_rows.get(b["booking_id"])
            if row is not None:
                b["room"] = row.room
                b["reason"] = row.reason

        # Two Square "singles", same customer + slot, notes say "couple room" → one shared double.
        pair_groups = _find_couple_room_note_pair_groups(sorted_bookings, locked_rows)
        pair_partner_by_primary: Dict[str, str] = {}
        pair_member_ids: Set[str] = set()
        for g in pair_groups:
            ida, idb = sorted(g)
            pair_partner_by_primary[ida] = idb
            pair_member_ids.update((ida, idb))

        # Add-on-only bookings never occupy a room (also unsticks manager rows left UNASSIGNED).
        addon_ids: Set[str] = set()
        for b in sorted_bookings:
            bid = b["booking_id"]
            if bid in pair_member_ids:
                continue
            row = locked_rows.get(bid)
            if row is not None and row.room != "UNASSIGNED":
                continue
            if booking_is_room_neutral_addon_only((b.get("service") or "").strip()):
                b["room"] = "ADDON"
                b["reason"] = None
                addon_ids.add(bid)
                self._persist_auto_assignment(bid, "ADDON", None, date)

        # Build solver input.
        fixed_segments: List[Segment] = []
        for b in sorted_bookings:
            row = locked_rows.get(b["booking_id"])
            if row is None or not row.room or row.room in ("UNASSIGNED", "ADDON"):
                continue
            try:
                fixed_segments.extend(
                    physical_busy_segments_ts({**b, "room": row.room}, ov_map.get(b["booking_id"]))
                )
            except Exception:
                logger.warning("Skipping locked booking %s with unparsable times", b["booking_id"][:18])

        requests: List[RoomRequest] = []
        for b in sorted_bookings:
            bid = b["booking_id"]
            if bid in locked_rows or bid in addon_ids:
                continue
            if bid in pair_member_ids and bid not in pair_partner_by_primary:
                continue  # secondary half: gets the primary's room below
            solve_b = {**b, "type": "couple"} if bid in pair_partner_by_primary else b
            try:
                candidates = self._candidate_rooms(solve_b)
                segments_by_room = {
                    r: physical_busy_segments_ts({**solve_b, "room": r}, ov_map.get(bid))
                    for r in candidates
                }
            except Exception:
                b["room"] = "UNASSIGNED"
                b["reason"] = "Invalid start/end time"
                continue
            requests.append(
                RoomRequest(
                    entity_id=bid,
                    candidate_rooms=candidates,
                    segments_by_room=segments_by_room,
                    unassigned_cost=self._unassigned_cost(solve_b, bid in protected_booking_ids),
                )
            )

        assignment = solve_day(requests, fixed_segments)

        # Occupancy of the final layout (for human-readable UNASSIGNED reasons).
        final_segments = list(fixed_segments)
        for req in requests:
            room = assignment.get(req.entity_id)
            if room:
                final_segments.extend(req.segments_by_room.get(room, []))

        for req in requests:
            bid = req.entity_id
            room = assignment.get(req.entity_id)
            targets = [by_id[bid]]
            partner_id = pair_partner_by_primary.get(bid)
            if partner_id and partner_id in by_id:
                targets.append(by_id[partner_id])
            if room:
                for tb in targets:
                    tb["room"] = room
                    tb["reason"] = None
                    self._persist_auto_assignment(tb["booking_id"], room, None, date)
                if partner_id:
                    logger.info(
                        "Couple-room note pair: %s + %s → shared %s",
                        bid[:14], partner_id[:14], room,
                    )
            else:
                reason = self._unassigned_reason(req, final_segments)
                for tb in targets:
                    tb["room"] = "UNASSIGNED"
                    tb["reason"] = reason
                    self._delete_stale_auto_row(tb["booking_id"])
                logger.warning(
                    "No room for booking %s (type: %s): %s",
                    bid[:20], by_id[bid].get("type", "single"), reason,
                )

        self.db.commit()

        self._log_physical_conflicts(sorted_bookings, ov_map, pair_partner_by_primary)

        unassigned_count = sum(1 for b in sorted_bookings if b.get("room") == "UNASSIGNED")
        if unassigned_count:
            logger.warning(
                "Room assignment for %s finished with %d unassigned booking(s) — day is over capacity "
                "for those slots (solver proof: no feasible layout assigns them).",
                date, unassigned_count,
            )
        return sorted_bookings

    # ------------------------------------------------------------------ input

    def _load_locked_rows(
        self,
        date: str,
        freeze_room_booking_ids: set,
        ov_map: Dict[str, Any],
    ) -> Dict[str, RoomAssignment]:
        """Manager rows + frozen (started/past) auto rooms + manager placement overrides."""
        locked = {
            row.booking_id: row
            for row in self.db.query(RoomAssignment).filter(
                RoomAssignment.date == date,
                RoomAssignment.assigned_by == "manager",
            ).all()
        }
        for bid in freeze_room_booking_ids:
            if bid in locked:
                continue
            row = self.db.query(RoomAssignment).filter(
                RoomAssignment.date == date,
                RoomAssignment.booking_id == bid,
            ).first()
            if row and row.room and row.room != "UNASSIGNED":
                locked[bid] = row
        # Manager confirmed placement despite calendar occupancy — never re-solve it.
        for bid, ov in ov_map.items():
            if bid in locked or not getattr(ov, "room_placement_override", False):
                continue
            row = self.db.query(RoomAssignment).filter(
                RoomAssignment.date == date,
                RoomAssignment.booking_id == bid,
            ).first()
            if row and row.room and row.room != "UNASSIGNED":
                locked[bid] = row
        return locked

    @staticmethod
    def _candidate_rooms(booking: Dict) -> List[str]:
        if (booking.get("type") or "single") == "couple":
            return list(COUPLE_PRIORITY)
        if booking_requires_back_walking_bar_room(booking):
            return _single_room_order_deprioritize_room3_for_facial(
                booking, list(BACK_WALKING_BAR_ROOMS)
            )
        return _single_room_order_deprioritize_room3_for_facial(booking, list(SINGLE_PRIORITY))

    @staticmethod
    def _unassigned_cost(booking: Dict, is_protected: bool) -> int:
        """Higher-value bookings are kept assigned first when the day is over capacity."""
        cost = 1_000_000 + 1_000 * _booking_duration_minutes(booking)
        if (booking.get("type") or "single") == "couple":
            cost += 1_000_000
        if is_protected:
            cost += 1_000_000_000  # checked-in / finished: unassign only if physically impossible
        return cost

    # ----------------------------------------------------------------- output

    def _unassigned_reason(self, req: RoomRequest, occupied: List[Segment]) -> str:
        parts = []
        for room in req.candidate_rooms:
            latest = None
            for phys, s0, s1 in req.segments_by_room.get(room, []):
                for op, o0, o1 in occupied:
                    if op == phys and _intervals_overlap(s0, s1, o0, o1):
                        latest = o1 if latest is None else max(latest, o1)
            if latest is not None:
                parts.append(
                    f"Room {room} blocked until {datetime.fromtimestamp(latest).strftime('%H:%M')}"
                )
            else:
                parts.append(f"Room {room} blocked for this slot")
        if req.candidate_rooms == list(COUPLE_PRIORITY):
            return f"No double room available. {'; '.join(parts)}"
        if set(req.candidate_rooms) <= set(BACK_WALKING_BAR_ROOMS):
            return f"No bar room (Rm 1, 3, or 4) free for back walking. {'; '.join(parts)}"
        return f"No room available. {'; '.join(parts)}"

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
                    assigned_by="auto",
                    date=date,
                    reason=reason,
                )
            )
        elif existing.assigned_by == "auto":
            existing.room = room
            existing.reason = reason
            existing.date = date
            existing.updated_at = datetime.now()

    def _delete_stale_auto_row(self, booking_id: str) -> None:
        """Booking ended UNASSIGNED: remove any leftover auto row so the DB matches the calendar."""
        row = self._room_assignment_row_for_booking(booking_id)
        if row is not None and row.assigned_by == "auto":
            self.db.delete(row)

    def _log_physical_conflicts(
        self,
        sorted_bookings: List[Dict],
        ov_map: Dict[str, Any],
        pair_partner_by_primary: Dict[str, str],
    ) -> None:
        """Safety net: solver output should never overlap; manager-vs-manager overlaps are kept (swaps in progress)."""
        pair_ids = set(pair_partner_by_primary.keys()) | set(pair_partner_by_primary.values())
        segs: List[Tuple[str, float, float, str]] = []
        for b in sorted_bookings:
            room = b.get("room")
            if not room or room in ("UNASSIGNED", "ADDON"):
                continue
            try:
                for phys, s0, s1 in physical_busy_segments_ts({**b, "room": room}, ov_map.get(b["booking_id"])):
                    segs.append((phys, s0, s1, b["booking_id"]))
            except Exception:
                continue
        for i, (r1, a0, a1, id1) in enumerate(segs):
            for r2, b0, b1, id2 in segs[i + 1:]:
                if r1 != r2 or id1 == id2:
                    continue
                if id1 in pair_ids and pair_partner_by_primary.get(id1) == id2:
                    continue
                if id2 in pair_ids and pair_partner_by_primary.get(id2) == id1:
                    continue
                if _intervals_overlap(a0, a1, b0, b1):
                    logger.warning(
                        "Physical overlap on room %s: %s vs %s (manager-locked overlap or model gap)",
                        r1, id1[:18], id2[:18],
                    )
