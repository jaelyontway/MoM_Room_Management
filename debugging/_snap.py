import sqlite3

c = sqlite3.connect("room_assignments.db")
c.row_factory = sqlite3.Row
bids = ("otzl8n7ij5yh31", "qqcjldi6akpv0o", "qopaeb5uf60twd")
for r in c.execute(
    "select booking_id, any_available_snapshot, therapist_override, therapist_locked "
    "from booking_overrides where booking_id in (?,?,?)",
    bids,
):
    print(dict(r))
