# Square API Integration Guide

## Setup Steps

### 1. Install Dependencies

Make sure you have the Square SDK installed:
```bash
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Create a `.env` file in the project root (or update your existing one):

```env
# Square API Configuration
SQUARE_ACCESS_TOKEN=your_access_token_here
SQUARE_APPLICATION_ID=your_application_id_here
SQUARE_LOCATION_ID=your_location_id_here
SQUARE_ENVIRONMENT=sandbox
# Options: sandbox, production

# Service Configuration (Optional)
COUPLES_MASSAGE_SERVICE_ID=your_service_id_here
# OR use service name pattern matching:
COUPLES_MASSAGE_SERVICE_NAME_PATTERN=couple

# Therapist Configuration (Optional)
# Comma-separated list of team member IDs to consider
THERAPIST_TEAM_MEMBER_IDS=
```

### 3. Get Your Square API Credentials

1. **Access Token**: 
   - Go to Square Developer Dashboard
   - Navigate to your application
   - Copy the Access Token (Sandbox or Production)

2. **Location ID**:
   - Go to Square Developer Dashboard
   - Navigate to Locations
   - Copy the Location ID you want to use

3. **Application ID**:
   - Found in your Square Developer Dashboard under your application

### 4. Test the Connection

The application will automatically:
- ✅ Use real Square API if credentials are configured
- ✅ Fall back to mock data if credentials are missing or invalid
- ✅ Log warnings if Square API is not available

### 5. Run the Application

```bash
python run.py
```

Then visit: http://127.0.0.1:8000/

## How It Works

1. **Square Service** (`app/square_service.py`):
   - Fetches bookings from Square API
   - Converts Square booking format to our internal format
   - Handles team member names and customer info
   - Detects couple vs single appointments

2. **Automatic Fallback**:
   - If Square API is not configured → uses mock data
   - If Square API fails → logs error and returns empty list
   - Application continues to work either way

3. **Data Mapping**:
   - Square `appointment_segments` → Our `therapist`, `service`, `type`
   - Square `start_at` + `duration_minutes` → Our `start_at`, `end_at`
   - Square `customer_id` / `customer_note` → Our `customer`

## Troubleshooting

### "Square API not configured" warning
- Check your `.env` file exists and has correct values
- Make sure `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` are set
- Verify the token has `BOOKINGS_READ` permission

### "Exception fetching bookings" error
- Check your access token is valid
- Verify location ID is correct
- Check network connection
- Review logs for detailed error messages

### No bookings showing
- Verify you have bookings in Square for the selected date
- Check booking status (cancelled bookings are filtered out)
- Try a different date
- Check Square API response in logs

## Security Notes

- ⚠️ **Never commit `.env` file to git**
- ✅ `.env` is already in `.gitignore`
- ✅ Use sandbox environment for testing
- ✅ Use production environment only when ready

## Next Steps

Once connected, the dashboard will:
- Show real bookings from your Square calendar
- Automatically assign rooms based on priority rules
- Display therapist names from Square
- Filter out cancelled bookings
- Handle couple vs single appointments

