# Square Bookings Sync

Automatically block a second therapist when a couple's massage is booked in Square Appointments.

## 🆕 新功能：房间分配系统

现在包含一个**房间分配管理系统**，可以：
- 自动为所有预约分配房间（1, 3, 4, 5, 6, 0, 2 或 0+2 合并）
- 可视化房间日历视图
- 手动调整房间分配
- 冲突检测和提示

**快速开始房间分配系统**：
```bash
python run_room_dashboard.py
```
然后打开浏览器访问 `http://localhost:5001`

详细说明请查看 [ROOM_ASSIGNMENT_GUIDE.md](ROOM_ASSIGNMENT_GUIDE.md)

---

## Problem

Square Appointments doesn't support multi-staff bookings natively. When customers book a couple's massage online, only one therapist's calendar gets blocked. This solution automatically blocks a second available therapist at the same time.

## Features

- ✅ Detects couple's massage bookings automatically
- ✅ Finds an available therapist for the second booking
- ✅ Creates blocked time for the second therapist
- ✅ Handles cancellations (removes secondary booking)
- ✅ Handles rescheduling (updates secondary booking)
- ✅ Webhook-based (real-time) or polling mode
- ✅ Configurable service identification

## Prerequisites

- Python 3.8 or higher
- Square Developer Account
- Square Appointments enabled
- Square API access token and application ID

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Square API

1. Go to [Square Developer Dashboard](https://developer.squareup.com/)
2. Create a new application or use an existing one
3. Enable the Bookings API in your application
4. Get your Access Token and Application ID
5. Get your Location ID (can be found in your Square Dashboard)

### 3. Configure Environment Variables

Copy `env.example` to `.env` and fill in your values:

```bash
# On Windows (PowerShell):
Copy-Item env.example .env

# On Mac/Linux:
cp env.example .env
```

Required configuration:
- `SQUARE_ACCESS_TOKEN`: Your Square API access token
- `SQUARE_LOCATION_ID`: Your Square location ID
- `SQUARE_ENVIRONMENT`: `sandbox` for testing, `production` for live use

Optional configuration:
- `COUPLES_MASSAGE_SERVICE_ID`: Specific service ID to match (if you know it)
- `COUPLES_MASSAGE_SERVICE_NAME_PATTERN`: Pattern to match in service name (default: "couple")
- `THERAPIST_TEAM_MEMBER_IDS`: Comma-separated list of therapist IDs (leave empty to use all)
- `WEBHOOK_SECRET`: Secret for webhook signature verification (recommended)
- `WEBHOOK_PORT`: Port for webhook server (default: 5000)

### 4. Find Your Service ID (Optional)

To identify couple's massages by service ID, you can run:

```python
from square_client import SquareBookingsClient
client = SquareBookingsClient()

# This will help you find service IDs
# You'll need to check Square's Catalog API or your Square Dashboard
```

Alternatively, you can use the service name pattern matching (default: looks for "couple" in the service name).

### 5. Set Up Webhooks (Recommended)

For real-time processing, set up webhooks:

1. Use a service like [ngrok](https://ngrok.com/) to expose your local server:
   ```bash
   ngrok http 5000
   ```

2. In Square Developer Dashboard:
   - Go to your application
   - Navigate to Webhooks
   - Add webhook URL: `https://your-ngrok-url.ngrok.io/webhook`
   - Subscribe to: `booking.created` and `booking.updated`

3. Run the webhook server:
   ```bash
   python main.py
   ```

### 6. Alternative: Polling Mode

If you can't use webhooks, use polling mode:

```bash
python polling_mode.py
```

This checks for new bookings every 60 seconds. You can modify the poll interval in the code.

## How It Works

1. **Detection**: When a booking is created/updated, the system checks if it's a couple's massage
2. **Identification**: Matches by service ID or service name pattern (default: "couple")
3. **Availability Check**: Finds an available therapist (excluding the one already assigned)
4. **Blocking**: Creates a blocked time appointment for the second therapist
5. **Tracking**: Maintains a mapping between primary and secondary bookings
6. **Cleanup**: Automatically handles cancellations and reschedules

## Testing

### Test in Sandbox

1. Set `SQUARE_ENVIRONMENT=sandbox` in `.env`
2. Use Square's test credentials
3. Create a test couple's massage booking
4. Check logs to verify secondary booking was created

### Test in Production

1. Set `SQUARE_ENVIRONMENT=production` in `.env`
2. Use production credentials
3. Monitor logs carefully
4. Test with a real booking (you may want to cancel it immediately)

## Deployment Options

### Local Machine
- Run `python main.py` for webhook mode
- Use ngrok or similar to expose the webhook endpoint
- Keep the process running (consider using a process manager like PM2 or supervisor)

### Cloud Functions (AWS Lambda, Google Cloud Functions, Azure Functions)
- Package the code as a serverless function
- Set up API Gateway to receive webhooks
- Configure environment variables in the cloud platform

### VPS/Server
- Deploy using systemd service or similar
- Use nginx as reverse proxy
- Set up SSL certificate for webhook endpoint
- Configure firewall rules

### Docker
```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "main.py"]
```

## Troubleshooting

### No secondary booking created
- Check if the booking matches your couple's massage criteria
- Verify therapist availability (check logs)
- Ensure Square API permissions include Bookings API

### Webhook not receiving events
- Verify webhook URL is accessible
- Check Square Developer Dashboard webhook configuration
- Review firewall/network settings
- Check webhook signature verification (if enabled)

### Authentication errors
- Verify `SQUARE_ACCESS_TOKEN` is correct
- Check token hasn't expired
- Ensure correct environment (sandbox vs production)

### No available therapists
- Check if therapists are properly configured in Square
- Verify `THERAPIST_TEAM_MEMBER_IDS` if using specific IDs
- Check for calendar conflicts

## Logging

Logs are written to:
- `square_bookings_sync.log` (webhook mode)
- `square_bookings_sync_polling.log` (polling mode)

Log level can be adjusted in the code (default: INFO).

## Limitations

- This solution creates a "blocked time" appointment, not a duplicate booking
- The secondary booking may appear differently in Square's interface
- Manual bookings in Square Dashboard won't trigger webhooks (use polling mode to catch them)
- Race conditions are possible if multiple bookings happen simultaneously (Square's API handles this)

## Security Notes

- Keep your `.env` file secure and never commit it to version control
- Use webhook signature verification in production
- Store secrets securely (use environment variables or secret management services)
- Regularly rotate API tokens

## Support

For issues:
1. Check the logs for error messages
2. Verify your configuration
3. Test API connectivity with Square's API Explorer
4. Review Square API documentation for any changes

## License

MIT License - feel free to modify and use for your business.

