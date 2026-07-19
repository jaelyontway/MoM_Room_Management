@echo off
set PY=python
if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" set PY=%LOCALAPPDATA%\Programs\Python\Python314\python.exe

echo.
echo === MoM Room Jaelyn ===
echo Server starting... browser will open: http://127.0.0.1:8001
echo.
echo Do NOT open http://0.0.0.0:8001 — browsers cannot use that address.
echo.
echo Phone (same WiFi): http://YOUR_PC_IP:8001
echo.

REM Open the correct URL after a short delay (gives uvicorn time to bind)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8001"

REM Use 0.0.0.0 so the app accepts connections from phone/other devices
"%PY%" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
pause