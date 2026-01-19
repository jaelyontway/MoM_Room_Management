"""Check raw Square API data for Sophia's appointments."""
import sys
from datetime import datetime, timedelta
from dateutil import parser
from dateutil import tz as dateutil_tz
from app.square_service import SquareService

service = SquareService()
date = '2026-01-18'

if not service.client:
    print("Square API not configured")
    sys.exit(1)

# Get raw bookings from Square
local_tz = dateutil_tz.tzlocal()
date_obj = datetime.strptime(date, '%Y-%m-%d')
local_start = date_obj.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
local_end = local_start.replace(hour=23, minute=59, second=59)

from dateutil import tz as dateutil_tz
start_at_min = local_start.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
start_at_max = local_end.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')

raw_bookings = service.client.list_bookings(
    start_at_min=start_at_min,
    start_at_max=start_at_max
)

print(f"\nRaw bookings from Square API for {date}:")
print("=" * 80)

sophia_raw = []
for b in raw_bookings:
    # Check therapist
    segments = b.get('appointment_segments', []) if isinstance(b, dict) else (getattr(b, 'appointment_segments', []) or [])
    if not segments:
        continue
    
    segment = segments[0]
    if isinstance(segment, dict):
        team_member_id = segment.get('team_member_id', '')
    else:
        team_member_id = getattr(segment, 'team_member_id', '') or ''
    
    # Get therapist name
    therapist_name = service.get_team_member_name(team_member_id)
    
    if 'sophia' in therapist_name.lower():
        sophia_raw.append(b)

print(f"\nFound {len(sophia_raw)} raw bookings for Sophia")

for i, b in enumerate(sorted(sophia_raw, key=lambda x: parser.parse(x.get('start_at') if isinstance(x, dict) else getattr(x, 'start_at', '')) if (isinstance(x, dict) and x.get('start_at')) or (not isinstance(x, dict) and getattr(x, 'start_at', '')) else datetime.min), 1):
    if isinstance(b, dict):
        booking_id = b.get('id', '')
        start_at = b.get('start_at', '')
        segments = b.get('appointment_segments', [])
    else:
        booking_id = getattr(b, 'id', '') or ''
        start_at = getattr(b, 'start_at', '') or ''
        segments = getattr(b, 'appointment_segments', []) or []
    
    print(f"\n{i}. Booking ID: {booking_id[:30]}...")
    print(f"   Square API start_at: {start_at}")
    
    # Calculate duration from segments
    total_duration = 0
    for seg in segments:
        if isinstance(seg, dict):
            duration = seg.get('duration_minutes', 0)
        else:
            duration = getattr(seg, 'duration_minutes', 0) or 0
        total_duration += duration
    
    if start_at:
        start_dt = parser.parse(str(start_at))
        end_dt = start_dt + timedelta(minutes=total_duration)
        print(f"   Calculated duration: {total_duration} minutes")
        print(f"   Start (UTC): {start_dt.strftime('%Y-%m-%d %H:%M:%S %Z')}")
        print(f"   End (UTC): {end_dt.strftime('%Y-%m-%d %H:%M:%S %Z')}")
        print(f"   Start (Local): {start_dt.astimezone(local_tz).strftime('%Y-%m-%d %H:%M:%S %Z')}")
        print(f"   End (Local): {end_dt.astimezone(local_tz).strftime('%Y-%m-%d %H:%M:%S %Z')}")
    
    print(f"   Segments: {len(segments)}")
    for j, seg in enumerate(segments, 1):
        if isinstance(seg, dict):
            duration = seg.get('duration_minutes', 0)
            team_member_id = seg.get('team_member_id', '')
        else:
            duration = getattr(seg, 'duration_minutes', 0) or 0
            team_member_id = getattr(seg, 'team_member_id', '') or ''
        print(f"      Segment {j}: {duration} minutes, team_member: {team_member_id[:20]}...")


