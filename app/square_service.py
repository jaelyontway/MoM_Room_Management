"""Square API service adapter for FastAPI app."""
import logging
from typing import List, Dict, Optional, Tuple, Any
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


# Display-name corrections for therapists whose Square profile is misspelled.
# Key = normalized Square name (lowercase, single-spaced); value = corrected name to show everywhere.
_THERAPIST_NAME_CORRECTIONS = {
    "lilian i": "Lillian I",
}


def correct_therapist_display_name(name: str) -> str:
    """Map a (possibly misspelled) Square team-member name to the corrected display spelling."""
    if not name or not isinstance(name, str):
        return name
    normalized = " ".join(name.lower().strip().split())
    return _THERAPIST_NAME_CORRECTIONS.get(normalized, name)


_SQUARE_LIST_EXCLUDED_STATUSES = frozenset({
    'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED',
    'NO_SHOW',
})

# "New appointments" report: omit dead bookings but keep NO_SHOW so desk can see risk.
_NEW_APPTS_REPORT_EXCLUDED_STATUSES = frozenset({
    'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED',
})


def _raw_booking_local_date_str(b, local_tz) -> Optional[str]:
    """Local calendar YYYY-MM-DD for booking start (for bucketing range reports)."""
    if isinstance(b, dict):
        start_at = b.get('start_at') or ''
    else:
        start_at = getattr(b, 'start_at', None) or ''
    if not start_at:
        return None
    try:
        dt = parser.parse(str(start_at))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=dateutil_tz.UTC)
        loc = dt.astimezone(local_tz)
        return loc.strftime('%Y-%m-%d')
    except Exception:
        return None


def _normalize_created_at(created_at) -> Optional[str]:
    """Ensure created_at is an ISO string for NEW badge (after 9pm → until 10am next day)."""
    if created_at is None:
        return None
    if hasattr(created_at, 'isoformat'):
        return getattr(created_at, 'isoformat', lambda: str(created_at))()
    s = (str(created_at) if created_at else '').strip()
    return s if s else None


def _coerce_square_booking_row(booking):
    """Normalize Square SDK Pydantic models to plain dicts so segment/status handling is consistent."""
    if isinstance(booking, dict):
        return booking
    md = getattr(booking, 'model_dump', None)
    if callable(md):
        try:
            return md(mode='json')
        except TypeError:
            try:
                d = md()
                if isinstance(d, dict):
                    return d
            except Exception:
                pass
    td = getattr(booking, 'to_dict', None)
    if callable(td):
        try:
            d = td()
            if isinstance(d, dict):
                return d
        except Exception:
            pass
    return booking


def _get_created_at(booking) -> Optional[str]:
    """Extract created_at from a Square booking (dict or SDK object). Tries multiple keys and to_dict()."""
    if isinstance(booking, dict):
        return booking.get('created_at') or booking.get('createdAt')
    raw = getattr(booking, 'created_at', None) or getattr(booking, 'createdAt', None)
    if raw is not None:
        return raw
    to_dict = getattr(booking, 'to_dict', None)
    if callable(to_dict):
        try:
            d = to_dict()
            if isinstance(d, dict):
                raw = d.get('created_at') or d.get('createdAt')
                if raw is not None:
                    return raw
        except Exception:
            pass
    d = getattr(booking, '__dict__', None)
    if isinstance(d, dict):
        raw = d.get('created_at') or d.get('createdAt')
        if raw is not None:
            return raw
    return None


class SquareService:
    """Service to fetch and convert Square bookings to our format."""
    
    # Add-ons that do not extend appointment duration (matched case-insensitive in service name)
    _TIME_NEUTRAL_ADDON_NAMES = {
        "pain relief oil",
        "pain relief cream",  # Square ~5 min segment; no extra massage/room time vs main service
        "cupping",
        "air cup",  # "Air Cupping" / "air cupping" — same clock as massage when bundled
        "eye spa",
        "aromatherapy",
        "tea tree",  # scent add-on; Square often books as ~5 min segment — do not extend massage end time
        "teatree",
        "collagen socks",
        "collagen sock",
    }

    def __init__(self):
        """Initialize Square service."""
        if not SQUARE_AVAILABLE:
            logger.warning("Square client modules not available. Using mock data.")
            self.client = None
            self._team_members_cache = {}
            self._catalog_name_cache = {}
            self._customer_name_cache = {}
            self._customer_phone_cache = {}
            self._customer_visits_cache = {}
            self._customer_massage_together_cache = {}
            return
        
        try:
            Config.validate()
            self.client = SquareBookingsClient()
            self._team_members_cache = {}
            self._catalog_name_cache = {}
            self._customer_name_cache = {}
            self._customer_phone_cache = {}
            self._customer_visits_cache = {}
            self._customer_massage_together_cache = {}
            logger.info("Square API client initialized successfully")
        except (ValueError, AttributeError) as e:
            logger.warning(f"Square API not configured: {e}. Using mock data.")
            self.client = None
            self._team_members_cache = {}
            self._catalog_name_cache = {}
            self._customer_name_cache = {}
            self._customer_phone_cache = {}
            self._customer_visits_cache = {}
            self._customer_massage_together_cache = {}
    
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
                    name = correct_therapist_display_name(name)
                    self._team_members_cache[team_member_id] = name
                    return name
        except Exception as e:
            logger.error(f"Error fetching team member {team_member_id}: {e}")
        
        return team_member_id

    def _segment_is_eye_spa(self, segment, *, allow_catalog: bool = True) -> bool:
        """True if this segment is Eye Spa (by name or catalog resolution)."""
        try:
            if isinstance(segment, dict):
                name = (segment.get("service_variation_name") or "").lower()
                variation_id = segment.get("service_variation_id") or ""
            else:
                name = (getattr(segment, "service_variation_name", "") or "").lower()
                variation_id = getattr(segment, "service_variation_id", "") or ""
                if hasattr(segment, "model_dump"):
                    d = segment.model_dump()
                    name = name or (d.get("service_variation_name") or "").lower()
                    variation_id = variation_id or (d.get("service_variation_id") or "")
            if "eye spa" in name or ("eye" in name and "spa" in name):
                return True
            if allow_catalog and variation_id:
                looked = self._get_service_name_from_catalog(variation_id)
                looked_lower = (looked or "").lower()
                if "eye spa" in looked_lower or ("eye" in looked_lower and "spa" in looked_lower):
                    return True
        except Exception:
            pass
        return False

    def _segment_is_time_neutral_addon(self, segment, all_segments=None, *, allow_catalog: bool = True) -> bool:
        """Return True if this segment is a time-neutral add-on (pain relief oil/cream, cupping, aromatherapy, tea tree).
        Eye Spa is time-neutral only when booked with another service; if Eye Spa is the only segment,
        its duration counts toward the appointment (typically 5 min)."""
        try:
            # Eye spa + massage: do not extend end time; eye spa alone: duration applies
            if self._segment_is_eye_spa(segment, allow_catalog=allow_catalog):
                if all_segments is not None and len(all_segments) > 1:
                    return True
                return False
            if isinstance(segment, dict):
                name = (segment.get("service_variation_name") or "").lower()
                variation_id = segment.get("service_variation_id") or ""
            else:
                name = (getattr(segment, "service_variation_name", "") or "").lower()
                variation_id = getattr(segment, "service_variation_id", "") or ""
                if hasattr(segment, "model_dump"):
                    d = segment.model_dump()
                    name = name or (d.get("service_variation_name") or "").lower()
                    variation_id = variation_id or (d.get("service_variation_id") or "")

            def _bundled_massage_and_cupping_title(txt: str) -> bool:
                """One catalog line that is both massage and cupping is full wall-clock time (e.g. 90 min), not add-on only."""
                if not (txt or "").strip():
                    return False
                t = txt.lower()
                cup = "cupping" in t or "air cup" in t or "vacuum cup" in t
                if not cup:
                    return False
                return any(
                    k in t
                    for k in (
                        "massage",
                        "swedish",
                        "deep tissue",
                        "hot stone",
                        "prenatal",
                        "sports massage",
                        "couple",
                    )
                )

            if _bundled_massage_and_cupping_title(name):
                return False
            for addon in self._TIME_NEUTRAL_ADDON_NAMES:
                if addon == "eye spa":
                    continue
                if addon in name:
                    return True
            if allow_catalog and variation_id:
                looked = self._get_service_name_from_catalog(variation_id)
                looked_lower = (looked or "").lower()
                if _bundled_massage_and_cupping_title(looked_lower):
                    return False
                for addon in self._TIME_NEUTRAL_ADDON_NAMES:
                    if addon == "eye spa":
                        continue
                    if addon in looked_lower:
                        return True
        except Exception:
            pass
        return False

    def _cached_name_is_id_placeholder(self, name: str) -> bool:
        """True if value is our fallback 'Customer {id[:8]}' (must not stick in cache for real UI paths)."""
        if not name or not isinstance(name, str):
            return False
        if not name.startswith("Customer "):
            return False
        rest = name[len("Customer ") :].strip()
        if not rest or " " in rest:
            return False
        return len(rest) <= 8

    def get_customer_name(self, booking: Dict, *, allow_remote: bool = True) -> str:
        """Extract customer name from booking, with caching. If allow_remote is False, skip Customer API (bulk reports)."""
        # Handle both dict and Square SDK object formats
        if isinstance(booking, dict):
            customer_id = booking.get('customer_id', '')
            customer_note = booking.get('customer_note', '')
        else:
            customer_id = getattr(booking, 'customer_id', '') or ''
            customer_note = getattr(booking, 'customer_note', '') or ''

        # Bulk report path must not read/write shared name cache (would poison calendar/grid with "Customer x." placeholders).
        if allow_remote and customer_id and customer_id in self._customer_name_cache:
            cached = self._customer_name_cache[customer_id]
            if self._cached_name_is_id_placeholder(cached):
                del self._customer_name_cache[customer_id]
            else:
                logger.debug(f"Using cached customer name for {customer_id[:8]}...")
                return cached
        
        # Log what we have
        logger.debug(f"[CUSTOMER] Processing booking - customer_id: {customer_id[:8] if customer_id else 'None'}..., customer_note: {customer_note[:20] if customer_note else 'None'}...")
        
        # Try to fetch customer name from Customer API if available
        if allow_remote and customer_id and self.client:
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
                        
                        if phone:
                            self._customer_phone_cache[customer_id] = phone
                        
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
            if customer_id and allow_remote:
                self._customer_name_cache[customer_id] = result
            logger.info(f"[CUSTOMER] Using customer_note: {customer_note[:30]}... for ID {customer_id[:8] if customer_id else 'None'}...")
            return result
        elif customer_id:
            result = f"Customer {customer_id[:8]}"
            if allow_remote:
                self._customer_name_cache[customer_id] = result
            logger.info(f"[CUSTOMER] Using fallback customer ID display for {customer_id[:8]}...")
            return result
        else:
            logger.warning("[CUSTOMER] No customer_id or customer_note found - using 'Unknown Customer'")
            return "Unknown Customer"
    
    def get_customer_visits(self, customer_id: str) -> Optional[int]:
        """Get visit count from Square customer custom attribute (keys: visits, visit_count, Visits).
        Used by calendar: 1stV when 1; loyalty styling + LOYAL badge when >= 20. Cached."""
        if not customer_id:
            return None
        if customer_id in self._customer_visits_cache:
            return self._customer_visits_cache[customer_id]
        if not self.client or not hasattr(self.client, 'get_customer_custom_attribute'):
            return None
        try:
            for key in ('visits', 'visit_count', 'Visits'):
                raw = self.client.get_customer_custom_attribute(customer_id, key)
                if raw is not None:
                    n = int(raw) if isinstance(raw, (int, float)) else int(str(raw).strip())
                    n = max(0, n)
                    self._customer_visits_cache[customer_id] = n
                    return n
        except Exception:
            pass
        self._customer_visits_cache[customer_id] = None
        return None

    def get_customer_must_book_online_note(self, customer_id: str) -> Optional[str]:
        """Square custom attributes that mean book-online / prepay only. Returns a short label for UI (not app DB)."""
        if not customer_id:
            return None
        cid = str(customer_id).strip()
        if not cid:
            return None
        cache = getattr(self, "_customer_online_only_cache", None)
        if cache is None:
            self._customer_online_only_cache = {}
            cache = self._customer_online_only_cache
        if cid in cache:
            return cache[cid]
        if not self.client or not hasattr(self.client, "get_customer_custom_attribute"):
            cache[cid] = None
            return None
        keys = (
            "must_book_online",
            "book_online_only",
            "online_booking_only",
            "Book_online_only",
            "Online_booking_only",
            "Book online only",
            "Must book online",
            "onlineOnly",
            "prepay_required",
            "Prepay_required",
        )
        try:
            for key in keys:
                raw = self.client.get_customer_custom_attribute(cid, key)
                if raw is None:
                    continue
                s = str(raw).strip()
                if not s:
                    continue
                sl = s.lower()
                if sl in ("yes", "true", "1", "y", "required"):
                    cache[cid] = "Online-only / prepay (Square profile)"
                    return cache[cid]
                if sl in ("no", "false", "0", "n"):
                    continue
                cache[cid] = s if len(s) <= 200 else s[:200].rstrip()
                return cache[cid]
        except Exception:
            pass
        cache[cid] = None
        return None

    def get_customer_massage_together_with(self, customer_id: str) -> Optional[str]:
        """Square customer custom attribute: who they massage with (couple partner). Key variants by catalog."""
        if not customer_id:
            return None
        cache = getattr(self, "_customer_massage_together_cache", None)
        if cache is None:
            self._customer_massage_together_cache = {}
            cache = self._customer_massage_together_cache
        if customer_id in cache:
            return cache[customer_id]
        if not self.client or not hasattr(self.client, "get_customer_custom_attribute"):
            cache[customer_id] = None
            return None
        keys = (
            "massage_together_with",
            "Massage_together_with",
            "Massage together with",
            "massageTogetherWith",
            "massagetogetherwith",
        )
        try:
            for key in keys:
                raw = self.client.get_customer_custom_attribute(customer_id, key)
                if raw is not None:
                    s = str(raw).strip()
                    if s:
                        if len(s) > 120:
                            s = s[:120].rstrip()
                        cache[customer_id] = s
                        return s
        except Exception:
            pass
        cache[customer_id] = None
        return None

    def get_customer_phone(self, booking: Dict) -> str:
        """Get customer phone for booking. Uses cache from get_customer_name when available, else fetches."""
        if isinstance(booking, dict):
            customer_id = booking.get('customer_id', '')
        else:
            customer_id = getattr(booking, 'customer_id', '') or ''
        if not customer_id:
            return ''
        if customer_id in self._customer_phone_cache:
            return self._customer_phone_cache[customer_id] or ''
        if not self.client or not hasattr(self.client, 'get_customer') or not self.client.get_customer:
            return ''
        try:
            customer = self.client.get_customer(customer_id)
            if customer:
                phone = getattr(customer, 'phone_number', None) or ''
                self._customer_phone_cache[customer_id] = phone
                return phone
        except Exception:
            pass
        return ''
    
    def _segment_service_name(self, segment, segment_idx: int = 0) -> str:
        """Resolve one Square appointment_segment to a catalog/service title."""
        if isinstance(segment, dict):
            service_name = segment.get('service_variation_name', '') or ''
            service_variation_id = segment.get('service_variation_id', '') or ''
        else:
            service_name = getattr(segment, 'service_variation_name', '') or ''
            service_variation_id = getattr(segment, 'service_variation_id', '') or ''
            if hasattr(segment, 'model_dump'):
                seg_dict = segment.model_dump()
                service_name = service_name or seg_dict.get('service_variation_name', '') or ''
                service_variation_id = service_variation_id or seg_dict.get('service_variation_id', '') or ''

        logger.debug(
            "[SERVICE NAME] Segment %s has service_variation_name: '%s', service_variation_id: '%s'",
            segment_idx, service_name, service_variation_id,
        )

        # When segment says "Regular", look up catalog so we can use parent item name (e.g. "Luxury $199")
        if service_name and (service_name.strip().lower() != 'regular' or not service_variation_id):
            return service_name
        if service_variation_id:
            looked_up = self._get_service_name_from_catalog(service_variation_id)
            if looked_up:
                return looked_up
            if service_name:
                return service_name
            logger.warning(
                "[SERVICE NAME] ✗ Could not find service name for variation_id: %s",
                service_variation_id,
            )
            return ""
        if service_name:
            return service_name
        logger.warning("No service_variation_id found in segment %s", segment_idx)
        return ""

    def get_service_name(self, booking: Dict) -> str:
        """Extract service name(s) from booking. Returns all services if multiple."""
        if isinstance(booking, dict):
            segments = booking.get('appointment_segments', [])
        else:
            segments = getattr(booking, 'appointment_segments', []) or []

        if not segments:
            logger.warning("No appointment_segments found in booking")
            return "Unknown Service"

        service_names = []
        for segment_idx, segment in enumerate(segments):
            name = self._segment_service_name(segment, segment_idx)
            if name:
                service_names.append(name)

        if not service_names:
            logger.warning("No service names found in any segment")
            return "Unknown Service"

        if len(service_names) == 1:
            logger.info(f"[SERVICE NAME] Single service: {service_names[0]}")
            return service_names[0]
        combined = ", ".join(service_names)
        logger.info(f"[SERVICE NAME] Multiple services ({len(service_names)}): {combined}")
        return combined

    def get_service_segments(self, booking, *, allow_catalog: bool = True) -> List[Dict]:
        """
        Per Square appointment_segment: name + duration_minutes + is_addon.
        Used by calendar cards so multi-service bookings (e.g. 60 Deep Tissue + 30 Trigger Point)
        show each segment's own minutes, not the full block length on the first line only.
        """
        if isinstance(booking, dict):
            segments = booking.get('appointment_segments', []) or []
        else:
            segments = getattr(booking, 'appointment_segments', None) or []
        out: List[Dict] = []
        for idx, segment in enumerate(segments):
            name = (self._segment_service_name(segment, idx) or "").strip()
            if not name:
                continue
            if isinstance(segment, dict):
                dur = segment.get('duration_minutes', 0) or 0
            else:
                dur = getattr(segment, 'duration_minutes', 0) or 0
            try:
                dur_i = int(dur)
            except (TypeError, ValueError):
                dur_i = 0
            is_addon = self._segment_is_time_neutral_addon(
                segment, segments, allow_catalog=allow_catalog
            )
            out.append({
                'name': name,
                'duration_minutes': dur_i if dur_i > 0 else None,
                'is_addon': bool(is_addon),
            })
        return out
    
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
                            # Variation name (e.g. "Regular" when there is only one variation)
                            if isinstance(item_variation_data, dict):
                                name = item_variation_data.get('name', '')
                            else:
                                name = getattr(item_variation_data, 'name', '') or ''
                            
                            if isinstance(item_variation_data, dict):
                                item_id = item_variation_data.get('item_id', '')
                            else:
                                item_id = getattr(item_variation_data, 'item_id', '') or ''
                            
                            # When variation is "Regular", check parent item name (e.g. "Luxury $199")
                            # so we show Luxury instead of Regular when there's no second variation
                            variation_is_regular = (name or '').strip().lower() == 'regular'
                            parent_item_name = None
                            if item_id:
                                # Look in related objects first
                                for related_obj in related_objects:
                                    related_id = get_attr(related_obj, 'id', '')
                                    if related_id == item_id:
                                        if isinstance(related_obj, dict):
                                            item_data = related_obj.get('item_data')
                                        else:
                                            item_data = getattr(related_obj, 'item_data', None)
                                        if item_data:
                                            if isinstance(item_data, dict):
                                                parent_item_name = item_data.get('name', '')
                                            else:
                                                parent_item_name = getattr(item_data, 'name', '') or ''
                                        break
                                if not parent_item_name:
                                    try:
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
                                        else:
                                            item_obj = None
                                        if item_obj:
                                            if isinstance(item_obj, dict):
                                                item_data = item_obj.get('item_data')
                                            else:
                                                item_data = getattr(item_obj, 'item_data', None)
                                            if item_data:
                                                if isinstance(item_data, dict):
                                                    parent_item_name = item_data.get('name', '')
                                                else:
                                                    parent_item_name = getattr(item_data, 'name', '') or ''
                                    except Exception as e:
                                        logger.debug(f"Could not fetch parent item {item_id}: {e}")
                            
                            # Prefer parent item name when variation is "Regular" and parent suggests Luxury
                            if variation_is_regular and (parent_item_name or '').strip():
                                parent_lower = parent_item_name.lower()
                                if 'luxury' in parent_lower or '$199' in parent_item_name:
                                    self._catalog_name_cache[variation_id] = parent_item_name
                                    logger.info(f"[SERVICE NAME] Variation 'Regular' -> using parent item name: {parent_item_name}")
                                    return parent_item_name
                                # Eye Spa is often variation "Regular" under catalog item "Eye Spa"
                                if 'eye spa' in parent_lower or ('eye' in parent_lower and 'spa' in parent_lower):
                                    self._catalog_name_cache[variation_id] = parent_item_name
                                    logger.info(f"[SERVICE NAME] Variation 'Regular' -> using parent item name (Eye Spa): {parent_item_name}")
                                    return parent_item_name
                                # Back Facial (single variation "Regular" under catalog item "Back Facial")
                                if 'back facial' in parent_lower:
                                    self._catalog_name_cache[variation_id] = parent_item_name
                                    logger.info(f"[SERVICE NAME] Variation 'Regular' -> using parent item name (Back Facial): {parent_item_name}")
                                    return parent_item_name
                                # Combo / Back Facial Combo — parent item name includes "combo"
                                if 'combo' in parent_lower:
                                    self._catalog_name_cache[variation_id] = parent_item_name
                                    logger.info(f"[SERVICE NAME] Variation 'Regular' -> using parent item name (Combo): {parent_item_name}")
                                    return parent_item_name
                            
                            # No variation name: use parent item name if we have it
                            if not name and parent_item_name:
                                self._catalog_name_cache[variation_id] = parent_item_name
                                logger.debug(f"Found service name from parent item: {parent_item_name}")
                                return parent_item_name
                            
                            if name:
                                self._catalog_name_cache[variation_id] = name
                                logger.debug(f"Found service name from variation: {name}")
                                return name
                    
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

    def list_calendar_catalog_lines(self) -> List[Dict[str, str]]:
        """
        Bookable catalog variations with display names matching the calendar (same catalog API as bookings).

        Returns list of {variation_id, name}. Used to show human-readable labels on Service Pay Setup.
        """
        if not self.client:
            return []
        try:
            raw = self.client.list_booking_services()
        except Exception as e:
            logger.warning("list_booking_services failed: %s", e)
            return []
        seen = set()
        out: List[Dict[str, str]] = []
        for row in raw or []:
            vid = row.get("id") if isinstance(row, dict) else None
            if not vid or vid in seen:
                continue
            seen.add(vid)
            name = (self._get_service_name_from_catalog(vid) or "").strip()
            if not name:
                name = (row.get("name") or "").strip() if isinstance(row, dict) else ""
            if name:
                out.append({"variation_id": vid, "name": name})
        return out

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

    def _service_name_from_segments_only(self, booking) -> str:
        """Segment display names only; no catalog API (for bulk stats)."""
        if isinstance(booking, dict):
            segments = booking.get('appointment_segments', []) or []
        else:
            segments = getattr(booking, 'appointment_segments', None) or []
        names = []
        for seg in segments:
            if isinstance(seg, dict):
                sn = (seg.get('service_variation_name') or '').strip()
            else:
                sn = (getattr(seg, 'service_variation_name', None) or '').strip()
            if sn:
                names.append(sn)
        if not names:
            return 'Unknown Service'
        return names[0] if len(names) == 1 else ', '.join(names)

    def get_booking_type_for_stats(self, booking) -> str:
        """Couple vs single without catalog lookups (for bulk stats)."""
        if self.client and self.client.is_couples_massage(booking):
            return 'couple'
        if isinstance(booking, dict):
            segments = booking.get('appointment_segments', []) or []
        else:
            segments = getattr(booking, 'appointment_segments', None) or []
        pat = (getattr(Config, 'COUPLES_MASSAGE_SERVICE_NAME_PATTERN', None) or '').strip().lower()
        for seg in segments:
            if isinstance(seg, dict):
                name = (seg.get('service_variation_name') or '').lower()
            else:
                name = (getattr(seg, 'service_variation_name', None) or '').lower()
            if 'couple' in name:
                return 'couple'
            if pat and pat in name:
                return 'couple'
        return 'single'

    def resolve_voice_service(self, service_name: str, duration_minutes: int) -> Tuple[Optional[str], int]:
        """
        Resolve a voice phrase (e.g. 'Deep Tissue Massage') and duration to Square
        service_variation_id and version. Returns (variation_id, version) or (None, 1).
        """
        if not self.client:
            return (None, 1)
        name_lower = (service_name or "").lower().strip()
        # 1) From catalog list
        try:
            services = self.client.list_booking_services()
            for s in services:
                sid = s.get("id")
                sname = (s.get("name") or "").lower()
                sdur = s.get("duration_minutes")
                if not sid or not sname:
                    continue
                if name_lower in sname or sname in name_lower:
                    if sdur is None or int(sdur) == duration_minutes:
                        logger.info(f"resolve_voice_service: matched catalog '{sname}' -> {sid}")
                        return (sid, 1)
                # match by keywords
                if "deep tissue" in name_lower and "deep" in sname:
                    if sdur is None or int(sdur) == duration_minutes:
                        return (sid, 1)
                if "couple" in name_lower and "couple" in sname:
                    if sdur is None or int(sdur) == duration_minutes:
                        return (sid, 1)
                if "swedish" in name_lower and "swedish" in sname:
                    if sdur is None or int(sdur) == duration_minutes:
                        return (sid, 1)
            if services:
                # fallback: first name match ignoring duration
                for s in services:
                    sid = s.get("id")
                    sname = (s.get("name") or "").lower()
                    if name_lower in sname or sname in name_lower:
                        return (sid, 1)
        except Exception as e:
            logger.debug(f"resolve_voice_service from catalog: {e}")
        # 2) From recent bookings: collect variation ids from segments
        try:
            today = datetime.now(dateutil_tz.tzlocal()).strftime("%Y-%m-%d")
            bookings = self.client.list_bookings(
                start_at_min=datetime.now(dateutil_tz.tzlocal()).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dateutil_tz.UTC).isoformat().replace("+00:00", "Z"),
                start_at_max=(datetime.now(dateutil_tz.tzlocal()) + timedelta(days=7)).astimezone(dateutil_tz.UTC).isoformat().replace("+00:00", "Z"),
            )
            for b in (bookings or [])[:50]:
                segs = b.get("appointment_segments", []) if isinstance(b, dict) else (getattr(b, "appointment_segments", None) or [])
                for seg in segs:
                    vid = seg.get("service_variation_id") if isinstance(seg, dict) else getattr(seg, "service_variation_id", None)
                    ver = seg.get("service_variation_version", 1) if isinstance(seg, dict) else getattr(seg, "service_variation_version", 1) or 1
                    dur = seg.get("duration_minutes") if isinstance(seg, dict) else getattr(seg, "duration_minutes", None)
                    if not vid:
                        continue
                    seg_name = (seg.get("service_variation_name") or "") if isinstance(seg, dict) else (getattr(seg, "service_variation_name", None) or "")
                    if not seg_name:
                        seg_name = self._get_service_name_from_catalog(vid)
                    seg_name_lower = seg_name.lower()
                    if name_lower in seg_name_lower or seg_name_lower in name_lower:
                        if dur is None or int(dur) == duration_minutes:
                            return (vid, int(ver))
                    if "deep tissue" in name_lower and "deep" in seg_name_lower and (dur is None or int(dur) == duration_minutes):
                        return (vid, int(ver))
                    if "couple" in name_lower and "couple" in seg_name_lower and (dur is None or int(dur) == duration_minutes):
                        return (vid, int(ver))
            # last resort: any segment with matching duration
            for b in (bookings or [])[:30]:
                segs = b.get("appointment_segments", []) if isinstance(b, dict) else (getattr(b, "appointment_segments", None) or [])
                for seg in segs:
                    vid = seg.get("service_variation_id") if isinstance(seg, dict) else getattr(seg, "service_variation_id", None)
                    ver = seg.get("service_variation_version", 1) if isinstance(seg, dict) else getattr(seg, "service_variation_version", 1) or 1
                    dur = seg.get("duration_minutes") if isinstance(seg, dict) else getattr(seg, "duration_minutes", None)
                    if vid and (dur is None or int(dur) == duration_minutes):
                        return (vid, int(ver))
        except Exception as e:
            logger.debug(f"resolve_voice_service from bookings: {e}")
        return (None, 1)

    def _convert_raw_booking_row_to_dict(self, raw_booking, *, enrich_bookings: bool = True) -> Optional[Dict]:
        """Convert one Square list/retrieve booking row to internal dict; None if skip.
        enrich_bookings=False skips customer/catalog/created_at hydration (customers-hours bulk path)."""
        booking = raw_booking
        try:
            booking = _coerce_square_booking_row(booking)
            bsrc = booking
            final_booking = booking
            booking_id = ''
            start_at = ''
            segments = []
            customer_id = ''
            customer_note = ''
            seller_note = ''
            status = 'ACCEPTED'
            raw_source = ''
            creator_details = {}
            for hydrate_try in range(2):
                if isinstance(bsrc, dict):
                    booking_id = bsrc.get('id', '')
                    start_at = bsrc.get('start_at', '')
                    segments = bsrc.get('appointment_segments') or []
                    customer_id = bsrc.get('customer_id', '')
                    customer_note = bsrc.get('customer_note', '')
                    seller_note = bsrc.get('seller_note', '')
                    status = bsrc.get('status', 'ACCEPTED')
                    raw_source = bsrc.get('source', '') or ''
                    creator_details = bsrc.get('creator_details') or {}
                else:
                    booking_id = getattr(bsrc, 'id', '') or ''
                    start_at = getattr(bsrc, 'start_at', '') or ''
                    segments = getattr(bsrc, 'appointment_segments', None) or []
                    customer_id = getattr(bsrc, 'customer_id', '') or ''
                    customer_note = getattr(bsrc, 'customer_note', '') or ''
                    seller_note = getattr(bsrc, 'seller_note', '') or ''
                    status = getattr(bsrc, 'status', 'ACCEPTED') or 'ACCEPTED'
                    raw_source = getattr(bsrc, 'source', '') or ''
                    creator_details = getattr(bsrc, 'creator_details', None) or {}
                if segments:
                    final_booking = bsrc
                    break
                if hydrate_try == 0 and booking_id and getattr(self.client, 'get_booking', None):
                    try:
                        gb = self.client.get_booking(booking_id)
                        if gb is not None:
                            bsrc = _coerce_square_booking_row(gb)
                            logger.info(
                                "Booking %s: list payload had no segments; hydrated via get_booking",
                                booking_id[:16],
                            )
                            continue
                    except Exception as ex:
                        logger.debug(
                            "get_booking hydrate failed for %s: %s",
                            booking_id[:16] if booking_id else "?",
                            ex,
                        )
                break
            booking = final_booking
            if not segments:
                logger.warning(f"Booking {booking_id} skipped: no appointment_segments")
                return None
            allow_cat = enrich_bookings
            created_at = _get_created_at(booking)
            # List API may omit created_at for some bookings; fetch full booking when missing so NEW badge works for all
            if enrich_bookings and created_at is None and booking_id and getattr(self.client, 'get_booking', None):
                try:
                    full = self.client.get_booking(booking_id)
                    if full is not None:
                        created_at = _get_created_at(_coerce_square_booking_row(full))
                except Exception as e:
                    logger.debug("Could not fetch created_at for booking %s: %s", booking_id[:20] if booking_id else "?", e)
            if isinstance(creator_details, dict):
                creator_type = creator_details.get('creator_type', '') or ''
            else:
                creator_type = getattr(creator_details, 'creator_type', '') or ''
            # booked_by: "customer" | "us" (staff/merchant)
            source_upper = str(raw_source).upper()
            if creator_type == 'CUSTOMER':
                booked_by = 'customer'
            elif creator_type == 'TEAM_MEMBER':
                booked_by = 'us'
            elif 'BUYER' in source_upper:  # FIRST_PARTY_BUYER, THIRD_PARTY_BUYER
                booked_by = 'customer'
            elif 'MERCHANT' in source_upper or source_upper == 'API':
                booked_by = 'us'
            else:
                booked_by = None

            # Main segment for therapist: first non-time-neutral
            main_segment = None
            for seg in segments:
                if not self._segment_is_time_neutral_addon(seg, segments, allow_catalog=allow_cat):
                    main_segment = seg
                    break
            if main_segment is None:
                main_segment = segments[0]
            if isinstance(main_segment, dict):
                team_member_id = main_segment.get('team_member_id', '')
                any_available = bool(main_segment.get('any_team_member', False))
            else:
                team_member_id = getattr(main_segment, 'team_member_id', '') or ''
                any_available = bool(getattr(main_segment, 'any_team_member', False))

            # Prepayment: try Square booking fields (some flows expose it)
            prepayment_amount = None
            if isinstance(booking, dict):
                pm = booking.get('prepayment_money') or booking.get('total_money')
                if pm and isinstance(pm, dict) and (pm.get('amount') or 0) > 0:
                    prepayment_amount = round((pm.get('amount') or 0) / 100.0, 2)
            else:
                pm = getattr(booking, 'prepayment_money', None) or getattr(booking, 'total_money', None)
                if pm and (getattr(pm, 'amount', 0) or 0) > 0:
                    prepayment_amount = round((getattr(pm, 'amount', 0) or 0) / 100.0, 2)

            # Sum only non-add-on segment durations (add-ons like pain relief oil, cupping, aromatherapy = 0 min;
            # eye spa = 0 min only when bundled with another service — see _segment_is_time_neutral_addon)
            total_duration_minutes = 0
            for seg in segments:
                if self._segment_is_time_neutral_addon(seg, segments, allow_catalog=allow_cat):
                    continue
                if isinstance(seg, dict):
                    total_duration_minutes += seg.get('duration_minutes', 0) or 0
                else:
                    total_duration_minutes += getattr(seg, 'duration_minutes', 0) or 0
            if total_duration_minutes <= 0:
                if isinstance(main_segment, dict):
                    total_duration_minutes = main_segment.get('duration_minutes', 60) or 60
                else:
                    total_duration_minutes = getattr(main_segment, 'duration_minutes', 60) or 60
            if len(segments) > 1:
                logger.debug(f"Multiple services: {len(segments)} segments, total non-add-on duration: {total_duration_minutes} min")

            # Parse times
            if not start_at:
                logger.warning(f"Booking {booking_id} skipped: no start_at")
                return None

            start_dt = parser.parse(str(start_at))
            end_dt = start_dt + timedelta(minutes=total_duration_minutes)

            # Get therapist name
            therapist_name = self.get_team_member_name(team_member_id)

            if enrich_bookings:
                customer_name = self.get_customer_name(booking)
                customer_phone = self.get_customer_phone(booking)
                service_name = self.get_service_name(booking)
                service_segments = self.get_service_segments(booking, allow_catalog=True)
                booking_type = self.get_booking_type(booking)
                customer_visits = self.get_customer_visits(customer_id) if customer_id else None
                customer_massage_together_with = (
                    self.get_customer_massage_together_with(customer_id) if customer_id else None
                )
            else:
                customer_name = self.get_customer_name(booking, allow_remote=False)
                customer_phone = ''
                service_name = self._service_name_from_segments_only(booking)
                service_segments = self.get_service_segments(booking, allow_catalog=False)
                booking_type = self.get_booking_type_for_stats(booking)
                customer_visits = None
                customer_massage_together_with = None

            # Couple massage: Square uses two appointment_segments with two team_member_ids.
            therapist_2_name = None
            if (booking_type or "").lower() == "couple" and segments:
                main_tid = (team_member_id or "").strip()
                for seg in segments:
                    if seg is main_segment:
                        continue
                    if self._segment_is_time_neutral_addon(seg, segments, allow_catalog=allow_cat):
                        continue
                    if isinstance(seg, dict):
                        tid = (seg.get("team_member_id") or "").strip()
                        any_tm = bool(seg.get("any_team_member", False))
                    else:
                        tid = (getattr(seg, "team_member_id", None) or "").strip()
                        any_tm = bool(getattr(seg, "any_team_member", False))
                    if any_tm or not tid or tid == main_tid:
                        continue
                    therapist_2_name = self.get_team_member_name(tid)
                    break

            converted_booking = {
                'id': booking_id,
                'start_at': start_dt.isoformat(),
                'end_at': end_dt.isoformat(),
                'therapist': therapist_name,
                'therapist_2': therapist_2_name,
                'service': service_name,
                'service_segments': service_segments,
                'customer': customer_name,
                'customer_id': customer_id or '',
                'customer_phone': customer_phone or '',
                'type': booking_type,
                'status': status,
                'any_available': any_available,
                'prepayment_amount': prepayment_amount,
                'created_at': _normalize_created_at(created_at),
                'customer_visits': customer_visits,
                'customer_massage_together_with': customer_massage_together_with,
                'customer_note': (customer_note or '').strip() or None,
                'seller_note': (seller_note or '').strip() or None,
                'booked_by': booked_by,
            }

            if converted_booking.get('created_at') is None:
                logger.debug(
                    "Booking %s (customer %s) has no created_at from Square; NEW badge will not show.",
                    booking_id[:20] if booking_id else "?",
                    (converted_booking.get('customer') or '?')[:30],
                )
            return converted_booking

        except Exception as e:
            booking_id_str = (
                raw_booking.get("id", "Unknown")
                if isinstance(raw_booking, dict)
                else getattr(raw_booking, "id", "Unknown")
            )
            logger.error(f"Error converting booking {booking_id_str}: {e}")
            return None


    def _list_active_square_bookings_utc_window(
        self, start_at_min: str, start_at_max: str, *, merged_list: bool = True
    ) -> List:
        """List bookings in UTC window + status filter. merged_list=False uses two-pass location merge only (wide ranges)."""
        if merged_list and hasattr(self.client, 'list_bookings_merged_for_range'):
            square_bookings = self.client.list_bookings_merged_for_range(start_at_min, start_at_max)
        elif not merged_list and hasattr(self.client, 'list_bookings_two_pass_location_merge'):
            square_bookings = self.client.list_bookings_two_pass_location_merge(start_at_min, start_at_max)
        else:
            square_bookings = self.client.list_bookings(
                start_at_min=start_at_min,
                start_at_max=start_at_max,
            )
        extra_ids = list(getattr(Config, 'SQUARE_SUPPLEMENT_BOOKING_IDS', None) or [])
        if extra_ids and getattr(self.client, 'bulk_retrieve_bookings', None):
            by_id = {
                self.client._booking_raw_id(b): b
                for b in square_bookings
                if self.client._booking_raw_id(b)
            }
            for b in self.client.bulk_retrieve_bookings(extra_ids):
                bid = self.client._booking_raw_id(b)
                if bid:
                    by_id[bid] = b
            square_bookings = list(by_id.values())
        active_bookings = []
        for b in square_bookings:
            if isinstance(b, dict):
                status = b.get('status', '')
            else:
                status = getattr(b, 'status', '') or ''
            st = (status or '').strip().upper()
            if st not in _SQUARE_LIST_EXCLUDED_STATUSES:
                active_bookings.append(b)
        return active_bookings

    def _list_square_bookings_utc_window_preserving_status(
        self, start_at_min: str, start_at_max: str, *, merged_list: bool = True
    ) -> List:
        """
        Square bookings in UTC window (merged + supplements). No status filter — caller filters.
        Includes NO_SHOW / cancelled rows so reports can inspect them.
        """
        if merged_list and hasattr(self.client, 'list_bookings_merged_for_range'):
            square_bookings = self.client.list_bookings_merged_for_range(start_at_min, start_at_max)
        elif not merged_list and hasattr(self.client, 'list_bookings_two_pass_location_merge'):
            square_bookings = self.client.list_bookings_two_pass_location_merge(start_at_min, start_at_max)
        else:
            square_bookings = self.client.list_bookings(
                start_at_min=start_at_min,
                start_at_max=start_at_max,
            )
        extra_ids = list(getattr(Config, 'SQUARE_SUPPLEMENT_BOOKING_IDS', None) or [])
        if extra_ids and getattr(self.client, 'bulk_retrieve_bookings', None):
            by_id = {
                self.client._booking_raw_id(b): b
                for b in square_bookings
                if self.client._booking_raw_id(b)
            }
            for b in self.client.bulk_retrieve_bookings(extra_ids):
                bid = self.client._booking_raw_id(b)
                if bid:
                    by_id[bid] = b
            square_bookings = list(by_id.values())
        return list(square_bookings or [])

    def list_newest_booked_appointments_report(self, limit: int) -> List[Dict[str, Any]]:
        """
        Bookings in a wide appointment-start window, sorted by created_at (newest first).
        Omits cancelled/declined; keeps NO_SHOW. Adds risk from full fetched set + Square profile note.
        """
        out: List[Dict[str, Any]] = []
        if not self.client or not hasattr(self.client, 'list_bookings'):
            return out
        limit = max(1, min(int(limit or 10), 30))
        try:
            local_tz = dateutil_tz.tzlocal()
            now = datetime.now(local_tz)
            query_lo = now - timedelta(days=365 * 3)
            query_hi = now + timedelta(days=366)
            start_at_min = query_lo.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            start_at_max = query_hi.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            raw_list = self._list_square_bookings_utc_window_preserving_status(
                start_at_min, start_at_max, merged_list=True
            )
        except Exception as e:
            logger.error('list_newest_booked_appointments_report: %s', e, exc_info=True)
            return out

        by_id: Dict[str, Dict] = {}
        for raw in raw_list or []:
            conv = self._convert_raw_booking_row_to_dict(raw, enrich_bookings=True)
            if not conv:
                continue
            bid = (conv.get('id') or '').strip()
            if not bid:
                continue
            st = str(conv.get('status') or '').strip().upper()
            if st in _NEW_APPTS_REPORT_EXCLUDED_STATUSES:
                continue
            by_id[bid] = conv

        def sort_key(b: Dict) -> float:
            ca = b.get('created_at')
            if ca:
                try:
                    dt = parser.parse(str(ca))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=dateutil_tz.UTC)
                    return dt.timestamp()
                except Exception:
                    pass
            sa = b.get('start_at')
            if sa:
                try:
                    dt = parser.parse(str(sa))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=dateutil_tz.UTC)
                    return dt.timestamp()
                except Exception:
                    pass
            return 0.0

        ordered = sorted(by_id.values(), key=sort_key, reverse=True)
        slice_bookings = ordered[:limit]

        by_customer: Dict[str, List[Dict]] = {}
        for b in by_id.values():
            cid = (b.get('customer_id') or '').strip()
            if cid:
                by_customer.setdefault(cid, []).append(b)
        had_ns_map: Dict[str, bool] = {}
        for cid, lst in by_customer.items():
            had_ns_map[cid] = any(
                str(x.get('status') or '').strip().upper() == 'NO_SHOW' for x in lst
            )

        online_cache: Dict[str, Optional[str]] = {}
        for b in slice_bookings:
            cid = (b.get('customer_id') or '').strip()
            bid = (b.get('id') or '').strip()
            had_ns = had_ns_map.get(cid, False) if cid else False
            online_note: Optional[str] = None
            if cid:
                if cid not in online_cache:
                    online_cache[cid] = self.get_customer_must_book_online_note(cid)
                online_note = online_cache[cid]
            online_s = (online_note or '').strip() or None
            out.append(
                {
                    'booking_id': bid,
                    'customer': (b.get('customer') or '').strip() or '—',
                    'customer_id': cid,
                    'created_at': b.get('created_at'),
                    'start_at': b.get('start_at') or '',
                    'end_at': b.get('end_at') or '',
                    'service': (b.get('service') or '').strip() or '—',
                    'therapist': (b.get('therapist') or '').strip(),
                    'square_status': str(b.get('status') or '').strip().upper() or 'UNKNOWN',
                    'booked_by': b.get('booked_by'),
                    'had_square_no_show': had_ns,
                    'online_only_note': online_s,
                }
            )
        return out

    def _bucket_active_bookings_by_local_date(
        self,
        active_bookings: List,
        local_tz,
        start_date: str,
        end_date: str,
        *,
        enrich_bookings: bool = True,
    ) -> Dict[str, List[Dict]]:
        """Assign each active booking to its local start date and convert."""
        by_date: Dict[str, List[Dict]] = {}
        for booking in active_bookings:
            ds = _raw_booking_local_date_str(booking, local_tz)
            if not ds or ds < start_date or ds > end_date:
                continue
            conv = self._convert_raw_booking_row_to_dict(booking, enrich_bookings=enrich_bookings)
            if conv:
                by_date.setdefault(ds, []).append(conv)
        for k in list(by_date.keys()):
            by_date[k].sort(key=lambda b: b['start_at'])
        return by_date

    def get_bookings_by_local_date_range(
        self,
        start_date: str,
        end_date: str,
        *,
        merged_list: bool = True,
        enrich_bookings: bool = True,
    ) -> Dict[str, List[Dict]]:
        """
        One Square fetch for [start_date, end_date] inclusive (local days), bucketed by local start date.
        merged_list=False: skip per-team-member list passes (use for wide reports).
        enrich_bookings=False: skip customer/catalog extras when converting rows (use with wide reports).
        """
        if not self.client:
            return {}
        try:
            local_tz = dateutil_tz.tzlocal()
            d0 = datetime.strptime(start_date, '%Y-%m-%d')
            d1 = datetime.strptime(end_date, '%Y-%m-%d')
            local_start = d0.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
            local_end_exclusive = d1.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz) + timedelta(days=1)
            query_lo = local_start - timedelta(hours=2)
            query_hi = local_end_exclusive + timedelta(hours=2)
            start_at_min = query_lo.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            start_at_max = query_hi.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            active = self._list_active_square_bookings_utc_window(
                start_at_min, start_at_max, merged_list=merged_list
            )
            by_date = self._bucket_active_bookings_by_local_date(
                active, local_tz, start_date, end_date, enrich_bookings=enrich_bookings
            )
            total = sum(len(v) for v in by_date.values())
            logger.info(
                'Square range %s..%s: %d converted bookings across %d local days (one API window)',
                start_date, end_date, total, len(by_date),
            )
            return by_date
        except Exception as e:
            logger.error('Error fetching bookings range from Square: %s', e, exc_info=True)
            return {}

    def get_bookings_for_date(self, date: str) -> List[Dict]:
        """Single local day; uses one range query (same as multi-day path) for consistency."""
        if not self.client:
            logger.warning('Square API not configured, returning empty list')
            return []
        m = self.get_bookings_by_local_date_range(date, date)
        out = m.get(date, [])
        logger.info('Fetched %d bookings for %s', len(out), date)
        return out

    def list_recent_bookings_for_customer(
        self, customer_id: str, limit: int = 10
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Last N Square bookings for one customer, newest by created_at first.
        Includes NO_SHOW and other statuses (unlike day grid, which omits NO_SHOW).
        """
        empty_flags: Dict[str, Any] = {"had_square_no_show": False, "online_only_note": None}
        if not self.client or not customer_id or not str(customer_id).strip():
            return [], empty_flags
        cid = str(customer_id).strip()
        limit = max(1, min(int(limit or 10), 30))
        if not hasattr(self.client, "list_bookings"):
            return [], empty_flags
        try:
            local_tz = dateutil_tz.tzlocal()
            now = datetime.now(local_tz)
            query_lo = now - timedelta(days=365 * 3)
            query_hi = now + timedelta(days=366)
            start_at_min = query_lo.astimezone(dateutil_tz.UTC).isoformat().replace("+00:00", "Z")
            start_at_max = query_hi.astimezone(dateutil_tz.UTC).isoformat().replace("+00:00", "Z")
            raw_list = self.client.list_bookings(
                start_at_min, start_at_max, customer_id=cid
            )
        except Exception as e:
            logger.error("list_recent_bookings_for_customer: %s", e, exc_info=True)
            return [], empty_flags

        by_id: Dict[str, Dict] = {}
        for raw in raw_list or []:
            conv = self._convert_raw_booking_row_to_dict(raw, enrich_bookings=True)
            if not conv:
                continue
            bid = (conv.get("id") or "").strip()
            if not bid:
                continue
            by_id[bid] = conv

        def sort_key(b: Dict) -> float:
            ca = b.get("created_at")
            if ca:
                try:
                    dt = parser.parse(str(ca))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=dateutil_tz.UTC)
                    return dt.timestamp()
                except Exception:
                    pass
            sa = b.get("start_at")
            if sa:
                try:
                    dt = parser.parse(str(sa))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=dateutil_tz.UTC)
                    return dt.timestamp()
                except Exception:
                    pass
            return 0.0

        ordered = sorted(by_id.values(), key=sort_key, reverse=True)
        slice_ = ordered[:limit]
        # Flag any NO_SHOW in the full fetched range (not only the last N shown), for desk risk.
        had_no_show = any(
            str(b.get("status") or "").strip().upper() == "NO_SHOW" for b in ordered
        )
        online_note = self.get_customer_must_book_online_note(cid)
        items: List[Dict[str, Any]] = []
        for b in slice_:
            items.append(
                {
                    "booking_id": b.get("id") or "",
                    "start_at": b.get("start_at") or "",
                    "end_at": b.get("end_at") or "",
                    "service": b.get("service") or "",
                    "therapist": (b.get("therapist") or "").strip(),
                    "created_at": b.get("created_at"),
                    "square_status": str(b.get("status") or "").strip().upper() or "UNKNOWN",
                }
            )
        return items, {
            "had_square_no_show": had_no_show,
            "online_only_note": online_note,
        }

    def get_suggested_tips_for_bookings(self, date: str, bookings: list) -> tuple:
        """
        Pull tips and prepayment amounts from Square payments for the given date and match to bookings.
        Returns (suggested_tips, suggested_prepayments) where each is dict booking_id -> amount (float).
        Match by: (1) customer_id + same day; (2) payment note containing service or customer name.
        """
        empty = ({}, {})
        if not self.client or not getattr(self.client, 'list_payments', None):
            return empty
        try:
            from dateutil import parser as date_parser
            local_tz = dateutil_tz.tzlocal()
            date_obj = datetime.strptime(date, '%Y-%m-%d')
            local_start = date_obj.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
            local_end = local_start + timedelta(days=1)
            begin_time = local_start.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            end_time = local_end.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            payments = self.client.list_payments(begin_time=begin_time, end_time=end_time)
            payments_with_tip = [p for p in payments if (p.get('tip_dollars') or 0) > 0]
            payments_with_amount = [p for p in payments if (p.get('amount_dollars') or 0) > 0]
            logger.info("Tips: date=%s bookings=%d payments_with_tip=%d payments_with_amount=%d",
                        date, len(bookings), len(payments_with_tip), len(payments_with_amount))
            suggested = {}
            suggested_prepayments = {}
            used_payment_ids = set()
            used_for_prepayment = set()
            bookings_by_id = {b.get('booking_id') or b.get('id'): b for b in bookings}
            for bid, b in list(bookings_by_id.items())[:10]:
                logger.info("  booking id=%s customer=%r customer_id=%s service=%s",
                            (bid or '')[:12], b.get('customer'), (b.get('customer_id') or '')[:20] or '(none)', (b.get('service') or '')[:30])
            # 1) Match by customer_id + same day (payment created_at is already that day)
            for bid, b in bookings_by_id.items():
                cid = (b.get('customer_id') or '').strip()
                if not cid:
                    continue
                candidates = [p for p in payments_with_tip if (p.get('customer_id') or '').strip() == cid and p.get('id') not in used_payment_ids]
                if not candidates:
                    continue
                # Prefer payment closest to booking end (tip often added after service)
                start_at = b.get('start_at') or ''
                if start_at:
                    try:
                        booking_end = date_parser.parse(start_at)
                        if isinstance(b.get('end_at'), str):
                            booking_end = date_parser.parse(b['end_at'])
                        else:
                            booking_end = booking_end + timedelta(minutes=60)
                        def dist(p):
                            ct = p.get('created_at') or ''
                            if not ct:
                                return float('inf')
                            try:
                                pt = date_parser.parse(ct)
                                return abs((pt - booking_end).total_seconds())
                            except Exception:
                                return float('inf')
                        candidates.sort(key=dist)
                    except Exception:
                        pass
                p = candidates[0]
                suggested[bid] = p['tip_dollars']
                suggested_prepayments[bid] = (p.get('amount_dollars') or 0)
                used_payment_ids.add(p['id'])
                used_for_prepayment.add(p['id'])
            # 2) For bookings still without a tip: match by note containing service name or customer name
            def payment_note_matches_booking(p, b, used):
                if p.get('id') in used:
                    return False
                note = (p.get('note') or '').lower()
                if not note:
                    return False
                service_name = (b.get('service') or '').lower()
                customer_name = (b.get('customer') or '').strip().lower()
                if service_name and len(service_name) >= 3 and service_name in note:
                    return True
                if not customer_name or len(customer_name) < 2:
                    return False
                parts = customer_name.split()
                first = parts[0]
                last = parts[-1] if len(parts) > 1 else ''
                if first in note:
                    return True
                if last and last in note:
                    return True
                if customer_name in note:
                    return True
                if all(part in note for part in parts if len(part) >= 2):
                    return True
                return False

            for bid, b in bookings_by_id.items():
                if bid in suggested:
                    continue
                candidates = [p for p in payments_with_tip if payment_note_matches_booking(p, b, used_payment_ids)]
                if not candidates:
                    continue
                # Prefer payment closest to booking end (tip often added after service)
                start_at = b.get('start_at') or ''
                end_at = b.get('end_at') or ''
                if end_at or start_at:
                    try:
                        end_dt = date_parser.parse(end_at) if end_at else date_parser.parse(start_at) + timedelta(minutes=60)
                        def dist(p):
                            ct = p.get('created_at') or ''
                            if not ct:
                                return float('inf')
                            try:
                                return abs((date_parser.parse(ct) - end_dt).total_seconds())
                            except Exception:
                                return float('inf')
                        candidates.sort(key=dist)
                    except Exception:
                        pass
                p = candidates[0]
                suggested[bid] = p['tip_dollars']
                suggested_prepayments[bid] = (p.get('amount_dollars') or 0)
                used_payment_ids.add(p['id'])
                used_for_prepayment.add(p['id'])
            # 3) Last resort: one unmatched payment with tip and one unmatched booking - match by time proximity
            unmatched_bookings = [b for bid, b in bookings_by_id.items() if bid not in suggested]
            unmatched_payments = [p for p in payments_with_tip if p.get('id') not in used_payment_ids]
            if len(unmatched_bookings) == 1 and len(unmatched_payments) == 1:
                bid = next(bid for bid, b in bookings_by_id.items() if bid not in suggested)
                p = unmatched_payments[0]
                suggested[bid] = p['tip_dollars']
                suggested_prepayments[bid] = (p.get('amount_dollars') or 0)
                used_for_prepayment.add(p['id'])
            # 4) Prepayment-only: match any payment with amount to bookings not yet having prepayment (customer_id or note)
            for bid, b in bookings_by_id.items():
                if bid in suggested_prepayments:
                    continue
                cid = (b.get('customer_id') or '').strip()
                candidates = [p for p in payments_with_amount if p.get('id') not in used_for_prepayment]
                if cid:
                    candidates = [p for p in candidates if (p.get('customer_id') or '').strip() == cid]
                if not candidates and not cid:
                    for p in payments_with_amount:
                        if p.get('id') in used_for_prepayment:
                            continue
                        if payment_note_matches_booking(p, b, used_for_prepayment):
                            candidates.append(p)
                            break
                if not candidates:
                    continue
                start_at = b.get('start_at') or ''
                if start_at:
                    try:
                        booking_end = date_parser.parse(start_at)
                        if isinstance(b.get('end_at'), str):
                            booking_end = date_parser.parse(b['end_at'])
                        else:
                            booking_end = booking_end + timedelta(minutes=60)
                        def dist_prepay(p):
                            ct = p.get('created_at') or ''
                            if not ct:
                                return float('inf')
                            try:
                                return abs((date_parser.parse(ct) - booking_end).total_seconds())
                            except Exception:
                                return float('inf')
                        candidates.sort(key=dist_prepay)
                    except Exception:
                        pass
                p = candidates[0]
                suggested_prepayments[bid] = (p.get('amount_dollars') or 0)
                used_for_prepayment.add(p['id'])
            logger.info("Tips: suggested_tips=%s suggested_prepayments=%s", suggested, suggested_prepayments)
            return (suggested, suggested_prepayments)
        except Exception as e:
            logger.warning("Could not pull suggested tips from Square: %s", e)
            return ({}, {})

