"""
Alternative polling mode for detecting new bookings.
Use this if you cannot set up webhooks (e.g., local development, firewall issues).
"""
import logging
import time
from datetime import datetime, timedelta
from dateutil import parser
from config import Config
from booking_sync import BookingSync
from square_client import SquareBookingsClient

logger = logging.getLogger(__name__)


class PollingBookingsMonitor:
    """Monitor bookings using polling instead of webhooks."""
    
    def __init__(self, poll_interval_seconds=60):
        """
        Initialize the polling monitor.
        
        Args:
            poll_interval_seconds: How often to check for new bookings (default: 60 seconds)
        """
        self.poll_interval = poll_interval_seconds
        self.booking_sync = BookingSync()
        self.client = SquareBookingsClient()
        self.processed_bookings = set()  # Track processed booking IDs
    
    def poll_bookings(self):
        """Poll for new bookings and process them."""
        try:
            # Get bookings from the last 24 hours and next 7 days
            now = datetime.now()
            start_at_min = (now - timedelta(days=1)).isoformat()
            start_at_max = (now + timedelta(days=7)).isoformat()
            
            bookings = self.client.list_bookings(
                start_at_min=start_at_min,
                start_at_max=start_at_max
            )
            
            logger.info(f"Found {len(bookings)} bookings to check")
            
            for booking in bookings:
                booking_id = booking.get('id')
                booking_status = booking.get('status')
                
                # Skip cancelled/declined bookings
                if booking_status in ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED']:
                    if booking_id in self.processed_bookings:
                        # This was previously active, now cancelled
                        logger.info(f"Detected cancellation for booking {booking_id}")
                        self.booking_sync.process_cancellation(booking_id)
                        self.processed_bookings.discard(booking_id)
                    continue
                
                # Process new bookings
                if booking_id not in self.processed_bookings:
                    logger.info(f"Processing new booking {booking_id}")
                    result = self.booking_sync.process_new_booking(booking_id)
                    if result:
                        self.processed_bookings.add(booking_id)
                else:
                    # Check if booking was rescheduled (compare start times)
                    # This is a simplified check - in production you'd want to store the original start time
                    pass
                    
        except Exception as e:
            logger.error(f"Error polling bookings: {e}", exc_info=True)
    
    def run(self):
        """Run the polling loop."""
        logger.info(f"Starting polling mode (checking every {self.poll_interval} seconds)")
        logger.info("Press Ctrl+C to stop")
        
        try:
            while True:
                self.poll_bookings()
                time.sleep(self.poll_interval)
        except KeyboardInterrupt:
            logger.info("Stopping polling monitor...")


def main():
    """Main entry point for polling mode."""
    import sys
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('square_bookings_sync_polling.log'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    try:
        Config.validate()
        logger.info("Configuration validated successfully")
        
        # Create and run polling monitor
        monitor = PollingBookingsMonitor(poll_interval_seconds=60)
        monitor.run()
        
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()

