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
        # Payments API for tip lookup (PAYMENTS_READ permission)
        self.payments_api = getattr(self.client, 'payments', None)
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
    
    @staticmethod
    def _booking_raw_id(booking) -> str:
        if isinstance(booking, dict):
            return (booking.get('id') or '') or ''
        return (getattr(booking, 'id', None) or '') or ''

    @staticmethod
    def _booking_raw_location_id(booking) -> str:
        if isinstance(booking, dict):
            v = booking.get('location_id')
        else:
            v = getattr(booking, 'location_id', None)
        if v is None:
            return ''
        if hasattr(v, 'value'):
            return str(v.value)
        return str(v)

    def list_bookings(
        self,
        start_at_min=None,
        start_at_max=None,
        team_member_id=None,
        customer_id=None,
        *,
        restrict_to_config_location: bool = True,
    ):
        """List bookings with optional filters. Fetches all pages (busy days can exceed one page).

        If restrict_to_config_location is False, location_id is omitted so Square returns all locations;
        callers should filter to Config.SQUARE_LOCATION_ID in application code.
        """
        try:
            kw = dict(
                limit=100,
                start_at_min=start_at_min,
                start_at_max=start_at_max,
            )
            if team_member_id:
                kw['team_member_id'] = team_member_id
            if customer_id:
                kw['customer_id'] = str(customer_id).strip()
            if restrict_to_config_location and getattr(Config, 'SQUARE_LOCATION_ID', None):
                kw['location_id'] = Config.SQUARE_LOCATION_ID
            result = self.bookings_api.list(**kw)
            all_bookings = []
            # SyncPager __iter__ walks every page (official SDK pattern); avoids partial-day data.
            try:
                all_bookings = list(result)
            except Exception as e:
                logger.warning("list(SyncPager) failed (%s); using page-by-page fallback", e)
                if hasattr(result, 'iter_pages'):
                    try:
                        for page in result.iter_pages():
                            if hasattr(page, 'items') and page.items is not None:
                                page_items = page.items
                                if isinstance(page_items, list):
                                    all_bookings.extend(page_items)
                                else:
                                    all_bookings.extend(list(page_items) if page_items else [])
                            elif hasattr(page, 'bookings'):
                                all_bookings.extend(page.bookings or [])
                    except Exception as e2:
                        logger.warning("iter_pages fallback failed: %s", e2)
                if not all_bookings and hasattr(result, 'items') and result.items is not None:
                    items = result.items
                    all_bookings = items if isinstance(items, list) else list(items)
            
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

    def list_bookings_merged_for_range(self, start_at_min, start_at_max):
        """
        Union several List Bookings queries. Square's list endpoint is unreliable for some bookings
        (notably recurring-series instances); per-team-member and all-location passes reduce gaps.
        """
        by_id = {}
        want_loc = (getattr(Config, 'SQUARE_LOCATION_ID', None) or '').strip()

        def put(bookings, loc_filter: bool = False):
            for b in bookings or []:
                bid = self._booking_raw_id(b)
                if not bid:
                    continue
                if loc_filter and want_loc:
                    loc = (self._booking_raw_location_id(b) or '').strip()
                    if loc and loc != want_loc:
                        continue
                by_id[bid] = b

        put(self.list_bookings(start_at_min, start_at_max, restrict_to_config_location=True))
        try:
            put(
                self.list_bookings(start_at_min, start_at_max, restrict_to_config_location=False),
                loc_filter=True,
            )
        except Exception as e:
            logger.warning('list_bookings_merged: all-locations pass failed: %s', e)

        team_ids = []
        at_location = self._team_member_ids_at_location()
        if getattr(Config, "THERAPIST_IDS", None):
            configured = [str(t) for t in Config.THERAPIST_IDS if t]
            if at_location:
                for tid in configured:
                    if tid in at_location:
                        team_ids.append(tid)
                    else:
                        logger.warning(
                            "Skipping team_member_id not returned by Square for this location (remove from "
                            "THERAPIST_TEAM_MEMBER_IDS or fix env): %s",
                            tid,
                        )
            else:
                team_ids = configured
        else:
            for m in self.get_team_members() or []:
                if isinstance(m, dict):
                    tid = m.get('id')
                else:
                    tid = getattr(m, 'id', None)
                if tid:
                    team_ids.append(str(tid))
        for tid in team_ids:
            try:
                put(
                    self.list_bookings(
                        start_at_min,
                        start_at_max,
                        team_member_id=tid,
                        restrict_to_config_location=True,
                    )
                )
            except Exception as e:
                logger.warning('list_bookings_merged: team_member %s failed: %s', tid[:16], e)

        supplement_cids = list(getattr(Config, 'SQUARE_SUPPLEMENT_CUSTOMER_IDS', None) or [])
        for cid in supplement_cids:
            try:
                put(
                    self.list_bookings(
                        start_at_min,
                        start_at_max,
                        customer_id=cid,
                        restrict_to_config_location=True,
                    )
                )
            except Exception as e:
                logger.warning('list_bookings_merged: customer_id %s failed: %s', cid[:16], e)

        logger.info(
            'list_bookings_merged_for_range: %d unique booking(s) in [%s .. %s]',
            len(by_id),
            start_at_min,
            start_at_max,
        )
        return list(by_id.values())

    def list_bookings_two_pass_location_merge(self, start_at_min, start_at_max):
        """
        Same first two passes as list_bookings_merged_for_range (default location + all-locations
        filtered to config location), but without per-team-member queries. Use for wide date ranges
        (e.g. customers-hours report) where full merge would issue dozens of paginated list calls.
        """
        by_id = {}
        want_loc = (getattr(Config, 'SQUARE_LOCATION_ID', None) or '').strip()

        def put(bookings, loc_filter: bool = False):
            for b in bookings or []:
                bid = self._booking_raw_id(b)
                if not bid:
                    continue
                if loc_filter and want_loc:
                    loc = (self._booking_raw_location_id(b) or '').strip()
                    if loc and loc != want_loc:
                        continue
                by_id[bid] = b

        put(self.list_bookings(start_at_min, start_at_max, restrict_to_config_location=True))
        try:
            put(
                self.list_bookings(start_at_min, start_at_max, restrict_to_config_location=False),
                loc_filter=True,
            )
        except Exception as e:
            logger.warning('list_bookings_two_pass: all-locations pass failed: %s', e)
        logger.info(
            'list_bookings_two_pass_location_merge: %d booking(s) in [%s .. %s]',
            len(by_id),
            start_at_min,
            start_at_max,
        )
        return list(by_id.values())

    def bulk_retrieve_bookings(self, booking_ids):
        """Fetch up to 10 IDs per Square API request; returns raw booking objects/dicts."""
        if not booking_ids:
            return []
        ids = [str(x).strip() for x in booking_ids if str(x).strip()]
        out = []
        for i in range(0, len(ids), 10):
            chunk = ids[i : i + 10]
            try:
                resp = self.bookings_api.bulk_retrieve_bookings(booking_ids=chunk)
                bmap = getattr(resp, 'bookings', None) or {}
                if not isinstance(bmap, dict):
                    continue
                for _bid, wrap in bmap.items():
                    if wrap is None:
                        continue
                    gb = getattr(wrap, 'booking', None)
                    if gb is not None:
                        out.append(gb)
            except Exception as e:
                logger.error('bulk_retrieve_bookings failed for chunk starting %s: %s', chunk[0][:16], e)
        return out
    
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

    def search_availability(self, start_at_begin: str, start_at_end: str,
                            service_variation_id: str) -> list:
        """
        Search for available appointment slots.
        start_at_begin, start_at_end: RFC 3339 datetime strings (e.g. 2025-03-08T00:00:00Z).
        service_variation_id: Catalog item variation ID for the service.
        Returns list of availability dicts with 'start_at' (and optionally 'location_id', 'appointment_segments').
        """
        try:
            query = {
                "filter": {
                    "start_at_range": {
                        "start_at": start_at_begin,
                        "end_at": start_at_end,
                    },
                    "location_id": Config.SQUARE_LOCATION_ID,
                    "segment_filters": [
                        {"service_variation_id": service_variation_id}
                    ],
                }
            }
            result = self.bookings_api.search_availability(query=query)
            if hasattr(result, 'body') and isinstance(result.body, dict):
                return result.body.get('availabilities') or []
            if hasattr(result, 'availabilities'):
                return result.availabilities or []
            return []
        except Exception as e:
            logger.error(f"Exception searching availability: {e}")
            return []

    def create_appointment_booking(self, start_at: str, service_variation_id: str,
                                    service_variation_version: int, duration_minutes: int,
                                    any_team_member: bool = True,
                                    team_member_id: str = None,
                                    customer_id: str = None,
                                    customer_note: str = None) -> dict:
        """
        Create a real appointment booking (not blocked time).
        start_at: RFC 3339 datetime.
        Use any_team_member=True to book with any available provider; else pass team_member_id.
        Returns created booking dict or None.
        """
        try:
            segment = {
                "duration_minutes": duration_minutes,
                "service_variation_id": service_variation_id,
                "service_variation_version": service_variation_version,
            }
            if any_team_member:
                segment["any_team_member"] = True
            elif team_member_id:
                segment["team_member_id"] = team_member_id
            else:
                logger.error("create_appointment_booking: need any_team_member=True or team_member_id")
                return None

            booking_data = {
                "location_id": Config.SQUARE_LOCATION_ID,
                "start_at": start_at,
                "status": "ACCEPTED",
                "appointment_segments": [segment],
            }
            if customer_id:
                booking_data["customer_id"] = customer_id
            if customer_note:
                booking_data["customer_note"] = customer_note

            result = self.bookings_api.create(booking=booking_data)
            if hasattr(result, 'body') and isinstance(result.body, dict):
                return result.body.get('booking')
            if hasattr(result, 'booking'):
                return result.booking
            return None
        except Exception as e:
            logger.error(f"Exception creating appointment booking: {e}")
            return None

    def find_or_create_autoblock_customer(self):
        """Return the Square customer_id of the shared 'AUTO BLOCK' placeholder customer.

        Search by exact given+family name; create it if missing. Returns None if the
        Customers API is unavailable or lacks permissions (caller falls back to no-customer booking).
        """
        if Config.COUPLE_AUTOBLOCK_CUSTOMER_ID:
            return Config.COUPLE_AUTOBLOCK_CUSTOMER_ID
        if not self.customers_api:
            return None
        given = Config.COUPLE_AUTOBLOCK_CUSTOMER_GIVEN_NAME
        family = Config.COUPLE_AUTOBLOCK_CUSTOMER_FAMILY_NAME
        try:
            result = self.customers_api.search(
                query={'filter': {'given_name': {'exact': given}, 'family_name': {'exact': family}}},
                limit=1,
            )
            customers = getattr(result, 'customers', None)
            if customers is None and hasattr(result, 'body') and isinstance(result.body, dict):
                customers = result.body.get('customers')
            for c in customers or []:
                cid = c.get('id') if isinstance(c, dict) else getattr(c, 'id', None)
                if cid:
                    return cid
        except Exception as e:
            logger.warning('Autoblock customer search failed: %s', e)
        try:
            result = self.customers_api.create(
                given_name=given,
                family_name=family,
                note='Placeholder customer for automatic couples-massage second-therapist blocks.',
            )
            customer = getattr(result, 'customer', None)
            if customer is None and hasattr(result, 'body') and isinstance(result.body, dict):
                customer = result.body.get('customer')
            cid = customer.get('id') if isinstance(customer, dict) else getattr(customer, 'id', None)
            if cid:
                logger.info('Created autoblock placeholder customer %s', cid)
                return cid
        except Exception as e:
            logger.warning('Autoblock customer create failed (CUSTOMERS_WRITE permission?): %s', e)
        return None

    def create_autoblock_booking(self, team_member_id: str, start_at: str,
                                 service_variation_id: str, service_variation_version: int,
                                 duration_minutes: int, seller_note: str,
                                 customer_id: str = None):
        """Create the second-therapist placeholder booking for a couples massage.

        seller_note carries the AUTO-BLOCK marker + the real customer's first name so staff
        can tell placeholders from real bookings, and so the poller can recognize its own blocks.
        Returns the created booking (dict/object) or None.
        """
        try:
            segment = {
                'team_member_id': team_member_id,
                'duration_minutes': duration_minutes,
            }
            if service_variation_id:
                segment['service_variation_id'] = service_variation_id
                segment['service_variation_version'] = service_variation_version or 1
            booking_data = {
                'location_id': Config.SQUARE_LOCATION_ID,
                'start_at': start_at,
                'status': 'ACCEPTED',
                'appointment_segments': [segment],
                'seller_note': seller_note,
            }
            if customer_id:
                booking_data['customer_id'] = customer_id
            result = self.bookings_api.create(booking=booking_data)
            if hasattr(result, 'body') and isinstance(result.body, dict):
                booking = result.body.get('booking')
            elif hasattr(result, 'booking'):
                booking = result.booking
            else:
                booking = None
            if booking:
                logger.info('Created autoblock booking for team member %s at %s', team_member_id, start_at)
            else:
                logger.error('Error creating autoblock booking: %s', result)
            return booking
        except Exception as e:
            logger.error('Exception creating autoblock booking: %s', e)
            return None

    def list_booking_services(self) -> list:
        """
        List catalog item variations that can be used for booking (service variation id, name, duration).
        Used to map voice phrases like 'deep tissue' to Square service_variation_id.
        Returns list of dicts: {id, name, duration_minutes}.
        """
        out = []
        try:
            catalog_api = getattr(self.client, 'catalog', None)
            if not catalog_api or not hasattr(catalog_api, 'list'):
                return out
            # List ITEM_VARIATION and ITEM to get service names and durations
            for types in ("ITEM_VARIATION", "ITEM"):
                try:
                    pager = catalog_api.list(types=types)
                    if not hasattr(pager, 'iter_pages'):
                        continue
                    for page in pager.iter_pages():
                        if not page:
                            continue
                        items = page if isinstance(page, list) else (getattr(page, 'objects', None) or getattr(page, 'items', None) or [])
                        for obj in items or []:
                            if isinstance(obj, dict):
                                oid = obj.get('id')
                                otype = obj.get('type')
                                if otype == 'ITEM_VARIATION':
                                    var_data = obj.get('item_variation_data') or {}
                                    name = (var_data.get('name') or '').strip()
                                    # duration in service-related catalog may be in item_variation_data
                                    dur = var_data.get('duration')  # may be in minutes as int
                                    if dur is None and 'duration_minutes' in var_data:
                                        dur = var_data.get('duration_minutes')
                                    out.append({"id": oid, "name": name or "Unnamed", "duration_minutes": dur})
                                elif otype == 'ITEM':
                                    item_data = obj.get('item_data') or {}
                                    name = (item_data.get('name') or '').strip()
                                    variations = item_data.get('variations') or []
                                    for v in variations:
                                        vid = v.get('id') if isinstance(v, dict) else getattr(v, 'id', None)
                                        vdata = v.get('item_variation_data', v) if isinstance(v, dict) else v
                                        dur = vdata.get('duration') or vdata.get('duration_minutes') if isinstance(vdata, dict) else None
                                        out.append({"id": vid, "name": name or "Unnamed", "duration_minutes": dur})
                            else:
                                oid = getattr(obj, 'id', None)
                                otype = getattr(obj, 'type', None)
                                if otype == 'ITEM_VARIATION':
                                    var_data = getattr(obj, 'item_variation_data', None) or {}
                                    name = (getattr(var_data, 'name', None) or (var_data.get('name') if isinstance(var_data, dict) else None) or '').strip()
                                    dur = getattr(var_data, 'duration', None) if var_data else None
                                    if dur is None and var_data and isinstance(var_data, dict):
                                        dur = var_data.get('duration_minutes')
                                    out.append({"id": oid, "name": name or "Unnamed", "duration_minutes": dur})
                except Exception as e:
                    logger.debug(f"list_booking_services: list type {types}: {e}")
                    continue
            return out
        except Exception as e:
            logger.error(f"Exception listing booking services: {e}")
            return out

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
    
    def _team_member_ids_at_location(self) -> set:
        """Square IDs for ACTIVE team members at SQUARE_LOCATION_ID (used to drop stale THERAPIST_IDS)."""
        ids: set = set()
        for m in self.get_team_members() or []:
            if isinstance(m, dict):
                tid = m.get("id")
            else:
                tid = getattr(m, "id", None)
            if tid:
                ids.add(str(tid))
        return ids

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
    
    @staticmethod
    def _attr(obj, name, default=None):
        """Field access that works for both dicts (old SDK) and Pydantic objects (new SDK)."""
        if isinstance(obj, dict):
            v = obj.get(name, default)
        else:
            v = getattr(obj, name, default)
        if v is None:
            return default
        if hasattr(v, 'value') and not isinstance(v, (str, int, float, list, dict)):
            return v.value  # enum (e.g. booking status)
        return v

    def get_available_team_member(self, start_at: str, duration_minutes: int, 
                                  exclude_team_member_id: str,
                                  exclude_team_member_ids=None):
        """Find an available team member for the given time slot.

        exclude_team_member_ids: optional extra IDs to skip (e.g. therapists already claimed
        for an overlapping block earlier in the same poll pass).
        """
        try:
            from datetime import timedelta
            from dateutil import parser
            
            # Parse the start time
            start_dt = parser.parse(start_at)
            end_dt = start_dt + timedelta(minutes=duration_minutes)
            
            # Get all team members
            all_members = self.get_team_members()
            
            # Filter to therapists if configured
            if Config.THERAPIST_IDS:
                members = [m for m in all_members if self._attr(m, 'id') in Config.THERAPIST_IDS]
            else:
                members = all_members
            
            # Exclude the already assigned therapist and any caller-supplied exclusions
            excluded = {exclude_team_member_id} | set(exclude_team_member_ids or [])
            members = [m for m in members if self._attr(m, 'id') not in excluded]
            
            if not members:
                logger.warning("No available therapists found")
                return None
            
            # Check availability for each member
            for member in members:
                member_id = self._attr(member, 'id')
                
                # Get existing bookings for this member in the time range.
                # Query directly (not via list_bookings) so an API error can be told apart from
                # "no bookings": a member Square rejects (e.g. no appointments profile) must be
                # skipped, not treated as free.
                try:
                    kw = dict(limit=100, start_at_min=start_at, start_at_max=end_dt.isoformat(),
                              team_member_id=member_id)
                    if getattr(Config, 'SQUARE_LOCATION_ID', None):
                        kw['location_id'] = Config.SQUARE_LOCATION_ID
                    bookings = list(self.bookings_api.list(**kw))
                except Exception as e:
                    logger.warning("Skipping team member %s: bookings lookup failed (%s)",
                                   member_id, str(e)[:200])
                    continue
                
                # Filter out cancelled bookings
                active_bookings = [
                    b for b in bookings 
                    if str(self._attr(b, 'status', '')) not in ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED', 'NO_SHOW']
                ]
                
                # Check if this member has any conflicts
                has_conflict = False
                for booking in active_bookings:
                    booking_start = parser.parse(self._attr(booking, 'start_at'))
                    segments = self._attr(booking, 'appointment_segments', None) or []
                    seg_minutes = self._attr(segments[0], 'duration_minutes', 0) if segments else 0
                    booking_end = booking_start + timedelta(minutes=seg_minutes or 0)
                    
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

    def get_customer_custom_attribute(self, customer_id: str, key: str):
        """Retrieve a custom attribute value for a customer (e.g. 'visits' for 1stV badge). Returns raw value or None."""
        if not customer_id or not key:
            return None
        api = getattr(self.client, 'customer_custom_attributes', None) or getattr(self.client, 'customer_custom_attributes_api', None)
        if not api or not hasattr(api, 'retrieve'):
            logger.debug("Customer Custom Attributes API not available")
            return None
        try:
            result = api.retrieve(customer_id=customer_id, key=key)
            if hasattr(result, 'errors') and result.errors:
                return None
            attr = getattr(result, 'custom_attribute', None) or (result.body.get('custom_attribute') if hasattr(result, 'body') and isinstance(result.body, dict) else None)
            if attr is None:
                return None
            val = getattr(attr, 'value', None)
            if val is None and isinstance(attr, dict):
                val = attr.get('value')
            return val
        except Exception as e:
            logger.debug(f"Could not retrieve custom attribute {key} for customer {customer_id[:8]}...: {e}")
            return None

    def list_payments(self, begin_time: str, end_time: str, limit: int = 100):
        """
        List payments in a time range (RFC 3339). Used to pull tips for matching to bookings.
        Requires PAYMENTS_READ permission. Returns list of dicts with id, customer_id, order_id,
        tip_dollars, created_at, note, amount_dollars.
        """
        if not self.payments_api or not begin_time or not end_time:
            return []
        try:
            result = self.payments_api.list_payments(
                begin_time=begin_time,
                end_time=end_time,
                location_id=Config.SQUARE_LOCATION_ID,
                limit=limit
            )
            payments = []
            if hasattr(result, 'payments') and result.payments:
                items = result.payments
            elif hasattr(result, 'body') and isinstance(result.body, dict):
                items = result.body.get('payments') or []
            elif hasattr(result, 'body') and hasattr(result.body, 'payments'):
                items = result.body.payments or []
            else:
                items = []
            if not items and hasattr(result, 'body'):
                body = getattr(result, 'body', None)
                if hasattr(body, 'get'):
                    items = body.get('payments') or []
                elif hasattr(body, 'payments'):
                    items = body.payments or []
            for p in items:
                if isinstance(p, dict):
                    tip_money = p.get('tip_money') or {}
                    amount_money = p.get('amount_money') or {}
                    total_money = p.get('total_money') or {}
                    tip_cents = tip_money.get('amount') or 0
                    amount_cents = amount_money.get('amount') or 0
                    total_cents = total_money.get('amount') or 0
                    if tip_cents <= 0 and total_cents > 0 and amount_cents > 0 and total_cents > amount_cents:
                        tip_cents = total_cents - amount_cents
                    tip_dollars = round((tip_cents or 0) / 100.0, 2)
                    amount_dollars = round((amount_cents or 0) / 100.0, 2)
                    payments.append({
                        'id': p.get('id', ''),
                        'customer_id': p.get('customer_id') or '',
                        'order_id': p.get('order_id') or '',
                        'tip_dollars': tip_dollars,
                        'amount_dollars': amount_dollars,
                        'created_at': p.get('created_at', ''),
                        'note': (p.get('note') or '')[:500],
                    })
                else:
                    tip_money = getattr(p, 'tip_money', None)
                    amount_money = getattr(p, 'amount_money', None)
                    total_money = getattr(p, 'total_money', None)
                    tip_cents = getattr(tip_money, 'amount', 0) or 0 if tip_money else 0
                    amount_cents = getattr(amount_money, 'amount', 0) or 0 if amount_money else 0
                    total_cents = getattr(total_money, 'amount', 0) or 0 if total_money else 0
                    if tip_cents <= 0 and total_cents > 0 and amount_cents > 0 and total_cents > amount_cents:
                        tip_cents = total_cents - amount_cents
                    tip_dollars = round((tip_cents or 0) / 100.0, 2)
                    amount_dollars = round((amount_cents or 0) / 100.0, 2)
                    payments.append({
                        'id': getattr(p, 'id', '') or '',
                        'customer_id': getattr(p, 'customer_id', '') or '',
                        'order_id': getattr(p, 'order_id', '') or '',
                        'tip_dollars': tip_dollars,
                        'amount_dollars': amount_dollars,
                        'created_at': getattr(p, 'created_at', '') or '',
                        'note': (getattr(p, 'note', None) or '')[:500],
                    })
            with_tip = [x for x in payments if (x.get('tip_dollars') or 0) > 0]
            logger.info("Square list_payments: %d payments, %d with tip (range %s..%s)",
                        len(payments), len(with_tip), begin_time[:19], end_time[:19])
            for x in with_tip[:5]:
                logger.info("  payment id=%s tip=$%s customer_id=%s note=%s",
                            (x.get('id') or '')[:12], x.get('tip_dollars'),
                            (x.get('customer_id') or '')[:20] or '(none)',
                            (x.get('note') or '')[:50] or '(none)')
            return payments
        except Exception as e:
            logger.warning("Could not list payments for tip pull: %s", e)
            return []
    
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

