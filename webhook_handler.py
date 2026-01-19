"""Webhook handler for Square booking events."""
import logging
import hmac
import hashlib
from flask import Flask, request, jsonify
from config import Config
from booking_sync import BookingSync

logger = logging.getLogger(__name__)

app = Flask(__name__)
booking_sync = BookingSync()


def verify_webhook_signature(payload: bytes, signature: str) -> bool:
    """
    Verify the webhook signature from Square.
    
    Args:
        payload: The raw request body
        signature: The X-Square-Signature header value
        
    Returns:
        True if signature is valid, False otherwise
    """
    if not Config.WEBHOOK_SECRET:
        logger.warning("WEBHOOK_SECRET not configured, skipping signature verification")
        return True
    
    try:
        # Square uses HMAC SHA256
        expected_signature = hmac.new(
            Config.WEBHOOK_SECRET.encode('utf-8'),
            payload,
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(expected_signature, signature)
    except Exception as e:
        logger.error(f"Error verifying webhook signature: {e}")
        return False


@app.route('/webhook', methods=['POST'])
def handle_webhook():
    """Handle incoming webhook events from Square."""
    try:
        # Get the raw payload for signature verification
        payload = request.get_data()
        signature = request.headers.get('X-Square-Signature', '')
        
        # Verify signature if configured
        if Config.WEBHOOK_SECRET and not verify_webhook_signature(payload, signature):
            logger.warning("Invalid webhook signature")
            return jsonify({'error': 'Invalid signature'}), 401
        
        # Parse the JSON payload
        data = request.get_json()
        if not data:
            logger.warning("Received empty webhook payload")
            return jsonify({'error': 'Empty payload'}), 400
        
        # Extract event information
        event_type = data.get('type')
        event_data = data.get('data', {}).get('object', {})
        
        logger.info(f"Received webhook event: {event_type}")
        
        # Handle booking.created events
        if event_type == 'booking.created':
            booking_id = event_data.get('booking', {}).get('id')
            if booking_id:
                logger.info(f"Processing new booking: {booking_id}")
                booking_sync.process_new_booking(booking_id)
            else:
                logger.warning("booking.created event missing booking ID")
        
        # Handle booking.updated events
        elif event_type == 'booking.updated':
            booking_id = event_data.get('booking', {}).get('id')
            booking_status = event_data.get('booking', {}).get('status')
            
            if booking_id:
                if booking_status in ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED']:
                    logger.info(f"Processing cancelled booking: {booking_id}")
                    booking_sync.process_cancellation(booking_id)
                else:
                    # Check if this is a reschedule by comparing start times
                    logger.info(f"Processing updated booking: {booking_id}")
                    booking_sync.process_reschedule(booking_id)
            else:
                logger.warning("booking.updated event missing booking ID")
        
        # Return success response
        return jsonify({'status': 'success'}), 200
        
    except Exception as e:
        logger.error(f"Error handling webhook: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'healthy'}), 200


def run_webhook_server():
    """Run the webhook server."""
    logger.info(f"Starting webhook server on port {Config.WEBHOOK_PORT}")
    app.run(
        host='0.0.0.0',
        port=Config.WEBHOOK_PORT,
        debug=False
    )

