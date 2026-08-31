"""Check what appointments should be displayed in the calendar."""
import sys
import os
import requests
import json
from datetime import datetime
from collections import Counter

print("=" * 60)
print("Checking Calendar Display")
print("=" * 60)

# Get data from API
today = datetime.now().strftime('%Y-%m-%d')
url = f'http://127.0.0.1:8002/api/day?date={today}'

try:
    response = requests.get(url, timeout=5)
    if response.status_code == 200:
        data = response.json()
        
        therapists = data.get('therapists', [])
        events = data.get('events', [])
        
        print(f"\nAPI Response:")
        print(f"  Therapists: {len(therapists)}")
        print(f"  Events: {len(events)}")
        
        # Group by therapist
        by_therapist = Counter(e['therapist'] for e in events)
        
        print(f"\n{'='*60}")
        print("Appointments by Therapist:")
        print(f"{'='*60}")
        for therapist in sorted(by_therapist.keys()):
            count = by_therapist[therapist]
            appointments = [e for e in events if e['therapist'] == therapist]
            print(f"\n{therapist}: {count} appointment(s)")
            for apt in sorted(appointments, key=lambda x: x['start_at']):
                start = apt['start_at'][:16]  # YYYY-MM-DDTHH:MM
                customer = apt.get('customer', 'Unknown')
                service = apt.get('services', 'Unknown Service')
                print(f"  - {start}: {customer} ({service})")
        
        print(f"\n{'='*60}")
        print("Summary:")
        print(f"  Total therapists with appointments: {len(by_therapist)}")
        print(f"  Total appointments: {len(events)}")
        print(f"  Total therapists (all): {len(therapists)}")
        print(f"{'='*60}")
        
        # Check time range
        if events:
            times = [datetime.fromisoformat(e['start_at'].replace('Z', '+00:00')) for e in events]
            min_time = min(times)
            max_time = max(times)
            print(f"\nTime Range:")
            print(f"  Earliest: {min_time.strftime('%Y-%m-%d %H:%M')}")
            print(f"  Latest: {max_time.strftime('%Y-%m-%d %H:%M')}")
        
    else:
        print(f"[ERROR] Status {response.status_code}: {response.text}")
        
except requests.exceptions.ConnectionError:
    print("[ERROR] Cannot connect to server")
    print("Make sure server is running on port 8002")
except Exception as e:
    print(f"[ERROR] {e}")

