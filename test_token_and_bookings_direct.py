"""Direct test of Square API token and bookings endpoint."""
import requests
import json
from config import Config

print("=" * 60)
print("Testing Square API Token and Bookings Directly")
print("=" * 60)

# Your production credentials
ACCESS_TOKEN = Config.SQUARE_ACCESS_TOKEN
LOCATION_ID = Config.SQUARE_LOCATION_ID
ENVIRONMENT = Config.SQUARE_ENVIRONMENT

print(f"\nConfiguration:")
print(f"  Environment: {ENVIRONMENT}")
print(f"  Location ID: {LOCATION_ID}")
print(f"  Access Token: {ACCESS_TOKEN[:20]}...")

# Determine base URL
if ENVIRONMENT.lower() == 'production':
    BASE_URL = "https://connect.squareup.com"
else:
    BASE_URL = "https://connect.squareupsandbox.com"

print(f"  Base URL: {BASE_URL}")

# Step 1: Check token status
print("\n" + "=" * 60)
print("Step 1: Checking Token Status")
print("=" * 60)

try:
    token_status_url = f"{BASE_URL}/oauth2/token/status"
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }
    
    print(f"\nRequest URL: {token_status_url}")
    response = requests.post(token_status_url, headers=headers)
    
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print("[OK] Token is VALID")
        print(f"\nToken Info:")
        print(json.dumps(data, indent=2))
    else:
        print(f"[ERROR] Token check FAILED")
        print(f"Response: {response.text}")
        print("\n⚠️  This means:")
        print("   - Token might be invalid")
        print("   - Wrong environment (production vs sandbox)")
        print("   - Token might be expired")
        
except Exception as e:
    print(f"[ERROR] Error checking token: {e}")
    import traceback
    traceback.print_exc()

# Step 2: Test Bookings API directly
print("\n" + "=" * 60)
print("Step 2: Testing Bookings API Directly")
print("=" * 60)

try:
    bookings_url = f"{BASE_URL}/v2/bookings"
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Square-Version": "2025-01-23",
        "Content-Type": "application/json"
    }
    
    params = {
        "location_id": LOCATION_ID
    }
    
    print(f"\nRequest URL: {bookings_url}")
    print(f"Location ID: {LOCATION_ID}")
    
    response = requests.get(bookings_url, headers=headers, params=params)
    
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        bookings = data.get('bookings', [])
        errors = data.get('errors', [])
        
        if errors:
            print(f"\n⚠️  API returned errors:")
            for error in errors:
                print(f"   - {error}")
        
        print(f"\n[OK] Found {len(bookings)} bookings")
        
        if bookings:
            print(f"\nSample bookings:")
            for i, booking in enumerate(bookings[:3], 1):
                print(f"\n   Booking {i}:")
                print(f"      ID: {booking.get('id', 'N/A')}")
                print(f"      Status: {booking.get('status', 'N/A')}")
                print(f"      Start: {booking.get('start_at', 'N/A')}")
                segments = booking.get('appointment_segments', [])
                if segments:
                    seg = segments[0]
                    print(f"      Team Member: {seg.get('team_member_id', 'N/A')}")
                    print(f"      Service: {seg.get('service_variation_name', 'N/A')}")
        else:
            print("\n[WARN] No bookings found")
            print("   This could mean:")
            print("   - No bookings exist for this location")
            print("   - Bookings are in a different location")
            print("   - Bookings API not enabled for this account")
    else:
        print(f"[ERROR] Bookings API call FAILED")
        print(f"\nResponse:")
        try:
            error_data = response.json()
            print(json.dumps(error_data, indent=2))
            
            # Analyze common errors
            errors = error_data.get('errors', [])
            if errors:
                print("\n[WARN] Error Analysis:")
                for error in errors:
                    code = error.get('code', '')
                    detail = error.get('detail', '')
                    category = error.get('category', '')
                    
                    print(f"\n   Category: {category}")
                    print(f"   Code: {code}")
                    print(f"   Detail: {detail}")
                    
                    if 'location' in detail.lower() or 'LOCATION' in code:
                        print("   → Check if location_id is correct")
                    elif 'permission' in detail.lower() or 'PERMISSION' in code:
                        print("   → Check API permissions (though personal token should have full access)")
                    elif 'not found' in detail.lower() or 'NOT_FOUND' in code:
                        print("   → Bookings might not be enabled for this account")
        except:
            print(response.text)
            
except Exception as e:
    print(f"❌ Error calling Bookings API: {e}")
    import traceback
    traceback.print_exc()

# Step 3: Check locations
print("\n" + "=" * 60)
print("Step 3: Checking Available Locations")
print("=" * 60)

try:
    locations_url = f"{BASE_URL}/v2/locations"
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Square-Version": "2025-01-23"
    }
    
    response = requests.get(locations_url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        locations = data.get('locations', [])
        
        print(f"\n[OK] Found {len(locations)} locations:")
        for loc in locations:
            loc_id = loc.get('id', 'N/A')
            name = loc.get('name', 'N/A')
            address = loc.get('address', {})
            city = address.get('locality', '') if isinstance(address, dict) else ''
            
            match = "[MATCH]" if loc_id == LOCATION_ID else "[     ]"
            print(f"   {match} {loc_id} - {name} ({city})")
            
        if not any(loc.get('id') == LOCATION_ID for loc in locations):
            print(f"\n[WARN] WARNING: Location ID {LOCATION_ID} not found in your locations!")
            print("   Use one of the location IDs listed above")
    else:
        print(f"[ERROR] Could not fetch locations: {response.status_code}")
        print(response.text)
        
except Exception as e:
    print(f"❌ Error fetching locations: {e}")

print("\n" + "=" * 60)
print("Test Complete")
print("=" * 60)

