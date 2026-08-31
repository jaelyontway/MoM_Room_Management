"""Test script for room assignment system."""
import logging
from database import init_database, save_room_assignment, get_room_assignment
from room_assignment import RoomAssignment

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def test_database():
    """Test database operations."""
    print("Testing database...")
    init_database()
    print("✓ Database initialized")
    
    # Test save
    save_room_assignment(
        booking_id="test_booking_1",
        room="1",
        assigned_by="auto",
        date="2026-01-06"
    )
    print("✓ Saved test assignment")
    
    # Test get
    assignment = get_room_assignment("test_booking_1")
    if assignment:
        print(f"✓ Retrieved assignment: {assignment}")
    else:
        print("✗ Failed to retrieve assignment")
    
    print("\nDatabase test completed!")


def test_room_assignment():
    """Test room assignment logic."""
    print("\nTesting room assignment...")
    try:
        from config import Config
        Config.validate()
        
        room_assignment = RoomAssignment()
        print("✓ RoomAssignment initialized")
        
        # Test getting bookings for today
        from datetime import datetime
        today = datetime.now().strftime('%Y-%m-%d')
        print(f"Attempting to fetch bookings for {today}...")
        
        bookings = room_assignment.get_bookings_for_date(today)
        print(f"✓ Found {len(bookings)} bookings")
        
        if bookings:
            print("\nSample booking:")
            sample = bookings[0]
            print(f"  ID: {sample.get('id')}")
            print(f"  Type: {sample.get('type')}")
            print(f"  Room: {sample.get('room')}")
            print(f"  Time: {sample.get('start_at')}")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        logger.exception(e)


if __name__ == '__main__':
    print("=" * 50)
    print("Room Assignment System Test")
    print("=" * 50)
    
    test_database()
    test_room_assignment()
    
    print("\n" + "=" * 50)
    print("Test completed!")
    print("=" * 50)


