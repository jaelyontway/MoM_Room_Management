# Start the TEST dashboard (uses full path to Python if python not in PATH)
$py = "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe"
if (-not (Test-Path $py)) {
    $py = "python"
}
# Use 0.0.0.0 so you can open the app on your phone at http://YOUR_PC_IP:8000
& $py -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
