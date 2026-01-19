# Square API Requirements - Complete Guide

## What You Need to Get Real Data from Square

### 1. **Required API Permissions (OAuth Scopes)**

Your Square Access Token needs these permissions:

#### ✅ **Currently Used:**
- `BOOKINGS_READ` - To fetch appointments/bookings
- `TEAM_READ` - To get team member (therapist) names
- `MERCHANT_PROFILE_READ` - To access location information

#### ⚠️ **Optional but Recommended:**
- `CUSTOMERS_READ` - To get customer names (currently using customer_note as fallback)
- `CATALOG_READ` - To get detailed service information

### 2. **Required Configuration (.env file)**

```env
# REQUIRED - Minimum to get bookings
SQUARE_ACCESS_TOKEN=your_access_token
SQUARE_LOCATION_ID=your_location_id
SQUARE_ENVIRONMENT=sandbox  # or production

# OPTIONAL - For better data
SQUARE_APPLICATION_ID=your_app_id  # Not strictly required but good to have
COUPLES_MASSAGE_SERVICE_NAME_PATTERN=couple  # To identify couple bookings
```

### 3. **What Data We Currently Fetch**

✅ **Working:**
- **Bookings/Appointments** - All appointments for a date
- **Start/End Times** - From `start_at` + `duration_minutes`
- **Therapist Names** - From Team Members API
- **Service Names** - From `service_variation_name` in booking segments
- **Booking Status** - Filters out cancelled bookings
- **Booking Type** - Detects couple vs single (by service name pattern)

⚠️ **Limited:**
- **Customer Names** - Currently uses `customer_note` or shows "Customer {id}"
  - To get real names, need `CUSTOMERS_READ` permission + Customer API

### 4. **How to Get Complete Customer Information**

To get real customer names instead of IDs:

1. **Enable Customer API in Square Developer Dashboard:**
   - Go to your application
   - Enable `CUSTOMERS_READ` scope
   - Regenerate access token if needed

2. **The code will automatically use it** (I'll add this feature)

### 5. **What Information Comes from Square Bookings API**

From `list_bookings()` we get:
- `id` - Booking ID
- `start_at` - Start time (ISO format)
- `appointment_segments[]` - Array with:
  - `team_member_id` - Therapist ID
  - `service_variation_id` - Service ID
  - `service_variation_name` - Service name (e.g., "Swedish Massage")
  - `duration_minutes` - Appointment duration
- `customer_id` - Customer ID (if available)
- `customer_note` - Customer note/name (if set)
- `status` - Booking status (ACCEPTED, CANCELLED, etc.)

### 6. **What Information Comes from Team Members API**

From `get_team_members()` we get:
- `id` - Team member ID
- `given_name` - First name
- `family_name` - Last name
- `display_name` - Display name

### 7. **Missing Information (Optional Enhancements)**

These would require additional API calls:

- **Customer Full Details** - Need Customer API
  - Full name, email, phone
  - Currently: We use `customer_note` or show ID

- **Service Details** - Need Catalog API
  - Service description, pricing
  - Currently: We use `service_variation_name` from booking

- **Location Details** - Already have location_id
  - Location name, address
  - Currently: Not needed for room assignment

## Quick Checklist

- [ ] Square Access Token with `BOOKINGS_READ` permission
- [ ] Square Location ID
- [ ] `.env` file configured
- [ ] Square SDK installed (`pip install squareup`)
- [ ] Test connection (run app and check logs)

## Testing Your Setup

1. **Check if Square API is connected:**
   ```bash
   python -c "from app.square_service import SquareService; s = SquareService(); print('Connected:', s.client is not None)"
   ```

2. **Test fetching bookings:**
   - Run the app: `python run.py`
   - Visit: http://127.0.0.1:8000/
   - Select a date with bookings
   - Check browser console and server logs

3. **Check logs for errors:**
   - Look for "Square API client initialized successfully"
   - Check for any permission errors
   - Verify bookings are being fetched

## Common Issues

### "Square API not configured"
- Check `.env` file exists
- Verify `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` are set
- Make sure no extra spaces in values

### "Permission denied" errors
- Your access token needs `BOOKINGS_READ` scope
- Regenerate token in Square Developer Dashboard
- Make sure token is for correct environment (sandbox/production)

### "No bookings found"
- Verify you have bookings in Square for that date
- Check booking status (cancelled bookings are filtered)
- Verify location_id is correct
- Check timezone - bookings might be in different timezone

### "Customer names showing as IDs"
- This is normal if `CUSTOMERS_READ` permission not enabled
- Customer names will show from `customer_note` if available
- To get real names, enable Customer API (see section 4)

