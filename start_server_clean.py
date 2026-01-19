"""Start server after ensuring port is free."""
import subprocess
import sys
import time
import socket

def is_port_free(port):
    """Check if port is free."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(('127.0.0.1', port))
        sock.close()
        return True
    except:
        return False

print("=" * 60)
print("Starting Server (Clean)")
print("=" * 60)

# Check if port is free
if not is_port_free(8000):
    print("\n[WARN] Port 8000 is still in use")
    print("Trying to kill processes...")
    
    # Try to kill processes
    try:
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True,
            text=True
        )
        
        pids = set()
        for line in result.stdout.split('\n'):
            if ':8000' in line and 'LISTENING' in line:
                parts = line.split()
                if len(parts) > 4:
                    try:
                        pid = int(parts[-1])
                        pids.add(pid)
                    except:
                        pass
        
        if pids:
            for pid in pids:
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/PID", str(pid)],
                        capture_output=True,
                        timeout=3
                    )
                except:
                    pass
            
            print("  Waiting 5 seconds for port to release...")
            time.sleep(5)
    except Exception as e:
        print(f"  Error: {e}")

# Check again
if not is_port_free(8000):
    print("\n[ERROR] Port 8000 is still in use!")
    print("Please manually stop all servers and try again.")
    print("\nRun this command:")
    print("  Get-Process python | Stop-Process -Force")
    sys.exit(1)

print("\n[OK] Port 8000 is free")
print("\nStarting server...")
print("=" * 60)

# Import and start
from app.main import app
import uvicorn

# Show routes
routes = [r.path for r in app.routes if hasattr(r, 'path')]
print(f"\nRegistered routes: {len(routes)}")
if '/api/status' in routes:
    print("[OK] /api/status route is registered!")
else:
    print("[ERROR] /api/status route NOT found!")

print("\n" + "=" * 60)
print("Server starting on http://127.0.0.1:8000")
print("Press Ctrl+C to stop")
print("=" * 60 + "\n")

uvicorn.run(
    app,
    host="127.0.0.1",
    port=8000,
    log_level="info"
)

