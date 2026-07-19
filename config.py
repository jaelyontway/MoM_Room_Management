"""Configuration management for Square Bookings Sync."""
import os
from typing import Optional

from dotenv import load_dotenv

# Square test / placeholder profiles (exact calendar display name, case-insensitive): hidden from calendar and headcounts.
_EXCLUDED_TEST_CUSTOMER_DISPLAY_NAMES_NORMALIZED = frozenset({"rich bernstein"})


def customer_display_excluded_from_calendar_and_counts(customer_name: Optional[str]) -> bool:
    """True when this booking's display customer should not appear on the dashboard calendar or in customer counts."""
    n = (customer_name or "").strip().lower()
    return bool(n) and n in _EXCLUDED_TEST_CUSTOMER_DISPLAY_NAMES_NORMALIZED

# Load environment variables
load_dotenv()

class Config:
    """Application configuration."""
    
    # Square API Configuration
    SQUARE_ACCESS_TOKEN = os.getenv('SQUARE_ACCESS_TOKEN', '')
    SQUARE_APPLICATION_ID = os.getenv('SQUARE_APPLICATION_ID', '')
    SQUARE_LOCATION_ID = os.getenv('SQUARE_LOCATION_ID', '')
    SQUARE_ENVIRONMENT = os.getenv('SQUARE_ENVIRONMENT', 'sandbox')
    # Comma-separated Square booking IDs to always merge in (List Bookings often omits recurring instances).
    SQUARE_SUPPLEMENT_BOOKING_IDS = [
        x.strip() for x in os.getenv('SQUARE_SUPPLEMENT_BOOKING_IDS', '').split(',') if x.strip()
    ]
    # Comma-separated Square customer IDs: extra List Bookings calls with customer_id=... (recurring
    # Saturday slots etc. sometimes missing from location/team lists; add Angela's Square customer id).
    SQUARE_SUPPLEMENT_CUSTOMER_IDS = [
        x.strip() for x in os.getenv('SQUARE_SUPPLEMENT_CUSTOMER_IDS', '').split(',') if x.strip()
    ]
    
    # Webhook Configuration
    WEBHOOK_SECRET = os.getenv('WEBHOOK_SECRET', '')
    WEBHOOK_PORT = int(os.getenv('WEBHOOK_PORT', '5000'))
    
    # Service Configuration
    COUPLES_MASSAGE_SERVICE_ID = os.getenv('COUPLES_MASSAGE_SERVICE_ID', '')
    COUPLES_MASSAGE_SERVICE_NAME_PATTERN = os.getenv(
        'COUPLES_MASSAGE_SERVICE_NAME_PATTERN', 
        'couple'
    ).lower()

    # Availability audit (GET /api/availability-audit): compare Square SearchAvailability vs room striping.
    # Optional explicit catalog variation IDs (recommended for production). If blank, names + duration resolve via catalog.
    SQUARE_AUDIT_SINGLE_VARIATION_ID = os.getenv('SQUARE_AUDIT_SINGLE_VARIATION_ID', '').strip()
    SQUARE_AUDIT_COUPLE_VARIATION_ID = os.getenv('SQUARE_AUDIT_COUPLE_VARIATION_ID', '').strip()
    SQUARE_AUDIT_SINGLE_SERVICE_NAME = os.getenv('SQUARE_AUDIT_SINGLE_SERVICE_NAME', 'Swedish Massage').strip()
    SQUARE_AUDIT_COUPLE_SERVICE_NAME = os.getenv('SQUARE_AUDIT_COUPLE_SERVICE_NAME', 'Couples Massage').strip()
    SQUARE_AUDIT_DURATION_MINUTES = int(os.getenv('SQUARE_AUDIT_DURATION_MINUTES', '60'))
    
    # Therapist Configuration
    THERAPIST_IDS = [
        tid.strip() 
        for tid in os.getenv('THERAPIST_TEAM_MEMBER_IDS', '').split(',') 
        if tid.strip()
    ]

    # No-room notifications (SMS + email when a booking has no room)
    NO_ROOM_SMS_PHONE = os.getenv('NO_ROOM_SMS_PHONE', '9173787373')
    NO_ROOM_EMAIL_TO = os.getenv('NO_ROOM_EMAIL_TO', 'melispatex@gmail.com')
    NO_ROOM_ALERT_COOLDOWN_MINUTES = int(os.getenv('NO_ROOM_ALERT_COOLDOWN_MINUTES', '10'))  # Min minutes between sends per date
    # Twilio (optional): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (e.g. +19175551234)
    TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID', '')
    TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN', '')
    TWILIO_FROM_NUMBER = os.getenv('TWILIO_FROM_NUMBER', '')
    # SMTP for email (optional): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
    SMTP_HOST = os.getenv('SMTP_HOST', '')
    SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
    SMTP_USER = os.getenv('SMTP_USER', '')
    SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
    SMTP_FROM = os.getenv('SMTP_FROM', '') or os.getenv('SMTP_USER', '')
    
    @classmethod
    def validate(cls):
        """Validate required configuration values."""
        required = [
            ('SQUARE_ACCESS_TOKEN', cls.SQUARE_ACCESS_TOKEN),
            ('SQUARE_LOCATION_ID', cls.SQUARE_LOCATION_ID),
        ]
        
        missing = [name for name, value in required if not value]
        if missing:
            raise ValueError(
                f"Missing required configuration: {', '.join(missing)}"
            )
        
        return True

