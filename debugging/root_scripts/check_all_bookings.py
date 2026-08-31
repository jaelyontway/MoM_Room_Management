"""Check all bookings without date filters to see if any exist."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService
from config import Config

print("=" * 60)
print("Checking All Bookings (No Date Filter)")
print("=" * 60)

service = SquareService()
if not service.client:
    print("❌ Square service not initialized")
    sys.exit(1)

print(f"\nLocation ID: {Config.SQUARE_LOCATION_ID}")
print(f"Environment: {Config.SQUARE_ENVIRONMENT}")

# Try fetching without date filters (or with a very wide range)
print(f"\n1. Fetching all bookings (no date filter)...")
try:
    # Try with no date filters first
    all_bookings = service.client.list_bookings()
    print(f"   Found {len(all_bookings)} bookings (no date filter)")
    
    if all_bookings:
        print(f"\n   Sample bookings:")
        for i, booking in enumerate(all_bookings[:5], 1):
            if isinstance(booking, dict):
                booking_id = booking.get('id', 'N/A')
                status = booking.get('status', 'N/A')
                start_at = booking.get('start_at', 'N/A')
                location_id = booking.get('location_id', 'N/A')
            else:
                booking_id = getattr(booking, 'id', 'N/A') or 'N/A'
                status = getattr(booking, 'status', 'N/A') or 'N/A'
                start_at = getattr(booking, 'start_at', 'N/A') or 'N/A'
                location_id = getattr(booking, 'location_id', 'N/A') or 'N/A'
            
            print(f"\n   Booking {i}:")
            print(f"      ID: {booking_id}")
            print(f"      Status: {status}")
            print(f"      Start: {start_at}")
            print(f"      Location: {location_id}")
            if location_id != Config.SQUARE_LOCATION_ID:
                print(f"      ⚠️  WARNING: Location mismatch!")
    else:
        print("   [INFO] No bookings found without date filter")
        
        # Try with a very wide date range (past and future)
        print(f"\n2. Trying very wide date range (2020-2030)...")
        wide_start = "2020-01-01T00:00:00Z"
        wide_end = "2030-12-31T23:59:59Z"
        wide_bookings = service.client.list_bookings(
            start_at_min=wide_start,
            start_at_max=wide_end
        )
        print(f"   Found {len(wide_bookings)} bookings in 2020-2030 range")
        
        if wide_bookings:
            print(f"\n   Sample bookings:")
            for booking in wide_bookings[:3]:
                if isinstance(booking, dict):
                    start = booking.get('start_at', 'N/A')
                    status = booking.get('status', 'N/A')
                else:
                    start = getattr(booking, 'start_at', 'N/A') or 'N/A'
                    status = getattr(booking, 'status', 'N/A') or 'N/A'
                print(f"      - {start} ({status})")
        
        # Check if location ID is correct
        print(f"\n3. Verifying location ID...")
        try:
            locations = service.client.locations_api.list_locations()
            if hasattr(locations, 'body'):
                locs = locations.body.get('locations', [])
            elif hasattr(locations, 'locations'):
                locs = locations.locations or []
            else:
                locs = []
            
            print(f"   Found {len(locs)} locations in your account:")
            for loc in locs:
                if isinstance(loc, dict):
                    loc_id = loc.get('id', '')
                    name = loc.get('name', '')
                    address = loc.get('address', {})
                    city = address.get('locality', '') if isinstance(address, dict) else ''
                else:
                    loc_id = getattr(loc, 'id', '') or ''
                    name = getattr(loc, 'name', '') or ''
                    addr = getattr(loc, 'address', None)
                    city = getattr(addr, 'locality', '') if addr else ''
                
                match = "✓" if loc_id == Config.SQUARE_LOCATION_ID else " "
                print(f"   {match} {loc_id} - {name} ({city})")
                
        except Exception as e:
            print(f"   [ERROR] Could not list locations: {e}")
            
except Exception as e:
    print(f"   [ERROR] Error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)

