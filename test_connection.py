"""Simple test script to verify Square API connection and configuration."""
import sys
import logging
from config import Config
from square_client import SquareBookingsClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def test_config():
    """Test configuration."""
    print("Testing configuration...")
    try:
        Config.validate()
        print("[OK] Configuration is valid")
        return True
    except ValueError as e:
        print(f"[ERROR] Configuration error: {e}")
        return False


def test_api_connection():
    """Test Square API connection."""
    print("\nTesting Square API connection...")
    try:
        client = SquareBookingsClient()
        
        # Try to get team members
        team_members = client.get_team_members()
        if team_members:
            print(f"[OK] Successfully connected to Square API")
            print(f"[OK] Found {len(team_members)} team member(s)")
            
            # Show therapist IDs if configured
            if Config.THERAPIST_IDS:
                print(f"[OK] Configured to use {len(Config.THERAPIST_IDS)} specific therapist(s)")
            else:
                print(f"[OK] Using all available team members")
            
            return True
        else:
            print("[WARNING] Connected but no team members found (this might be OK)")
            return True
    except Exception as e:
        print(f"[ERROR] API connection error: {e}")
        logger.exception("Full error:")
        return False


def test_list_bookings():
    """Test listing bookings."""
    print("\nTesting booking retrieval...")
    try:
        client = SquareBookingsClient()
        
        # Try to list recent bookings
        bookings = client.list_bookings()
        print(f"[OK] Successfully retrieved bookings API")
        print(f"[OK] Found {len(bookings)} booking(s) in recent time range")
        
        # Check for couple's massage bookings
        couples_bookings = [b for b in bookings if client.is_couples_massage(b)]
        if couples_bookings:
            print(f"[OK] Found {len(couples_bookings)} couple's massage booking(s)")
        else:
            print(f"[INFO] No couple's massage bookings found (this is OK)")
        
        return True
    except Exception as e:
        print(f"[ERROR] Booking retrieval error: {e}")
        logger.exception("Full error:")
        return False


def main():
    """Run all tests."""
    print("=" * 50)
    print("Square Bookings Sync - Connection Test")
    print("=" * 50)
    
    results = []
    
    # Test configuration
    results.append(("Configuration", test_config()))
    
    # Test API connection
    if results[-1][1]:  # Only if config passed
        results.append(("API Connection", test_api_connection()))
        
        # Test bookings
        if results[-1][1]:  # Only if API connection passed
            results.append(("Bookings API", test_list_bookings()))
    
    # Summary
    print("\n" + "=" * 50)
    print("Test Summary")
    print("=" * 50)
    for test_name, passed in results:
        status = "[PASS]" if passed else "[FAIL]"
        print(f"{status}: {test_name}")
    
    all_passed = all(result[1] for result in results)
    
    if all_passed:
        print("\n[OK] All tests passed! You're ready to run the sync.")
        return 0
    else:
        print("\n[ERROR] Some tests failed. Please check your configuration and API credentials.")
        return 1


if __name__ == '__main__':
    sys.exit(main())

