"""Test if server is running and status endpoint works."""
import requests
import time
import sys

print("Testing server status...")
print("=" * 60)

# Wait a bit for server to start
time.sleep(2)

try:
    response = requests.get("http://127.0.0.1:8000/api/status", timeout=5)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.json()}")
    
    if response.status_code == 200:
        data = response.json()
        if data.get('using_real_api'):
            print("\n[OK] Server is using REAL Square API!")
        else:
            print("\n[WARN] Server is using MOCK DATA")
            print("Check server logs for initialization messages")
    else:
        print(f"\n[ERROR] Unexpected status code: {response.status_code}")
        
except requests.exceptions.ConnectionError:
    print("[ERROR] Cannot connect to server")
    print("Make sure server is running: python run.py")
    sys.exit(1)
except Exception as e:
    print(f"[ERROR] {e}")
    sys.exit(1)

print("=" * 60)

