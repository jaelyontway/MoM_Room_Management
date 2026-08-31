"""Test fetching customer names from actual bookings."""
import logging
from datetime import datetime, timedelta
from square_client import SquareBookingsClient
from app.square_service import SquareService
from config import Config

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def test_customer_fetch():
    """Test fetching customers from real bookings."""
    try:
        Config.validate()
        service = SquareService()
        
        if not service.client:
            logger.error("Square service client is None - check configuration")
            return
        
        logger.info("=" * 60)
        logger.info("Testing Customer Name Retrieval from Bookings")
        logger.info("=" * 60)
        
        # Get today's date
        today = datetime.now().strftime('%Y-%m-%d')
        logger.info(f"Fetching bookings for date: {today}")
        
        # Get bookings for today
        bookings = service.get_bookings_for_date(today)
        
        if not bookings:
            logger.warning(f"No bookings found for {today}")
            logger.info("Trying tomorrow's date...")
            tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
            bookings = service.get_bookings_for_date(tomorrow)
        
        if not bookings:
            logger.warning(f"No bookings found for {today} or tomorrow")
            logger.info("Please ensure you have bookings in Square for these dates")
            return
        
        logger.info(f"Found {len(bookings)} bookings")
        logger.info("")
        
        # Test customer name retrieval for each booking
        for i, booking in enumerate(bookings[:5], 1):  # Test first 5 bookings
            logger.info(f"--- Booking {i} ---")
            logger.info(f"Booking ID: {booking.get('id', 'N/A')[:20]}...")
            logger.info(f"Therapist: {booking.get('therapist', 'N/A')}")
            logger.info(f"Service: {booking.get('service', 'N/A')}")
            logger.info(f"Customer Display: {booking.get('customer', 'N/A')}")
            
            # Get the raw booking to check customer_id
            if service.client and hasattr(service.client, 'get_booking'):
                raw_booking = service.client.get_booking(booking.get('id'))
                if raw_booking:
                    if isinstance(raw_booking, dict):
                        customer_id = raw_booking.get('customer_id', '')
                    else:
                        customer_id = getattr(raw_booking, 'customer_id', '') or ''
                    
                    logger.info(f"Customer ID from raw booking: {customer_id[:20] if customer_id else 'None'}...")
                    
                    if customer_id:
                        # Try to fetch customer directly
                        customer = service.client.get_customer(customer_id)
                        if customer:
                            logger.info(f"✓ Successfully fetched customer data:")
                            logger.info(f"  - ID: {getattr(customer, 'id', 'N/A')[:20]}...")
                            logger.info(f"  - Given Name: {getattr(customer, 'given_name', 'N/A')}")
                            logger.info(f"  - Family Name: {getattr(customer, 'family_name', 'N/A')}")
                            logger.info(f"  - Email: {getattr(customer, 'email_address', 'N/A')}")
                            logger.info(f"  - Phone: {getattr(customer, 'phone_number', 'N/A')}")
                        else:
                            logger.warning(f"✗ Could not fetch customer data for ID {customer_id[:20]}...")
                    else:
                        logger.warning("✗ No customer_id in booking")
            
            logger.info("")
        
    except Exception as e:
        logger.error(f"Error testing customer fetch: {e}", exc_info=True)

if __name__ == "__main__":
    test_customer_fetch()

