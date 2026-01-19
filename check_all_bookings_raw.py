"""Check all raw bookings to see what might be filtered."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService
from config import Config

service = SquareService()
if not service.client:
    print("Service not initialized")
    sys.exit(1)

today = datetime.now().strftime('%Y-%m-%d')
print(f"Checking ALL bookings for {today}")
print("=" * 60)

# Get raw bookings
date_obj = datetime.strptime(today, '%Y-%m-%d')
start_at_min = date_obj.isoformat() + 'Z'
start_at_max = (date_obj + timedelta(days=1)).isoformat() + 'Z'

raw_bookings = service.client.list_bookings(
    start_at_min=start_at_min,
    start_at_max=start_at_max
)

print(f"\nTotal raw bookings from API: {len(raw_bookings)}")

# Check each booking
skipped_no_segments = 0
skipped_cancelled = 0
skipped_no_start = 0
valid_bookings = 0

for booking in raw_bookings:
    if isinstance(booking, dict):
        booking_id = booking.get('id', 'N/A')
        status = booking.get('status', '')
        start_at = booking.get('start_at', '')
        segments = booking.get('appointment_segments', [])
    else:
        booking_id = getattr(booking, 'id', 'N/A') or 'N/A'
        status = getattr(booking, 'status', '') or ''
        start_at = getattr(booking, 'start_at', '') or ''
        segments = getattr(booking, 'appointment_segments', []) or []
    
    # Check why it might be skipped
    if status in ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED']:
        skipped_cancelled += 1
        print(f"\n[SKIPPED - Cancelled] {booking_id}")
        print(f"  Status: {status}")
    elif not segments:
        skipped_no_segments += 1
        print(f"\n[SKIPPED - No segments] {booking_id}")
        print(f"  Start: {start_at}")
    elif not start_at:
        skipped_no_start += 1
        print(f"\n[SKIPPED - No start time] {booking_id}")
    else:
        valid_bookings += 1
        if isinstance(segments[0], dict):
            team_member_id = segments[0].get('team_member_id', 'N/A')
        else:
            team_member_id = getattr(segments[0], 'team_member_id', 'N/A') or 'N/A'
        print(f"\n[VALID] {booking_id}")
        print(f"  Start: {start_at}")
        print(f"  Status: {status}")
        print(f"  Team Member: {team_member_id}")

print("\n" + "=" * 60)
print("Summary:")
print(f"  Total from API: {len(raw_bookings)}")
print(f"  Valid bookings: {valid_bookings}")
print(f"  Skipped (cancelled): {skipped_cancelled}")
print(f"  Skipped (no segments): {skipped_no_segments}")
print(f"  Skipped (no start): {skipped_no_start}")
print("=" * 60)

# Compare with processed
processed = service.get_bookings_for_date(today)
print(f"\nProcessed bookings: {len(processed)}")
if len(processed) != valid_bookings:
    print(f"[WARN] Mismatch! Expected {valid_bookings}, got {len(processed)}")
    print("Some bookings might have conversion errors")

