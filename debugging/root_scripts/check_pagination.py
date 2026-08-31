"""Check if pagination is the issue."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient
from config import Config

print("=" * 60)
print("Checking Pagination")
print("=" * 60)

client = SquareBookingsClient()

today = datetime.now().strftime('%Y-%m-%d')
date_obj = datetime.strptime(today, '%Y-%m-%d')
start_at_min = date_obj.isoformat() + 'Z'
start_at_max = (date_obj + timedelta(days=1)).isoformat() + 'Z'

print(f"\nQuery parameters:")
print(f"  start_at_min: {start_at_min}")
print(f"  start_at_max: {start_at_max}")

# Get the raw result
result = client.bookings_api.list(
    location_id=Config.SQUARE_LOCATION_ID,
    start_at_min=start_at_min,
    start_at_max=start_at_max
)

print(f"\nResult type: {type(result)}")
print(f"Has 'items': {hasattr(result, 'items')}")
print(f"Has 'iter_pages': {hasattr(result, 'iter_pages')}")
print(f"Has 'cursor': {hasattr(result, 'cursor')}")

# Check items property
if hasattr(result, 'items'):
    items = result.items
    print(f"\nItems type: {type(items)}")
    print(f"Items length: {len(items) if isinstance(items, list) else 'N/A'}")
    
    # Try to get all items
    if isinstance(items, list):
        all_bookings = items
    else:
        all_bookings = list(items) if items else []
    
    print(f"Total bookings from items: {len(all_bookings)}")

# Check if there's pagination via iter_pages
if hasattr(result, 'iter_pages'):
    print(f"\nChecking pagination via iter_pages()...")
    try:
        all_pages = []
        for page in result.iter_pages():
            print(f"  Page type: {type(page)}")
            if hasattr(page, 'items'):
                page_items = page.items
                if isinstance(page_items, list):
                    all_pages.extend(page_items)
                else:
                    all_pages.extend(list(page_items) if page_items else [])
            elif hasattr(page, 'bookings'):
                all_pages.extend(page.bookings or [])
            print(f"  Page has {len(all_pages) - sum(len(p) for p in all_pages[:-1]) if all_pages else 0)} items")
        
        print(f"\nTotal bookings from all pages: {len(all_pages)}")
        if len(all_pages) > len(all_bookings):
            print(f"  [FOUND] Pagination issue! Got {len(all_bookings)} from items, but {len(all_pages)} from pages")
    except Exception as e:
        print(f"  Error iterating pages: {e}")

# Check cursor
if hasattr(result, 'cursor'):
    cursor = result.cursor
    print(f"\nCursor: {cursor}")
    if cursor:
        print(f"  [INFO] There might be more results (cursor exists)")

print("\n" + "=" * 60)

