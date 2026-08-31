"""
Single source of truth for rooms, priority orders, and the overlap tolerance.

Previously these lists were maintained separately in room_assigner.py and
unassigned_suggestions.py (m2 todo). Change them here only.
"""

# Physical rooms tracked for occupancy (virtual "02D" occupies 0 + 2).
PHYSICAL_ROOM_KEYS = ("0", "1", "2", "3", "4", "5", "6")

SINGLE_ONLY_ROOMS = ("1", "3", "4")  # fixed single rooms
DOUBLE_ROOMS = ("5", "6")            # fixed double rooms (can host a single)
CONVERTIBLE_ROOMS = ("0", "2")       # single rooms, or merged into virtual "02D"
MERGED_DOUBLE_ROOM = "02D"

# Preference orders, best room first.
COUPLE_PRIORITY = ("5", "6", "02D")
SINGLE_PRIORITY = ("1", "3", "4", "2", "0", "6", "5")
BASE_SINGLE_PHYSICAL_ORDER = ("1", "3", "4", "2", "0")
# Single facial: 4/0/2 best, Rm 3 last (handled by the facial reorder helper).
FACIAL_SINGLE_TRY_ORDER = ("4", "0", "2", "1", "6", "5")
# Only these rooms have ceiling bars for back walking.
BACK_WALKING_BAR_ROOMS = ("1", "3", "4")

# End/start from Square can differ by a few seconds on logically back-to-back
# appointments. Touching boundaries or clock crumbs under this width must not
# count as double-booking (historic "Room 5 free but UNASSIGNED" root cause).
OCCUPANCY_MIN_OVERLAP_SEC = 2.0


def intervals_overlap(a0: float, a1: float, b0: float, b1: float) -> bool:
    """True if [a0, a1) and [b0, b1) overlap by strictly more than the tolerance."""
    if a1 <= a0 or b1 <= b0:
        return False
    return (min(a1, b1) - max(a0, b0)) > OCCUPANCY_MIN_OVERLAP_SEC
