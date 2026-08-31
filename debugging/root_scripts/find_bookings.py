"""Find dates that have bookings in Square."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService

print("=" * 60)
print("Finding Dates with Bookings in Square")
print("=" * 60)

service = SquareService()

if not service.client:
    print("[ERROR] Square API not configured")
    sys.exit(1)

print("\nSearching for bookings in the next 30 days...")
print("This may take a moment...\n")

found_dates = []
start_date = datetime.now()

for i in range(30):
    check_date = (start_date + timedelta(days=i)).strftime('%Y-%m-%d')
    bookings = service.get_bookings_for_date(check_date)
    
    if bookings:
        found_dates.append((check_date, len(bookings)))
        print(f"  [FOUND] {check_date}: {len(bookings)} bookings")
        # Show sample
        if bookings:
            b = bookings[0]
            print(f"           Sample: {b['customer']} with {b['therapist']} at {b['start_at'][:16]}")

if not found_dates:
    print("\n[INFO] No bookings found in the next 30 days")
    print("This could mean:")
    print("  - No appointments are scheduled")
    print("  - All appointments are in the past")
    print("  - There's an issue with the Square API connection")
    print("\nTry checking your Square dashboard directly")
else:
    print(f"\n[SUCCESS] Found bookings on {len(found_dates)} date(s)")
    print("\nTo view these bookings in the dashboard:")
    print("  1. Restart your server: python run.py")
    print("  2. Open: http://127.0.0.1:8000/")
    print("  3. Select one of the dates above")

print("=" * 60)

