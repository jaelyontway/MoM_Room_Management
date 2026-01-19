# Quick Start Script for PowerShell
# 快速启动脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Square Bookings Sync - Quick Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Step 1: Stop all Python processes
Write-Host "`n[1/4] Stopping all Python processes..." -ForegroundColor Yellow
try {
    Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] Stopped Python processes" -ForegroundColor Green
} catch {
    Write-Host "  [INFO] No Python processes to stop" -ForegroundColor Gray
}

# Step 2: Wait
Write-Host "`n[2/4] Waiting for port to release..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Step 3: Clean cache (optional)
Write-Host "`n[3/4] Cleaning cache..." -ForegroundColor Yellow
try {
    Get-ChildItem -Path . -Recurse -Filter "__pycache__" -ErrorAction SilentlyContinue | 
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] Cache cleaned" -ForegroundColor Green
} catch {
    Write-Host "  [INFO] No cache to clean" -ForegroundColor Gray
}

# Step 4: Start server
Write-Host "`n[4/4] Starting server..." -ForegroundColor Yellow
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Server will start in a new window" -ForegroundColor Yellow
Write-Host "Access at: http://127.0.0.1:8001" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nPress any key to start the server..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Start-Process python -ArgumentList "run_fresh.py" -WindowStyle Normal

Write-Host "`n[OK] Server starting..." -ForegroundColor Green
Write-Host "`nWait 10 seconds, then test:" -ForegroundColor Yellow
Write-Host "  python test_port_8001.py" -ForegroundColor Cyan
Write-Host "`nOr open in browser:" -ForegroundColor Yellow
Write-Host "  http://127.0.0.1:8001/api/status" -ForegroundColor Cyan

