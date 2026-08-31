"""Check all appointments in detail to find missing ones."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService
from square_client import SquareBookingsClient
from config import Config

print("=" * 60)
print("Detailed Appointment Check")
print("=" * 60)

service = SquareService()
if not service.client:
    print("[ERROR] Service not initialized")
    sys.exit(1)

today = datetime.now().strftime('%Y-%m-%d')
print(f"\nDate: {today}")

# Get raw bookings
date_obj = datetime.strptime(today, '%Y-%m-%d')
start_at_min = date_obj.isoformat() + 'Z'
start_at_max = (date_obj + timedelta(days=1)).isoformat() + 'Z'

raw_bookings = service.client.list_bookings(
    start_at_min=start_at_min,
    start_at_max=start_at_max
)

print(f"\nTotal raw bookings from API: {len(raw_bookings)}")

# Group by therapist
therapist_bookings = {}
for booking in raw_bookings:
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
        print(f"\n[SKIP] Booking {booking_id} - No segments")
        continue
    
    segment = segments[0]
    if isinstance(segment, dict):
        team_member_id = segment.get('team_member_id', '')
    else:
        team_member_id = getattr(segment, 'team_member_id', '') or ''
    
    # Get therapist name
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
        print(f"  - {booking['id']} at {booking['start_at'][:16]} (Status: {booking['status']})")

total_count = sum(len(bookings) for bookings in therapist_bookings.values())
print(f"\n{'='*60}")
print(f"Total appointments: {total_count}")
print(f"Expected: 13")
print(f"Missing: {13 - total_count}")
print(f"{'='*60}")

# Check processed bookings
processed = service.get_bookings_for_date(today)
print(f"\nProcessed bookings: {len(processed)}")

# Group processed by therapist
processed_by_therapist = {}
for booking in processed:
    therapist = booking['therapist']
    if therapist not in processed_by_therapist:
        processed_by_therapist[therapist] = []
    processed_by_therapist[therapist].append(booking)

print(f"\n{'='*60}")
print("Processed Appointments by Therapist:")
print(f"{'='*60}")

for therapist in sorted(processed_by_therapist.keys()):
    count = len(processed_by_therapist[therapist])
    print(f"\n{therapist}: {count} appointment(s)")
    for booking in processed_by_therapist[therapist]:
        print(f"  - {booking['customer']} at {booking['start_at'][:16]}")

print(f"\n{'='*60}")
print("Comparison:")
print(f"  Raw bookings: {len(raw_bookings)}")
print(f"  Valid bookings (with segments): {total_count}")
print(f"  Processed bookings: {len(processed)}")
print(f"{'='*60}")

