"""Test the status endpoint directly."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import app, square_service

# Test the status function directly
print("=" * 60)
print("Testing Status Endpoint")
print("=" * 60)

# Import the function
from app.main import get_status
import asyncio

# Run the async function
result = asyncio.run(get_status())
print("\nStatus Response:")
for key, value in result.items():
    print(f"  {key}: {value}")

print("\n" + "=" * 60)
print("Square Service Status:")
print(f"  Client available: {square_service.client is not None}")
if square_service.client:
    print("  [OK] Using Real Square API")
else:
    print("  [WARNING] Using Mock Data")
print("=" * 60)

