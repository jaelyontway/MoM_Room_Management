# Quick Setup Guide - New Computer

## Prerequisites

- Python 3.8+ installed
- Git installed
- Internet connection

## Step 1: Clone the Repository

```bash
git clone https://github.com/jaelyontway/MoM_Room_Management.git
cd MoM_Room_Management
```

Or if you already have the repo:
```bash
cd MoM_Room_Management
git pull origin main
```

## Step 2: Install Python Dependencies

```bash
pip install -r requirements.txt
```

**Note:** On some systems, you may need to use:
- `pip3` instead of `pip`
- `python -m pip install -r requirements.txt`

## Step 3: Set Up Environment Variables

1. Copy the example environment file:
   ```bash
   copy env.example .env
   ```
   (On Linux/Mac: `cp env.example .env`)

2. Edit `.env` file and add your Square API credentials:
   ```
   SQUARE_ACCESS_TOKEN=your_access_token_here
   SQUARE_APPLICATION_ID=your_application_id_here
   SQUARE_LOCATION_ID=your_location_id_here
   SQUARE_ENVIRONMENT=production
   COUPLES_MASSAGE_SERVICE_NAME_PATTERN=couple
   ```

**Important:** If you don't have Square API credentials yet, the app will work with mock data (test data).

## Step 4: Run the Server

### Option 1: Using the run script (Recommended)
```bash
python run_fresh.py
```

### Option 2: Using uvicorn directly
```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Option 3: Using kill ports script first (if port is busy)
```powershell
# On Windows PowerShell
.\kill_ports.ps1
python .\run_fresh.py
```

## Step 5: Access the Dashboard

Open your web browser and navigate to:
- **Dashboard**: http://127.0.0.1:8000/
- **API Docs**: http://127.0.0.1:8000/docs

## Troubleshooting

### Port Already in Use
If port 8000 is busy, the script will automatically try ports 8001-8010, or 9000-9010.

To manually kill processes on ports:
```powershell
# Windows PowerShell
.\kill_ports.ps1

# Or manually:
Get-NetTCPConnection -LocalPort 8000 | Select-Object -ExpandProperty OwningProcess | Stop-Process -Force
```

### Module Not Found Errors
Make sure you're in the project root directory and all dependencies are installed:
```bash
pip install -r requirements.txt
```

### Database Issues
The SQLite database (`room_assignments.db`) will be automatically created on first run. If you encounter issues, you can delete it to reset:
```bash
# Delete the database (on next run, it will be recreated)
del room_assignments.db
```

### Square API Not Working
If Square API is not configured, the app will automatically use mock data. Check the dashboard - it will show "⚠ Using Mock Data" in the header if Square API is not connected.

To verify Square API connection, check:
- `.env` file exists and has correct credentials
- Server logs show "Square API: CONNECTED"
- Dashboard shows "✓ Connected to Real Square API"

## Verification

After starting the server, you should see:
1. Server running on http://127.0.0.1:8000/
2. Calendar grid with therapists listed
3. Appointments showing on the calendar (if any exist for the selected date)

## Next Steps

- Select a date and click "Load Day" to view appointments
- Click on room numbers to manually change room assignments
- The system automatically assigns rooms based on priority rules

