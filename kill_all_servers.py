"""Force kill all Python processes and restart server."""
import subprocess
import sys
import time
import os

print("=" * 60)
print("Force Stopping All Servers")
print("=" * 60)

# Find all processes on port 8000
print("\nFinding processes on port 8000...")
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
                print(f"  Found PID: {pid}")
            except ValueError:
                pass

# Kill all Python processes (more aggressive)
print("\nStopping all Python processes...")
try:
    subprocess.run(
        ["taskkill", "/F", "/IM", "python.exe"],
        capture_output=True,
        timeout=5
    )
    print("  [OK] Stopped all Python processes")
except Exception as e:
    print(f"  [WARN] {e}")

# Wait
print("\nWaiting 3 seconds...")
time.sleep(3)

# Verify port is free
result = subprocess.run(
    ["netstat", "-ano"],
    capture_output=True,
    text=True
)
if ':8000' not in result.stdout or 'LISTENING' not in result.stdout:
    print("  [OK] Port 8000 is now free")
else:
    print("  [WARN] Port 8000 still in use")

print("\n" + "=" * 60)
print("Now start the server manually:")
print("  python run.py")
print("=" * 60)

