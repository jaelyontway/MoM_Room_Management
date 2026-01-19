# PowerShell script to kill processes using ports 8000-8010 and 9000-9010
Write-Host "Killing processes on ports 8000-8010 and 9000-9010..." -ForegroundColor Yellow

$ports = (8000..8010) + (9000..9010)
$killed = 0

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.OwningProcess) {
            try {
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
                Write-Host "  Killed process $($conn.OwningProcess) on port $port" -ForegroundColor Green
                $killed++
            } catch {
                Write-Host "  Could not kill process $($conn.OwningProcess) on port $port" -ForegroundColor Red
            }
        }
    }
}

if ($killed -eq 0) {
    Write-Host "No processes found on ports 8000-8010, 9000-9010" -ForegroundColor Cyan
} else {
    Write-Host "`nKilled $killed process(es)" -ForegroundColor Green
}

