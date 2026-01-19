"""Diagnose why some appointments might be missing."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService
from square_client import SquareBookingsClient
from config import Config

print("=" * 60)
print("Diagnosing Missing Appointments")
print("=" * 60)

service = SquareService()
if not service.client:
    print("[ERROR] Service not initialized")
    sys.exit(1)

# Check today and a few days around
today = datetime.now()
dates_to_check = [
    (today - timedelta(days=1)).strftime('%Y-%m-%d'),
    today.strftime('%Y-%m-%d'),
    (today + timedelta(days=1)).strftime('%Y-%m-%d'),
]

print("\nChecking multiple dates...")
for date_str in dates_to_check:
    print(f"\n{'='*60}")
    print(f"Date: {date_str}")
    print(f"{'='*60}")
    
    # Get raw bookings
    date_obj = datetime.strptime(date_str, '%Y-%m-%d')
    start_at_min = date_obj.isoformat() + 'Z'
    start_at_max = (date_obj + timedelta(days=1)).isoformat() + 'Z'
    
    raw_bookings = service.client.list_bookings(
        start_at_min=start_at_min,
        start_at_max=start_at_max
    )
    
    processed = service.get_bookings_for_date(date_str)
    
    print(f"  Raw bookings from API: {len(raw_bookings)}")
    print(f"  Processed bookings: {len(processed)}")
    
    if len(raw_bookings) != len(processed):
        print(f"  [WARN] Mismatch! {len(raw_bookings) - len(processed)} bookings were filtered out")
    
    if processed:
        print(f"  Sample bookings:")
        for booking in processed[:3]:
            print(f"    - {booking['therapist']}: {booking['customer']} at {booking['start_at'][:16]}")

# Check if there are bookings in a wider range
print(f"\n{'='*60}")
print("Checking wider date range (today ± 30 days)...")
print(f"{'='*60}")

date_obj = datetime.strptime(today.strftime('%Y-%m-%d'), '%Y-%m-%d')
start_wide = (date_obj - timedelta(days=30)).isoformat() + 'Z'
end_wide = (date_obj + timedelta(days=30)).isoformat() + 'Z'

try:
    # Note: Square API limits to 31 days, so we'll check in chunks
    wide_bookings = service.client.list_bookings(
        start_at_min=start_wide,
        start_at_max=end_wide
    )
    print(f"  Total bookings in ±30 day range: {len(wide_bookings)}")
    
    # Group by date
    bookings_by_date = {}
    for booking in wide_bookings:
        if isinstance(booking, dict):
            start_at = booking.get('start_at', '')
        else:
            start_at = getattr(booking, 'start_at', '') or ''
        
        if start_at:
            # Extract date
            date_part = start_at[:10]  # YYYY-MM-DD
            if date_part not in bookings_by_date:
                bookings_by_date[date_part] = 0
            bookings_by_date[date_part] += 1
    
    print(f"\n  Bookings by date (showing dates with bookings):")
    for date_key in sorted(bookings_by_date.keys())[:10]:
        print(f"    {date_key}: {bookings_by_date[date_key]} bookings")
        
except Exception as e:
    print(f"  [ERROR] Could not check wide range: {e}")

print("\n" + "=" * 60)
print("Possible reasons for missing appointments:")
print("=" * 60)
print("1. Appointments are on different dates")
print("2. Appointments are cancelled (filtered out)")
print("3. Appointments have no appointment_segments (filtered out)")
print("4. Time zone issues (appointments might be in different timezone)")
print("5. Appointments are in a different location")
print("=" * 60)

