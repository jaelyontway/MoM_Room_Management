"""Verify that we're using the correct API credentials."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import Config
from app.square_service import SquareService

print("=" * 60)
print("Verifying API Credentials")
print("=" * 60)

# Expected credentials (what you provided)
EXPECTED = {
    'LOCATION_ID': 'L72T81FV9YPDT',
    'APPLICATION_ID': 'sq0idp-OkGYrKxpsxd_FD0hG_eslg',
    'ENVIRONMENT': 'production',
    'ACCESS_TOKEN_START': 'EAAAloJo5lQHMs52re0U'  # First 20 chars
}

print("\n1. Checking Configuration:")
print(f"   Location ID: {Config.SQUARE_LOCATION_ID}")
print(f"   Expected:    {EXPECTED['LOCATION_ID']}")
print(f"   Match: {'[OK]' if Config.SQUARE_LOCATION_ID == EXPECTED['LOCATION_ID'] else '[NO]'}")

print(f"\n   Application ID: {Config.SQUARE_APPLICATION_ID}")
print(f"   Expected:        {EXPECTED['APPLICATION_ID']}")
print(f"   Match: {'[OK]' if Config.SQUARE_APPLICATION_ID == EXPECTED['APPLICATION_ID'] else '[NO]'}")

print(f"\n   Environment: {Config.SQUARE_ENVIRONMENT}")
print(f"   Expected:    {EXPECTED['ENVIRONMENT']}")
print(f"   Match: {'[OK]' if Config.SQUARE_ENVIRONMENT == EXPECTED['ENVIRONMENT'] else '[NO]'}")

print(f"\n   Access Token: {Config.SQUARE_ACCESS_TOKEN[:20]}...")
print(f"   Expected:     {EXPECTED['ACCESS_TOKEN_START']}...")
print(f"   Match: {'[OK]' if Config.SQUARE_ACCESS_TOKEN.startswith(EXPECTED['ACCESS_TOKEN_START']) else '[NO]'}")

print("\n2. Testing Square Service:")
service = SquareService()
if service.client:
    print("   [OK] Square service initialized")
    print("   [OK] Using REAL Square API")
    
    # Test a booking fetch
    from datetime import datetime
    today = datetime.now().strftime('%Y-%m-%d')
    print(f"\n3. Testing API call for {today}:")
    bookings = service.get_bookings_for_date(today)
    print(f"   [OK] API call successful")
    print(f"   [OK] Found {len(bookings)} bookings")
    
    if bookings:
        print("\n   Sample booking:")
        b = bookings[0]
        print(f"     - Customer: {b['customer']}")
        print(f"     - Therapist: {b['therapist']}")
        print(f"     - Service: {b['service']}")
else:
    print("   [NO] Square service NOT initialized")
    print("   [NO] Will use MOCK data")

print("\n" + "=" * 60)
print("Summary:")
if service.client and Config.SQUARE_LOCATION_ID == EXPECTED['LOCATION_ID']:
    print("  [OK] Using YOUR production credentials")
    print("  [OK] Connected to REAL Square API")
    print("\n  If server shows 'mock data', you need to RESTART it:")
    print("    1. Stop server (Ctrl+C)")
    print("    2. Run: python run.py")
else:
    print("  [NO] Configuration mismatch - check .env file")
print("=" * 60)

