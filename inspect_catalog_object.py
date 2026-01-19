"""Inspect catalog.object methods."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from square_client import SquareBookingsClient

client = SquareBookingsClient()
catalog_api = client.client.catalog

print("=" * 60)
print("catalog.object Methods:")
print("=" * 60)

if hasattr(catalog_api, 'object'):
    obj_api = catalog_api.object
    methods = [attr for attr in dir(obj_api) if not attr.startswith('_')]
    for method in sorted(methods):
        print(f"  - {method}")

print("\n" + "=" * 60)
print("Testing batch_get:")
print("=" * 60)

# Test batch_get signature
if hasattr(catalog_api, 'batch_get'):
    import inspect
    sig = inspect.signature(catalog_api.batch_get)
    print(f"  batch_get signature: {sig}")

