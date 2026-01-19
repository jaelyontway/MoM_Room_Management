# Troubleshooting: No Bookings Found

## The Problem
Your Square API connection is working (we found 27 team members), but no bookings are showing up.

## Possible Causes

### 1. Square Appointments vs Square Bookings API
Square has **TWO different systems**:
- **Square Appointments** (older system) - Used by many businesses
- **Square Bookings API** (newer API) - Part of the Square Developer Platform

**If your appointments are in Square Appointments, they won't appear in the Bookings API.**

### 2. Missing API Permissions
Your API token might not have the `BOOKINGS_READ` permission.

### 3. Wrong Location ID
The location ID might not match where your appointments are stored.

## How to Fix

### Step 1: Check Your Square App Type
1. Go to: https://developer.squareup.com/apps
2. Click on your application
3. Check the **Permissions** section
4. Look for: `BOOKINGS_READ` or `APPOINTMENTS_READ`

### Step 2: Verify Location ID
1. In Square Developer Dashboard, go to your app
2. Check the **Locations** section
3. Verify the Location ID matches: `L72T81FV9YPDT`

### Step 3: Check Which System You're Using
**If you're using Square Appointments:**
- You need to use the **Square Appointments API** (different from Bookings API)
- The code would need to be updated to use Appointments API instead

**If you're using Square Bookings:**
- Make sure your app has `BOOKINGS_READ` permission
- Check that appointments are created in the Square Bookings system (not Appointments)

### Step 4: Test in Square Dashboard
1. Log into your Square Dashboard
2. Go to Appointments/Bookings
3. Check if appointments show up there
4. Note which system you're using (Appointments vs Bookings)

## Quick Check Commands

```bash
# Test API connection
python test_square_connection.py

# Debug bookings
python debug_bookings.py

# Check all bookings
python check_all_bookings.py
```

## Next Steps

**If you're using Square Appointments:**
- The current code uses Bookings API
- You may need to switch to Appointments API
- Or migrate your appointments to Square Bookings

**If you're using Square Bookings:**
- Verify `BOOKINGS_READ` permission is enabled
- Check that appointments exist in Square Dashboard
- Verify the location ID is correct

## Need Help?
1. Check your Square Developer Dashboard permissions
2. Verify which system your appointments are in
3. Confirm the location ID matches your business location

