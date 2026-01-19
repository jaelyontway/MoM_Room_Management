"""Verify server configuration without starting the server."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("=" * 60)
print("Verifying Server Configuration")
print("=" * 60)

# Check if we can import
try:
    from app.main import square_service, app
    print("\n[OK] Successfully imported app.main")
except Exception as e:
    print(f"\n[ERROR] Failed to import: {e}")
    sys.exit(1)

# Check Square service
print("\nSquare Service Status:")
if square_service.client:
    print("  [OK] Square API client is initialized")
    print(f"  - Environment: {square_service.client.client.environment}")
    print("  - Status: READY TO USE REAL API")
else:
    print("  [WARNING] Square API client is NOT initialized")
    print("  - Status: WILL USE MOCK DATA")
    
    # Check why
    print("\n  Checking configuration...")
    from config import Config
    try:
        Config.validate()
        print("  [OK] Config validation passed")
        print("  [INFO] But client is None - this might be a module import issue")
        print("  [INFO] Try restarting the server")
    except ValueError as e:
        print(f"  [ERROR] Config validation failed: {e}")
        print("  [INFO] Check your .env file")

# Check status endpoint
print("\n" + "=" * 60)
print("To check status via API:")
print("  1. Start server: python run.py")
print("  2. Visit: http://127.0.0.1:8000/api/status")
print("=" * 60)

