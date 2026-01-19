"""Check what routes the running server actually has."""
import requests
import json

try:
    response = requests.get("http://127.0.0.1:8000/openapi.json", timeout=3)
    if response.status_code == 200:
        data = response.json()
        paths = data.get('paths', {})
        
        print("=" * 60)
        print("Routes registered on running server:")
        print("=" * 60)
        for path in sorted(paths.keys()):
            methods = list(paths[path].keys())
            print(f"  {path:30} {', '.join(methods)}")
        
        print("\n" + "=" * 60)
        if "/api/status" in paths:
            print("[OK] /api/status route exists!")
        else:
            print("[ERROR] /api/status route NOT found!")
            print("\nThe server is running OLD code.")
            print("Solution:")
            print("  1. Stop the server (Ctrl+C)")
            print("  2. Delete all __pycache__ folders")
            print("  3. Run: python clean_restart.py")
        print("=" * 60)
    else:
        print(f"Server returned status {response.status_code}")
except requests.exceptions.ConnectionError:
    print("Cannot connect to server. Is it running?")
except Exception as e:
    print(f"Error: {e}")

