
@echo off
set PY=python
if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" set PY=%LOCALAPPDATA%\Programs\Python\Python314\python.exe
echo.
echo === To open on your phone ===
echo 1. Phone and PC on the SAME WiFi
echo 2. In browser on phone type:  http://YOUR_PC_IP:8000
echo    (Find PC IP: run "ipconfig" and look for IPv4 Address, e.g. 192.168.1.5)
echo.
REM Use 0.0.0.0 so the app accepts connections from phone/other devices
"%PY%" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pause

