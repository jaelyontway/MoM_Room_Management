"""Check actual booking times from Square API."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService

service = SquareService()
if not service.client:
    print("Service not initialized")
    sys.exit(1)

today = datetime.now().strftime('%Y-%m-%d')
print(f"Checking bookings for {today}")
print("=" * 60)

# Get raw bookings
date_obj = datetime.strptime(today, '%Y-%m-%d')
start_at_min = date_obj.isoformat() + 'Z'
start_at_max = (date_obj + timedelta(days=1)).isoformat() + 'Z'

raw_bookings = service.client.list_bookings(
    start_at_min=start_at_min,
    start_at_max=start_at_max
)

print(f"\nRaw bookings from API: {len(raw_bookings)}")
for i, booking in enumerate(raw_bookings[:5], 1):
    if isinstance(booking, dict):
        booking_id = booking.get('id', 'N/A')
        start_at = booking.get('start_at', 'N/A')
        segments = booking.get('appointment_segments', [])
    else:
        booking_id = getattr(booking, 'id', 'N/A') or 'N/A'
        start_at = getattr(booking, 'start_at', 'N/A') or 'N/A'
        segments = getattr(booking, 'appointment_segments', []) or []
    
    print(f"\nBooking {i}:")
    print(f"  ID: {booking_id}")
    print(f"  Raw start_at: {start_at}")
    if segments:
        seg = segments[0]
        if isinstance(seg, dict):
            duration = seg.get('duration_minutes', 'N/A')
        else:
            duration = getattr(seg, 'duration_minutes', 'N/A') or 'N/A'
        print(f"  Duration: {duration} minutes")

# Get processed bookings
processed = service.get_bookings_for_date(today)
print(f"\n\nProcessed bookings: {len(processed)}")
for i, booking in enumerate(processed[:5], 1):
    print(f"\nProcessed {i}:")
    print(f"  Start: {booking['start_at']}")
    print(f"  End: {booking['end_at']}")
    print(f"  Therapist: {booking['therapist']}")

