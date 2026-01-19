"""Test how to use SyncPager from Square SDK."""
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient
from config import Config

print("=" * 60)
print("Testing SyncPager Usage")
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

print(f"\nResult type: {type(result)}")
print(f"Has 'items': {hasattr(result, 'items')}")
print(f"Has 'iter_pages': {hasattr(result, 'iter_pages')}")
print(f"Has 'response': {hasattr(result, 'response')}")

# Try method 1: items()
print(f"\n1. Trying result.items()...")
try:
    items = result.items()
    print(f"   Items type: {type(items)}")
    bookings = list(items)
    print(f"   Found {len(bookings)} bookings via items()")
    if bookings:
        print(f"   First booking ID: {bookings[0].id if hasattr(bookings[0], 'id') else 'N/A'}")
except Exception as e:
    print(f"   Error: {e}")

# Try method 2: iter_pages()
print(f"\n2. Trying result.iter_pages()...")
try:
    all_bookings = []
    for page in result.iter_pages():
        print(f"   Page type: {type(page)}")
        print(f"   Page attributes: {[a for a in dir(page) if not a.startswith('_')]}")
        
        # Try different ways to get bookings from page
        if hasattr(page, 'body'):
            body = page.body
            if isinstance(body, dict):
                bookings = body.get('bookings', [])
            else:
                bookings = getattr(body, 'bookings', []) or []
        elif hasattr(page, 'bookings'):
            bookings = page.bookings or []
        elif isinstance(page, dict):
            bookings = page.get('bookings', [])
        else:
            # Try to access as object
            bookings = []
            if hasattr(page, 'data'):
                data = page.data
                if isinstance(data, dict):
                    bookings = data.get('bookings', [])
        
        print(f"   Found {len(bookings)} bookings in this page")
        all_bookings.extend(bookings)
        
        # Only check first page for now
        break
    
    print(f"   Total bookings via iter_pages(): {len(all_bookings)}")
except Exception as e:
    print(f"   Error: {e}")
    import traceback
    traceback.print_exc()

# Try method 3: response attribute
print(f"\n3. Trying result.response...")
try:
    response = result.response
    print(f"   Response type: {type(response)}")
    print(f"   Response attributes: {[a for a in dir(response) if not a.startswith('_')]}")
    
    if hasattr(response, 'body'):
        body = response.body
        print(f"   Body type: {type(body)}")
        if isinstance(body, dict):
            bookings = body.get('bookings', [])
        else:
            print(f"   Body attributes: {[a for a in dir(body) if not a.startswith('_')]}")
            bookings = getattr(body, 'bookings', []) or []
        print(f"   Found {len(bookings)} bookings via response.body")
    elif isinstance(response, dict):
        bookings = response.get('bookings', [])
        print(f"   Found {len(bookings)} bookings via response dict")
except Exception as e:
    print(f"   Error: {e}")

print("\n" + "=" * 60)

