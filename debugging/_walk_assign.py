"""Walk sheet assignment for teaching — print step-by-step."""
import json
import urllib.request
from datetime import datetime, timezone

DATE = "2026-07-19"
BASE_SLOTS = 9
FACIAL_ONLY = ["Tina"]
TRIGGER_ONLY = ["Casey", "Cassey", "May"]


def near(a, b):
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
    x = " ".join((a or "").strip().lower().split())
    y = " ".join((b or "").strip().lower().split())
    if not x or not y:
        return False
    if x == y:
        return True
    fa, fb = x.split(" ")[0], y.split(" ")[0]
    if len(fa) >= 3 and fa == fb:
        return True
    if len(fa) >= 4 and len(fb) >= 4 and near(fa, fb):
        return True
    return False


def parse_iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def overlap(a0, a1, b0, b1):
    return a0 < b1 and b0 < a1


def blob(ev):
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
    b = blob(ev)
    return "facial" in b or "lymphatic" in b or "面部" in b or "淋巴" in b


def needs_trigger(ev):
    return "trigger point" in blob(ev)


def short(name):
    s = (name or "").strip()
    return s.split()[0] if s else ""


def main():
    data = json.load(urllib.request.urlopen(f"http://127.0.0.1:8001/api/day?date={DATE}", timeout=60))
    order = sorted(data.get("therapist_order") or [], key=lambda r: r.get("order") or 0)
    roster = []
    seen = set()
    for r in order:
        n = (r.get("therapist") or "").strip()
        if n and n.lower() not in seen:
            seen.add(n.lower())
            roster.append(n)
    while len(roster) < BASE_SLOTS:
        roster.append("")
    roster = roster[:BASE_SLOTS]

    print("=" * 60)
    print(f"DATE {DATE}")
    print("SHEET CARDS (# = turn order):")
    for i, n in enumerate(roster):
        print(f"  #{i+1} {n or '(empty)'}")
    print("=" * 60)

    req_by = {}
    for it in (data.get("customer_requests_summary") or {}).get("items") or []:
        bid = str(it.get("booking_id") or "").strip()
        req = (it.get("requested_masseuse") or "").strip()
        if bid and req:
            req_by.setdefault(bid, []).append(req)

    events = [e for e in (data.get("events") or []) if str(e.get("room") or "") != "ADDON"]
    events.sort(key=lambda e: e.get("start_at") or "")

    slots = [{"name": n, "rows": []} for n in roster]
    turn = 0
    step = 0

    def busy(i, start, end):
        return any(overlap(start, end, r["start"], r["end"]) for r in slots[i]["rows"])

    def count(i):
        return len(slots[i]["rows"])

    def find(name):
        if not name:
            return -1
        for i, n in enumerate(roster):
            if n and names_match(n, name):
                return i
        return -1

    def skill_idxs(ev):
        if needs_facial(ev):
            return [i for i in (find(x) for x in FACIAL_ONLY) if i >= 0]
        if needs_trigger(ev):
            return [i for i in (find(x) for x in TRIGGER_ONLY) if i >= 0]
        return None

    def assign_one(ev, preferred, tip_slot, force, why_prefix):
        nonlocal turn
        start = parse_iso(ev.get("start_at"))
        end = parse_iso(ev.get("display_end_at") or ev.get("end_at"))
        if not start or not end:
            return -1, "no time"
        skills = skill_idxs(ev)
        reason = []

        if force:
            idx = find(preferred)
            if idx >= 0:
                slots[idx]["rows"].append(
                    {
                        "cust": short(ev.get("customer")),
                        "start": start,
                        "end": end,
                        "req": True,
                        "tip": tip_slot,
                    }
                )
                old = turn
                turn = (idx + 1) % BASE_SLOTS
                reason.append(f"FORCE request/named -> #{idx+1} {roster[idx]}")
                reason.append(f"turn {old+1} -> next #{turn+1}")
                return idx, " | ".join(reason)

        pool = []
        for i in range(BASE_SLOTS):
            if not roster[i]:
                continue
            if busy(i, start, end):
                continue
            if skills is not None and skills and i not in skills:
                continue
            pool.append(i)
        if not pool:
            for i in range(BASE_SLOTS):
                if not roster[i]:
                    continue
                if busy(i, start, end):
                    continue
                pool.append(i)
            if skills:
                reason.append("skill people busy -> open to anyone free")

        pref = find(preferred)
        if pref >= 0 and pref in pool:
            slots[pref]["rows"].append(
                {"cust": short(ev.get("customer")), "start": start, "end": end, "req": False, "tip": tip_slot}
            )
            old = turn
            turn = (pref + 1) % BASE_SLOTS
            reason.append(f"calendar preferred {preferred} free -> #{pref+1} {roster[pref]}")
            reason.append(f"turn -> #{turn+1}")
            return pref, " | ".join(reason)

        if not pool:
            best, best_c = -1, 10**9
            for k in range(BASE_SLOTS):
                i = (turn + k) % BASE_SLOTS
                if not roster[i]:
                    continue
                c = count(i)
                if c < best_c:
                    best_c, best = c, i
            if best >= 0:
                slots[best]["rows"].append(
                    {"cust": short(ev.get("customer")), "start": start, "end": end, "req": False, "tip": tip_slot}
                )
                old = turn
                turn = (best + 1) % BASE_SLOTS
                reason.append(f"everyone busy -> fewest rows #{best+1} {roster[best]}")
                return best, " | ".join(reason)
            return -1, "failed"

        pool.sort(
            key=lambda i: (
                count(i),
                (i - turn + BASE_SLOTS) % BASE_SLOTS,
            )
        )
        pick = pool[0]
        free_names = [f"#{i+1}{roster[i][:6]}({count(i)})" for i in pool]
        reason.append(f"free pool: {', '.join(free_names)}")
        reason.append(f"pick fewest then turn -> #{pick+1} {roster[pick]}")
        slots[pick]["rows"].append(
            {"cust": short(ev.get("customer")), "start": start, "end": end, "req": False, "tip": tip_slot}
        )
        turn = (pick + 1) % BASE_SLOTS
        reason.append(f"next turn #{turn+1}")
        return pick, " | ".join(reason)

    for ev in events:
        step += 1
        is_couple = str(ev.get("type") or "").lower() == "couple"
        any_avail = ev.get("original_any_available") is True
        bid = str(ev.get("booking_id") or "")
        req_names = req_by.get(bid) or []
        has_req = len(req_names) > 0 or ev.get("original_any_available") is False
        t1 = (ev.get("therapist") or "").strip()
        t2 = (ev.get("therapist_2") or "").strip()
        cust = short(ev.get("customer"))
        tm = (ev.get("start_at") or "")[11:16]

        print(f"\n--- Step {step}: {tm} {cust} ({'COUPLE' if is_couple else 'single'}) ---")
        print(f"    Square: any_available={ev.get('original_any_available')} calendar t1={t1 or '-'} t2={t2 or '-'}")
        print(f"    Request list: {req_names or '(none)'} -> hasRequest={has_req}")
        print(f"    Turn pointer BEFORE: #{turn+1} {roster[turn]}")

        if is_couple:
            if has_req:
                r0 = req_names[0] if req_names else t1
                r1 = req_names[1] if len(req_names) > 1 else t2
                i0, why0 = assign_one(ev, r0, 1, bool(r0), "p1")
                print(f"    Person1 -> {why0}")
                if r1:
                    force2 = len(req_names) > 1 or (bool(t2) and ev.get("original_any_available") is False)
                    i1, why1 = assign_one(ev, r1, 2, force2, "p2")
                    print(f"    Person2 -> {why1}")
                else:
                    i1, why1 = assign_one(ev, "", 2, False, "p2")
                    print(f"    Person2 (partner by turn) -> {why1}")
            else:
                i0, why0 = assign_one(ev, t1, 1, False, "p1")
                print(f"    Person1 -> {why0}")
                i1, why1 = assign_one(ev, t2, 2, False, "p2")
                print(f"    Person2 -> {why1}")
        else:
            if has_req:
                i0, why0 = assign_one(ev, (req_names[0] if req_names else t1), 1, True, "s")
            else:
                i0, why0 = assign_one(ev, t1, 1, False, "s")
            print(f"    -> {why0}")

    print("\n" + "=" * 60)
    print("FINAL SHEET (auto only, no your pinned edits)")
    print("=" * 60)
    for i, slot in enumerate(slots):
        rows = sorted(slot["rows"], key=lambda r: r["start"])
        names = ", ".join(
            f"{r['cust']}{'*' if r['req'] else ''}" for r in rows
        ) or "(empty)"
        print(f"#{i+1} {slot['name']}: {names}")
        print("       (* = requested/named path)")


if __name__ == "__main__":
    main()
