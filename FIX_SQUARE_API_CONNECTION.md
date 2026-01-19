# Fix: Using Mock Data Instead of Real Square API

If your dashboard shows "⚠ Using Mock Data (Square API not configured)" instead of "✓ Connected to Real Square API", follow these steps:

## Step 1: Check if .env File Exists

In the project root directory, verify you have a `.env` file:

```bash
# Windows
dir .env

# Linux/Mac
ls -la .env
```

If the file doesn't exist, create it:

```bash
# Windows
copy env.example .env

# Linux/Mac
cp env.example .env
```

## Step 2: Configure .env File

Open the `.env` file in a text editor and add your Square API credentials:

```env
# Required: Square API Credentials
SQUARE_ACCESS_TOKEN=your_production_access_token_here
SQUARE_APPLICATION_ID=your_application_id_here
SQUARE_LOCATION_ID=your_location_id_here
SQUARE_ENVIRONMENT=production

# Optional: Service Configuration
COUPLES_MASSAGE_SERVICE_NAME_PATTERN=couple
```

### Required Variables:

1. **SQUARE_ACCESS_TOKEN**: Your Square API access token (starts with `EAAAl...`)
2. **SQUARE_LOCATION_ID**: Your Square location ID (starts with `L...`)
3. **SQUARE_ENVIRONMENT**: Either `production` or `sandbox`

### Where to Find These Values:

1. **Square Developer Portal**: https://developer.squareup.com/
2. **Access Token**: 
   - Go to your application
   - Click "Production" or "Sandbox"
   - Copy the "Access Token"
3. **Location ID**:
   - Go to Square Dashboard → Locations
   - Or use API: https://developer.squareup.com/reference/square/locations-api/list-locations

## Step 3: Verify .env File Format

Make sure your `.env` file has:
- ✅ No spaces around the `=` sign
- ✅ No quotes around values (unless the value contains special characters)
- ✅ No extra spaces at the end of lines
- ✅ File is saved as `.env` (not `.env.txt`)

**Correct format:**
```env
SQUARE_ACCESS_TOKEN=EAAAl9J5MxVbwhLqEgrFN-ClezNZ6VV7Lw2KXgc3_lHWgAgAPtAco0MVCrNbt1ZK
SQUARE_LOCATION_ID=L72T81FV9YPDT
SQUARE_ENVIRONMENT=production
```

**Incorrect format:**
```env
SQUARE_ACCESS_TOKEN = "EAAAl..."  # ❌ Spaces and quotes
SQUARE_ACCESS_TOKEN=EAAAl...     # ❌ Extra spaces
```

## Step 4: Restart the Server

**IMPORTANT:** After modifying `.env`, you MUST restart the server:

1. Stop the current server (Ctrl+C in the terminal)
2. Start it again:
   ```bash
   python run_fresh.py
   ```

The server loads environment variables only at startup. Changes to `.env` won't take effect until you restart.

## Step 5: Verify Connection

After restarting, check the server logs. You should see:

**✅ Success:**
```
INFO:app.main:============================================================
INFO:app.main:Square API: CONNECTED (Using Real API)
INFO:app.main:============================================================
```

**❌ Failure:**
```
WARNING:app.main:============================================================
WARNING:app.main:Square API: NOT CONFIGURED (Using Mock Data)
WARNING:app.main:Check your .env file and restart the server
WARNING:app.main:============================================================
```

Also check the dashboard header - it should show:
- ✅ "✓ Connected to Real Square API" (green badge)
- ❌ "⚠ Using Mock Data (Square API not configured)" (yellow badge)

## Step 6: Troubleshooting

### Issue: Still shows Mock Data after restart

**Check 1: File Location**
- Ensure `.env` is in the project root directory (same folder as `app/`, `static/`, etc.)
- Not in a subdirectory

**Check 2: File Encoding**
- Save `.env` as UTF-8 encoding (not UTF-16 or other)
- Some editors (like Notepad) might save with wrong encoding

**Check 3: Check Server Logs**
Look for error messages like:
```
WARNING:app.square_service:Square API not configured: ...
```

This will tell you which variable is missing or incorrect.

**Check 4: Test Configuration**
Run this Python command to test:
```python
from dotenv import load_dotenv
import os

load_dotenv()
print("ACCESS_TOKEN:", os.getenv('SQUARE_ACCESS_TOKEN', 'NOT FOUND'))
print("LOCATION_ID:", os.getenv('SQUARE_LOCATION_ID', 'NOT FOUND'))
print("ENVIRONMENT:", os.getenv('SQUARE_ENVIRONMENT', 'NOT FOUND'))
```

If any show "NOT FOUND", the `.env` file isn't being loaded correctly.

**Check 5: Verify Credentials**
- Double-check you copied the correct values
- Ensure no extra spaces or line breaks
- For Production token, make sure you're using the Production token (not Sandbox)

### Issue: API Errors

If you see errors like "401 Unauthorized" or "403 Forbidden":
- Verify your access token is correct and not expired
- Check that your token has the required permissions:
  - `BOOKINGS_READ`
  - `CUSTOMERS_READ` (optional, for customer names)
  - `CATALOG_READ` (optional, for service names)
  - `TEAM_READ` (for therapist names)

### Issue: No Appointments Showing

Even with real API connected, if no appointments show:
- Check the date you're viewing (appointments might be on a different date)
- Verify there are actual bookings in Square for that date
- Check server logs for any API errors

## Quick Checklist

- [ ] `.env` file exists in project root
- [ ] `.env` contains `SQUARE_ACCESS_TOKEN`
- [ ] `.env` contains `SQUARE_LOCATION_ID`
- [ ] `.env` contains `SQUARE_ENVIRONMENT=production`
- [ ] No spaces around `=` in `.env`
- [ ] File saved and closed
- [ ] Server restarted after editing `.env`
- [ ] Server logs show "Square API: CONNECTED"
- [ ] Dashboard shows green "✓ Connected to Real Square API" badge

## Getting Help

If you still have issues after following these steps:
1. Check server logs for specific error messages
2. Verify your Square API credentials in the Square Developer Portal
3. Test your credentials using Square's API Explorer: https://developer.squareup.com/docs/build-basics/using-rest-apis

