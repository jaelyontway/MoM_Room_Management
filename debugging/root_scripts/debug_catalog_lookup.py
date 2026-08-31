"""Debug script to test catalog lookup with detailed logging."""
import sys
import os
import json
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService
import logging

# Set up detailed logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

print("=" * 80)
print("Catalog Lookup Debug Script")
print("=" * 80)

service = SquareService()
if not service.client:
    print("[ERROR] Square service not initialized. Check your .env file.")
    sys.exit(1)

# Get bookings for today
today = datetime.now().strftime('%Y-%m-%d')
print(f"\n[1] Fetching bookings for {today}...")

bookings = service.get_bookings_for_date(today)
print(f"[1] Found {len(bookings)} bookings\n")

if not bookings:
    print("[INFO] No bookings found. Try a different date or check your Square configuration.")
    print("\n[INFO] To test with a specific variation_id, modify this script.")
    sys.exit(0)

# Analyze service names
print("=" * 80)
print("Service Name Analysis")
print("=" * 80)

unknown_bookings = []
known_bookings = []

for i, booking in enumerate(bookings, 1):
    service_name = booking.get('service', 'N/A')
    service_variation_id = None
    
    # Try to get the variation_id from the original booking
    # We need to trace back to the original booking data
    booking_id = booking.get('id', 'N/A')
    
    if service_name == "Unknown Service":
        unknown_bookings.append({
            'booking_id': booking_id,
            'therapist': booking.get('therapist', 'N/A'),
            'customer': booking.get('customer', 'N/A'),
            'start_at': booking.get('start_at', 'N/A')
        })
    else:
        known_bookings.append({
            'booking_id': booking_id,
            'service_name': service_name,
            'therapist': booking.get('therapist', 'N/A')
        })

print(f"\n✓ Known Services: {len(known_bookings)}")
for b in known_bookings[:5]:  # Show first 5
    print(f"  - {b['service_name']} (Booking: {b['booking_id'][:8]}...)")

print(f"\n✗ Unknown Services: {len(unknown_bookings)}")
for b in unknown_bookings[:5]:  # Show first 5
    print(f"  - Booking: {b['booking_id'][:8]}... | Therapist: {b['therapist']} | Time: {b['start_at']}")

print("\n" + "=" * 80)
print("Next Steps:")
print("=" * 80)
print("1. Check the server logs above for [CATALOG DEBUG] messages")
print("2. Look for [SERVICE NAME] messages to see the lookup process")
print("3. If you have a specific variation_id, you can test it directly")
print("4. Check that CATALOG_READ permission is enabled in Square")
print("\nTo test a specific variation_id, modify this script to call:")
print("  service._get_service_name_from_catalog('YOUR_VARIATION_ID')")

