# Quick Start Guide

## 1. Install Dependencies

```bash
pip install -r requirements.txt
```

## 2. Set Up Configuration

1. Copy the example environment file:
   ```bash
   # Windows PowerShell:
   Copy-Item env.example .env
   
   # Mac/Linux:
   cp env.example .env
   ```

2. Edit `.env` and add your Square API credentials:
   - `SQUARE_ACCESS_TOKEN`: Get from Square Developer Dashboard
   - `SQUARE_LOCATION_ID`: Get from Square Dashboard (Settings > Locations)
   - `SQUARE_ENVIRONMENT`: Use `sandbox` for testing, `production` for live

## 3. Test Your Configuration

Run a quick test to verify your API connection:
```python
python -c "from config import Config; Config.validate(); print('Config OK!')"
```

## 4. Choose Your Mode

### Option A: Webhook Mode (Recommended for Production)

1. **Expose your local server** (for testing):
   - Install ngrok: https://ngrok.com/
   - Run: `ngrok http 5000`
   - Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

2. **Configure Square Webhooks**:
   - Go to Square Developer Dashboard > Your App > Webhooks
   - Add webhook URL: `https://your-ngrok-url.ngrok.io/webhook`
   - Subscribe to: `booking.created` and `booking.updated`
   - Save the webhook signature (add to `.env` as `WEBHOOK_SECRET`)

3. **Start the server**:
   ```bash
   python main.py
   ```

### Option B: Polling Mode (Good for Testing)

If you can't set up webhooks, use polling mode:

```bash
python polling_mode.py
```

This checks for new bookings every 60 seconds.

## 5. Test It

1. In Square Appointments, create a test booking for a "Couple's Massage"
2. Check the logs - you should see:
   - Detection of the couple's massage
   - Finding an available therapist
   - Creating a secondary booking

3. Check Square Appointments - you should see both therapists blocked

## Troubleshooting

- **No secondary booking created?**
  - Check logs for errors
  - Verify the service name contains "couple" (or update `COUPLES_MASSAGE_SERVICE_NAME_PATTERN`)
  - Ensure therapists are available

- **Authentication errors?**
  - Verify your `SQUARE_ACCESS_TOKEN` is correct
  - Check you're using the right environment (sandbox vs production)

- **Webhook not receiving events?**
  - Verify ngrok is running and URL is accessible
  - Check Square Developer Dashboard webhook configuration
  - Review firewall settings

