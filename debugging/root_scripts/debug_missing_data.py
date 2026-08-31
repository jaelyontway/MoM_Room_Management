"""Debug why some staff and appointments are missing."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.square_service import SquareService
from square_client import SquareBookingsClient
from config import Config

print("=" * 60)
print("Debugging Missing Staff and Appointments")
print("=" * 60)

service = SquareService()
if not service.client:
    print("[ERROR] Square service not initialized")
    sys.exit(1)

# Test 1: Get ALL team members
print("\n1. Getting ALL team members from Square...")
try:
    client = service.client
    # Get team members directly from client
    all_team_members = client.get_team_members()
    print(f"   [OK] Found {len(all_team_members)} team members")
    
    print(f"\n   All team members:")
    for i, member in enumerate(all_team_members, 1):
        if isinstance(member, dict):
            member_id = member.get('id', 'N/A')
            given = member.get('given_name', '')
            family = member.get('family_name', '')
            display = member.get('display_name', '')
            status = member.get('status', 'N/A')
        else:
            member_id = getattr(member, 'id', 'N/A') or 'N/A'
            given = getattr(member, 'given_name', '') or ''
            family = getattr(member, 'family_name', '') or ''
            display = getattr(member, 'display_name', '') or ''
            status = getattr(member, 'status', 'N/A') or 'N/A'
        
        name = f"{given} {family}".strip() or display or 'Unknown'
        print(f"      {i}. {name} (Status: {status}, ID: {str(member_id)[:10]}...)")
        
except Exception as e:
    print(f"   [ERROR] {e}")
    import traceback
    traceback.print_exc()

# Test 2: Get bookings for today
print("\n2. Getting bookings for today...")
today = datetime.now().strftime('%Y-%m-%d')
print(f"   Date: {today}")

try:
    bookings = service.get_bookings_for_date(today)
    print(f"   [OK] Found {len(bookings)} bookings")
    
    # Get unique therapists from bookings
    therapists_in_bookings = sorted(set(b['therapist'] for b in bookings))
    print(f"\n   Therapists with bookings today: {len(therapists_in_bookings)}")
    for therapist in therapists_in_bookings:
        count = sum(1 for b in bookings if b['therapist'] == therapist)
        print(f"      - {therapist} ({count} bookings)")
    
    print(f"\n   All bookings:")
    for i, booking in enumerate(bookings, 1):
        print(f"      {i}. {booking['customer']} with {booking['therapist']}")
        print(f"         {booking['service']} at {booking['start_at'][:16]}")
        
except Exception as e:
    print(f"   [ERROR] {e}")
    import traceback
    traceback.print_exc()

# Test 3: Check if there are more bookings with wider date range
print("\n3. Checking wider date range (today ± 7 days)...")
try:
    date_obj = datetime.strptime(today, '%Y-%m-%d')
    start_wide = (date_obj - timedelta(days=7)).isoformat() + 'Z'
    end_wide = (date_obj + timedelta(days=7)).isoformat() + 'Z'
    
    wide_bookings = client.list_bookings(
        start_at_min=start_wide,
        start_at_max=end_wide
    )
    print(f"   [OK] Found {len(wide_bookings)} bookings in ±7 day range")
    
    # Filter for today
    today_bookings = []
    for booking in wide_bookings:
        if isinstance(booking, dict):
            start_at = booking.get('start_at', '')
        else:
            start_at = getattr(booking, 'start_at', '') or ''
        
        if start_at.startswith(today):
            today_bookings.append(booking)
    
    print(f"   [INFO] {len(today_bookings)} bookings are for today")
    
except Exception as e:
    print(f"   [ERROR] {e}")
    import traceback
    traceback.print_exc()

# Test 4: Check team members filter
print("\n4. Checking team members filter...")
print(f"   Current filter: status='ACTIVE', location_id={Config.SQUARE_LOCATION_ID}")
print(f"   This might exclude:")
print(f"      - INACTIVE team members")
print(f"      - Team members from other locations")

print("\n" + "=" * 60)
print("Summary:")
print("=" * 60)
print("1. Team members are filtered by:")
print("   - Status: ACTIVE only")
print("   - Location: Only your location")
print("2. Therapists shown in calendar:")
print("   - Only those with bookings on that date")
print("   - If a staff has no bookings, they won't appear")
print("3. Appointments shown:")
print("   - Only for the selected date")
print("   - Only non-cancelled appointments")
print("=" * 60)

