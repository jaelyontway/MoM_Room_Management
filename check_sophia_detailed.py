"""Check Sophia's appointments in detail with local time conversion."""
import sys
from datetime import datetime
from dateutil import parser
from dateutil import tz as dateutil_tz
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

# Get local timezone
local_tz = dateutil_tz.tzlocal()

for i, b in enumerate(sorted(sophia_bookings, key=lambda x: x.get('start_at', '')), 1):
    start_str = b.get('start_at', 'N/A')
    end_str = b.get('end_at', 'N/A')
    customer = b.get('customer', 'N/A')
    room = b.get('room', 'N/A')
    booking_id = b.get('id', 'N/A')
    
    # Parse and convert to local time
    if start_str != 'N/A' and end_str != 'N/A':
        start_utc = parser.parse(start_str)
        end_utc = parser.parse(end_str)
        start_local = start_utc.astimezone(local_tz)
        end_local = end_utc.astimezone(local_tz)
        
        print(f"\n{i}. {customer}")
        print(f"   UTC Time:  {start_utc.strftime('%Y-%m-%d %H:%M:%S %Z')} - {end_utc.strftime('%H:%M:%S %Z')}")
        print(f"   Local Time: {start_local.strftime('%Y-%m-%d %H:%M:%S %Z')} - {end_local.strftime('%H:%M:%S %Z')}")
        print(f"   Room: {room}")
        print(f"   Booking ID: {booking_id[:30]}...")
    else:
        print(f"\n{i}. {start_str} - {end_str}")
        print(f"   Customer: {customer}, Room: {room}")

# Check for overlaps (using UTC times)
print("\n" + "=" * 80)
print("OVERLAP CHECK (using parsed times):")
print("=" * 80)

if len(sophia_bookings) < 2:
    print("Not enough appointments to check for overlaps")
else:
    overlaps_found = []
    for i, b1 in enumerate(sophia_bookings):
        for j, b2 in enumerate(sophia_bookings[i+1:], i+1):
            try:
                start1 = parser.parse(b1['start_at'])
                end1 = parser.parse(b1['end_at'])
                start2 = parser.parse(b2['start_at'])
                end2 = parser.parse(b2['end_at'])
                
                # Check if they overlap
                overlaps = not (end1 <= start2 or end2 <= start1)
                
                if overlaps:
                    overlap_start = max(start1, start2)
                    overlap_end = min(end1, end2)
                    overlap_duration = (overlap_end - overlap_start).total_seconds() / 60
                    
                    overlaps_found.append({
                        'apt1': b1,
                        'apt2': b2,
                        'start1': start1,
                        'end1': end1,
                        'start2': start2,
                        'end2': end2,
                        'overlap_duration': overlap_duration
                    })
                    
                    print(f"\n[OVERLAP DETECTED]:")
                    print(f"   {b1.get('customer', 'N/A')}: {start1.strftime('%H:%M')} - {end1.strftime('%H:%M')} UTC ({start1.astimezone(local_tz).strftime('%H:%M')} - {end1.astimezone(local_tz).strftime('%H:%M')} local)")
                    print(f"   {b2.get('customer', 'N/A')}: {start2.strftime('%H:%M')} - {end2.strftime('%H:%M')} UTC ({start2.astimezone(local_tz).strftime('%H:%M')} - {end2.astimezone(local_tz).strftime('%H:%M')} local)")
                    print(f"   Overlap: {overlap_start.strftime('%H:%M')} - {overlap_end.strftime('%H:%M')} UTC ({overlap_start.astimezone(local_tz).strftime('%H:%M')} - {overlap_end.astimezone(local_tz).strftime('%H:%M')} local)")
                    print(f"   Overlap duration: {overlap_duration:.0f} minutes")
            except Exception as e:
                print(f"Error checking overlap between {b1.get('customer', 'N/A')} and {b2.get('customer', 'N/A')}: {e}")

if not overlaps_found:
    print("\n[OK] No overlaps found for Sophia on this date")

