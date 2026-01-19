"""Check what routes are registered in the FastAPI app."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import app

print("Registered routes:")
print("=" * 60)

for route in app.routes:
    if hasattr(route, 'path') and hasattr(route, 'methods'):
        methods = ', '.join(route.methods) if route.methods else 'N/A'
        print(f"{methods:20} {route.path}")
    elif hasattr(route, 'path'):
        print(f"{'N/A':20} {route.path}")

print("=" * 60)
print("\nTesting /api/status route...")
print(f"Route exists: {any(r.path == '/api/status' for r in app.routes)}")

