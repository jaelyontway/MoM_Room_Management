"""Completely clean and restart the server."""
import subprocess
import sys
import os
import shutil
import time
import requests

print("=" * 60)
print("Complete Clean Restart")
print("=" * 60)

# Step 1: Kill all Python processes
print("\n[1/6] Killing all Python processes...")
try:
    subprocess.run(["taskkill", "/F", "/IM", "python.exe"], 
                  capture_output=True, timeout=5)
    print("  [OK] Stopped all Python processes")
except:
    print("  [INFO] No Python processes to stop")

# Step 2: Wait
print("\n[2/6] Waiting for processes to terminate...")
time.sleep(3)

# Step 3: Delete all __pycache__ directories
print("\n[3/6] Cleaning Python cache...")
cache_dirs = []
for root, dirs, files in os.walk('.'):
    if '__pycache__' in dirs:
        cache_path = os.path.join(root, '__pycache__')
        cache_dirs.append(cache_path)
        try:
            shutil.rmtree(cache_path)
            print(f"  [OK] Removed {cache_path}")
        except Exception as e:
            print(f"  [WARN] Could not remove {cache_path}: {e}")

if not cache_dirs:
    print("  [INFO] No cache directories found")

# Step 4: Delete .pyc files
print("\n[4/6] Cleaning .pyc files...")
pyc_count = 0
for root, dirs, files in os.walk('.'):
    for file in files:
        if file.endswith('.pyc'):
            try:
                os.remove(os.path.join(root, file))
                pyc_count += 1
            except:
                pass
print(f"  [OK] Removed {pyc_count} .pyc files")

# Step 5: Verify configuration
print("\n[5/6] Verifying configuration...")
try:
    result = subprocess.run([sys.executable, "verify_server_config.py"],
                           capture_output=True, text=True, timeout=10)
    if "Square API client is initialized" in result.stdout:
        print("  [OK] Configuration valid")
    else:
        print("  [WARN] Configuration check had issues")
except Exception as e:
    print(f"  [WARN] Could not verify: {e}")

# Step 6: Start server
print("\n[6/6] Starting server...")
print("=" * 60)
print("Starting server in new window...")
print("Check the server window for logs.")
print("=" * 60)

try:
    # Start in new console window
    if sys.platform == "win32":
        subprocess.Popen(
            [sys.executable, "run.py"],
            creationflags=subprocess.CREATE_NEW_CONSOLE
        )
    else:
        subprocess.Popen([sys.executable, "run.py"])
    
    print("\n[OK] Server starting...")
    print("  Waiting 8 seconds for server to initialize...")
    time.sleep(8)
    
    # Test
    print("\nTesting server...")
    try:
        response = requests.get("http://127.0.0.1:8000/api/status", timeout=5)
        print(f"  Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print("\n" + "=" * 60)
            if data.get('using_real_api'):
                print("[SUCCESS] Server is running with REAL Square API!")
            else:
                print("[WARN] Server is using MOCK DATA")
            print("=" * 60)
            print(f"\nServer URL: http://127.0.0.1:8000")
            print(f"Status: {data.get('message')}")
        else:
            print(f"  [ERROR] Server returned {response.status_code}")
            print(f"  Response: {response.text}")
            
    except requests.exceptions.RequestException as e:
        print(f"  [WARN] Could not test server: {e}")
        print("  Server might still be starting. Wait a few seconds.")
        
except Exception as e:
    print(f"[ERROR] Could not start server: {e}")
    print("\nTry running manually: python run.py")

print("\nDone!")

