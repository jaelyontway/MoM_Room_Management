#!/usr/bin/env python
"""Python script to restart the Square Bookings Sync server."""
import subprocess
import sys
import os
import time
import requests
import shutil

print("=" * 60)
print("Restarting Square Bookings Sync Server")
print("=" * 60)

# Step 1: Find and stop processes on port 8000
print("\n[1/5] Stopping processes on port 8000...")
try:
    # Use netstat to find processes
    result = subprocess.run(
        ["netstat", "-ano"],
        capture_output=True,
        text=True,
        timeout=5
    )
    
    pids_to_kill = set()
    for line in result.stdout.split('\n'):
        if ':8000' in line and 'LISTENING' in line:
            parts = line.split()
            if len(parts) > 4:
                try:
                    pid = int(parts[-1])
                    pids_to_kill.add(pid)
                except ValueError:
                    pass
    
    if pids_to_kill:
        for pid in pids_to_kill:
            try:
                # Check if it's a Python process
                proc = subprocess.run(
                    ["tasklist", "/FI", f"PID eq {pid}"],
                    capture_output=True,
                    text=True,
                    timeout=3
                )
                if "python" in proc.stdout.lower():
                    print(f"  Stopping Python process (PID: {pid})...")
                    subprocess.run(
                        ["taskkill", "/F", "/PID", str(pid)],
                        capture_output=True,
                        timeout=3
                    )
            except Exception as e:
                print(f"  Could not stop PID {pid}: {e}")
        
        print("  [OK] Stopped processes")
    else:
        print("  [INFO] No processes found on port 8000")
except Exception as e:
    print(f"  [WARN] Could not check processes: {e}")

# Step 2: Wait for port to be released
print("\n[2/5] Waiting for port to be released...")
time.sleep(2)

# Step 3: Clean Python cache
print("\n[3/5] Cleaning Python cache...")
cache_dirs = ["app/__pycache__", "__pycache__"]
for cache_dir in cache_dirs:
    if os.path.exists(cache_dir):
        try:
            shutil.rmtree(cache_dir)
            print(f"  [OK] Cleaned {cache_dir}")
        except Exception as e:
            print(f"  [WARN] Could not clean {cache_dir}: {e}")

# Step 4: Verify configuration
print("\n[4/5] Verifying configuration...")
try:
    result = subprocess.run(
        [sys.executable, "verify_server_config.py"],
        capture_output=True,
        text=True,
        timeout=10
    )
    if "Square API client is initialized" in result.stdout:
        print("  [OK] Configuration is valid")
    else:
        print("  [WARN] Configuration check had issues")
except Exception as e:
    print(f"  [WARN] Could not verify config: {e}")

# Step 5: Start the server
print("\n[5/5] Starting server...")
print("=" * 60)
print("Server will start in the background.")
print("Check http://127.0.0.1:8000/api/status in a few seconds.")
print("=" * 60)

try:
    # Start server in background
    if sys.platform == "win32":
        # Windows: start in new window
        subprocess.Popen(
            [sys.executable, "run.py"],
            creationflags=subprocess.CREATE_NEW_CONSOLE
        )
    else:
        # Unix: start in background
        subprocess.Popen(
            [sys.executable, "run.py"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    
    print("\n[OK] Server starting...")
    print("  Waiting 5 seconds for server to initialize...")
    time.sleep(5)
    
    # Test the server
    print("\nTesting server status...")
    try:
        response = requests.get("http://127.0.0.1:8000/api/status", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print("\n" + "=" * 60)
            if data.get('using_real_api'):
                print("[SUCCESS] Server is running with REAL Square API!")
            else:
                print("[WARN] Server is running but using MOCK DATA")
                print("  Check your .env file and server logs")
            print("=" * 60)
            print(f"\nServer URL: http://127.0.0.1:8000")
            print(f"Status API: http://127.0.0.1:8000/api/status")
        else:
            print(f"[WARN] Server returned status {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"[WARN] Server might still be starting...")
        print(f"  Wait a few seconds and check: http://127.0.0.1:8000/api/status")
        print(f"  Error: {e}")
    
except Exception as e:
    print(f"[ERROR] Could not start server: {e}")
    print("\nTry running manually: python run.py")
    sys.exit(1)

print("\nDone! Check the server window for logs.")

