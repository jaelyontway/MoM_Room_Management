"""Verify routes are in the code."""
from app.main import app

routes = [r.path for r in app.routes if hasattr(r, 'path')]

print("Routes in app object:")
for r in sorted(routes):
    print(f"  {r}")

print(f"\n/api/status exists: {'/api/status' in routes}")

if '/api/status' not in routes:
    print("\n[ERROR] Route not found in code!")
    print("Check app/main.py file.")
else:
    print("\n[OK] Route exists in code!")
    print("Server should register it on next restart.")

