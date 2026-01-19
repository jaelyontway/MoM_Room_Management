"""Test script to debug service name lookup from Square."""
import sys
import os
from datetime import datetime, timedelta
from dateutil import parser, tz as dateutil_tz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService
import logging

# Set up logging to see debug messages
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

print("=" * 60)
print("Testing Service Name Lookup")
print("=" * 60)

service = SquareService()
if not service.client:
    print("[ERROR] Square service not initialized")
    sys.exit(1)

# Get bookings for today
today = datetime.now().strftime('%Y-%m-%d')
print(f"\nFetching bookings for {today}...")

bookings = service.get_bookings_for_date(today)
print(f"Found {len(bookings)} bookings\n")

if not bookings:
    print("No bookings found. Try a different date or check your Square configuration.")
    sys.exit(0)

# Check service names
print("=" * 60)
print("Service Names Found:")
print("=" * 60)

unknown_count = 0
for i, booking in enumerate(bookings, 1):
    service_name = booking.get('service', 'N/A')
    customer = booking.get('customer', 'N/A')
    therapist = booking.get('therapist', 'N/A')
    start_time = booking.get('start_at', 'N/A')
    
    if service_name == "Unknown Service":
        unknown_count += 1
        print(f"\n{i}. [UNKNOWN SERVICE]")
    else:
        print(f"\n{i}. {service_name}")
    
    print(f"   Customer: {customer}")
    print(f"   Therapist: {therapist}")
    print(f"   Time: {start_time}")

print("\n" + "=" * 60)
print(f"Summary: {len(bookings)} total bookings, {unknown_count} with 'Unknown Service'")
print("=" * 60)

if unknown_count > 0:
    print("\n[INFO] To fix 'Unknown Service' issues:")
    print("1. Check that CATALOG_READ permission is enabled in Square")
    print("2. Check server logs for catalog API errors")
    print("3. Verify service_variation_id exists in booking segments")

