import json
import urllib.request
from pathlib import Path

d = json.loads(
    urllib.request.urlopen("http://127.0.0.1:8001/api/day?date=2026-07-20", timeout=30)
    .read()
    .decode()
)
rec = json.loads(Path("appt records/2026-07-20.json").read_text(encoding="utf-8"))
lines = []
order = sorted(d.get("therapist_order") or [], key=lambda x: x.get("order") or 0)
lines.append("ORDER: " + str([(r.get("order"), r.get("therapist")) for r in order]))
lines.append("SHEET: " + str([s.get("name") for s in rec.get("slots") or []]))
lines.append("EDITS roster: " + str((rec.get("edits") or {}).get("roster")))
rows = (rec.get("edits") or {}).get("rows") or {}
lines.append("LOCKS count: " + str(len(rows)))
for k, v in list(rows.items())[:30]:
    lines.append(f"  lock {k}: masseuse={v.get('masseuse')} bid={v.get('bid')} past={v.get('past')} pinned={v.get('pinned')} nm={v.get('nm')}")

def lt(iso):
    if not iso or "T" not in iso:
        return ""
    return iso.split("T")[1][:5]

lines.append("--- EVENTS ---")
for ev in sorted(d.get("events") or [], key=lambda e: str(e.get("start_at") or "")):
    if str(ev.get("room")) == "ADDON":
        continue
    lines.append(
        f"{lt(ev.get('start_at'))}-{lt(ev.get('display_end_at') or ev.get('end_at'))} "
        f"{ev.get('customer')} any={ev.get('original_any_available')} t={ev.get('therapist')} "
        f"seller={ev.get('seller_note')!r}"
    )

lines.append("--- SHEET FILLED ---")
for i, s in enumerate(rec.get("slots") or []):
    filled = [r for r in (s.get("rows") or []) if r.get("nm") or r.get("bid")]
    lines.append(f"#{i+1} {s.get('name')}")
    for r in filled:
        lines.append(f"  {r.get('dur')} {r.get('nm')} req={r.get('requested')} bid={r.get('bid')}")

Path("debugging/_assign_zh.txt").write_text("\n".join(lines), encoding="utf-8")
print("ok")
