#!/usr/bin/env python
"""Start server with fresh imports to avoid caching issues."""
import sys
import os

# Clear any cached modules
if 'app.main' in sys.modules:
    del sys.modules['app.main']
if 'app' in sys.modules:
    del sys.modules['app']
if 'app.square_service' in sys.modules:
    del sys.modules['app.square_service']

# Import and run
from app.main import app
import uvicorn

if __name__ == "__main__":
    print("=" * 60)
    print("Starting server with fresh imports...")
    print("=" * 60)
    
    # Check routes
    routes = [r.path for r in app.routes if hasattr(r, 'path')]
    print(f"\nRegistered routes: {len(routes)}")
    for route in sorted(routes):
        print(f"  {route}")
    
    if "/api/status" in routes:
        print("\n[OK] /api/status route is registered!")
    else:
        print("\n[ERROR] /api/status route NOT found!")
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("Starting server (will find available port)")
    print("Press Ctrl+C to stop")
    print("=" * 60 + "\n")
    
    # Try ports in order: 8000-8010, then 9000-9010
    import socket
    ports_to_try = list(range(8000, 8011)) + list(range(9000, 9011))
    selected_port = None
    
    for port in ports_to_try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(('127.0.0.1', port))
            sock.close()
            selected_port = port
            break
        except:
            sock.close()
            continue
    
    if selected_port is None:
        print("\n[ERROR] All ports (8000-8010, 9000-9010) are in use!")
        print("Please stop other servers or restart your computer.")
        print("\nTo kill processes on these ports, run:")
        print("  .\\kill_ports.ps1")
        print("  OR")
        print("  Get-NetTCPConnection -LocalPort 8000,8001,8002 | Select-Object -ExpandProperty OwningProcess | Stop-Process -Force")
        print("\nAlternatively, you can manually kill Python processes:")
        print("  Get-Process python | Stop-Process -Force")
        print("\nOr wait a few minutes for ports to be released from TIME_WAIT state.")
        sys.exit(1)
    
    print(f"\n[INFO] Using port {selected_port}")
    print(f"[INFO] Dashboard will be available at: http://127.0.0.1:{selected_port}/")
    print(f"[INFO] API docs will be available at: http://127.0.0.1:{selected_port}/docs")
    
    uvicorn.run(
        app,  # Pass app object directly, not string
        host="127.0.0.1",
        port=selected_port,
        log_level="info"
    )

