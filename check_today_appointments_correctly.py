"""Check today's appointments with correct timezone handling."""
import sys
import os
from datetime import datetime, timedelta
from dateutil import tz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient
from config import Config

print("=" * 60)
print("Checking Today's Appointments (Correct Timezone)")
print("=" * 60)

client = SquareBookingsClient()

# Get today in local timezone
local_tz = tz.tzlocal()
now = datetime.now(local_tz)
today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
today_end = today_start + timedelta(days=1)

# Convert to UTC for API
today_start_utc = today_start.astimezone(tz.UTC)
today_end_utc = today_end.astimezone(tz.UTC)

print(f"\nLocal timezone: {local_tz}")
print(f"Today (local): {today_start.date()}")
print(f"Today start (UTC): {today_start_utc.isoformat()}")
print(f"Today end (UTC): {today_end_utc.isoformat()}")

# Query with UTC times
bookings = client.list_bookings(
    start_at_min=today_start_utc.isoformat().replace('+00:00', 'Z'),
    start_at_max=today_end_utc.isoformat().replace('+00:00', 'Z')
)

print(f"\nFound {len(bookings)} bookings")

# Group by therapist
therapist_bookings = {}
for booking in bookings:
    if isinstance(booking, dict):
        booking_id = booking.get('id', 'N/A')
        start_at = booking.get('start_at', '')
        segments = booking.get('appointment_segments', [])
        status = booking.get('status', '')
    else:
        booking_id = getattr(booking, 'id', 'N/A') or 'N/A'
        start_at = getattr(booking, 'start_at', '') or ''
        segments = getattr(booking, 'appointment_segments', []) or []
        status = getattr(booking, 'status', '') or ''
    
    if not segments:
        continue
    
    segment = segments[0]
    if isinstance(segment, dict):
        team_member_id = segment.get('team_member_id', '')
    else:
        team_member_id = getattr(segment, 'team_member_id', '') or ''
    
    # Get therapist name
    from app.square_service import SquareService
    service = SquareService()
    therapist_name = service.get_team_member_name(team_member_id)
    
    if therapist_name not in therapist_bookings:
        therapist_bookings[therapist_name] = []
    
    therapist_bookings[therapist_name].append({
        'id': booking_id,
        'start_at': start_at,
        'status': status
    })

print(f"\n{'='*60}")
print("Appointments by Therapist:")
print(f"{'='*60}")

for therapist in sorted(therapist_bookings.keys()):
    count = len(therapist_bookings[therapist])
    print(f"\n{therapist}: {count} appointment(s)")
    for booking in therapist_bookings[therapist]:
        print(f"  - {booking['id']} at {booking['start_at'][:19]} (Status: {booking['status']})")

total = sum(len(b) for b in therapist_bookings.values())
print(f"\n{'='*60}")
print(f"Total: {total} appointments")
print(f"Expected: 13")
print(f"Missing: {13 - total}")
print(f"{'='*60}")

# Also check what the current code does
print("\n\nComparing with current code's date range...")
date_str = now.strftime('%Y-%m-%d')
date_obj = datetime.strptime(date_str, '%Y-%m-%d')
start_at_min_old = date_obj.isoformat() + 'Z'
start_at_max_old = (date_obj + timedelta(days=1)).isoformat() + 'Z'

print(f"Current code uses:")
print(f"  start_at_min: {start_at_min_old}")
print(f"  start_at_max: {start_at_max_old}")

bookings_old = client.list_bookings(
    start_at_min=start_at_min_old,
    start_at_max=start_at_max_old
)

print(f"  Found: {len(bookings_old)} bookings")

