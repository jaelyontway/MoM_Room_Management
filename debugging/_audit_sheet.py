"""Audit today's sheet vs request/turn rules."""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DATE = "2026-07-20"
d = json.loads(
    urllib.request.urlopen(f"http://127.0.0.1:8001/api/day?date={DATE}", timeout=30)
    .read()
    .decode()
)
rec = json.loads(Path(f"appt records/{DATE}.json").read_text(encoding="utf-8"))


def parse_iso(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def staff_turn(ev):
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
    )


def is_request(ev):
    if staff_turn(ev):
        return False
    if ev.get("original_any_available") is True:
        return False
    name = (ev.get("original_therapist") or ev.get("therapist") or "").strip()
    if not name or name.lower() == "staff":
        return False
    return True


def overlap(a0, a1, b0, b1):
    return a0 < b1 and b0 < a1


def local_hm(iso):
    dt = parse_iso(iso)
    if not dt:
        return "?"
    # show America/Chicago-ish: API is UTC, CDT = UTC-5 in July
    local = dt.astimezone(timezone.utc).replace(tzinfo=timezone.utc)
    # convert to UTC-5 for display
    from datetime import timedelta

    local = local + timedelta(hours=-5)
    return local.strftime("%H:%M")


events = sorted(
    [e for e in d.get("events") or [] if e.get("room") != "ADDON"],
    key=lambda e: str(e.get("start_at") or ""),
)

# Map sheet: customer short -> list of (masseuse, requested flag, bid)
sheet_by_bid = {}
sheet_by_nm = {}
roster = []
for i, s in enumerate(rec.get("slots") or []):
    name = (s.get("name") or "").strip()
    roster.append(name)
    for r in s.get("rows") or []:
        if not r.get("nm") and not r.get("bid"):
            continue
        bid = str(r.get("bid") or "")
        entry = {
            "masseuse": name,
            "nm": r.get("nm"),
            "dur": r.get("dur"),
            "requested": r.get("requested"),
            "bid": bid,
            "slot": i + 1,
        }
        if bid:
            sheet_by_bid.setdefault(bid, []).append(entry)
        sheet_by_nm.setdefault((r.get("nm") or "").lower(), []).append(entry)

lines = []
lines.append(f"saved_at={rec.get('saved_at')}")
lines.append(f"roster={roster}")
ed = rec.get("edits") or {}
lines.append(f"edits.roster={ed.get('roster')}")
lines.append(f"manual row locks={len(ed.get('rows') or {})}")
lines.append("")
lines.append("=== Per-appointment check ===")

issues = []
ok = []

# Simulate expected under current rules (pure, no locks)
sim_rows = {n: [] for n in roster if n}
turn = 0


def busy(name, start, end):
    for s, e in sim_rows.get(name) or []:
        if overlap(start, end, s, e):
            return True
    return False


def count(name):
    return len(sim_rows.get(name) or [])


def names_match(a, b):
    a = (a or "").strip().lower()
    b = (b or "").strip().lower()
    if not a or not b:
        return False
    if a == b:
        return True
    af, bf = a.split()[0], b.split()[0]
    return af == bf or (len(af) > 2 and (af in bf or bf in af))


def find_roster(name):
    for n in roster:
        if n and names_match(n, name):
            return n
    return None


for ev in events:
    start = parse_iso(ev.get("start_at"))
    end = parse_iso(ev.get("display_end_at") or ev.get("end_at"))
    cust = ev.get("customer") or ""
    bid = str(ev.get("booking_id") or "")
    req = is_request(ev)
    req_name = (ev.get("original_therapist") or ev.get("therapist") or "").strip()
    sheet_hits = sheet_by_bid.get(bid) or []
    short = cust.split()[0] if cust else ""
    if not sheet_hits:
        sheet_hits = sheet_by_nm.get(short.lower(), [])

    actual = [h["masseuse"] for h in sheet_hits]
    expected = None
    reason = ""

    if not start or not end:
        issues.append(f"{cust}: bad times")
        continue

    if req:
        target = find_roster(req_name)
        if target and not busy(target, start, end):
            expected = target
            reason = f"request {req_name} free"
            sim_rows[target].append((start, end))
            turn = (roster.index(target) + 1) % max(len(roster), 1)
        else:
            # fall through turn
            pool = [n for n in roster if n and not busy(n, start, end)]
            if not pool:
                pool = [n for n in roster if n]
            pool.sort(
                key=lambda n: (
                    count(n),
                    (roster.index(n) - turn) % len(roster),
                )
            )
            expected = pool[0] if pool else None
            reason = f"request {req_name} busy/missing → turn"
            if expected:
                sim_rows[expected].append((start, end))
                turn = (roster.index(expected) + 1) % max(len(roster), 1)
    else:
        pool = [n for n in roster if n and not busy(n, start, end)]
        if not pool:
            pool = [n for n in roster if n]
        pool.sort(
            key=lambda n: (
                count(n),
                (roster.index(n) - turn) % len(roster),
            )
        )
        expected = pool[0] if pool else None
        reason = "turn" + (" (staff 正常轮/不找人)" if staff_turn(ev) else "")
        if expected:
            sim_rows[expected].append((start, end))
            turn = (roster.index(expected) + 1) % max(len(roster), 1)

    act_s = ",".join(actual) if actual else "(missing)"
    match = expected in actual if expected and actual else False
    # couples may have 2
    couple = str(ev.get("type") or "").lower() == "couple"
    flag = "OK" if match else "DIFF"
    if couple and len(actual) >= 1:
        flag = "COUPLE" if expected in actual else "DIFF"

    line = (
        f"{flag} {local_hm(ev.get('start_at'))}-{local_hm(ev.get('display_end_at') or ev.get('end_at'))} "
        f"{cust[:24]:24} req={req} want={expected} sheet={act_s} | {reason}"
    )
    lines.append(line)
    if flag == "DIFF":
        issues.append(line)
    else:
        ok.append(line)

lines.append("")
lines.append(f"OK={len(ok)} DIFF={len(issues)}")
lines.append("")
lines.append("=== Sheet as saved ===")
for i, s in enumerate(rec.get("slots") or []):
    filled = [r for r in (s.get("rows") or []) if r.get("nm") or r.get("bid")]
    lines.append(f"#{i+1} {s.get('name')} n={len(filled)}")
    for r in filled:
        lines.append(
            f"  {r.get('dur')} {r.get('nm')} requested={r.get('requested')} note={r.get('note')}"
        )

# Desiree special: seller Rose Vicky
lines.append("")
lines.append("=== Notable ===")
for ev in events:
    if staff_turn(ev) or is_request(ev):
        lines.append(
            f"{ev.get('customer')}: staff_turn={staff_turn(ev)} is_request={is_request(ev)} "
            f"seller={ev.get('seller_note')!r} any={ev.get('original_any_available')} t={ev.get('therapist')}"
        )

out = Path("debugging/_audit_sheet.txt")
out.write_text("\n".join(lines), encoding="utf-8")
print(out.read_text(encoding="utf-8"))
