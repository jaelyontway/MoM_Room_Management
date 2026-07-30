"""Simulate morning turn: Sophia, Rose, Tina, Katy, Lillian, May."""
from datetime import datetime, timezone

roster = ["Sophia E", "Rose J", "Tina R", "Katy M", "Lillian I", "May L"]
# local times as minutes from midnight
events = [
    ("Jude", 10 * 60, 11 * 60, True, None),  # any
    ("Christalle", 10 * 60 + 30, 12 * 60, True, None),
    ("Fay", 11 * 60, 12 * 60, False, "Sophia E"),  # requested but Sophia may already have
]

rows = {n: [] for n in roster}
turn = 0


def busy(name, start, end):
    for s, e in rows[name]:
        if s < end and start < e:
            return True
    return False


def count(name):
    return len(rows[name])


for cust, start, end, any_av, pref in events:
    n = len(roster)
    if not any_av and pref:
        idx = roster.index(pref) if pref in roster else -1
        if idx >= 0 and count(roster[idx]) == 0 and not busy(roster[idx], start, end):
            rows[roster[idx]].append((start, end))
            turn = (idx + 1) % n
            print(cust, "->", roster[idx], "(request)")
            continue
    pool = [i for i, name in enumerate(roster) if not busy(name, start, end)]
    pool.sort(
        key=lambda i: (
            count(roster[i]),
            (i - turn + n) % n,
        )
    )
    pick = pool[0]
    rows[roster[pick]].append((start, end))
    turn = (pick + 1) % n
    print(cust, "->", roster[pick], "(turn)")

print("---")
for name in roster:
    print(name, rows[name])
