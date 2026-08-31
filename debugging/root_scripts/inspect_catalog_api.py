"""Inspect CatalogClient methods."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient

client = SquareBookingsClient()
catalog_api = client.client.catalog

print("=" * 60)
print("CatalogClient Methods:")
print("=" * 60)

# Get all methods/attributes
methods = [attr for attr in dir(catalog_api) if not attr.startswith('_')]
for method in sorted(methods):
    print(f"  - {method}")

print("\n" + "=" * 60)
print("Checking for common method names:")
print("=" * 60)

# Check for common patterns
for method_name in ['retrieve', 'get', 'retrieve_catalog_object', 'get_catalog_object', 'batch_retrieve', 'list']:
    if hasattr(catalog_api, method_name):
        print(f"  ✓ {method_name} exists")
        method = getattr(catalog_api, method_name)
        print(f"    Type: {type(method)}")
        if hasattr(method, '__doc__'):
            doc = method.__doc__
            if doc:
                print(f"    Doc: {doc[:100]}...")
    else:
        print(f"  ✗ {method_name} does not exist")

