"""Check what the API is actually returning for customer names."""
import requests
import json
from datetime import datetime

today = datetime.now().strftime('%Y-%m-%d')
url = f'http://127.0.0.1:8001/api/day?date={today}'

print(f"Testing API: {url}")
print("=" * 60)

try:
    response = requests.get(url, timeout=10)
    if response.status_code == 200:
        data = response.json()
        events = data.get('events', [])
        print(f"✓ API returned {len(events)} events\n")
        
        if events:
            print("First 5 events customer data:")
            print("-" * 60)
            for i, event in enumerate(events[:5], 1):
                customer = event.get('customer', 'N/A')
                booking_id = event.get('booking_id', 'N/A')
                therapist = event.get('therapist', 'N/A')
                service = event.get('service', 'N/A')
                print(f"Event {i}:")
                print(f"  Customer: {customer}")
                print(f"  Booking ID: {booking_id[:30]}...")
                print(f"  Therapist: {therapist}")
                print(f"  Service: {service}")
                print()
        else:
            print("No events found in response")
    else:
        print(f"✗ API returned status code: {response.status_code}")
        print(f"Response: {response.text[:500]}")
except requests.exceptions.ConnectionError:
    print("✗ Could not connect to API. Is the server running at http://127.0.0.1:8001?")
except Exception as e:
    print(f"✗ Error: {e}")

