"""Compare SDK response vs direct API call."""
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient
from config import Config
import requests

print("=" * 60)
print("Comparing SDK vs Direct API Call")
print("=" * 60)

# Test SDK
print("\n1. Testing Square SDK...")
client = SquareBookingsClient()

try:
    today = datetime.now()
    start = today.isoformat() + 'Z'
    end = (today.replace(hour=23, minute=59, second=59)).isoformat() + 'Z'
    
    result = client.bookings_api.list(
        location_id=Config.SQUARE_LOCATION_ID,
        start_at_min=start,
        start_at_max=end
    )
    
    print(f"   Result type: {type(result)}")
    print(f"   Result attributes: {dir(result)}")
    
    # Try different ways to access the data
    bookings_sdk = None
    if hasattr(result, 'body'):
        print(f"   Has 'body' attribute")
        body = result.body
        print(f"   Body type: {type(body)}")
        if isinstance(body, dict):
            bookings_sdk = body.get('bookings', [])
        else:
            print(f"   Body attributes: {dir(body)}")
            if hasattr(body, 'bookings'):
                bookings_sdk = body.bookings
    elif hasattr(result, 'bookings'):
        print(f"   Has 'bookings' attribute")
        bookings_sdk = result.bookings
    elif hasattr(result, 'data'):
        print(f"   Has 'data' attribute")
        data = result.data
        if isinstance(data, dict):
            bookings_sdk = data.get('bookings', [])
    else:
        print(f"   Trying to convert to dict...")
        try:
            result_dict = result.__dict__
            print(f"   Dict keys: {result_dict.keys()}")
        except:
            pass
    
    print(f"   SDK returned: {len(bookings_sdk) if bookings_sdk else 0} bookings")
    
    # Also test the wrapper method
    print(f"\n2. Testing wrapper method (list_bookings)...")
    bookings_wrapper = client.list_bookings(
        start_at_min=start,
        start_at_max=end
    )
    print(f"   Wrapper returned: {len(bookings_wrapper)} bookings")
    
except Exception as e:
    print(f"   [ERROR] SDK error: {e}")
    import traceback
    traceback.print_exc()

# Test direct API
print(f"\n3. Testing Direct API Call...")
try:
    url = "https://connect.squareup.com/v2/bookings"
    headers = {
        "Authorization": f"Bearer {Config.SQUARE_ACCESS_TOKEN}",
        "Square-Version": "2025-01-23"
    }
    params = {
        "location_id": Config.SQUARE_LOCATION_ID,
        "start_at_min": start,
        "start_at_max": end
    }
    
    response = requests.get(url, headers=headers, params=params)
    data = response.json()
    bookings_direct = data.get('bookings', [])
    
    print(f"   Direct API returned: {len(bookings_direct)} bookings")
    
    if bookings_direct and not bookings_wrapper:
        print(f"\n   [PROBLEM] Direct API works but SDK doesn't!")
        print(f"   Need to fix SDK response parsing")
        
except Exception as e:
    print(f"   [ERROR] Direct API error: {e}")

print("\n" + "=" * 60)

