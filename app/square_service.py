"""Square API service adapter for FastAPI app."""
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from dateutil import parser, tz as dateutil_tz

# Import from parent directory
import sys
import os
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

try:
    from square_client import SquareBookingsClient
    from config import Config
    SQUARE_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Square client not available: {e}")
    SQUARE_AVAILABLE = False
    SquareBookingsClient = None
    Config = None

logger = logging.getLogger(__name__)


class SquareService:
    """Service to fetch and convert Square bookings to our format."""
    
    def __init__(self):
        """Initialize Square service."""
        if not SQUARE_AVAILABLE:
            logger.warning("Square client modules not available. Using mock data.")
            self.client = None
            self._team_members_cache = {}
            self._catalog_name_cache = {}
            self._customer_name_cache = {}
            return
        
        try:
            Config.validate()
            self.client = SquareBookingsClient()
            self._team_members_cache = {}
            self._catalog_name_cache = {}
            self._customer_name_cache = {}
            logger.info("Square API client initialized successfully")
        except (ValueError, AttributeError) as e:
            logger.warning(f"Square API not configured: {e}. Using mock data.")
            self.client = None
            self._team_members_cache = {}
            self._catalog_name_cache = {}
            self._customer_name_cache = {}
    
    def get_team_member_name(self, team_member_id: str) -> str:
        """Get team member name by ID, with caching."""
        if not self.client:
            return team_member_id
        
        if team_member_id in self._team_members_cache:
            return self._team_members_cache[team_member_id]
        
        try:
            team_members = self.client.get_team_members()
            for member in team_members:
                # Handle both dict and Square SDK object formats
                if isinstance(member, dict):
                    member_id = member.get('id', '')
                    given = member.get('given_name', '')
                    family = member.get('family_name', '')
                    display = member.get('display_name', '')
                else:
                    # Square SDK object
                    member_id = getattr(member, 'id', '') or ''
                    given = getattr(member, 'given_name', '') or ''
                    family = getattr(member, 'family_name', '') or ''
                    display = getattr(member, 'display_name', '') or ''
                
                if member_id == team_member_id:
                    name = f"{given} {family}".strip() or display or team_member_id
                    self._team_members_cache[team_member_id] = name
                    return name
        except Exception as e:
            logger.error(f"Error fetching team member {team_member_id}: {e}")
        
        return team_member_id
    
    def get_customer_name(self, booking: Dict) -> str:
        """Extract customer name from booking, with caching."""
        # Handle both dict and Square SDK object formats
        if isinstance(booking, dict):
            customer_id = booking.get('customer_id', '')
            customer_note = booking.get('customer_note', '')
        else:
            customer_id = getattr(booking, 'customer_id', '') or ''
            customer_note = getattr(booking, 'customer_note', '') or ''
        
        # Check cache first
        if customer_id and customer_id in self._customer_name_cache:
            logger.debug(f"Using cached customer name for {customer_id[:8]}...")
            return self._customer_name_cache[customer_id]
        
        # Log what we have
        logger.debug(f"[CUSTOMER] Processing booking - customer_id: {customer_id[:8] if customer_id else 'None'}..., customer_note: {customer_note[:20] if customer_note else 'None'}...")
        
        # Try to fetch customer name from Customer API if available
        if customer_id and self.client:
            # Check if customer API is available
            if not hasattr(self.client, 'customers_api') or not self.client.customers_api:
                logger.debug(f"[CUSTOMER] Customer API not available for {customer_id[:8]}... - will use fallback (customers_api={hasattr(self.client, 'customers_api')})")
            else:
                try:
                    logger.info(f"[CUSTOMER] Attempting to fetch customer name for ID {customer_id[:8]}...")
                    customer = self.client.get_customer(customer_id)
                    
                    if customer:
                        logger.info(f"[CUSTOMER] Successfully retrieved customer data for {customer_id[:8]}...")
                        # Customer is a Pydantic model object in new Square SDK
                        # Fields are accessed as attributes: customer.given_name, customer.email_address (direct string)
                        given_name = getattr(customer, 'given_name', None) or ''
                        family_name = getattr(customer, 'family_name', None) or ''
                        # In new SDK, email_address and phone_number are direct strings, not objects
                        email = getattr(customer, 'email_address', None) or ''
                        phone = getattr(customer, 'phone_number', None) or ''
                        
                        logger.debug(f"[CUSTOMER] Extracted - given: '{given_name}', family: '{family_name}', email: '{email[:20] if email else 'None'}...', phone: '{phone[:15] if phone else 'None'}...'")
                        
                        # Prefer full name
                        if given_name or family_name:
                            name = f"{given_name} {family_name}".strip()
                            if name:
                                self._customer_name_cache[customer_id] = name
                                logger.info(f"[CUSTOMER] ✓ Using customer name: {name} for ID {customer_id[:8]}...")
                                return name
                        
                        # Fallback to email
                        if email:
                            self._customer_name_cache[customer_id] = email
                            logger.info(f"[CUSTOMER] ✓ Using customer email: {email[:20]}... for ID {customer_id[:8]}...")
                            return email
                        
                        # Fallback to phone
                        if phone:
                            self._customer_name_cache[customer_id] = phone
                            logger.info(f"[CUSTOMER] ✓ Using customer phone: {phone[:15]}... for ID {customer_id[:8]}...")
                            return phone
                        
                        logger.warning(f"[CUSTOMER] Customer data retrieved but no name/email/phone found for {customer_id[:8]}...")
                    else:
                        logger.info(f"[CUSTOMER] Customer API returned None for {customer_id[:8]}... (may need CUSTOMERS_READ permission)")
                        
                except Exception as e:
                    # Customer API not available or failed - use fallback
                    logger.warning(f"[CUSTOMER] Exception fetching customer {customer_id[:8]}...: {e}")
                    import traceback
                    logger.debug(traceback.format_exc())
        
        # Fallback: use customer_note or customer_id
        if customer_note:
            result = customer_note
            if customer_id:
                self._customer_name_cache[customer_id] = result
            logger.info(f"[CUSTOMER] Using customer_note: {customer_note[:30]}... for ID {customer_id[:8] if customer_id else 'None'}...")
            return result
        elif customer_id:
            result = f"Customer {customer_id[:8]}"
            self._customer_name_cache[customer_id] = result
            logger.info(f"[CUSTOMER] Using fallback customer ID display for {customer_id[:8]}...")
            return result
        else:
            logger.warning("[CUSTOMER] No customer_id or customer_note found - using 'Unknown Customer'")
            return "Unknown Customer"
    
    def get_service_name(self, booking: Dict) -> str:
        """Extract service name(s) from booking. Returns all services if multiple."""
        # Handle both dict and Square SDK object formats
        if isinstance(booking, dict):
            segments = booking.get('appointment_segments', [])
        else:
            # Pydantic object or Square SDK object
            segments = getattr(booking, 'appointment_segments', []) or []
        
        if not segments:
            logger.warning("No appointment_segments found in booking")
            return "Unknown Service"
        
        # Collect all service names from all segments
        service_names = []
        
        for segment_idx, segment in enumerate(segments):
            # 1) Try direct name on segment (if Square API returned it)
            if isinstance(segment, dict):
                service_name = segment.get('service_variation_name', '') or ''
                service_variation_id = segment.get('service_variation_id', '') or ''
            else:
                # Pydantic object or SDK object - use attribute access first
                service_name = getattr(segment, 'service_variation_name', '') or ''
                service_variation_id = getattr(segment, 'service_variation_id', '') or ''
                # If still empty, try model_dump() for Pydantic v2
                if hasattr(segment, 'model_dump'):
                    seg_dict = segment.model_dump()
                    service_name = service_name or seg_dict.get('service_variation_name', '') or ''
                    service_variation_id = service_variation_id or seg_dict.get('service_variation_id', '') or ''
            
            logger.debug(f"[SERVICE NAME] Segment {segment_idx} has service_variation_name: '{service_name}', service_variation_id: '{service_variation_id}'")
            
            if service_name:
                logger.debug(f"[SERVICE NAME] ✓ Found service name directly from segment {segment_idx}: {service_name}")
                service_names.append(service_name)
            elif service_variation_id:
                # 2) If name not present, look up via Catalog using variation id
                logger.debug(f"[SERVICE NAME] Looking up service name from catalog for variation_id: {service_variation_id}")
                looked_up = self._get_service_name_from_catalog(service_variation_id)
                if looked_up:
                    logger.debug(f"[SERVICE NAME] ✓ Found service name from catalog: {looked_up}")
                    service_names.append(looked_up)
                else:
                    logger.warning(f"[SERVICE NAME] ✗ Could not find service name for variation_id: {service_variation_id}")
            else:
                logger.warning(f"No service_variation_id found in segment {segment_idx}")
        
        if not service_names:
            logger.warning("No service names found in any segment")
            return "Unknown Service"
        
        # Return all service names joined with comma
        if len(service_names) == 1:
            logger.info(f"[SERVICE NAME] Single service: {service_names[0]}")
            return service_names[0]
        else:
            combined = ", ".join(service_names)
            logger.info(f"[SERVICE NAME] Multiple services ({len(service_names)}): {combined}")
            return combined
    
    def _get_service_name_from_catalog(self, variation_id: str) -> str:
        """Lookup service variation name via Catalog API (with cache)."""
        if not self.client or not variation_id:
            logger.debug("Catalog lookup skipped: client or variation_id missing")
            return ""
        
        # Cache check
        if variation_id in self._catalog_name_cache:
            logger.debug(f"Returning cached service name for {variation_id}: {self._catalog_name_cache[variation_id]}")
            return self._catalog_name_cache[variation_id]
        
        try:
            # Access underlying Square SDK client
            if not hasattr(self.client, 'client'):
                logger.warning("Square client does not have 'client' attribute")
                return ""
            
            if not hasattr(self.client.client, 'catalog'):
                logger.warning("Square SDK client does not have 'catalog' API - CATALOG_READ permission may be missing")
                return ""
            
            catalog_api = self.client.client.catalog
            
            # Helper function to extract attributes from objects/dicts
            def get_attr(o, key, default=""):
                if o is None:
                    return default
                if isinstance(o, dict):
                    val = o.get(key, default)
                    # If default is empty string and we got a dict/None, return empty string
                    if isinstance(default, str) and default == "" and (val is None or isinstance(val, dict)):
                        return default if val is None else val
                    return val
                val = getattr(o, key, default)
                # Handle None values when default is empty string
                if isinstance(default, str) and default == "" and val is None:
                    return default
                return val or default
            
            # Try to retrieve the catalog object with related objects included
            # This helps when the variation references a parent item
            result = None
            try:
                # Use catalog.object.get() - the correct Square SDK method
                if hasattr(catalog_api, 'object') and hasattr(catalog_api.object, 'get'):
                    result = catalog_api.object.get(object_id=variation_id, include_related_objects=True)
                    logger.debug(f"Catalog API call successful with include_related_objects=True")
                else:
                    logger.error("Catalog API does not have object.get() method")
                    return ""
            except Exception as e:
                try:
                    # Try without include_related_objects
                    result = catalog_api.object.get(object_id=variation_id)
                    logger.debug(f"Catalog API call successful without include_related_objects")
                except Exception as e2:
                    logger.error(f"Catalog API call failed: {e}, {e2}")
                    return ""
                
            if result is None:
                logger.warning(f"Catalog API returned None for variation_id: {variation_id}")
                return ""
            
            # Handle various response formats
            obj = None
            related_objects = []
            
            if hasattr(result, 'body'):
                if isinstance(result.body, dict):
                    obj = result.body.get('object')
                    related_objects = result.body.get('related_objects', [])
                else:
                    # result.body might be an object with attributes
                    obj = getattr(result.body, 'object', None)
                    related_objects = getattr(result.body, 'related_objects', []) or []
            elif hasattr(result, 'object'):
                obj = result.object
                related_objects = getattr(result, 'related_objects', []) or []
            elif isinstance(result, dict):
                obj = result.get('object')
                related_objects = result.get('related_objects', [])
            else:
                # Try to access as if result itself is the object
                logger.debug(f"[CATALOG DEBUG] Trying result as object directly")
                obj = result
            
            # Log the raw result structure for debugging
            if variation_id not in self._catalog_name_cache:
                logger.info(f"[CATALOG DEBUG] Raw result type: {type(result)}")
                if hasattr(result, '__dict__'):
                    logger.info(f"[CATALOG DEBUG] Result attributes: {list(result.__dict__.keys())[:10]}")
                if hasattr(result, 'body'):
                    logger.debug(f"[CATALOG DEBUG] Result has 'body' attribute")
                if hasattr(result, 'object'):
                    logger.debug(f"[CATALOG DEBUG] Result has 'object' attribute directly")
            
            if obj is None:
                logger.warning(f"[CATALOG DEBUG] Could not extract object from result for variation_id: {variation_id}")
                # Try to log what we actually got
                try:
                    result_str = str(result)[:500]
                    logger.warning(f"[CATALOG DEBUG] Result content (first 500 chars): {result_str}")
                except:
                    pass
                return ""
            
            if obj:
                    obj_type = get_attr(obj, 'type', '')
                    logger.info(f"[CATALOG DEBUG] Retrieved object type: {obj_type} for variation_id: {variation_id}")
                    
                    # Log the full object structure for debugging (first time only)
                    if variation_id not in self._catalog_name_cache:
                        try:
                            import json
                            if isinstance(obj, dict):
                                obj_str = json.dumps(obj, indent=2, default=str)
                            else:
                                # Try to convert object to dict
                                obj_dict = {}
                                for attr in dir(obj):
                                    if not attr.startswith('_'):
                                        try:
                                            val = getattr(obj, attr)
                                            if not callable(val):
                                                obj_dict[attr] = str(val)[:100]  # Limit length
                                        except:
                                            pass
                                obj_str = json.dumps(obj_dict, indent=2, default=str)
                            logger.info(f"[CATALOG DEBUG] Full object structure:\n{obj_str[:1000]}")  # Limit to first 1000 chars
                        except Exception as e:
                            logger.debug(f"Could not serialize object for logging: {e}")
                    
                    # For ITEM_VARIATION, try to get name from variation data
                    if obj_type == 'ITEM_VARIATION':
                        # Get item_variation_data (can be dict or object)
                        if isinstance(obj, dict):
                            item_variation_data = obj.get('item_variation_data')
                        else:
                            item_variation_data = getattr(obj, 'item_variation_data', None)
                        
                        if item_variation_data:
                            # Try variation name first
                            if isinstance(item_variation_data, dict):
                                name = item_variation_data.get('name', '')
                            else:
                                name = getattr(item_variation_data, 'name', '') or ''
                            
                            if name:
                                self._catalog_name_cache[variation_id] = name
                                logger.debug(f"Found service name from variation: {name}")
                                return name
                            
                            # If no variation name, try to get parent item name
                            if isinstance(item_variation_data, dict):
                                item_id = item_variation_data.get('item_id', '')
                            else:
                                item_id = getattr(item_variation_data, 'item_id', '') or ''
                            
                            if item_id:
                                # Look in related objects first
                                for related_obj in related_objects:
                                    related_id = get_attr(related_obj, 'id', '')
                                    if related_id == item_id:
                                        # Get item_data from related object
                                        if isinstance(related_obj, dict):
                                            item_data = related_obj.get('item_data')
                                        else:
                                            item_data = getattr(related_obj, 'item_data', None)
                                        
                                        if item_data:
                                            if isinstance(item_data, dict):
                                                item_name = item_data.get('name', '')
                                            else:
                                                item_name = getattr(item_data, 'name', '') or ''
                                            
                                            if item_name:
                                                self._catalog_name_cache[variation_id] = item_name
                                                logger.debug(f"Found service name from related item: {item_name}")
                                                return item_name
                                
                                # If not in related objects, try to fetch the item directly
                                try:
                                    # Use catalog.object.get() - the correct Square SDK method
                                    item_result = catalog_api.object.get(object_id=item_id)  # type: ignore
                                    
                                    item_obj = None
                                    if hasattr(item_result, 'body'):
                                        if isinstance(item_result.body, dict):
                                            item_obj = item_result.body.get('object')
                                        else:
                                            item_obj = getattr(item_result.body, 'object', None)
                                    elif hasattr(item_result, 'object'):
                                        item_obj = item_result.object
                                    elif isinstance(item_result, dict):
                                        item_obj = item_result.get('object')
                                    
                                    if item_obj:
                                        # Get item_data from fetched object
                                        if isinstance(item_obj, dict):
                                            item_data = item_obj.get('item_data')
                                        else:
                                            item_data = getattr(item_obj, 'item_data', None)
                                        
                                        if item_data:
                                            if isinstance(item_data, dict):
                                                item_name = item_data.get('name', '')
                                            else:
                                                item_name = getattr(item_data, 'name', '') or ''
                                            
                                            if item_name:
                                                self._catalog_name_cache[variation_id] = item_name
                                                logger.debug(f"Found service name from parent item: {item_name}")
                                                return item_name
                                except Exception as e:
                                    logger.debug(f"Could not fetch parent item {item_id}: {e}")
                    
                    # For ITEM type, get name from item_data
                    elif obj_type == 'ITEM':
                        if isinstance(obj, dict):
                            item_data = obj.get('item_data')
                        else:
                            item_data = getattr(obj, 'item_data', None)
                        
                        if item_data:
                            if isinstance(item_data, dict):
                                name = item_data.get('name', '')
                            else:
                                name = getattr(item_data, 'name', '') or ''
                            
                            if name:
                                self._catalog_name_cache[variation_id] = name
                                logger.debug(f"Found service name from item: {name}")
                                return name
                    
                    # Fallback: try generic name field
                    name = get_attr(obj, 'name', '')
                    if name:
                        self._catalog_name_cache[variation_id] = name
                        return name
                    
                    # Last resort: try to get name from any related objects
                    for related_obj in related_objects:
                        related_type = get_attr(related_obj, 'type', '')
                        if related_type == 'ITEM':
                            if isinstance(related_obj, dict):
                                item_data = related_obj.get('item_data')
                            else:
                                item_data = getattr(related_obj, 'item_data', None)
                            
                            if item_data:
                                if isinstance(item_data, dict):
                                    item_name = item_data.get('name', '')
                                else:
                                    item_name = getattr(item_data, 'name', '') or ''
                                
                                if item_name:
                                    self._catalog_name_cache[variation_id] = item_name
                                    logger.debug(f"Found service name from related object: {item_name}")
                                    return item_name
        except Exception as e:
            logger.error(f"Catalog lookup failed for variation {variation_id}: {e}")
            # Log more details for debugging
            logger.error(f"Exception type: {type(e).__name__}, message: {str(e)}")
            import traceback
            logger.debug(f"Traceback: {traceback.format_exc()}")
        
        return ""
    
    def get_booking_type(self, booking: Dict) -> str:
        """Determine if booking is couple or single."""
        if not self.client:
            return 'single'
        
        # First check using the standard method (checks segment service_variation_name)
        if self.client.is_couples_massage(booking):
            return 'couple'
        
        # Also check the service name from catalog (in case segment name is empty)
        # This handles cases where service_variation_name is not in the segment
        # but we can get it from the catalog API
        if Config and Config.COUPLES_MASSAGE_SERVICE_NAME_PATTERN:
            service_name = self.get_service_name(booking).lower()
            if Config.COUPLES_MASSAGE_SERVICE_NAME_PATTERN.lower() in service_name:
                logger.info(f"[BOOKING TYPE] Detected couple booking by service name: {service_name}")
                return 'couple'
        
        return 'single'
    
    def get_bookings_for_date(self, date: str) -> List[Dict]:
        """
        Get Square bookings for a specific date and convert to our format.
        
        Args:
            date: Date string in YYYY-MM-DD format
            
        Returns:
            List of booking dicts in our format
        """
        if not self.client:
            logger.warning("Square API not configured, returning empty list")
            return []
        
        try:
            # Parse date and create time range
            # Convert the date to local timezone first, then to UTC
            # This ensures we get all appointments for the local day
            local_tz = dateutil_tz.tzlocal()
            
            # Parse date as local date
            date_obj = datetime.strptime(date, '%Y-%m-%d')
            # Set to local timezone (start of day)
            local_start = date_obj.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
            local_end = local_start + timedelta(days=1)
            
            # Convert to UTC for API query
            start_at_min = local_start.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            start_at_max = local_end.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            
            # Fetch bookings from Square
            square_bookings = self.client.list_bookings(
                start_at_min=start_at_min,
                start_at_max=start_at_max
            )
            
            # Filter out cancelled bookings (handle both dict and object formats)
            active_bookings = []
            for b in square_bookings:
                if isinstance(b, dict):
                    status = b.get('status', '')
                else:
                    status = getattr(b, 'status', '') or ''
                
                if status not in ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED']:
                    active_bookings.append(b)
            
            # Convert to our format
            converted_bookings = []
            for booking in active_bookings:
                try:
                    # Handle both dict and Square SDK object formats
                    if isinstance(booking, dict):
                        booking_id = booking.get('id', '')
                        start_at = booking.get('start_at', '')
                        segments = booking.get('appointment_segments', [])
                        customer_id = booking.get('customer_id', '')
                        customer_note = booking.get('customer_note', '')
                        status = booking.get('status', 'ACCEPTED')
                    else:
                        # Square SDK object
                        booking_id = getattr(booking, 'id', '') or ''
                        start_at = getattr(booking, 'start_at', '') or ''
                        segments = getattr(booking, 'appointment_segments', []) or []
                        customer_id = getattr(booking, 'customer_id', '') or ''
                        customer_note = getattr(booking, 'customer_note', '') or ''
                        status = getattr(booking, 'status', 'ACCEPTED') or 'ACCEPTED'
                    
                    if not segments:
                        continue
                    
                    # Get segment info (handle both formats)
                    # For multiple services, sum all durations
                    segment = segments[0]
                    if isinstance(segment, dict):
                        team_member_id = segment.get('team_member_id', '')
                        duration_minutes = segment.get('duration_minutes', 60)
                    else:
                        team_member_id = getattr(segment, 'team_member_id', '') or ''
                        duration_minutes = getattr(segment, 'duration_minutes', 60) or 60
                    
                    # Sum durations from all segments (for multiple services)
                    total_duration_minutes = duration_minutes
                    if len(segments) > 1:
                        for seg in segments[1:]:
                            if isinstance(seg, dict):
                                seg_duration = seg.get('duration_minutes', 0)
                            else:
                                seg_duration = getattr(seg, 'duration_minutes', 0) or 0
                            total_duration_minutes += seg_duration
                        logger.debug(f"Multiple services detected: {len(segments)} segments, total duration: {total_duration_minutes} minutes")
                    
                    # Parse times
                    if not start_at:
                        continue
                    
                    start_dt = parser.parse(str(start_at))
                    end_dt = start_dt + timedelta(minutes=total_duration_minutes)
                    
                    # Get therapist name
                    therapist_name = self.get_team_member_name(team_member_id)
                    
                    # Get customer name
                    customer_name = self.get_customer_name(booking)
                    
                    # Get service name
                    service_name = self.get_service_name(booking)
                    
                    # Determine type
                    booking_type = self.get_booking_type(booking)
                    
                    converted_booking = {
                        'id': booking_id,
                        'start_at': start_dt.isoformat(),
                        'end_at': end_dt.isoformat(),
                        'therapist': therapist_name,
                        'service': service_name,
                        'customer': customer_name,
                        'type': booking_type,
                        'status': status
                    }
                    
                    converted_bookings.append(converted_booking)
                    
                except Exception as e:
                    booking_id_str = booking.get('id', 'Unknown') if isinstance(booking, dict) else getattr(booking, 'id', 'Unknown')
                    logger.error(f"Error converting booking {booking_id_str}: {e}")
                    continue
            
            # Sort by start time
            converted_bookings.sort(key=lambda b: b['start_at'])
            
            logger.info(f"Fetched {len(converted_bookings)} bookings for {date}")
            return converted_bookings
            
        except Exception as e:
            logger.error(f"Error fetching bookings from Square: {e}", exc_info=True)
            return []

