"""Test cases for room assignment logic."""
import sys
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.room_assigner import RoomAssigner


def create_test_db():
    """Create a test database in memory."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return SessionLocal()


def test_case_1():
    """Test: 3 couple + 3 single => couples use 5,6,02D; singles use 1,3,4"""
    print("\n=== Test Case 1: 3 couple + 3 single ===")
    db = create_test_db()
    assigner = RoomAssigner(db)
    
    date = "2026-01-06"
    base_time = datetime(2026, 1, 6, 10, 0, 0)
    
    bookings = [
        # 3 couple bookings - all at same time to test priority
        {
            'booking_id': 'c1',
            'therapist': 'Katy',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Couple1',
            'service': "Couple's Massage",
            'type': 'couple'
        },
        {
            'booking_id': 'c2',
            'therapist': 'May',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Couple2',
            'service': "Couple's Massage",
            'type': 'couple'
        },
        {
            'booking_id': 'c3',
            'therapist': 'Jenny',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Couple3',
            'service': "Couple's Massage",
            'type': 'couple'
        },
        # 3 single bookings - all at same time to test priority
        {
            'booking_id': 's1',
            'therapist': 'Sarah',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single1',
            'service': 'Swedish Massage',
            'type': 'single'
        },
        {
            'booking_id': 's2',
            'therapist': 'Emma',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single2',
            'service': 'Deep Tissue',
            'type': 'single'
        },
        {
            'booking_id': 's3',
            'therapist': 'Katy',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single3',
            'service': 'Hot Stone',
            'type': 'single'
        },
    ]
    
    assigned = assigner.assign_rooms(bookings, date)
    
    # Check couple assignments
    couple_rooms = [b['room'] for b in assigned if b['type'] == 'couple']
    single_rooms = [b['room'] for b in assigned if b['type'] == 'single']
    
    print(f"Couple rooms assigned: {sorted(couple_rooms)}")
    print(f"Single rooms assigned: {sorted(single_rooms)}")
    
    # Expected: couples should get 5, 6, 02D (in some order)
    # Expected: singles should get 1, 3, 4 (in some order)
    assert set(couple_rooms) == {'5', '6', '02D'}, f"Expected couples in {{'5', '6', '02D'}}, got {set(couple_rooms)}"
    assert set(single_rooms) == {'1', '3', '4'}, f"Expected singles in {{'1', '3', '4'}}, got {set(single_rooms)}"
    print("[PASS] Test Case 1 PASSED")


def test_case_2():
    """Test: 2 couple + 5 single => couples 5,6; singles 1,3,4,0,2"""
    print("\n=== Test Case 2: 2 couple + 5 single ===")
    db = create_test_db()
    assigner = RoomAssigner(db)
    
    date = "2026-01-06"
    base_time = datetime(2026, 1, 6, 10, 0, 0)
    
    bookings = [
        # 2 couple bookings - all at same time
        {
            'booking_id': 'c1',
            'therapist': 'Katy',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Couple1',
            'service': "Couple's Massage",
            'type': 'couple'
        },
        {
            'booking_id': 'c2',
            'therapist': 'May',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Couple2',
            'service': "Couple's Massage",
            'type': 'couple'
        },
        # 5 single bookings - all at same time
        {
            'booking_id': 's1',
            'therapist': 'Jenny',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single1',
            'service': 'Swedish Massage',
            'type': 'single'
        },
        {
            'booking_id': 's2',
            'therapist': 'Sarah',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single2',
            'service': 'Deep Tissue',
            'type': 'single'
        },
        {
            'booking_id': 's3',
            'therapist': 'Emma',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single3',
            'service': 'Hot Stone',
            'type': 'single'
        },
        {
            'booking_id': 's4',
            'therapist': 'Katy',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single4',
            'service': 'Aromatherapy',
            'type': 'single'
        },
        {
            'booking_id': 's5',
            'therapist': 'May',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single5',
            'service': 'Sports Massage',
            'type': 'single'
        },
    ]
    
    assigned = assigner.assign_rooms(bookings, date)
    
    # Check assignments
    couple_rooms = [b['room'] for b in assigned if b['type'] == 'couple']
    single_rooms = [b['room'] for b in assigned if b['type'] == 'single']
    
    print(f"Couple rooms assigned: {sorted(couple_rooms)}")
    print(f"Single rooms assigned: {sorted(single_rooms)}")
    
    # Expected: couples should get 5, 6
    # Expected: singles should get 1, 3, 4, 0, 2
    assert set(couple_rooms) == {'5', '6'}, f"Expected couples in {{'5', '6'}}, got {set(couple_rooms)}"
    assert set(single_rooms) == {'1', '3', '4', '0', '2'}, f"Expected singles in {{'1', '3', '4', '0', '2'}}, got {set(single_rooms)}"
    print("[PASS] Test Case 2 PASSED")


def test_case_3():
    """Test: 0 couple + 7 single => fill 1,3,4,5,6,0,2 (7 singles total)"""
    print("\n=== Test Case 3: 0 couple + 7 single ===")
    db = create_test_db()
    assigner = RoomAssigner(db)
    
    date = "2026-01-06"
    base_time = datetime(2026, 1, 6, 10, 0, 0)
    
    bookings = [
        # 7 single bookings - all at same time
        {
            'booking_id': 's1',
            'therapist': 'Katy',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single1',
            'service': 'Swedish Massage',
            'type': 'single'
        },
        {
            'booking_id': 's2',
            'therapist': 'May',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single2',
            'service': 'Deep Tissue',
            'type': 'single'
        },
        {
            'booking_id': 's3',
            'therapist': 'Jenny',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single3',
            'service': 'Hot Stone',
            'type': 'single'
        },
        {
            'booking_id': 's4',
            'therapist': 'Sarah',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single4',
            'service': 'Aromatherapy',
            'type': 'single'
        },
        {
            'booking_id': 's5',
            'therapist': 'Emma',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single5',
            'service': 'Sports Massage',
            'type': 'single'
        },
        {
            'booking_id': 's6',
            'therapist': 'Katy',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single6',
            'service': 'Swedish Massage',
            'type': 'single'
        },
        {
            'booking_id': 's7',
            'therapist': 'May',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Single7',
            'service': 'Deep Tissue',
            'type': 'single'
        },
    ]
    
    assigned = assigner.assign_rooms(bookings, date)
    
    # Check assignments
    single_rooms = [b['room'] for b in assigned if b['type'] == 'single']
    
    print(f"Single rooms assigned: {sorted(single_rooms)}")
    
    # Expected: singles should get 1, 3, 4, 2, 0, 6, 5 (in priority order)
    assert set(single_rooms) == {'1', '3', '4', '2', '0', '6', '5'}, f"Expected singles in {{'1', '3', '4', '2', '0', '6', '5'}}, got {set(single_rooms)}"
    assert len(single_rooms) == 7, f"Expected 7 singles, got {len(single_rooms)}"
    print("[PASS] Test Case 3 PASSED")


def test_02d_blocks_both_rooms():
    """Test that assigning 02D blocks both room 0 and room 2"""
    print("\n=== Test: 02D blocks both 0 and 2 ===")
    db = create_test_db()
    assigner = RoomAssigner(db)
    
    date = "2026-01-06"
    base_time = datetime(2026, 1, 6, 10, 0, 0)
    
    # Force 02D by making 5 and 6 busy first
    bookings = [
        # Block rooms 5 and 6 first with couple bookings
        {
            'booking_id': 'c_block5',
            'therapist': 'Katy',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=2)).isoformat(),
            'customer': 'CoupleBlock5',
            'service': "Couple's Massage",
            'type': 'couple'
        },
        {
            'booking_id': 'c_block6',
            'therapist': 'May',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=2)).isoformat(),
            'customer': 'CoupleBlock6',
            'service': "Couple's Massage",
            'type': 'couple'
        },
        # Now this couple should get 02D
        {
            'booking_id': 'c1',
            'therapist': 'Jenny',
            'start_at': (base_time + timedelta(hours=0)).isoformat(),
            'end_at': (base_time + timedelta(hours=1)).isoformat(),
            'customer': 'Couple1',
            'service': "Couple's Massage",
            'type': 'couple'
        },
        # Try to assign singles to 0 and 2 (should fail - use other rooms)
        {
            'booking_id': 's1',
            'therapist': 'Sarah',
            'start_at': (base_time + timedelta(hours=0, minutes=30)).isoformat(),
            'end_at': (base_time + timedelta(hours=1, minutes=30)).isoformat(),
            'customer': 'Single1',
            'service': 'Swedish Massage',
            'type': 'single'
        },
        {
            'booking_id': 's2',
            'therapist': 'Emma',
            'start_at': (base_time + timedelta(hours=0, minutes=30)).isoformat(),
            'end_at': (base_time + timedelta(hours=1, minutes=30)).isoformat(),
            'customer': 'Single2',
            'service': 'Deep Tissue',
            'type': 'single'
        },
    ]
    
    assigned = assigner.assign_rooms(bookings, date)
    
    couple_booking = [b for b in assigned if b['booking_id'] == 'c1'][0]
    single_rooms = [b['room'] for b in assigned if b['type'] == 'single']
    
    print(f"Couple booking (c1) room: {couple_booking['room']}")
    print(f"Single rooms assigned: {sorted(single_rooms)}")
    
    # The couple should get 02D since 5 and 6 are blocked
    assert couple_booking['room'] == '02D', f"Couple should get 02D when 5 and 6 are busy, got {couple_booking['room']}"
    # Singles should NOT get 0 or 2 when 02D is used
    assert '0' not in single_rooms, "Room 0 should be blocked when 02D is used"
    assert '2' not in single_rooms, "Room 2 should be blocked when 02D is used"
    
    print("[PASS] Test: 02D blocks both rooms PASSED")


if __name__ == "__main__":
    try:
        test_case_1()
        test_case_2()
        test_case_3()
        test_02d_blocks_both_rooms()
        print("\n[SUCCESS] All tests PASSED!")
    except AssertionError as e:
        print(f"\n[FAILED] Test FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n[ERROR] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

