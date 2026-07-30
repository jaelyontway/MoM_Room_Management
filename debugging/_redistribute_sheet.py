"""Clear locks and redistribute 2026-07-20 sheet with current turn/request rules."""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DATE = "2026-07-20"
ROWS_MAIN = 9
XG_MAX = 3
SKILLS = {
    "facial": ["Tina", "Lynn"],
    "trigger": ["Casey", "Cassey", "May"],
    "fireCupping": ["Sophia", "Casey", "Cassey", "Vicky"],
    "manualOnly": ["Lynn", "part-time", "part time", "parttime"],
}


def get_json(url):
    return json.loads(urllib.request.urlopen(url, timeout=60).read().decode())


def put_json(url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="PUT", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def parse_iso(s):
    if not s:
        return None
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def first_names_nearly_equal(a, b):
    if not a or not b:
        return False
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    i = j = diffs = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
            continue
        diffs += 1
        if diffs > 1:
            return False
        if len(a) > len(b):
            i += 1
        elif len(b) > len(a):
            j += 1
        else:
            i += 1
            j += 1
    diffs += len(a) - i + len(b) - j
    return diffs <= 1


def names_match(a, b):
    x = re.sub(r"\s+", " ", (a or "").strip().lower())
    y = re.sub(r"\s+", " ", (b or "").strip().lower())
    if not x or not y:
        return False
    if x == y:
        return True
    fa, fb = x.split(" ")[0], y.split(" ")[0]
    if len(fa) >= 3 and fa == fb:
        return True
    if len(fa) >= 4 and len(fb) >= 4 and first_names_nearly_equal(fa, fb):
        return True
    return False


def name_in_list(name, lst):
    return any(names_match(name, n) for n in lst)


def staff_note_means_turn(ev):
    text = " ".join(
        str(x)
        for x in (ev.get("seller_note"), ev.get("customer_note"), ev.get("addon_note"))
        if x
    )
    if not text:
        return False
    if "正常轮" in text or "不找人" in text or "不着人" in text:
        return True
    low = text.lower()
    return bool(
        re.search(r"\bnormal\s*turn\b", low)
        or re.search(r"\bany\s*available\b", low)
        or re.search(r"\banyone\b", low)
        or re.search(r"\bno\s*request\b", low)
        or re.search(r"\bnot\s*requested\b", low)
    )


def is_any_available(ev):
    if staff_note_means_turn(ev):
        return True
    return ev.get("original_any_available") is True


def event_blob(ev):
    return " ".join(
        str(ev.get(k) or "")
        for k in (
            "display_service",
            "service",
            "package_type",
            "addon_note",
            "seller_note",
            "customer_note",
        )
    ).lower()


def needs_facial(ev):
    b = event_blob(ev)
    return bool(re.search(r"\bfacial\b", b) or "面部" in b or re.search(r"\blymphatic\b", b) or "淋巴" in b)


def needs_trigger(ev):
    return bool(re.search(r"\btrigger\s*point\b", event_blob(ev)))


def needs_fire_cupping(ev):
    b = event_blob(ev)
    return bool(re.search(r"fire\s*cup", b) or "火罐" in b)


def is_luxury(ev):
    if str(ev.get("package_type") or "").lower() == "luxury":
        return True
    return bool(re.search(r"\bluxury\b", event_blob(ev)))


def note_from_event(ev):
    b = event_blob(ev)
    tags = []
    if re.search(r"\b3\s*senses\b", b) or re.search(r"\bthree\s*senses\b", b) or "三感" in b:
        tags.append("3 senses")
    if needs_facial(ev):
        tags.append("facial")
    if re.search(r"\bcupping\b", b) or "拔罐" in b:
        tags.append("cupping")
    if re.search(r"\bbian\s*stone\b", b) or re.search(r"\bhot\s*stone\b", b) or "砭石" in b:
        tags.append("stone")
    if needs_trigger(ev):
        tags.append("trigger")
    return ", ".join(tags)


def duration_minutes(ev):
    s, e = parse_iso(ev.get("start_at")), parse_iso(ev.get("display_end_at") or ev.get("end_at"))
    if not s or not e:
        return None
    return int((e - s).total_seconds() // 60)


def price_label(ev):
    m = duration_minutes(ev)
    if m is None:
        return ""
    for lo, hi, lab in ((55, 65, "60"), (85, 95, "90"), (115, 125, "120"), (145, 155, "150"), (175, 185, "180")):
        if lo <= m <= hi:
            return lab
    return str(m)


def format_dur(start, end):
    def fmt(d):
        h = d.hour % 12 or 12
        return f"{h}:{d.minute:02d}"

    # local wall clock like browser (assume machine TZ); API times are aware UTC
    s = start.astimezone().replace(tzinfo=None) if start.tzinfo else start
    e = end.astimezone().replace(tzinfo=None) if end.tzinfo else end
    return f"{fmt(s)}-{fmt(e)}"


def customer_short(name):
    return (name or "").strip().split()[0] if name else ""


def room_label(ev):
    r = str(ev.get("room") or "").strip()
    if not r or r in ("UNASSIGNED", "ADDON"):
        return ""
    return re.sub(r"^Rm\s*", "", r, flags=re.I)


def tip_label(ev, tip_slot=1):
    tip = ev.get("tip_amount_2") if tip_slot == 2 else ev.get("tip_amount")
    if tip is None or tip == "":
        return ""
    try:
        n = float(tip)
    except (TypeError, ValueError):
        return ""
    return str(int(n)) if n == int(n) else f"{n:.2f}"


def request_map(data):
    m = {}
    events = data.get("events") or []
    for it in (data.get("customer_requests_summary") or {}).get("items") or []:
        req = str((it or {}).get("requested_masseuse") or "").strip()
        if not req:
            continue
        bid = str((it or {}).get("booking_id") or "").strip()
        if not bid:
            cust = str((it or {}).get("customer") or "").strip().lower()
            start = str((it or {}).get("start_at") or "")
            hit = next(
                (
                    e
                    for e in events
                    if str(e.get("customer") or "").strip().lower() == cust
                    and str(e.get("start_at") or "") == start
                ),
                None,
            )
            bid = str((hit or {}).get("booking_id") or "")
        if not bid:
            continue
        m.setdefault(bid, []).append(req)
    return m


def lock_key(bid, tip):
    return f"{bid}#{tip}"


def redistribute(data, roster):
    slots = [{"name": n, "extra": False, "rows": [], "xgJobs": []} for n in roster]
    n = len(slots)
    assigned = set()
    turn = 0
    req_by_bid = request_map(data)
    def _sort_key(e):
        any_av = is_any_available(e)
        return (str(e.get("start_at") or ""), 0 if not any_av else 1, str(e.get("booking_id") or ""))

    events = sorted(
        [e for e in (data.get("events") or []) if e.get("room") != "ADDON"],
        key=_sort_key,
    )
    by_bid = {str(e.get("booking_id")): e for e in events if e.get("booking_id")}

    def find_idx(name):
        if not name:
            return -1
        for i, r in enumerate(roster):
            if r and names_match(r, name):
                return i
        return -1

    def busy(i, start, end):
        for r in slots[i]["rows"]:
            if r["_start"] < end and start < r["_end"]:
                return True
        return False

    def count(i):
        return len(slots[i]["rows"])

    def skill_idxs(ev):
        if needs_facial(ev):
            return [i for i in (find_idx(x) for x in SKILLS["facial"]) if i >= 0]
        if needs_trigger(ev):
            return [i for i in (find_idx(x) for x in SKILLS["trigger"]) if i >= 0]
        return None

    def in_auto(i):
        if not roster[i]:
            return False
        if name_in_list(roster[i], SKILLS["manualOnly"]):
            return False
        return True

    def push(i, ev, tip_slot, requested, overrides=None):
        overrides = overrides or {}
        start = overrides.get("start") or parse_iso(ev.get("start_at"))
        end = overrides.get("end") or parse_iso(ev.get("display_end_at") or ev.get("end_at"))
        if i < 0 or not start or not end:
            return
        k = lock_key(ev.get("booking_id"), tip_slot)
        if k in assigned:
            return
        slots[i]["rows"].append(
            {
                "nm": customer_short(ev.get("customer")),
                "rm": room_label(ev),
                "dur": overrides.get("dur") or format_dur(start, end),
                "price": overrides["price"] if "price" in overrides else price_label(ev),
                "tip": tip_label(ev, tip_slot),
                "note": overrides["note"] if "note" in overrides else note_from_event(ev),
                "requested": bool(requested),
                "bid": str(ev.get("booking_id") or ""),
                "tipSlot": tip_slot,
                "_start": start,
                "_end": end,
            }
        )
        assigned.add(k)

    def assign_one(ev, preferred, tip_slot, force_request):
        k = lock_key(ev.get("booking_id"), tip_slot)
        if k in assigned:
            return -1
        start = parse_iso(ev.get("start_at"))
        end = parse_iso(ev.get("display_end_at") or ev.get("end_at"))
        if not start or not end:
            return -1
        sk = skill_idxs(ev)
        nonlocal turn
        if force_request:
            idx = find_idx(preferred)
            if idx >= 0 and not busy(idx, start, end):
                push(idx, ev, tip_slot, True)
                turn = (idx + 1) % max(n, 1)
                return idx
        pool = []
        for i in range(n):
            if not in_auto(i) or busy(i, start, end):
                continue
            if sk and i not in sk:
                continue
            pool.append(i)
        if not pool:
            for i in range(n):
                if in_auto(i) and not busy(i, start, end):
                    pool.append(i)
        if not pool:
            best, best_c = -1, 10**9
            for koff in range(n):
                i = (turn + koff) % n
                if not in_auto(i):
                    continue
                c = count(i)
                if c < best_c:
                    best_c, best = c, i
            if best >= 0:
                push(best, ev, tip_slot, False)
                turn = (best + 1) % n
                return best
            return -1
        pool.sort(key=lambda i: (count(i), (i - turn) % n))
        pick = pool[0]
        push(pick, ev, tip_slot, False)
        turn = (pick + 1) % n
        return pick

    for ev in events:
        is_couple = str(ev.get("type") or "").lower() == "couple"
        any_av = is_any_available(ev)
        req_names = []
        if not any_av:
            req_names = list(req_by_bid.get(str(ev.get("booking_id") or ""), []))
            if not req_names:
                nm = str(ev.get("original_therapist") or ev.get("therapist") or "").strip()
                if nm and nm.lower() != "staff":
                    req_names = [nm]
        # Staff note names e.g. Rose Vicky
        if not any_av:
            note_text = " ".join(
                str(x)
                for x in (ev.get("seller_note"), ev.get("customer_note"), ev.get("addon_note"))
                if x
            )
            if note_text and not staff_note_means_turn(ev):
                note_hits = []
                for rname in roster:
                    if not rname:
                        continue
                    first = rname.split()[0]
                    if len(first) >= 3 and re.search(
                        r"\b" + re.escape(first) + r"\b", note_text, re.I
                    ):
                        note_hits.append((note_text.lower().find(first.lower()), rname))
                for extra in SKILLS["facial"] + SKILLS["fireCupping"] + SKILLS["trigger"]:
                    first = str(extra).split()[0]
                    if len(first) < 3:
                        continue
                    if any(names_match(h[1], extra) for h in note_hits):
                        continue
                    m = re.search(r"\b" + re.escape(first) + r"\b", note_text, re.I)
                    if m:
                        note_hits.append((m.start(), str(extra)))
                note_hits.sort(key=lambda x: x[0])
                if note_hits:
                    req_names = [h[1] for h in note_hits]
        has_req = (not any_av) and bool(req_names)
        t1 = str(ev.get("therapist") or "").strip()
        t2 = str(ev.get("therapist_2") or "").strip()
        split_first = ev.get("split_minutes_first")
        try:
            split_first = int(split_first) if split_first is not None else None
        except (TypeError, ValueError):
            split_first = None
        total = duration_minutes(ev)
        start = parse_iso(ev.get("start_at"))
        end = parse_iso(ev.get("display_end_at") or ev.get("end_at"))

        if not is_couple and lock_key(ev.get("booking_id"), 1) in assigned:
            continue
        if (
            is_couple
            and lock_key(ev.get("booking_id"), 1) in assigned
            and lock_key(ev.get("booking_id"), 2) in assigned
        ):
            continue

        if (
            not is_couple
            and split_first
            and split_first > 0
            and t2
            and total
            and total > split_first
        ):
            start = parse_iso(ev.get("start_at"))
            end = parse_iso(ev.get("display_end_at") or ev.get("end_at"))
            if start and end:
                from datetime import timedelta

                mid = start + timedelta(minutes=split_first)
                # simplify: force named segments if request else turn via assign
                if lock_key(ev.get("booking_id"), 1) not in assigned:
                    if has_req:
                        idx = find_idx(t1)
                        if idx >= 0 and not busy(idx, start, mid):
                            push(
                                idx,
                                ev,
                                1,
                                True,
                                {
                                    "start": start,
                                    "end": mid,
                                    "dur": format_dur(start, mid),
                                    "price": str(split_first),
                                },
                            )
                            turn = (idx + 1) % n
                        else:
                            assign_one(ev, "", 1, False)
                    else:
                        assign_one(ev, "", 1, False)
                if lock_key(ev.get("booking_id"), 2) not in assigned:
                    assign_one(ev, t2 if has_req and len(req_names) > 1 else "", 2, bool(has_req and len(req_names) > 1))
                continue

        # Luxury: 90min massage busy + Tina 小脸 小工
        if (
            not is_couple
            and is_luxury(ev)
            and start
            and end
            and total
            and total >= 90
        ):
            from datetime import timedelta

            massage_end = end - timedelta(minutes=30)
            win = {"start": start, "end": massage_end, "price": "90", "note": ""}
            # monkey: assign_one doesn't take window — push via shortened by temp mutate
            old_end = ev.get("display_end_at") or ev.get("end_at")
            ev["_sheet_end"] = massage_end.isoformat()
            # simpler direct pool assign
            def _assign_win(force, pref):
                # inline minimal
                nonlocal turn
                if force and pref:
                    idx = find_idx(pref)
                    if idx >= 0 and not busy(idx, start, massage_end):
                        push(
                            idx,
                            ev,
                            1,
                            True,
                            {
                                "start": start,
                                "end": massage_end,
                                "dur": format_dur(start, massage_end),
                                "price": "90",
                                "note": "",
                            },
                        )
                        turn = (idx + 1) % max(n, 1)
                        return
                pool = [i for i in range(n) if in_auto(i) and not busy(i, start, massage_end)]
                if not pool:
                    return
                pool.sort(key=lambda i: (count(i), (i - turn) % n))
                pick = pool[0]
                push(
                    pick,
                    ev,
                    1,
                    False,
                    {
                        "start": start,
                        "end": massage_end,
                        "dur": format_dur(start, massage_end),
                        "price": "90",
                        "note": "",
                    },
                )
                turn = (pick + 1) % n

            _assign_win(has_req, req_names[0] if req_names else t1)
            ms = -1
            for i, s in enumerate(slots):
                if any(str(r.get("bid")) == str(ev.get("booking_id")) for r in s["rows"]):
                    ms = i
                    break
            main = roster[ms] if ms >= 0 else ""
            if not name_in_list(main, SKILLS["facial"]):
                idxs = [i for i in (find_idx(x) for x in SKILLS["facial"]) if i >= 0]
                if idxs and len(slots[idxs[0]]["xgJobs"]) < XG_MAX:
                    slots[idxs[0]]["xgJobs"].append(
                        {
                            "kind": "小脸",
                            "tip": tip_label(ev, 1),
                            "bid": str(ev.get("booking_id") or ""),
                            "tipSlot": 1,
                        }
                    )
            continue

        # Basic facial + 90 massage
        blob = event_blob(ev)
        is_combo = (
            not is_luxury(ev)
            and (
                ("basic facial" in blob and "90" in blob)
                or ("facial w 90" in blob)
                or ("relax package" in blob and "facial" in blob)
            )
        )
        if not is_couple and is_combo and start and end and total and total > 90:
            from datetime import timedelta

            mid = start + timedelta(minutes=90)
            facial_mins = total - 90
            facial_idxs = [i for i in (find_idx(x) for x in SKILLS["facial"]) if i >= 0]
            tina_ok = next((i for i in facial_idxs if not busy(i, mid, end)), None)
            if tina_ok is not None:
                pool = [i for i in range(n) if in_auto(i) and not busy(i, start, mid)]
                pool.sort(key=lambda i: (count(i), (i - turn) % n))
                if pool:
                    push(
                        pool[0],
                        ev,
                        1,
                        False,
                        {
                            "start": start,
                            "end": mid,
                            "dur": format_dur(start, mid),
                            "price": "90",
                            "note": "",
                        },
                    )
                    turn = (pool[0] + 1) % n
                push(
                    tina_ok,
                    ev,
                    2,
                    False,
                    {
                        "start": mid,
                        "end": end,
                        "dur": format_dur(mid, end),
                        "price": str(facial_mins),
                        "note": "facial",
                    },
                )
                turn = (tina_ok + 1) % n
            else:
                facial_end = start + timedelta(minutes=facial_mins)
                tina_first = next((i for i in facial_idxs if not busy(i, start, facial_end)), None)
                if tina_first is not None:
                    push(
                        tina_first,
                        ev,
                        1,
                        False,
                        {
                            "start": start,
                            "end": facial_end,
                            "dur": format_dur(start, facial_end),
                            "price": str(facial_mins),
                            "note": "facial",
                        },
                    )
                    turn = (tina_first + 1) % n
                    assign_one(ev, "", 2, False)
                    # fix last row times if full — skip; keep simple
                elif has_req:
                    assign_one(ev, req_names[0] if req_names else t1, 1, True)
                else:
                    assign_one(ev, "", 1, False)
            continue

        if is_couple:
            if has_req:
                r0 = req_names[0] if req_names else t1
                r1 = req_names[1] if len(req_names) > 1 else ""
                if lock_key(ev.get("booking_id"), 1) not in assigned:
                    assign_one(ev, r0, 1, bool(r0))
                if lock_key(ev.get("booking_id"), 2) not in assigned:
                    if len(req_names) > 1 and r1:
                        assign_one(ev, r1, 2, True)
                    else:
                        assign_one(ev, "", 2, False)
            else:
                if lock_key(ev.get("booking_id"), 1) not in assigned:
                    assign_one(ev, "", 1, False)
                if lock_key(ev.get("booking_id"), 2) not in assigned:
                    assign_one(ev, "", 2, False)
        elif has_req:
            assign_one(ev, req_names[0] if req_names else t1, 1, True)
        else:
            assign_one(ev, "", 1, False)

    def find_slot_bid(bid):
        for i, s in enumerate(slots):
            if any(str(r.get("bid")) == str(bid) for r in s["rows"]):
                return i
        return -1

    for ev in events:
        start = parse_iso(ev.get("start_at"))
        end = parse_iso(ev.get("display_end_at") or ev.get("end_at"))
        if not start or not end:
            continue
        ms = find_slot_bid(ev.get("booking_id"))
        bid = str(ev.get("booking_id") or "")
        if is_luxury(ev):
            already = any(
                any(j.get("bid") == bid and j.get("kind") == "小脸" for j in s.get("xgJobs") or [])
                for s in slots
            )
            if already:
                pass
            else:
                main = roster[ms] if ms >= 0 else ""
                if not name_in_list(main, SKILLS["facial"]):
                    idxs = [i for i in (find_idx(x) for x in SKILLS["facial"]) if i >= 0]
                    from datetime import timedelta

                    face_start = end - timedelta(minutes=30)
                    fi = next((i for i in idxs if not busy(i, face_start, end)), None)
                    if fi is None and idxs:
                        fi = idxs[0]
                    if fi is not None and len(slots[fi]["xgJobs"]) < XG_MAX:
                        slots[fi]["xgJobs"].append(
                            {
                                "kind": "小脸",
                                "tip": tip_label(ev, 1),
                                "bid": bid,
                                "tipSlot": 1,
                            }
                        )
        if needs_fire_cupping(ev):
            cup = [
                i
                for i in (find_idx(x) for x in SKILLS["fireCupping"])
                if i >= 0 and i != ms
            ]
            cup.sort(key=lambda i: count(i))
            if cup and len(slots[cup[0]]["xgJobs"]) < XG_MAX:
                slots[cup[0]]["xgJobs"].append(
                    {
                        "kind": "cupping",
                        "tip": tip_label(ev, 1),
                        "bid": str(ev.get("booking_id") or ""),
                        "tipSlot": 1,
                    }
                )

    empty = {
        "nm": "",
        "rm": "",
        "dur": "",
        "price": "",
        "tip": "",
        "note": "",
        "bid": "",
        "tipSlot": 1,
        "requested": False,
    }
    out_slots = []
    for s in slots:
        rows = sorted(s["rows"], key=lambda r: r["_start"])
        clean = []
        for r in rows:
            clean.append(
                {
                    "nm": r["nm"],
                    "rm": r["rm"],
                    "dur": r["dur"],
                    "price": r["price"],
                    "tip": r["tip"],
                    "note": r["note"],
                    "bid": r["bid"],
                    "tipSlot": r["tipSlot"],
                    "requested": r["requested"],
                }
            )
        while len(clean) < ROWS_MAIN:
            clean.append(dict(empty))
        out_slots.append(
            {
                "name": s["name"],
                "extra": False,
                "rows": clean[:ROWS_MAIN],
                "xgJobs": s["xgJobs"][:XG_MAX],
            }
        )
    return out_slots


def main():
    day = get_json(f"http://127.0.0.1:8001/api/day?date={DATE}")
    old = get_json(f"http://127.0.0.1:8001/api/appt-records/{DATE}")
    roster = (old.get("edits") or {}).get("roster") or [
        s.get("name") for s in (old.get("slots") or []) if s.get("name")
    ]
    roster = [str(x or "").strip() for x in roster]
    while len(roster) < 6:
        roster.append("")
    slots = redistribute(day, roster)
    payload = {
        "date": DATE,
        "saved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "slots": slots,
        "edits": {
            "names": (old.get("edits") or {}).get("names") or {},
            "cells": (old.get("edits") or {}).get("cells") or {},
            "rows": {},  # cleared locks
            "extraCount": (old.get("edits") or {}).get("extraCount") or 0,
            "roster": roster,
            "xgJobs": {
                str(i): s["xgJobs"]
                for i, s in enumerate(slots)
                if s.get("xgJobs")
            },
            "cleared_locks_at": datetime.now(timezone.utc).isoformat(),
            "note": "redistributed with empty locks; request vs 正常轮/不找人 rules",
        },
    }
    put_json(f"http://127.0.0.1:8001/api/appt-records/{DATE}", payload)
    # also write disk directly for safety
    Path(f"appt records/{DATE}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [f"roster={roster}", "locks cleared", ""]
    for i, s in enumerate(slots):
        filled = [r for r in s["rows"] if r.get("nm")]
        lines.append(f"#{i+1} {s['name']} ({len(filled)})")
        for r in filled:
            req = "REQ" if r.get("requested") else "turn"
            lines.append(f"  {r['dur']} {r['nm']} [{req}] rm={r['rm']} note={r['note']}")
        if s.get("xgJobs"):
            lines.append(f"  xg={s['xgJobs']}")
    Path("debugging/_redistribute_out.txt").write_text("\n".join(lines), encoding="utf-8")
    print("saved", DATE)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
