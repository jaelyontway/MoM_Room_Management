# PowerShell script to restart the Square Bookings Sync server
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Restarting Square Bookings Sync Server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Step 1: Find and stop processes using port 8000
Write-Host "`n[1/4] Stopping processes on port 8000..." -ForegroundColor Yellow
$processes = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | 
    Select-Object -ExpandProperty OwningProcess -Unique

if ($processes) {
    foreach ($pid in $processes) {
        try {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -eq "python") {
                Write-Host "  Stopping Python process (PID: $pid)..." -ForegroundColor Gray
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
        } catch {
            # Process might already be gone
        }
    }
    Write-Host "  [OK] Stopped processes" -ForegroundColor Green
} else {
    Write-Host "  [INFO] No processes found on port 8000" -ForegroundColor Gray
}

# Step 2: Wait for port to be released
Write-Host "`n[2/4] Waiting for port to be released..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# Step 3: Clean Python cache (optional)
Write-Host "`n[3/4] Cleaning Python cache..." -ForegroundColor Yellow
if (Test-Path "app\__pycache__") {
    Remove-Item -Path "app\__pycache__" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] Cleaned app cache" -ForegroundColor Green
}
if (Test-Path "__pycache__") {
    Remove-Item -Path "__pycache__" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] Cleaned root cache" -ForegroundColor Green
}

# Step 4: Verify configuration
Write-Host "`n[4/4] Verifying configuration..." -ForegroundColor Yellow
python verify_server_config.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[WARN] Configuration check had issues" -ForegroundColor Yellow
    Write-Host "  But continuing anyway..." -ForegroundColor Gray
}

# Step 5: Start the server
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Starting server..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nServer will start in a new window." -ForegroundColor Yellow
Write-Host "Press Ctrl+C in that window to stop the server.`n" -ForegroundColor Yellow

# Start server in new window
Start-Process python -ArgumentList "run.py" -WindowStyle Normal

# Wait a bit for server to start
Start-Sleep -Seconds 3

# Test the server
Write-Host "Testing server status..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/status" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    $data = $response.Content | ConvertFrom-Json
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    if ($data.using_real_api) {
        Write-Host "[SUCCESS] Server is running with REAL Square API!" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Server is running but using MOCK DATA" -ForegroundColor Yellow
        Write-Host "  Check your .env file and server logs" -ForegroundColor Gray
    }
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "`nServer URL: http://127.0.0.1:8000" -ForegroundColor Cyan
    Write-Host "Status API: http://127.0.0.1:8000/api/status" -ForegroundColor Cyan
} catch {
    Write-Host "`n[WARN] Server might still be starting..." -ForegroundColor Yellow
    Write-Host "  Wait a few seconds and check: http://127.0.0.1:8000/api/status" -ForegroundColor Gray
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Gray
}

Write-Host "`nDone! Check the server window for logs." -ForegroundColor Green

