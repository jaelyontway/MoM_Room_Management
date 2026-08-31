"""
Baseline tests for RoomAssigner.assign_rooms (m2 todo: lock current behavior before refactor).

Covers: single/couple priority, 02D hard rule, manager lock, back-walking bar rooms,
facial ordering, add-on-only bookings, note-pair couple rooms, 2-second overlap
tolerance, depth-2 rebalance chain — plus xfail tests documenting known algorithm gaps
that the future solver-based engine must fix.
"""
import pytest

from app.models import RoomAssignment
from app.room_assigner import RoomAssigner

DATE = "2026-08-11"


def t(hhmmss: str) -> str:
    """'14:00' or '16:00:02' -> full ISO timestamp on DATE (spa-local offset)."""
    if len(hhmmss) == 5:
        hhmmss += ":00"
    return f"{DATE}T{hhmmss}-05:00"


def booking(bid, start, end, type_="single", **kw):
    b = {
        "booking_id": bid,
        "start_at": t(start),
        "end_at": t(end),
        "type": type_,
        "service": kw.pop("service", "60 min Massage"),
        "customer": kw.pop("customer", f"Cust {bid}"),
        "customer_id": kw.pop("customer_id", f"cid_{bid}"),
    }
    b.update(kw)
    return b


def add_manager_row(db, bid, room):
    db.add(
        RoomAssignment(booking_id=bid, room=room, assigned_by="manager", date=DATE)
    )
    db.commit()


def add_auto_row(db, bid, room):
    db.add(RoomAssignment(booking_id=bid, room=room, assigned_by="auto", date=DATE))
    db.commit()


def assign(db, bookings, **kw):
    result = RoomAssigner(db).assign_rooms(bookings, DATE, **kw)
    return {b["booking_id"]: b["room"] for b in result}


# ---------------------------------------------------------------------------
# Core priority rules
# ---------------------------------------------------------------------------

def test_single_alone_gets_room_1(db):
    rooms = assign(db, [booking("s1", "14:00", "15:00")])
    assert rooms["s1"] == "1"


def test_singles_fill_priority_order(db):
    bs = [booking(f"s{i}", "14:00", "15:00") for i in range(1, 8)]
    rooms = assign(db, bs)
    expected = ["1", "3", "4", "2", "0", "6", "5"]
    assert [rooms[f"s{i}"] for i in range(1, 8)] == expected


def test_same_start_longer_single_picks_first(db):
    # 90-min listed AFTER the 60-min one, but duration-desc sort gives it first pick (room 1)
    short = booking("short", "14:00", "15:00")
    long_ = booking("long", "14:00", "15:30")
    rooms = assign(db, [short, long_])
    assert rooms["long"] == "1"
    assert rooms["short"] == "3"


def test_couple_priority_5_6_02d(db):
    bs = [booking(f"c{i}", "14:00", "15:00", type_="couple") for i in range(1, 4)]
    rooms = assign(db, bs)
    assert [rooms["c1"], rooms["c2"], rooms["c3"]] == ["5", "6", "02D"]


def test_02d_hard_rule_single_in_room_0_blocks_it(db):
    # Manager pins a single in Rm 0; couples take 5 and 6; third couple cannot use 02D
    add_manager_row(db, "pin0", "0")
    bs = [
        booking("pin0", "14:00", "15:00"),
        booking("c1", "14:00", "15:00", type_="couple"),
        booking("c2", "14:00", "15:00", type_="couple"),
        booking("c3", "14:00", "15:00", type_="couple"),
    ]
    rooms = assign(db, bs)
    assert rooms["pin0"] == "0"
    assert sorted([rooms["c1"], rooms["c2"]]) == ["5", "6"]
    assert rooms["c3"] == "UNASSIGNED"


def test_unassigned_when_day_truly_full(db):
    bs = [booking(f"s{i}", "14:00", "15:00") for i in range(1, 8)]
    bs.append(booking("extra", "14:00", "15:00"))
    rooms = assign(db, bs)
    assert rooms["extra"] == "UNASSIGNED"
    assert sum(1 for r in rooms.values() if r == "UNASSIGNED") == 1


# ---------------------------------------------------------------------------
# Manager assignments and freeze
# ---------------------------------------------------------------------------

def test_manager_assignment_is_never_moved(db):
    add_manager_row(db, "m1", "4")
    rooms = assign(db, [booking("m1", "14:00", "15:00")])
    assert rooms["m1"] == "4"


def test_manager_room_blocks_auto_bookings(db):
    add_manager_row(db, "m1", "1")
    bs = [booking("m1", "14:00", "15:00"), booking("s2", "14:00", "15:00")]
    rooms = assign(db, bs)
    assert rooms["m1"] == "1"
    assert rooms["s2"] == "3"


def test_frozen_auto_room_is_kept(db):
    # Session started: existing auto room 4 is treated like manager for this pass
    add_auto_row(db, "s1", "4")
    bs = [booking("s1", "14:00", "15:00"), booking("s2", "14:00", "15:00")]
    rooms = assign(db, bs, freeze_room_booking_ids={"s1"})
    assert rooms["s1"] == "4"
    assert rooms["s2"] == "1"


# ---------------------------------------------------------------------------
# Service-specific rules
# ---------------------------------------------------------------------------

def test_addon_only_booking_gets_addon_room(db):
    b = booking("a1", "14:00", "14:30", service="Pain Relief Oil, Pain Relief Oil")
    rooms = assign(db, [b])
    assert rooms["a1"] == "ADDON"


def test_back_walking_single_uses_bar_room(db):
    b = booking("bw", "14:00", "15:00", customer_note="please do back walking")
    rooms = assign(db, [b])
    assert rooms["bw"] == "1"


def test_back_walking_never_uses_non_bar_room(db):
    for i, room in enumerate(["1", "3", "4"], start=1):
        add_manager_row(db, f"m{i}", room)
    bs = [booking(f"m{i}", "14:00", "15:00") for i in range(1, 4)]
    bs.append(booking("bw", "14:00", "15:00", customer_note="back walking please"))
    rooms = assign(db, bs)
    # Rooms 2/0/6/5 are all free, but bars exist only in 1/3/4 -> must stay unassigned
    assert rooms["bw"] == "UNASSIGNED"


def test_facial_single_prefers_room_4(db):
    b = booking("f1", "14:00", "15:00", service="Custom Facial (60 min)")
    rooms = assign(db, [b])
    assert rooms["f1"] == "4"


def test_facial_single_takes_room_3_only_as_last_resort(db):
    for i, room in enumerate(["4", "0", "2", "1", "6", "5"], start=1):
        add_manager_row(db, f"m{i}", room)
    bs = [booking(f"m{i}", "14:00", "15:00") for i in range(1, 7)]
    bs.append(booking("f1", "14:00", "15:00", service="Basic Facial"))
    rooms = assign(db, bs)
    assert rooms["f1"] == "3"


# ---------------------------------------------------------------------------
# Couple-room note pairing (two Square singles -> one shared double)
# ---------------------------------------------------------------------------

def test_same_customer_couple_room_note_shares_double(db):
    b1 = booking("p1", "14:00", "15:00", customer_id="cidX",
                 seller_note="couple room requested")
    b2 = booking("p2", "14:00", "15:00", customer_id="cidX")
    rooms = assign(db, [b1, b2])
    assert rooms["p1"] == rooms["p2"] == "5"


def test_couples_with_name_note_shares_double(db):
    b1 = booking("p1", "14:00", "15:00", customer="Adam Lee",
                 seller_note="Couples with Jenny")
    b2 = booking("p2", "14:00", "15:00", customer="Jenny Smith")
    rooms = assign(db, [b1, b2])
    assert rooms["p1"] == rooms["p2"] == "5"


# ---------------------------------------------------------------------------
# Known-bug regression: 2-second timestamp tolerance
# (historic root cause of "couple unassigned though Rm 5 free back-to-back")
# ---------------------------------------------------------------------------

def test_two_second_clock_skew_does_not_block_back_to_back(db):
    add_manager_row(db, "m5", "5")
    bs = [
        booking("m5", "14:00", "16:00:02"),  # Square end_at 2 seconds late
        booking("c1", "16:00", "17:00", type_="couple"),
    ]
    rooms = assign(db, bs)
    assert rooms["c1"] == "5"  # tolerance: 2s "overlap" is not a conflict


# ---------------------------------------------------------------------------
# Rebalance: freeing a double room for an unassigned couple
# ---------------------------------------------------------------------------

def test_rebalance_depth2_chain_frees_room_5_for_couple(db):
    """Rm 1/3 blocked all afternoon, Rm 6 manager couple. Greedy puts a single in 5,
    couple lands UNASSIGNED; depth-2 chain must move the Rm 0 single to 5 (back-to-back)
    and the Rm 5 single to 0 so the couple gets 5."""
    add_manager_row(db, "m1", "1")
    add_manager_row(db, "m3", "3")
    add_manager_row(db, "m6", "6")
    bs = [
        booking("m1", "14:00", "18:00"),
        booking("m3", "14:00", "18:00"),
        booking("m6", "14:30", "16:30", type_="couple"),
        booking("s4", "14:00", "15:45"),
        booking("s2", "14:00", "15:15"),
        booking("s3", "14:00", "15:00"),
        booking("s1", "14:30", "15:30"),
        booking("cpl", "15:00", "16:00", type_="couple"),
    ]
    rooms = assign(db, bs)
    assert rooms["cpl"] == "5"
    assert "UNASSIGNED" not in rooms.values()


# ---------------------------------------------------------------------------
# Whole-day optimality: cases the old greedy + patches provably missed
# (kept as regular tests now that the CP-SAT solver replaced the greedy core)
# ---------------------------------------------------------------------------

def test_back_walker_gets_bar_room_via_swap(db):
    """Old greedy gap: Rm 1 went to a plain single first and the back-walker was
    left UNASSIGNED even though the swap (plain single -> Rm 2) was feasible."""
    add_manager_row(db, "m3", "3")
    add_manager_row(db, "m4", "4")
    bs = [
        booking("m3", "15:00", "16:00"),
        booking("m4", "15:00", "16:00"),
        booking("s_plain", "15:00", "16:00"),
        booking("bw", "15:00", "16:00", customer_note="back walking"),
    ]
    rooms = assign(db, bs)
    assert rooms["bw"] in ("1", "3", "4")
    assert rooms["s_plain"] not in ("UNASSIGNED", rooms["bw"])
