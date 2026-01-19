"""Test the API endpoint to see what data it returns."""
import requests
from datetime import datetime

# Test the API endpoint
today = datetime.now().strftime('%Y-%m-%d')
url = f"http://127.0.0.1:8000/api/day?date={today}"

print(f"Testing API endpoint: {url}")
print("=" * 60)

try:
    response = requests.get(url)
    if response.status_code == 200:
        data = response.json()
        print(f"Date: {data['date']}")
        print(f"Therapists: {data['therapists']}")
        print(f"Number of events: {len(data['events'])}")
        
        if data['events']:
            print("\nSample events:")
            for event in data['events'][:3]:
                print(f"  - {event['customer']} with {event['therapist']}")
                print(f"    Service: {event['service']}")
                print(f"    Room: {event['room']}")
                print(f"    Time: {event['start_at'][:16]} - {event['end_at'][:16]}")
        else:
            print("\nNo events found for this date")
            print("This could mean:")
            print("  1. No bookings in Square for this date")
            print("  2. All bookings are cancelled")
            print("  3. Using mock data (check server logs)")
    else:
        print(f"Error: {response.status_code}")
        print(response.text)
except requests.exceptions.ConnectionError:
    print("[ERROR] Cannot connect to server")
    print("Make sure the server is running: python run.py")
except Exception as e:
    print(f"[ERROR] {e}")

