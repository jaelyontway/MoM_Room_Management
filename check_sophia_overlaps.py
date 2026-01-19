"""Check Sophia's appointments on 2026-01-18 for overlaps."""
import sys
from datetime import datetime
from app.square_service import SquareService

service = SquareService()
date = '2026-01-18'

if not service.client:
    print("Square API not configured, cannot check appointments")
    sys.exit(1)

bookings = service.get_bookings_for_date(date)
sophia_bookings = [b for b in bookings if 'sophia' in b.get('therapist', '').lower()]

print(f"\nSophia's appointments on {date}: {len(sophia_bookings)}")
print("=" * 80)

for i, b in enumerate(sorted(sophia_bookings, key=lambda x: x.get('start_at', '')), 1):
    start = b.get('start_at', 'N/A')
    end = b.get('end_at', 'N/A')
    customer = b.get('customer', 'N/A')
    room = b.get('room', 'N/A')
    booking_id = b.get('id', 'N/A')
    
    print(f"\n{i}. {start} - {end}")
    print(f"   Customer: {customer}")
    print(f"   Room: {room}")
    print(f"   Booking ID: {booking_id[:30]}...")

# Check for overlaps
print("\n" + "=" * 80)
print("OVERLAP CHECK:")
print("=" * 80)

if len(sophia_bookings) < 2:
    print("Not enough appointments to check for overlaps")
else:
    overlaps_found = []
    for i, b1 in enumerate(sophia_bookings):
        for j, b2 in enumerate(sophia_bookings[i+1:], i+1):
            start1 = datetime.fromisoformat(b1['start_at'].replace('Z', '+00:00') if b1['start_at'].endswith('Z') else b1['start_at'])
            end1 = datetime.fromisoformat(b1['end_at'].replace('Z', '+00:00') if b1['end_at'].endswith('Z') else b1['end_at'])
            start2 = datetime.fromisoformat(b2['start_at'].replace('Z', '+00:00') if b2['start_at'].endswith('Z') else b2['start_at'])
            end2 = datetime.fromisoformat(b2['end_at'].replace('Z', '+00:00') if b2['end_at'].endswith('Z') else b2['end_at'])
            
            # Check if they overlap
            overlaps = not (end1 <= start2 or end2 <= start1)
            
            if overlaps:
                overlaps_found.append({
                    'apt1': b1,
                    'apt2': b2,
                    'start1': start1,
                    'end1': end1,
                    'start2': start2,
                    'end2': end2
                })
                print(f"\n[OVERLAP DETECTED]:")
                print(f"   Appointment 1: {start1.strftime('%H:%M')} - {end1.strftime('%H:%M')} ({b1.get('customer', 'N/A')})")
                print(f"   Appointment 2: {start2.strftime('%H:%M')} - {end2.strftime('%H:%M')} ({b2.get('customer', 'N/A')})")
                print(f"   Overlap duration: {max(0, (min(end1, end2) - max(start1, start2)).total_seconds() / 60):.0f} minutes")

if not overlaps_found:
    print("\n✓ No overlaps found for Sophia on this date")

