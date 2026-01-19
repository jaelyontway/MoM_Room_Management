"""Square API client for Bookings operations."""
import logging
from square.client import Square, SquareEnvironment
from config import Config

logger = logging.getLogger(__name__)


class SquareBookingsClient:
    """Client for interacting with Square Bookings API."""
    
    def __init__(self):
        """Initialize Square API client."""
        # Map environment string to SquareEnvironment enum
        if Config.SQUARE_ENVIRONMENT.lower() == 'sandbox':
            environment = SquareEnvironment.SANDBOX
        else:
            environment = SquareEnvironment.PRODUCTION
        
        self.client = Square(
            token=Config.SQUARE_ACCESS_TOKEN,
            environment=environment
        )
        self.bookings_api = self.client.bookings
        self.team_members_api = self.client.team_members
        self.locations_api = self.client.locations
        # Customer API is optional - will be None if not available
        self.customers_api = getattr(self.client, 'customers', None)
        
        # Log Customer API availability
        if self.customers_api:
            logger.info("Customer API is available (CUSTOMERS_READ permission may be required)")
        else:
            logger.warning("Customer API not available - customer names will fall back to customer_note or customer_id")
    
    def get_booking(self, booking_id: str):
        """Retrieve a booking by ID."""
        try:
            result = self.bookings_api.get(booking_id=booking_id)
            # New SDK returns the response object directly
            if hasattr(result, 'body'):
                return result.body.get('booking')
            elif hasattr(result, 'booking'):
                return result.booking
            else:
                return None
        except Exception as e:
            logger.error(f"Exception retrieving booking {booking_id}: {e}")
            return None
    
    def list_bookings(self, start_at_min=None, start_at_max=None, team_member_id=None):
        """List bookings with optional filters."""
        try:
            # Build query parameters
            query_params = {
                'location_id': Config.SQUARE_LOCATION_ID
            }
            if start_at_min:
                query_params['start_at_min'] = start_at_min
            if start_at_max:
                query_params['start_at_max'] = start_at_max
            if team_member_id:
                query_params['team_member_id'] = team_member_id
            
            result = self.bookings_api.list(**query_params)
            
            # New Square SDK returns a SyncPager object
            # Access bookings via the 'items' property (not method)
            # Also check for pagination via iter_pages()
            all_bookings = []
            
            if hasattr(result, 'iter_pages'):
                # Use pagination to get all results
                try:
                    for page in result.iter_pages():
                        if hasattr(page, 'items'):
                            page_items = page.items
                            if isinstance(page_items, list):
                                all_bookings.extend(page_items)
                            else:
                                all_bookings.extend(list(page_items) if page_items else [])
                        elif hasattr(page, 'bookings'):
                            all_bookings.extend(page.bookings or [])
                except Exception as e:
                    logger.warning(f"Error iterating pages, falling back to items: {e}")
                    # Fallback to items property
                    if hasattr(result, 'items'):
                        items = result.items
                        if isinstance(items, list):
                            all_bookings = items
                        else:
                            all_bookings = list(items) if items else []
            elif hasattr(result, 'items'):
                # items is a property that returns a list of bookings
                bookings = result.items
                if isinstance(bookings, list):
                    all_bookings = bookings
                else:
                    # Convert to list if it's iterable
                    all_bookings = list(bookings) if bookings else []
            
            if all_bookings:
                return all_bookings
            elif hasattr(result, 'body'):
                # Fallback: direct response with body
                return result.body.get('bookings', [])
            elif hasattr(result, 'bookings'):
                # Fallback: direct response with bookings attribute
                return result.bookings or []
            else:
                logger.warning(f"Could not parse bookings response: {type(result)}")
                return []
        except Exception as e:
            logger.error(f"Exception listing bookings: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return []
    
    def create_blocked_time(self, team_member_id: str, start_at: str, duration_minutes: int, 
                           appointment_segments=None):
        """Create blocked time for a team member."""
        try:
            # If appointment_segments not provided, create a default one
            if appointment_segments is None:
                appointment_segments = [
                    {
                        'team_member_id': team_member_id,
                        'service_variation_version': 1,
                        'duration_minutes': duration_minutes
                    }
                ]
            
            booking_data = {
                'location_id': Config.SQUARE_LOCATION_ID,
                'start_at': start_at,
                'status': 'ACCEPTED',
                'appointment_segments': appointment_segments
            }
            
            result = self.bookings_api.create(booking=booking_data)
            # New SDK returns the response object directly
            if hasattr(result, 'body'):
                booking = result.body.get('booking')
            elif hasattr(result, 'booking'):
                booking = result.booking
            else:
                booking = None
            
            if booking:
                logger.info(f"Created blocked time for team member {team_member_id}")
                return booking
            else:
                logger.error(f"Error creating blocked time: {result}")
                return None
        except Exception as e:
            logger.error(f"Exception creating blocked time: {e}")
            return None
    
    def cancel_booking(self, booking_id: str, booking_version: int):
        """Cancel a booking."""
        try:
            # Get the current booking to preserve other fields
            current_booking = self.get_booking(booking_id)
            if not current_booking:
                logger.error(f"Cannot cancel booking {booking_id}: booking not found")
                return None
            
            # Cancel booking
            result = self.bookings_api.cancel(
                booking_id=booking_id,
                booking_version=booking_version
            )
            # New SDK returns the response object directly
            if hasattr(result, 'body'):
                booking = result.body.get('booking')
            elif hasattr(result, 'booking'):
                booking = result.booking
            else:
                booking = None
            
            if booking:
                logger.info(f"Cancelled booking {booking_id}")
                return booking
            else:
                logger.error(f"Error cancelling booking: {result}")
                return None
        except Exception as e:
            logger.error(f"Exception cancelling booking: {e}")
            return None
    
    def get_team_members(self):
        """Get all team members (therapists)."""
        try:
            result = self.team_members_api.search(
                query={
                    'filter': {
                        'location_ids': [Config.SQUARE_LOCATION_ID],
                        'status': 'ACTIVE'
                    }
                }
            )
            # New SDK returns the response object directly
            if hasattr(result, 'body'):
                return result.body.get('team_members', [])
            elif hasattr(result, 'team_members'):
                return result.team_members or []
            else:
                return []
        except Exception as e:
            logger.error(f"Exception retrieving team members: {e}")
            return []
    
    def get_available_team_member(self, start_at: str, duration_minutes: int, 
                                  exclude_team_member_id: str):
        """Find an available team member for the given time slot."""
        try:
            from datetime import datetime, timedelta
            from dateutil import parser
            
            # Parse the start time
            start_dt = parser.parse(start_at)
            end_dt = start_dt + timedelta(minutes=duration_minutes)
            
            # Get all team members
            all_members = self.get_team_members()
            
            # Filter to therapists if configured
            if Config.THERAPIST_IDS:
                members = [m for m in all_members if m.get('id') in Config.THERAPIST_IDS]
            else:
                members = all_members
            
            # Exclude the already assigned therapist
            members = [m for m in members if m.get('id') != exclude_team_member_id]
            
            if not members:
                logger.warning("No available therapists found")
                return None
            
            # Check availability for each member
            for member in members:
                member_id = member.get('id')
                
                # Get existing bookings for this member in the time range
                bookings = self.list_bookings(
                    start_at_min=start_at,
                    start_at_max=end_dt.isoformat(),
                    team_member_id=member_id
                )
                
                # Filter out cancelled bookings
                active_bookings = [
                    b for b in bookings 
                    if b.get('status') not in ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED']
                ]
                
                # Check if this member has any conflicts
                has_conflict = False
                for booking in active_bookings:
                    booking_start = parser.parse(booking.get('start_at'))
                    booking_end = booking_start + timedelta(
                        minutes=booking.get('appointment_segments', [{}])[0].get('duration_minutes', 0)
                    )
                    
                    # Check for overlap
                    if not (end_dt <= booking_start or start_dt >= booking_end):
                        has_conflict = True
                        break
                
                if not has_conflict:
                    logger.info(f"Found available therapist: {member_id}")
                    return member
            
            logger.warning("No available therapists found for the time slot")
            return None
            
        except Exception as e:
            logger.error(f"Exception finding available team member: {e}")
            return None
    
    def get_customer(self, customer_id: str):
        """Retrieve a customer by ID."""
        if not self.customers_api or not customer_id:
            logger.debug(f"Customer API not available or no customer_id provided: customers_api={self.customers_api is not None}, customer_id={bool(customer_id)}")
            return None
        
        try:
            # Use 'get' method - returns GetCustomerResponse object
            # GetCustomerResponse has: customer (Customer object or None) and errors (list or None)
            result = self.customers_api.get(customer_id=customer_id)
            
            # Check for errors first
            if hasattr(result, 'errors') and result.errors:
                error_messages = [str(e) for e in result.errors]
                logger.warning(f"Customer API returned errors for {customer_id[:8]}...: {', '.join(error_messages)}")
                return None
            
            # Check if customer data exists
            if hasattr(result, 'customer') and result.customer is not None:
                customer = result.customer
                logger.debug(f"Successfully retrieved customer {customer_id[:8]}...")
                return customer
            else:
                logger.warning(f"Customer API returned no customer data for {customer_id[:8]}... (customer field is None)")
                return None
                
        except AttributeError as e:
            logger.warning(f"Customer API method not available (might need CUSTOMERS_READ permission): {e}")
            return None
        except Exception as e:
            logger.warning(f"Exception retrieving customer {customer_id[:8]}...: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return None
    
    def is_couples_massage(self, booking):
        """Check if a booking is for a couple's massage."""
        try:
            # Handle both dict and Pydantic object formats
            if isinstance(booking, dict):
                segments = booking.get('appointment_segments', [])
            else:
                # Pydantic object - use attribute access
                segments = getattr(booking, 'appointment_segments', []) or []
            
            if not segments:
                return False
            
            # Check by service ID if configured
            if Config.COUPLES_MASSAGE_SERVICE_ID:
                for segment in segments:
                    if isinstance(segment, dict):
                        service_id = segment.get('service_variation_id', '')
                    else:
                        service_id = getattr(segment, 'service_variation_id', '') or ''
                    
                    if service_id == Config.COUPLES_MASSAGE_SERVICE_ID:
                        return True
            
            # Check by service name pattern
            for segment in segments:
                if isinstance(segment, dict):
                    service_name = segment.get('service_variation_name', '').lower()
                else:
                    service_name = (getattr(segment, 'service_variation_name', '') or '').lower()
                
                if Config.COUPLES_MASSAGE_SERVICE_NAME_PATTERN.lower() in service_name:
                    return True
            
            return False
        except Exception as e:
            logger.error(f"Exception checking if couples massage: {e}")
            return False

