"""Find why 3 appointments are missing."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient
from config import Config

print("=" * 60)
print("Finding Missing Appointments")
print("=" * 60)

client = SquareBookingsClient()

today = datetime.now().strftime('%Y-%m-%d')
print(f"\nDate: {today}")

# Try different date ranges to see if appointments are outside the range
date_obj = datetime.strptime(today, '%Y-%m-%d')

# Check a wider range (maybe appointments are at different times)
print("\n1. Checking exact date range (00:00 to 23:59:59)...")
start_at_min = date_obj.isoformat() + 'Z'
start_at_max = (date_obj + timedelta(days=1)).isoformat() + 'Z'

bookings1 = client.list_bookings(
    start_at_min=start_at_min,
    start_at_max=start_at_max
)
print(f"   Found: {len(bookings1)}")

# Check with a slightly wider range (maybe timezone issues)
print("\n2. Checking wider range (yesterday 00:00 to tomorrow 00:00)...")
start_at_min2 = (date_obj - timedelta(days=1)).isoformat() + 'Z'
start_at_max2 = (date_obj + timedelta(days=2)).isoformat() + 'Z'

bookings2 = client.list_bookings(
    start_at_min=start_at_min2,
    start_at_max=start_at_max2
)
print(f"   Found: {len(bookings2)}")

# Filter bookings2 to only today
today_bookings = []
for booking in bookings2:
    if isinstance(booking, dict):
        start_at = booking.get('start_at', '')
        status = booking.get('status', '')
    else:
        start_at = getattr(booking, 'start_at', '') or ''
        status = getattr(booking, 'status', '') or ''
    
    if start_at.startswith(today):
        today_bookings.append(booking)

print(f"   Filtered to today: {len(today_bookings)}")

# Check all bookings in the wider range
print("\n3. All bookings in wider range:")
for booking in bookings2:
    if isinstance(booking, dict):
        booking_id = booking.get('id', 'N/A')
        start_at = booking.get('start_at', '')
        status = booking.get('status', '')
        segments = booking.get('appointment_segments', [])
    else:
        booking_id = getattr(booking, 'id', 'N/A') or 'N/A'
        start_at = getattr(booking, 'start_at', '') or ''
        status = getattr(booking, 'status', '') or ''
        segments = getattr(booking, 'appointment_segments', []) or []
    
    date_part = start_at[:10] if start_at else 'N/A'
    print(f"   {booking_id}: {date_part} {start_at[11:19] if len(start_at) > 19 else ''} (Status: {status}, Segments: {len(segments)})")

# Check if there are bookings with different statuses
print("\n4. Checking for bookings with different statuses...")
statuses = {}
for booking in bookings2:
    if isinstance(booking, dict):
        status = booking.get('status', 'UNKNOWN')
    else:
        status = getattr(booking, 'status', 'UNKNOWN') or 'UNKNOWN'
    
    if status not in statuses:
        statuses[status] = 0
    statuses[status] += 1

print(f"   Status breakdown:")
for status, count in statuses.items():
    print(f"     {status}: {count}")

# Check if there are bookings without segments
print("\n5. Checking for bookings without segments...")
no_segments = 0
for booking in bookings2:
    if isinstance(booking, dict):
        segments = booking.get('appointment_segments', [])
    else:
        segments = getattr(booking, 'appointment_segments', []) or []
    
    if not segments:
        no_segments += 1
        if isinstance(booking, dict):
            booking_id = booking.get('id', 'N/A')
            start_at = booking.get('start_at', '')
        else:
            booking_id = getattr(booking, 'id', 'N/A') or 'N/A'
            start_at = getattr(booking, 'start_at', '') or ''
        print(f"   Booking without segments: {booking_id} at {start_at}")

print(f"\n   Total without segments: {no_segments}")

print("\n" + "=" * 60)
print("Summary:")
print(f"  Expected: 13 appointments")
print(f"  Found in exact range: {len(bookings1)}")
print(f"  Found in wider range (today only): {len(today_bookings)}")
print(f"  Missing: {13 - len(today_bookings)}")
print("=" * 60)

