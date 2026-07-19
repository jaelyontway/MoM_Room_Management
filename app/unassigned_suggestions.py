"""

Heuristic suggestions when one or more appointments are UNASSIGNED: least-disruptive

room or time options (direct open room, one neighbor room move, or Square time nudge).

"""

from __future__ import annotations



from datetime import datetime, timedelta, timezone

from typing import Any, Dict, List, Optional, Tuple



from dateutil import parser as du_parser



# Match room_assigner boundary tolerance (avoid false overlaps on back-to-back bookings).

_MIN_OVERLAP_SEC = 2.0



_COUPLE_ROOMS = ("5", "6", "02D")

_SINGLE_ROOMS = ("1", "3", "4", "2", "0", "6", "5")

_PHYSICAL_ROOMS = tuple(dict.fromkeys(list(_COUPLE_ROOMS) + list(_SINGLE_ROOMS)))





def _parse_iso_to_ts(iso: str) -> Optional[float]:

    if not iso or not isinstance(iso, str):

        return None

    try:

        s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso

        return datetime.fromisoformat(s).timestamp()

    except Exception:

        try:

            return du_parser.parse(iso).timestamp()

        except Exception:

            return None





def _intervals_overlap(a0: float, a1: float, b0: float, b1: float) -> bool:

    if a1 <= a0 or b1 <= b0:

        return False

    return (min(a1, b1) - max(a0, b0)) > _MIN_OVERLAP_SEC





def _event_window(ev: Dict[str, Any]) -> Optional[Tuple[float, float]]:

    t0 = _parse_iso_to_ts(ev.get("start_at") or "")

    t1 = _parse_iso_to_ts(ev.get("end_at") or "")

    if t0 is None or t1 is None or t1 <= t0:

        return None

    return (t0, t1)





def _norm_room(r: Optional[str]) -> Optional[str]:

    if not r or not isinstance(r, str):

        return None

    x = r.strip()

    if x in ("UNASSIGNED", "ADDON", ""):

        return None

    return x





def _candidate_rooms_for_unassigned(ev: Dict[str, Any]) -> Tuple[str, ...]:

    if (ev.get("type") or "").lower() == "couple":

        return _COUPLE_ROOMS

    return _SINGLE_ROOMS





def _occupancy(ev_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:

    rows: List[Dict[str, Any]] = []

    for ev in ev_list:

        room = _norm_room(ev.get("room"))

        if not room or room not in _PHYSICAL_ROOMS:

            continue

        w = _event_window(ev)

        if not w:

            continue

        rows.append(

            {

                "room": room,

                "t0": w[0],

                "t1": w[1],

                "booking_id": ev.get("booking_id") or "",

                "customer": (ev.get("customer") or "").strip() or "Customer",

                "room_locked": bool(ev.get("room_locked")),

            }

        )

    return rows





def _room_free_for_window(

    occ: List[Dict[str, Any]], room: str, t0: float, t1: float, ignore_booking_id: Optional[str] = None

) -> bool:

    for o in occ:

        if o["room"] != room:

            continue

        if ignore_booking_id and o["booking_id"] == ignore_booking_id:

            continue

        if _intervals_overlap(t0, t1, o["t0"], o["t1"]):

            return False

    return True





def _overlapping_on_room(occ: List[Dict[str, Any]], room: str, t0: float, t1: float) -> List[Dict[str, Any]]:

    out: List[Dict[str, Any]] = []

    for o in occ:

        if o["room"] != room:

            continue

        if _intervals_overlap(t0, t1, o["t0"], o["t1"]):

            out.append(o)

    return out





def compute_unassigned_fix_suggestions(events: List[Any], date: str) -> List[Dict[str, Any]]:

    """

    Return ordered suggestions (tier 0 = no other customers, 1 = one room move, 2 = Square time change for unassigned).

    """

    ev_list: List[Dict[str, Any]] = []

    for e in events:

        if hasattr(e, "model_dump"):

            ev_list.append(e.model_dump(mode="python"))

        else:

            ev_list.append(dict(e))



    unassigned = [e for e in ev_list if (e.get("room") or "").strip().upper() == "UNASSIGNED"]

    if not unassigned:

        return []



    occ = _occupancy(ev_list)

    suggestions: List[Dict[str, Any]] = []

    max_total = 10



    for u in unassigned:

        if len(suggestions) >= max_total:

            break

        uw = _event_window(u)

        if not uw:

            continue

        u0, u1 = uw

        bid = u.get("booking_id") or ""

        cust = (u.get("customer") or "").strip() or "Customer"

        cand_rooms = _candidate_rooms_for_unassigned(u)



        # Tier 0: direct assign — list up to 3 candidate rooms that are free for U's window

        direct_added = 0

        for room in cand_rooms:

            if len(suggestions) >= max_total or direct_added >= 3:

                break

            if _room_free_for_window(occ, room, u0, u1, ignore_booking_id=bid):

                suggestions.append(

                    {

                        "tier": 0,

                        "template": "assign_direct",

                        "booking_id": bid,

                        "customer": cust,

                        "room": room,

                        "date": date,

                    }

                )

                direct_added += 1



        if direct_added:

            continue



        # Tier 1: move one unlocked neighbor from room R to alt so R is free for U

        if len(suggestions) >= max_total:

            break

        found_t1 = False

        for room in cand_rooms:

            if found_t1:

                break

            overlaps = _overlapping_on_room(occ, room, u0, u1)

            for o in overlaps:

                if o.get("room_locked"):

                    continue

                ob = o["booking_id"]

                o0, o1 = o["t0"], o["t1"]

                occ_minus = [x for x in occ if not (x["booking_id"] == ob and x["room"] == room)]

                for alt in _PHYSICAL_ROOMS:

                    if alt == room:

                        continue

                    if not _room_free_for_window(occ_minus, alt, o0, o1, ignore_booking_id=ob):

                        continue

                    if not _room_free_for_window(occ_minus, room, u0, u1, ignore_booking_id=bid):

                        continue

                    suggestions.append(

                        {

                            "tier": 1,

                            "template": "move_then_assign",

                            "booking_id": bid,

                            "customer": cust,

                            "room": room,

                            "other_booking_id": ob,

                            "other_customer": o.get("customer") or "Customer",

                            "from_room": room,

                            "to_room": alt,

                            "date": date,

                        }

                    )

                    found_t1 = True

                    break

            if found_t1:

                break



        if found_t1:

            continue



        # Tier 2: shift unassigned start time in 15-min steps (keeps duration) — only the unassigned booking’s time changes

        if len(suggestions) >= max_total:

            break

        dur_sec = u1 - u0

        u0_dt = datetime.fromtimestamp(u0, tz=timezone.utc)

        found_t2 = False

        for delta_min in range(-180, 181, 15):

            if len(suggestions) >= max_total or found_t2:

                break

            n0_dt = u0_dt + timedelta(minutes=delta_min)

            n1_dt = n0_dt + timedelta(seconds=dur_sec)

            n0 = n0_dt.timestamp()

            n1 = n1_dt.timestamp()

            for room in cand_rooms:

                if _room_free_for_window(occ, room, n0, n1, ignore_booking_id=bid):

                    suggestions.append(

                        {

                            "tier": 2,

                            "template": "square_time_shift",

                            "booking_id": bid,

                            "customer": cust,

                            "room": room,

                            "new_start_at_iso": n0_dt.isoformat(),

                            "new_end_at_iso": n1_dt.isoformat(),

                            "delta_minutes": delta_min,

                            "date": date,

                        }

                    )

                    found_t2 = True

                    break



    suggestions.sort(key=lambda s: (s.get("tier", 9), abs(int(s.get("delta_minutes") or 0)) if s.get("template") == "square_time_shift" else 0))

    return suggestions[:max_total]


