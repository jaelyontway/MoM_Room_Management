"""Verify the fixes are working."""
import requests
import json

print("=" * 60)
print("Verifying Fixes")
print("=" * 60)

# Test the API endpoint
try:
    r = requests.get('http://127.0.0.1:8002/api/day?date=2026-01-06', timeout=5)
    if r.status_code == 200:
        data = r.json()
        
        therapists = data.get('therapists', [])
        events = data.get('events', [])
        
        print(f"\nTherapists in response: {len(therapists)}")
        print(f"Events in response: {len(events)}")
        
        print(f"\nFirst 10 therapists:")
        for i, therapist in enumerate(therapists[:10], 1):
            print(f"  {i}. {therapist}")
        
        if len(therapists) >= 20:
            print(f"\n[OK] All team members are included!")
        else:
            print(f"\n[WARN] Only {len(therapists)} therapists (expected ~27)")
        
        print(f"\nEvents (appointments): {len(events)}")
        if events:
            print(f"  Sample events:")
            for event in events[:3]:
                print(f"    - {event.get('therapist')}: {event.get('customer')} at {event.get('start_at', '')[:16]}")
        
    else:
        print(f"[ERROR] Status {r.status_code}: {r.text}")
        
except requests.exceptions.ConnectionError:
    print("[ERROR] Cannot connect to server")
    print("Make sure server is running on port 8002")
except Exception as e:
    print(f"[ERROR] {e}")

print("=" * 60)

