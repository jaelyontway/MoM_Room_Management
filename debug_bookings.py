"""Debug script to see what bookings are being returned from Square API."""
import sys
import os
from datetime import datetime, timedelta
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService
from config import Config

print("=" * 60)
print("Debugging Square Bookings")
print("=" * 60)

# Initialize service
service = SquareService()
if not service.client:
    print("❌ Square service not initialized")
    sys.exit(1)

# Get today's date
today = datetime.now()
today_str = today.strftime('%Y-%m-%d')
print(f"\n1. Testing date: {today_str}")
print(f"   Current time: {today.strftime('%Y-%m-%d %H:%M:%S')}")

# Create time range
date_obj = datetime.strptime(today_str, '%Y-%m-%d')
start_at_min = date_obj.isoformat() + 'Z'
start_at_max = (date_obj + timedelta(days=1)).isoformat() + 'Z'

print(f"\n2. API Query Parameters:")
print(f"   Location ID: {Config.SQUARE_LOCATION_ID}")
print(f"   Start: {start_at_min}")
print(f"   End: {start_at_max}")

# Fetch raw bookings from Square
print(f"\n3. Fetching raw bookings from Square API...")
try:
    square_bookings = service.client.list_bookings(
        start_at_min=start_at_min,
        start_at_max=start_at_max
    )
    print(f"   [OK] API returned {len(square_bookings)} bookings")
    
    if square_bookings:
        print(f"\n4. Raw Booking Details (first 3):")
        for i, booking in enumerate(square_bookings[:3], 1):
            print(f"\n   Booking {i}:")
            if isinstance(booking, dict):
                print(f"      ID: {booking.get('id', 'N/A')}")
                print(f"      Status: {booking.get('status', 'N/A')}")
                print(f"      Start: {booking.get('start_at', 'N/A')}")
                print(f"      Customer ID: {booking.get('customer_id', 'N/A')}")
                segments = booking.get('appointment_segments', [])
                print(f"      Segments: {len(segments)}")
                if segments:
                    seg = segments[0]
                    print(f"         - Team Member: {seg.get('team_member_id', 'N/A')}")
                    print(f"         - Service: {seg.get('service_variation_name', 'N/A')}")
                    print(f"         - Duration: {seg.get('duration_minutes', 'N/A')} min")
            else:
                # Square SDK object
                print(f"      ID: {getattr(booking, 'id', 'N/A')}")
                print(f"      Status: {getattr(booking, 'status', 'N/A')}")
                print(f"      Start: {getattr(booking, 'start_at', 'N/A')}")
                segments = getattr(booking, 'appointment_segments', []) or []
                print(f"      Segments: {len(segments)}")
    else:
        print("   [INFO] No bookings returned from API")
        
        # Try a wider date range
        print(f"\n5. Trying wider date range (today ± 7 days)...")
        start_wide = (date_obj - timedelta(days=7)).isoformat() + 'Z'
        end_wide = (date_obj + timedelta(days=7)).isoformat() + 'Z'
        wide_bookings = service.client.list_bookings(
            start_at_min=start_wide,
            start_at_max=end_wide
        )
        print(f"   Found {len(wide_bookings)} bookings in ±7 day range")
        
        if wide_bookings:
            print(f"\n   Sample bookings from wider range:")
            for booking in wide_bookings[:3]:
                if isinstance(booking, dict):
                    start = booking.get('start_at', '')
                    status = booking.get('status', '')
                    print(f"      - {start[:10]} ({status})")
                else:
                    start = getattr(booking, 'start_at', '') or ''
                    status = getattr(booking, 'status', '') or ''
                    print(f"      - {start[:10]} ({status})")
        
except Exception as e:
    print(f"   [ERROR] Error fetching bookings: {e}")
    import traceback
    traceback.print_exc()

# Test the processed bookings
print(f"\n6. Testing processed bookings (via get_bookings_for_date)...")
try:
    processed = service.get_bookings_for_date(today_str)
    print(f"   [OK] Processed {len(processed)} bookings")
    
    if processed:
        print(f"\n   Processed booking details:")
        for booking in processed[:3]:
            print(f"      - {booking['customer']} with {booking['therapist']}")
            print(f"        {booking['service']} at {booking['start_at'][:16]}")
    else:
        print("   [INFO] No processed bookings (might be filtered out)")
        print("   Possible reasons:")
        print("      - Bookings have no appointment_segments")
        print("      - Bookings are cancelled/declined")
        print("      - Time zone mismatch")
        print("      - Date format issue")
        
except Exception as e:
    print(f"   [ERROR] Error processing bookings: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)
print("Debug Complete")
print("=" * 60)

