import json
import urllib.request
from pathlib import Path

DATE = "2026-07-20"
url = f"http://127.0.0.1:8001/api/day?date={DATE}"
try:
    with urllib.request.urlopen(url, timeout=15) as r:
        d = json.loads(r.read().decode("utf-8"))
except Exception as e:
    print("API FAIL", e)
    d = None

rec_path = Path(__file__).resolve().parents[1] / "appt records" / f"{DATE}.json"
rec = json.loads(rec_path.read_text(encoding="utf-8")) if rec_path.exists() else None


def lt(iso):
    if not iso or "T" not in iso:
        return iso or ""
    return iso.split("T")[1][:5]


if d:
    print("=== API day", d.get("date"), "===")
    order = sorted(d.get("therapist_order") or [], key=lambda r: r.get("order") or 0)
    print("order:", [(r.get("order"), r.get("therapist")) for r in order])
    evs = [e for e in (d.get("events") or []) if str(e.get("room") or "") != "ADDON"]
    evs.sort(key=lambda e: str(e.get("start_at") or ""))
    print("sheet events:", len(evs))
    for ev in evs:
        cust = str(ev.get("customer") or "")[:22]
        print(
            f"  {lt(ev.get('start_at'))}-{lt(ev.get('display_end_at') or ev.get('end_at'))}"
            f" | {cust:22} | t1={ev.get('therapist') or ''} t2={ev.get('therapist_2') or ''}"
            f" | any={ev.get('original_any_available')} type={ev.get('type')} room={ev.get('room')}"
        )
        # morning focus
    print("\n--- morning 10:00 window ---")
    for ev in evs:
        st = lt(ev.get("start_at"))
        if st.startswith("10") or st.startswith("09") or st.startswith("11"):
            print(
                f"  {st}-{lt(ev.get('display_end_at') or ev.get('end_at'))}"
                f" | {ev.get('customer')} | {ev.get('therapist')} / {ev.get('therapist_2')}"
                f" | any={ev.get('original_any_available')}"
            )

if rec:
    print("\n=== SHEET RECORD slots ===")
    for i, s in enumerate(rec.get("slots") or []):
        filled = [r for r in (s.get("rows") or []) if r.get("nm") or r.get("bid")]
        print(f"#{i+1} {s.get('name')!r} filled={len(filled)}")
        for r in filled[:12]:
            print(f"    {r.get('dur')} | {r.get('nm')} | rm={r.get('rm')} | note={r.get('note')} | bid={r.get('bid')}")
