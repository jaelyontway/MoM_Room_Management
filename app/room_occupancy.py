"""
Physical room occupancy segments for calendar / assigner / next-available.

02D normally blocks rooms 0 and 2 for the full booking. When a couple is in 02D with
facial+m massage and staff confirms only one client receives the facial, the merged
room is split for the facial portion: room 0 is free from facial start onward; room 2
stays busy for the full appointment (facial in Rm 2).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


def _parse_iso_to_ts(iso: str) -> float:
    s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
    return datetime.fromisoformat(s).timestamp()


def duration_minutes(start_at: str, end_at: str) -> int:
    try:
        start = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
        return int((end - start).total_seconds() / 60)
    except Exception:
        return 0


def facial_massage_minutes(service: Optional[str], duration_min: int) -> Tuple[int, int]:
    """Return (massage_min, facial_min) for tip/split logic; total ~= duration."""
    lower = (service or "").lower()
    if (
        ("custom facial" in lower or "facial custom" in lower or "facial package" in lower)
        and "massage" in lower
        and ("90 min" in lower or "90min" in lower or " 90 " in lower)
    ):
        return (90, 30)
    if "60 min" in lower and "massage" in lower:
        massage_min = 60
        facial_min = max(0, duration_min - massage_min)
        return (massage_min, facial_min)
    if ("basic facial" in lower or "facial basic" in lower) and duration_min <= 65:
        return (30, 25)
    if ("custom facial" in lower or "facial custom" in lower) and 75 <= duration_min <= 105:
        if duration_min >= 88:
            return (60, 30)
        return (60, 25)
    # Long couples + custom facial + massage (e.g. 60 min couples massage + 90 min facial = 150)
    if (
        ("custom facial" in lower or "facial custom" in lower)
        and "massage" in lower
        and duration_min > 105
        and ("couple" in lower or "couples" in lower)
    ):
        m = 60
        return (m, max(0, duration_min - m))
    # Couples + basic facial + massage beyond the short 65-min path
    if (
        ("basic facial" in lower or "facial basic" in lower)
        and "massage" in lower
        and duration_min > 65
        and ("couple" in lower or "couples" in lower)
    ):
        m = 60
        return (m, max(0, duration_min - m))
    half = duration_min // 2
    return (half, duration_min - half)


def is_couple_facial_with_massage(
    service: Optional[str], booking_type: str, start_at: str, end_at: str
) -> bool:
    if (booking_type or "").lower() != "couple":
        return False
    lower = (service or "").lower().strip()
    if not lower:
        return False
    duration_min = duration_minutes(start_at, end_at)
    if ("basic facial" in lower or "facial basic" in lower) and "massage" in lower and 85 <= duration_min <= 240:
        return True
    if ("custom facial" in lower or "facial custom" in lower or "facial package" in lower) and "massage" in lower and 70 <= duration_min <= 240:
        return True
    if ("facial" in lower and "massage" in lower) and 70 <= duration_min <= 240:
        return True
    if "90" in lower and "facial" in lower and "massage" in lower and 70 <= duration_min <= 240:
        return True
    # Couple + facial in title; "massage" may be abbreviated (e.g. "w 90 min massage") or omitted in package names
    if ("couple" in lower or "couples" in lower) and "facial" in lower and 85 <= duration_min <= 240:
        if "package" in lower or "relax" in lower:
            return True
    return False


# Couple rooms where “one client facial only” split is supported (calendar + occupancy).
_COUPLE_SPLIT_ROOMS = frozenset({"02D", "5", "6"})
_PHYSICAL_ROOM_IDS = frozenset({"0", "1", "2", "3", "4", "5", "6"})


def _couple_single_facial_split_bounds(booking: Dict, ov: Optional[Any]) -> Optional[Tuple[float, float, float]]:
    """If split applies, return (start_ts, facial_start_ts, end_ts); else None."""
    room = booking.get("room") or ""
    if room not in _COUPLE_SPLIT_ROOMS:
        return None
    flag = ov is not None and getattr(ov, "couple_02d_single_facial_only", None) is True
    if not flag or not is_couple_facial_with_massage(
        booking.get("service"),
        booking.get("type") or "",
        booking["start_at"],
        booking["end_at"],
    ):
        return None
    dur = duration_minutes(booking["start_at"], booking["end_at"])
    m_min, f_min = facial_massage_minutes(booking.get("service"), dur)
    if m_min <= 0 or f_min <= 0:
        return None
    start_ts = _parse_iso_to_ts(booking["start_at"])
    end_ts = _parse_iso_to_ts(booking["end_at"])
    facial_start_ts = start_ts + m_min * 60.0
    if facial_start_ts >= end_ts:
        return None
    return (start_ts, facial_start_ts, end_ts)


def physical_busy_segments_ts(
    booking: Dict,
    ov: Optional[Any],
) -> List[Tuple[str, float, float]]:
    """
    Return list of (physical_room, start_ts, end_ts) for occupancy.
    booking must include room, start_at, end_at, service, type.
    """
    room = booking.get("room") or ""
    if not room or room == "UNASSIGNED" or room == "ADDON":
        return []
    start_ts = _parse_iso_to_ts(booking["start_at"])
    end_ts = _parse_iso_to_ts(booking["end_at"])

    bounds = _couple_single_facial_split_bounds(booking, ov)
    if bounds is not None:
        _, facial_start_ts, _ = bounds
        fr = (getattr(ov, "facial_portion_room", None) or "").strip() if ov else ""
        if room == "02D":
            if fr in _PHYSICAL_ROOM_IDS and fr != "2":
                return [
                    ("0", start_ts, facial_start_ts),
                    ("2", start_ts, end_ts),
                    (fr, facial_start_ts, end_ts),
                ]
            return [("0", start_ts, facial_start_ts), ("2", start_ts, end_ts)]
        # Rm 5 or 6: couples massage until facial starts; optional second room for facial
        if fr in _PHYSICAL_ROOM_IDS:
            return [(room, start_ts, facial_start_ts), (fr, facial_start_ts, end_ts)]
        return [(room, start_ts, facial_start_ts)]

    if room == "02D":
        return [("0", start_ts, end_ts), ("2", start_ts, end_ts)]
    return [(room, start_ts, end_ts)]


def facial_segment_start_iso(booking: Dict, ov: Optional[Any]) -> Optional[str]:
    """ISO datetime when facial portion begins (couple split on 02D / 5 / 6), or None."""
    bounds = _couple_single_facial_split_bounds(booking, ov)
    if bounds is None:
        return None
    try:
        from dateutil import parser as dateutil_parser
        from datetime import timedelta

        st = dateutil_parser.parse(booking["start_at"])
        dur = duration_minutes(booking["start_at"], booking["end_at"])
        m_min, _ = facial_massage_minutes(booking.get("service"), dur)
        return (st + timedelta(minutes=m_min)).isoformat()
    except Exception:
        return None
