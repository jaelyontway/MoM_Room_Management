"""Check all appointments including cancelled and no-show."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient
from app.square_service import SquareService

print("=" * 60)
print("Checking ALL Appointments (Including Cancelled/No-Show)")
print("=" * 60)

client = SquareBookingsClient()
service = SquareService()

today = datetime.now().strftime('%Y-%m-%d')
date_obj = datetime.strptime(today, '%Y-%m-%d')
start_at_min = date_obj.isoformat() + 'Z'
start_at_max = (date_obj + timedelta(days=1)).isoformat() + 'Z'

raw_bookings = client.list_bookings(
    start_at_min=start_at_min,
    start_at_max=start_at_max
)

print(f"\nTotal raw bookings: {len(raw_bookings)}")

# Group by status
by_status = {}
by_therapist = {}

for booking in raw_bookings:
    if isinstance(booking, dict):
        booking_id = booking.get('id', 'N/A')
        start_at = booking.get('start_at', '')
        status = booking.get('status', 'UNKNOWN')
        segments = booking.get('appointment_segments', [])
    else:
        booking_id = getattr(booking, 'id', 'N/A') or 'N/A'
        start_at = getattr(booking, 'start_at', '') or ''
        status = getattr(booking, 'status', 'UNKNOWN') or 'UNKNOWN'
        segments = getattr(booking, 'appointment_segments', []) or []
    
    # Count by status
    if status not in by_status:
        by_status[status] = 0
    by_status[status] += 1
    
    # Count by therapist
    if segments:
        segment = segments[0]
        if isinstance(segment, dict):
            team_member_id = segment.get('team_member_id', '')
        else:
            team_member_id = getattr(segment, 'team_member_id', '') or ''
        
        therapist_name = service.get_team_member_name(team_member_id)
        
        if therapist_name not in by_therapist:
            by_therapist[therapist_name] = {'total': 0, 'accepted': 0, 'cancelled': 0, 'no_show': 0}
        
        by_therapist[therapist_name]['total'] += 1
        if status == 'ACCEPTED':
            by_therapist[therapist_name]['accepted'] += 1
        elif status in ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED']:
            by_therapist[therapist_name]['cancelled'] += 1
        elif status == 'NO_SHOW':
            by_therapist[therapist_name]['no_show'] += 1

print(f"\n{'='*60}")
print("By Status:")
print(f"{'='*60}")
for status, count in sorted(by_status.items()):
    print(f"  {status}: {count}")

print(f"\n{'='*60}")
print("By Therapist (ALL statuses):")
print(f"{'='*60}")
for therapist in sorted(by_therapist.keys()):
    info = by_therapist[therapist]
    print(f"\n{therapist}:")
    print(f"  Total: {info['total']}")
    print(f"  Accepted: {info['accepted']}")
    print(f"  Cancelled: {info['cancelled']}")
    print(f"  No-Show: {info['no_show']}")

# Check what the current code filters
print(f"\n{'='*60}")
print("Current Code Filters:")
print(f"{'='*60}")
print("  Filters OUT: CANCELLED_BY_CUSTOMER, CANCELLED_BY_SELLER, DECLINED")
print("  Keeps: ACCEPTED, NO_SHOW, and other statuses")

processed = service.get_bookings_for_date(today)
print(f"\nProcessed bookings (after filtering): {len(processed)}")

# Count processed by therapist
processed_by_therapist = {}
for booking in processed:
    therapist = booking['therapist']
    if therapist not in processed_by_therapist:
        processed_by_therapist[therapist] = 0
    processed_by_therapist[therapist] += 1

print(f"\nProcessed by therapist:")
for therapist in sorted(processed_by_therapist.keys()):
    print(f"  {therapist}: {processed_by_therapist[therapist]}")

print(f"\n{'='*60}")
print("Summary:")
print(f"  Raw bookings: {len(raw_bookings)}")
print(f"  Processed (after filter): {len(processed)}")
print(f"  Expected: 13")
print(f"  Missing: {13 - len(processed)}")
print(f"{'='*60}")

