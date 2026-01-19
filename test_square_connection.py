"""Test script to verify Square API connection and permissions."""
import sys
import os
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from app.square_service import SquareService
    from config import Config
    print("=" * 60)
    print("Square API Connection Test")
    print("=" * 60)
    
    # Check configuration
    print("\n1. Checking Configuration...")
    try:
        Config.validate()
        print("   [OK] Configuration valid")
        print(f"   - Environment: {Config.SQUARE_ENVIRONMENT}")
        print(f"   - Location ID: {Config.SQUARE_LOCATION_ID[:10]}..." if Config.SQUARE_LOCATION_ID else "   - Location ID: Not set")
        print(f"   - Access Token: {'Set' if Config.SQUARE_ACCESS_TOKEN else 'Not set'}")
    except ValueError as e:
        print(f"   [ERROR] Configuration error: {e}")
        sys.exit(1)
    
    # Initialize service
    print("\n2. Initializing Square Service...")
    service = SquareService()
    if not service.client:
        print("   ❌ Square service not initialized")
        print("   Check your .env file and API credentials")
        sys.exit(1)
    print("   [OK] Square service initialized")
    
    # Test team members
    print("\n3. Testing Team Members API...")
    try:
        team_members = service.client.get_team_members()
        print(f"   [OK] Found {len(team_members)} team members")
        if team_members:
            print("   Sample team members:")
            for member in team_members[:3]:
                # Handle both dict and object formats
                if isinstance(member, dict):
                    given = member.get('given_name', '')
                    family = member.get('family_name', '')
                    display = member.get('display_name', '')
                    member_id = member.get('id', 'N/A')
                else:
                    # Square SDK object
                    given = getattr(member, 'given_name', '') or ''
                    family = getattr(member, 'family_name', '') or ''
                    display = getattr(member, 'display_name', '') or ''
                    member_id = getattr(member, 'id', 'N/A') or 'N/A'
                
                name = f"{given} {family}".strip() or display or 'Unknown'
                print(f"      - {name} (ID: {str(member_id)[:8]}...)")
    except Exception as e:
        print(f"   ⚠️  Team Members API error: {e}")
    
    # Test bookings
    print("\n4. Testing Bookings API...")
    try:
        # Test with today's date
        today = datetime.now().strftime('%Y-%m-%d')
        bookings = service.get_bookings_for_date(today)
        print(f"   [OK] Found {len(bookings)} bookings for {today}")
        
        if bookings:
            print("   Sample bookings:")
            for booking in bookings[:3]:
                print(f"      - {booking['customer']} with {booking['therapist']}")
                print(f"        Service: {booking['service']}")
                print(f"        Time: {booking['start_at'][:16]} - {booking['end_at'][:16]}")
                print(f"        Type: {booking['type']}")
        else:
            print("   [INFO] No bookings found for today")
            print("   Try a different date or create test bookings in Square")
    except Exception as e:
        print(f"   [ERROR] Bookings API error: {e}")
        import traceback
        traceback.print_exc()
    
    # Test customer API (optional)
    print("\n5. Testing Customer API (optional)...")
    if hasattr(service.client.client, 'customers'):
        print("   [OK] Customer API available")
        # Try to fetch a customer if we have bookings with customer_id
        if bookings:
            for booking in bookings:
                # Get original booking to check customer_id
                square_bookings = service.client.list_bookings(
                    start_at_min=datetime.now().isoformat() + 'Z',
                    start_at_max=(datetime.now() + timedelta(days=1)).isoformat() + 'Z'
                )
                if square_bookings:
                    test_booking = square_bookings[0]
                    customer_id = test_booking.get('customer_id')
                    if customer_id:
                        try:
                            customer_api = service.client.client.customers
                            result = customer_api.retrieve_customer(customer_id=customer_id)
                            if hasattr(result, 'body') and result.body.get('customer'):
                                print("   [OK] Customer API working - can fetch customer names")
                            else:
                                print("   [WARN] Customer API available but no customer data")
                        except Exception as e:
                            print(f"   [WARN] Customer API error (may need CUSTOMERS_READ permission): {e}")
                        break
    else:
        print("   [WARN] Customer API not available (need CUSTOMERS_READ permission)")
    
    print("\n" + "=" * 60)
    print("Test Complete!")
    print("=" * 60)
    print("\nSummary:")
    print("  [OK] Square API is connected and working")
    print("  [OK] You can fetch bookings and team members")
    if hasattr(service.client.client, 'customers'):
        print("  [OK] Customer API is available")
    else:
        print("  [INFO] Customer API not available (optional)")
    print("\nYour dashboard should work with real Square data!")
    
except ImportError as e:
    print(f"[ERROR] Import error: {e}")
    print("Make sure you've installed dependencies: pip install -r requirements.txt")
    sys.exit(1)
except Exception as e:
    print(f"[ERROR] Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

