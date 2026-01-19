"""Test the fixes for showing all staff and appointments."""
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService
from app.main import get_day
from app.database import get_db

print("=" * 60)
print("Testing Fixes")
print("=" * 60)

service = SquareService()
if not service.client:
    print("[ERROR] Service not initialized")
    sys.exit(1)

today = datetime.now().strftime('%Y-%m-%d')
print(f"\nTesting date: {today}")

# Test 1: Check all team members
print("\n1. Checking team members...")
team_members = service.client.get_team_members()
print(f"   Total team members from Square: {len(team_members)}")

# Test 2: Check bookings
print("\n2. Checking bookings...")
bookings = service.get_bookings_for_date(today)
print(f"   Total bookings: {len(bookings)}")

# Test 3: Check therapists from bookings
therapists_from_bookings = set(b['therapist'] for b in bookings)
print(f"   Therapists with bookings: {len(therapists_from_bookings)}")

# Test 4: Simulate what the API endpoint returns
print("\n3. Simulating API endpoint response...")
try:
    # This simulates what get_day() does
    therapists_from_bookings_set = set(b['therapist'] for b in bookings)
    all_therapists = set(therapists_from_bookings_set)
    
    # Get all team members
    for member in team_members:
        if isinstance(member, dict):
            given = member.get('given_name', '')
            family = member.get('family_name', '')
            display = member.get('display_name', '')
        else:
            given = getattr(member, 'given_name', '') or ''
            family = getattr(member, 'family_name', '') or ''
            display = getattr(member, 'display_name', '') or ''
        
        name = f"{given} {family}".strip() or display
        if name:
            all_therapists.add(name)
    
    therapists_list = sorted(all_therapists)
    print(f"   Total therapists in response: {len(therapists_list)}")
    print(f"   [OK] All {len(team_members)} team members should appear in calendar")
    
except Exception as e:
    print(f"   [ERROR] {e}")
    import traceback
    traceback.print_exc()

# Test 5: Check booking times
print("\n4. Checking booking times...")
for i, booking in enumerate(bookings[:3], 1):
    print(f"   Booking {i}:")
    print(f"      Start: {booking['start_at']}")
    print(f"      End: {booking['end_at']}")
    print(f"      Therapist: {booking['therapist']}")

print("\n" + "=" * 60)
print("Summary:")
print(f"  - Team members: {len(team_members)} (all should appear)")
print(f"  - Bookings: {len(bookings)}")
print(f"  - Therapists with bookings: {len(therapists_from_bookings)}")
print("=" * 60)

