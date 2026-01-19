# Setup Instructions - Production Square API

## Step 1: Create .env File

Create a file named `.env` in the project root directory with these contents:

```env
# Square API Configuration - PRODUCTION
SQUARE_ACCESS_TOKEN=EAAAloJo5lQHMs52re0UCZAQm0RfAekBDprx9pBwFihiWRdK_dDa3s-y-NM4MY2G
SQUARE_APPLICATION_ID=sq0idp-OkGYrKxpsxd_FD0hG_eslg
SQUARE_LOCATION_ID=L72T81FV9YPDT
SQUARE_ENVIRONMENT=production

# Webhook Configuration
WEBHOOK_SECRET=your_webhook_secret_here
WEBHOOK_PORT=5000

# Service Configuration
COUPLES_MASSAGE_SERVICE_ID=your_couples_massage_service_id_here
COUPLES_MASSAGE_SERVICE_NAME_PATTERN=couple

# Therapist Configuration
THERAPIST_TEAM_MEMBER_IDS=
```

**How to create the file:**
- In VS Code: Right-click in the file explorer → New File → Name it `.env`
- Or use any text editor and save it as `.env` in the project root

## Step 2: Verify Configuration

Run this command to test your Square API connection:

```bash
python test_square_connection.py
```

You should see:
- ✅ Configuration valid
- ✅ Square service initialized
- ✅ Found team members
- ✅ API is connected and working

## Step 3: Start the Server

Run this command to start the web dashboard:

```bash
python run.py
```

You should see output like:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:app.main:============================================================
INFO:app.main:Square API: CONNECTED (Using Real API)
INFO:app.main:============================================================
```

## Step 4: Open the Dashboard

1. Open your web browser
2. Go to: **http://127.0.0.1:8000**
3. You should see:
   - ✅ "Connected to Real Square API" (green status at top)
   - Real bookings from your Square account

## Step 5: Check Status (Optional)

Visit this URL to verify the API is working:
- **http://127.0.0.1:8000/api/status**

Should return:
```json
{
  "using_real_api": true,
  "square_configured": true,
  "message": "Using real Square API",
  "environment": "production"
}
```

## Troubleshooting

If you see "Using Mock Data":

1. **Check .env file exists** - Make sure `.env` is in the project root (same folder as `run.py`)

2. **Verify credentials** - Run:
   ```bash
   python test_square_connection.py
   ```

3. **Restart the server** - Stop it (Ctrl+C) and run `python run.py` again

4. **Check server logs** - Look for "Square API: CONNECTED" message when starting

## Quick Commands Summary

```bash
# Test API connection
python test_square_connection.py

# Start the server
python run.py

# Verify server config
python verify_server_config.py
```

