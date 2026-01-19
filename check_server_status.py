"""Check if server is using real or mock data."""
import sys
import os
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import square_service, mock_square
from app.square_service import SquareService

print("=" * 60)
print("Server Configuration Check")
print("=" * 60)

# Check Square service
print("\n1. Square Service Status:")
if square_service.client:
    print("   [OK] Using REAL Square API")
    print(f"   - Client initialized: Yes")
    
    # Test with a date
    test_date = datetime.now().strftime('%Y-%m-%d')
    print(f"\n2. Testing with date: {test_date}")
    bookings = square_service.get_bookings_for_date(test_date)
    print(f"   - Bookings found: {len(bookings)}")
    
    if len(bookings) == 0:
        print("\n   [INFO] No bookings found for today")
        print("   This could mean:")
        print("     - No appointments scheduled for this date")
        print("     - All appointments are cancelled")
        print("   Try a different date that has bookings")
        
        # Try tomorrow
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        print(f"\n   Testing tomorrow ({tomorrow}):")
        bookings_tomorrow = square_service.get_bookings_for_date(tomorrow)
        print(f"   - Bookings found: {len(bookings_tomorrow)}")
        
        if bookings_tomorrow:
            print("   [OK] Found bookings for tomorrow!")
            print("   Sample booking:")
            b = bookings_tomorrow[0]
            print(f"     - {b['customer']} with {b['therapist']}")
            print(f"       Service: {b['service']}")
            print(f"       Time: {b['start_at'][:16]}")
    else:
        print("   [OK] Found bookings!")
        print("   Sample booking:")
        b = bookings[0]
        print(f"     - {b['customer']} with {b['therapist']}")
        print(f"       Service: {b['service']}")
        print(f"       Time: {b['start_at'][:16]}")
else:
    print("   [WARNING] Using MOCK data")
    print("   - Square API not configured or failed to initialize")
    print("   - Check your .env file and Square credentials")

print("\n" + "=" * 60)
print("Recommendation:")
if square_service.client:
    print("  Your server IS using real Square API")
    print("  If you see mock data, it means:")
    print("    1. The date you selected has no bookings")
    print("    2. You need to restart the server (if you just updated .env)")
    print("  Try selecting a date that has bookings in Square")
else:
    print("  Your server is using MOCK data")
    print("  To use real data:")
    print("    1. Check your .env file has correct credentials")
    print("    2. Restart the server: python run.py")
print("=" * 60)

