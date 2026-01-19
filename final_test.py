"""Final test of /api/status endpoint."""
import time
import requests
import json

time.sleep(10)

print("=" * 60)
print("FINAL STATUS TEST")
print("=" * 60)

try:
    r = requests.get('http://127.0.0.1:8000/api/status', timeout=5)
    print(f'Status Code: {r.status_code}')
    
    if r.status_code == 200:
        print('\n[SUCCESS] Server is working!')
        data = r.json()
        print('\nResponse:')
        print(json.dumps(data, indent=2))
        print(f'\nUsing Real API: {data.get("using_real_api")}')
        if data.get('using_real_api'):
            print('\n[OK] Connected to REAL Square API!')
        else:
            print('\n[WARN] Using MOCK DATA')
    else:
        print(f'\n[ERROR] Status {r.status_code}')
        print(f'Response: {r.text}')
        
except requests.exceptions.ConnectionError:
    print('\n[ERROR] Cannot connect to server')
    print('Server might still be starting or port is blocked.')
except Exception as e:
    print(f'\n[ERROR] {e}')

print("=" * 60)

