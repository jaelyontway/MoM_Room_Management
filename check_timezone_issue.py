"""Check timezone conversion issue."""
import sys
import os
from datetime import datetime
import requests

print("=" * 60)
print("Checking Timezone Issue")
print("=" * 60)

today = datetime.now().strftime('%Y-%m-%d')
url = f'http://127.0.0.1:8002/api/day?date={today}'

try:
    response = requests.get(url, timeout=5)
    if response.status_code == 200:
        data = response.json()
        events = data.get('events', [])
        
        print(f"\nTotal events: {len(events)}")
        print(f"\nSample events with times:")
        
        for i, event in enumerate(events[:10], 1):
            start_at = event.get('start_at', '')
            therapist = event.get('therapist', '')
            customer = event.get('customer', '')
            
            # Parse the time
            try:
                # Handle both UTC (Z) and timezone-aware formats
                if start_at.endswith('Z'):
                    dt = datetime.fromisoformat(start_at.replace('Z', '+00:00'))
                else:
                    dt = datetime.fromisoformat(start_at)
                
                # Convert to local time
                local_dt = dt.astimezone()
                
                print(f"\n{i}. {therapist} - {customer}")
                print(f"   UTC time: {start_at}")
                print(f"   Local time: {local_dt.strftime('%Y-%m-%d %H:%M %Z')}")
                print(f"   Hour: {local_dt.hour}")
                
            except Exception as e:
                print(f"   Error parsing time: {e}")
        
        # Check which appointments are within 8 AM - 8 PM
        in_range = 0
        out_of_range = 0
        
        for event in events:
            start_at = event.get('start_at', '')
            try:
                if start_at.endswith('Z'):
                    dt = datetime.fromisoformat(start_at.replace('Z', '+00:00'))
                else:
                    dt = datetime.fromisoformat(start_at)
                local_dt = dt.astimezone()
                
                if 8 <= local_dt.hour < 20:
                    in_range += 1
                else:
                    out_of_range += 1
            except:
                pass
        
        print(f"\n{'='*60}")
        print(f"Appointments in 8 AM - 8 PM range: {in_range}")
        print(f"Appointments outside range: {out_of_range}")
        print(f"{'='*60}")
        
except Exception as e:
    print(f"[ERROR] {e}")

