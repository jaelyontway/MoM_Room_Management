"""Test SyncPager items property."""
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient
from config import Config

print("=" * 60)
print("Testing SyncPager items Property")
print("=" * 60)

client = SquareBookingsClient()

today = datetime.now()
start = today.isoformat() + 'Z'
end = (today.replace(hour=23, minute=59, second=59)).isoformat() + 'Z'

result = client.bookings_api.list(
    location_id=Config.SQUARE_LOCATION_ID,
    start_at_min=start,
    start_at_max=end
)

print(f"\n1. Accessing result.items (property, not method)...")
try:
    items = result.items  # Property, not method
    print(f"   Items type: {type(items)}")
    print(f"   Items: {items}")
    
    if isinstance(items, list):
        print(f"   Found {len(items)} bookings")
        if items:
            first = items[0]
            print(f"   First item type: {type(first)}")
            print(f"   First item ID: {getattr(first, 'id', 'N/A')}")
    else:
        print(f"   Items is not a list, trying to iterate...")
        bookings = list(items)
        print(f"   Found {len(bookings)} bookings")
        if bookings:
            print(f"   First booking: {bookings[0]}")
except Exception as e:
    print(f"   Error: {e}")
    import traceback
    traceback.print_exc()

print(f"\n2. Checking response structure...")
try:
    response = result.response
    print(f"   Response type: {type(response)}")
    
    # Check if response has data
    if hasattr(response, 'data'):
        data = response.data
        print(f"   Response.data type: {type(data)}")
        if isinstance(data, dict):
            bookings = data.get('bookings', [])
            print(f"   Found {len(bookings)} bookings in response.data")
    
    # Check response body if it exists
    if hasattr(response, 'body'):
        body = response.body
        print(f"   Response.body type: {type(body)}")
        if isinstance(body, dict):
            bookings = body.get('bookings', [])
            print(f"   Found {len(bookings)} bookings in response.body")
except Exception as e:
    print(f"   Error: {e}")

print("\n" + "=" * 60)

