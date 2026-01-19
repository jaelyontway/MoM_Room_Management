"""Force stop ALL processes on port 8000."""
import subprocess
import time
import socket

print("=" * 60)
print("Force Stopping ALL Servers on Port 8000")
print("=" * 60)

# Method 1: Kill all Python processes
print("\n[1/3] Stopping all Python processes...")
try:
    subprocess.run(["taskkill", "/F", "/IM", "python.exe"], 
                  capture_output=True, timeout=5)
    print("  [OK] Stopped all Python processes")
except:
    print("  [INFO] No Python processes to stop")

# Method 2: Find and kill specific PIDs
print("\n[2/3] Finding processes on port 8000...")
try:
    result = subprocess.run(
        ["netstat", "-ano"],
        capture_output=True,
        text=True,
        timeout=5
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
                except:
                    pass
    
    if pids:
        print(f"\n  Killing {len(pids)} processes...")
        for pid in pids:
            try:
                subprocess.run(
                    ["taskkill", "/F", "/PID", str(pid)],
                    capture_output=True,
                    timeout=3
                )
                print(f"    [OK] Killed PID {pid}")
            except Exception as e:
                print(f"    [WARN] Could not kill PID {pid}: {e}")
    else:
        print("  [INFO] No processes found on port 8000")
        
except Exception as e:
    print(f"  [ERROR] {e}")

# Method 3: Wait and verify
print("\n[3/3] Waiting for port to be released...")
time.sleep(5)

# Check if port is free
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    sock.bind(('127.0.0.1', 8000))
    sock.close()
    print("  [OK] Port 8000 is now FREE!")
    print("\n" + "=" * 60)
    print("SUCCESS! You can now start the server:")
    print("  python run_fresh.py")
    print("=" * 60)
except:
    print("  [WARN] Port 8000 is still in use")
    print("\n  Try running this command manually:")
    print("    Get-Process python | Stop-Process -Force")
    print("\n  Or restart your computer to clear all processes.")

