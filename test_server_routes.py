"""Test if server is running and what routes are available."""
import requests
import sys

print("=" * 60)
print("Testing Server Routes")
print("=" * 60)

base_url = "http://127.0.0.1:8000"

# Test if server is running
print("\n1. Checking if server is running...")
try:
    response = requests.get(base_url, timeout=2)
    print(f"   [OK] Server is running (status: {response.status_code})")
except requests.exceptions.ConnectionError:
    print("   [NO] Server is NOT running")
    print("   Start it with: python run.py")
    sys.exit(1)
except Exception as e:
    print(f"   ✗ Error: {e}")
    sys.exit(1)

# Test routes
routes_to_test = [
    "/",
    "/api/status",
    "/api/day?date=2026-01-06",
    "/docs"
]

print("\n2. Testing routes:")
for route in routes_to_test:
    try:
        url = base_url + route
        response = requests.get(url, timeout=2)
        status = "[OK]" if response.status_code == 200 else "[NO]"
        print(f"   {status} {route:30} -> {response.status_code}")
        
        if route == "/api/status" and response.status_code == 200:
            data = response.json()
            print(f"      Response: {data}")
    except Exception as e:
        print(f"   [ERROR] {route:30} -> Error: {e}")

print("\n" + "=" * 60)
print("If /api/status returns 404:")
print("  - Server is running OLD code")
print("  - You need to RESTART the server")
print("  - Stop with Ctrl+C, then run: python run.py")
print("=" * 60)

