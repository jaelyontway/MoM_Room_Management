"""Test script to check if Customer API is working."""
import logging
from square_client import SquareBookingsClient
from config import Config

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_customer_api():
    """Test if Customer API is accessible."""
    try:
        Config.validate()
        client = SquareBookingsClient()
        
        logger.info("=" * 60)
        logger.info("Testing Square Customer API Access")
        logger.info("=" * 60)
        
        # Check if customers_api is available
        if hasattr(client, 'customers_api') and client.customers_api:
            logger.info("✓ Customer API is initialized")
        else:
            logger.warning("✗ Customer API is NOT available")
            logger.warning("  This usually means:")
            logger.warning("  1. The Square SDK doesn't have 'customers' attribute, OR")
            logger.warning("  2. The CUSTOMERS_READ permission is not enabled in your Square app")
            logger.warning("  3. Your access token doesn't have CUSTOMERS_READ scope")
            return
        
        # Try to list customers (if API supports it) or test retrieve
        logger.info("\nTo test retrieving a specific customer, you need a customer_id")
        logger.info("from a booking. The API should work when fetching bookings.")
        logger.info("\nChecking if customers API has required methods...")
        
        if hasattr(client.customers_api, 'retrieve_customer'):
            logger.info("✓ customers_api.retrieve_customer() method exists")
        else:
            logger.error("✗ customers_api.retrieve_customer() method NOT found")
            logger.error("  Available methods: " + str([m for m in dir(client.customers_api) if not m.startswith('_')]))
        
    except Exception as e:
        logger.error(f"Error testing Customer API: {e}", exc_info=True)

if __name__ == "__main__":
    test_customer_api()

