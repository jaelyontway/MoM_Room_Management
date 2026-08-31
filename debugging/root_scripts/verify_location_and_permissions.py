"""Verify location ID and check API permissions."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient
from config import Config

print("=" * 60)
print("Verifying Location and Permissions")
print("=" * 60)

client = SquareBookingsClient()
print(f"\nLocation ID from config: {Config.SQUARE_LOCATION_ID}")

# Try to get locations
print(f"\n1. Checking available locations...")
try:
    # Try different methods to get locations
    if hasattr(client.locations_api, 'list_locations'):
        result = client.locations_api.list_locations()
    elif hasattr(client.locations_api, 'retrieve_location'):
        # Try to retrieve the specific location
        result = client.locations_api.retrieve_location(location_id=Config.SQUARE_LOCATION_ID)
        print(f"   [OK] Location {Config.SQUARE_LOCATION_ID} exists")
    else:
        print(f"   [WARN] Cannot access locations API")
        result = None
    
    # Try to get location info
    try:
        location_result = client.locations_api.retrieve_location(location_id=Config.SQUARE_LOCATION_ID)
        if hasattr(location_result, 'body'):
            location = location_result.body.get('location')
        elif hasattr(location_result, 'location'):
            location = location_result.location
        else:
            location = None
            
        if location:
            if isinstance(location, dict):
                name = location.get('name', 'N/A')
                address = location.get('address', {})
                city = address.get('locality', '') if isinstance(address, dict) else ''
            else:
                name = getattr(location, 'name', 'N/A') or 'N/A'
                addr = getattr(location, 'address', None)
                city = getattr(addr, 'locality', '') if addr else ''
            
            print(f"   [OK] Location found: {name} ({city})")
            print(f"   [OK] Location ID is correct")
        else:
            print(f"   [WARN] Could not retrieve location details")
    except Exception as e:
        print(f"   [ERROR] Could not retrieve location: {e}")
        print(f"   [INFO] This might mean the location ID is incorrect")
        
except Exception as e:
    print(f"   [ERROR] Error accessing locations: {e}")

# Check bookings API directly
print(f"\n2. Testing Bookings API directly...")
try:
    # Try with a 30-day range (max allowed)
    from datetime import datetime, timedelta
    today = datetime.now()
    start = today.isoformat() + 'Z'
    end = (today + timedelta(days=30)).isoformat() + 'Z'
    
    result = client.bookings_api.list(
        location_id=Config.SQUARE_LOCATION_ID,
        start_at_min=start,
        start_at_max=end
    )
    
    if hasattr(result, 'body'):
        bookings = result.body.get('bookings', [])
        errors = result.body.get('errors', [])
    elif hasattr(result, 'bookings'):
        bookings = result.bookings or []
        errors = getattr(result, 'errors', []) or []
    else:
        bookings = []
        errors = []
    
    print(f"   Found {len(bookings)} bookings")
    
    if errors:
        print(f"   [WARN] API returned errors:")
        for error in errors:
            print(f"      - {error}")
    
    if bookings:
        print(f"\n   Sample bookings:")
        for booking in bookings[:3]:
            if isinstance(booking, dict):
                print(f"      - {booking.get('id', 'N/A')} - {booking.get('start_at', 'N/A')}")
            else:
                print(f"      - {getattr(booking, 'id', 'N/A')} - {getattr(booking, 'start_at', 'N/A')}")
    else:
        print(f"   [INFO] No bookings found")
        print(f"   [INFO] This could mean:")
        print(f"      - No bookings exist for this location")
        print(f"      - Bookings are in Square Appointments (not Bookings API)")
        print(f"      - API token doesn't have BOOKINGS_READ permission")
        
except Exception as e:
    print(f"   [ERROR] Error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)
print("Important Notes:")
print("=" * 60)
print("1. Square has TWO different systems:")
print("   - Square Appointments (older, separate system)")
print("   - Square Bookings API (newer, part of Square API)")
print("2. If your appointments are in Square Appointments,")
print("   they won't show up in the Bookings API")
print("3. Check your Square Developer Dashboard:")
print("   - Go to: https://developer.squareup.com/apps")
print("   - Check if your app has 'BOOKINGS_READ' permission")
print("   - Verify the location ID matches your business location")
print("=" * 60)

