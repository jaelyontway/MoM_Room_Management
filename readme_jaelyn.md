# MoM Room Management — Setup on Another Computer (Jaelyn)

This guide gets the **TEST / mark-v** app running on a new Windows PC, including how to start it with `start_server.bat`.

## What you need

- Windows PC
- [Python 3.10+](https://www.python.org/downloads/) (3.14 works; during install, check **Add python.exe to PATH**)
- [Git](https://git-scm.com/download/win)
- Internet connection
- Square API credentials (optional — without them the app runs on mock data)

## 1. Get the code

Open **Command Prompt** or **PowerShell** and clone the repo (or pull if you already have it):

```bat
cd %USERPROFILE%\spa
git clone https://github.com/jaelyontway/MoM_Room_Management.git MoM_Room_Management-TEST
cd MoM_Room_Management-TEST
git checkout mark-v
git pull origin mark-v
```

If the folder already exists:

```bat
cd %USERPROFILE%\spa\MoM_Room_Management-TEST
git checkout mark-v
git pull origin mark-v
```

Use branch **`mark-v`** — that is the current TEST app. `main` may be older.

## 2. Install Python packages

From the project folder:

```bat
cd C:\Users\YOURNAME\spa\MoM_Room_Management-TEST
python -m pip install -r requirements.txt
```

If `python` is not found, try `py -m pip install -r requirements.txt`.

## 3. Create your `.env` file

1. Copy the example file:

   ```bat
   copy env.example .env
   ```

2. Edit `.env` in Notepad and set your Square values (no spaces around `=`, no quotes):

   ```
   SQUARE_ACCESS_TOKEN=your_access_token_here
   SQUARE_APPLICATION_ID=your_application_id_here
   SQUARE_LOCATION_ID=your_location_id_here
   SQUARE_ENVIRONMENT=production
   COUPLES_MASSAGE_SERVICE_NAME_PATTERN=couple
   ```

   For sandbox testing, use `SQUARE_ENVIRONMENT=sandbox` and sandbox credentials.

**Notes:**
- `.env` is gitignored — it will not be pushed to GitHub. You must create it on each new computer.
- Without Square credentials, the app still starts and uses mock data.
- After changing `.env`, stop and restart the server.

## 4. Run the server with `start_server.bat` (recommended)

This is the usual way to start the TEST app on Windows.

1. Open File Explorer and go to the project folder, for example:

   `C:\Users\YOURNAME\spa\MoM_Room_Management-TEST`

2. Double-click:

   **`start_server.bat`**

   Or from Command Prompt / PowerShell:

   ```bat
   cd C:\Users\YOURNAME\spa\MoM_Room_Management-TEST
   start_server.bat
   ```

3. Leave that black window open. Closing it stops the server.

What the bat file does:
- Prefers Python 3.14 at `%LOCALAPPDATA%\Programs\Python\Python314\python.exe` if present, otherwise uses `python`
- Starts: `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
- Listens on **all interfaces** (`0.0.0.0`) so phones on the same Wi‑Fi can connect

### Alternate: PowerShell

```powershell
cd C:\Users\YOURNAME\spa\MoM_Room_Management-TEST
.\start_server.ps1
```

## 5. Open the app

On the same PC:

| Page | URL |
|------|-----|
| Dashboard | http://127.0.0.1:8000/ |
| API docs | http://127.0.0.1:8000/docs |
| Check-in | http://127.0.0.1:8000/static/checkin.html |
| Voice book | http://127.0.0.1:8000/static/voice_book.html |
| Reports | http://127.0.0.1:8000/static/reports.html |

### Open on your phone (same Wi‑Fi)

1. Phone and PC on the **same Wi‑Fi**
2. On the PC, run `ipconfig` and note the **IPv4 Address** (e.g. `192.168.1.5`)
3. On the phone browser open: `http://YOUR_PC_IP:8000`  
   Example: `http://192.168.1.5:8000`

Windows Firewall may ask to allow Python the first time — allow it on private networks.

## 6. Quick checks that it worked

- The bat window shows uvicorn running without a traceback
- Browser loads the dashboard at http://127.0.0.1:8000/
- Header shows either **Connected to Real Square API** or **Using Mock Data**
- SQLite DB `room_assignments.db` is created automatically if missing

## Troubleshooting

### `python` / `uvicorn` not found
- Reinstall Python and check **Add to PATH**, or install to the default Python 3.14 path that `start_server.bat` looks for
- Confirm packages: `python -m pip install -r requirements.txt`

### Port 8000 already in use
Another server may already be running. Either use that one, or stop the old process, then run `start_server.bat` again.

PowerShell (run as needed):

```powershell
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

### Still on an old version
Make sure you pulled **mark-v**:

```bat
git checkout mark-v
git pull origin mark-v
```

Then restart with `start_server.bat`.

### Square shows mock data
1. Confirm `.env` exists in the project root (same folder as `start_server.bat`)
2. Check token / location / environment values
3. Restart the server after any `.env` edit
4. See `SETUP_NEW_COMPUTER.md` and `FIX_SQUARE_API_CONNECTION.md` if present

### Database issues
Delete the local DB and restart (it will be recreated):

```bat
del room_assignments.db
start_server.bat
```

## Stop the server

Close the `start_server.bat` window, or press `Ctrl+C` in that window, then any key at `pause`.

## Related docs

- `SETUP_NEW_COMPUTER.md` — older / alternate setup notes
- `VOICE_BOOKING.md` — voice booking page and API
- `env.example` — list of supported environment variables

## Reminder for this machine’s paths

On Mark’s PC the TEST folder and launcher are:

```
C:\Users\berns\spa\MoM_Room_Management-TEST\
C:\Users\berns\spa\MoM_Room_Management-TEST\start_server.bat
```

On your computer, replace `berns` with your Windows username (or wherever you cloned the repo). Always run `start_server.bat` from **inside** that project folder so it finds `app.main` and `.env`.
