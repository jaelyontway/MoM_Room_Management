"""Configuration management for Square Bookings Sync."""
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Config:
    """Application configuration."""
    
    # Square API Configuration
    SQUARE_ACCESS_TOKEN = os.getenv('SQUARE_ACCESS_TOKEN', '')
    SQUARE_APPLICATION_ID = os.getenv('SQUARE_APPLICATION_ID', '')
    SQUARE_LOCATION_ID = os.getenv('SQUARE_LOCATION_ID', '')
    SQUARE_ENVIRONMENT = os.getenv('SQUARE_ENVIRONMENT', 'sandbox')
    
    # Webhook Configuration
    WEBHOOK_SECRET = os.getenv('WEBHOOK_SECRET', '')
    WEBHOOK_PORT = int(os.getenv('WEBHOOK_PORT', '5000'))
    
    # Service Configuration
    COUPLES_MASSAGE_SERVICE_ID = os.getenv('COUPLES_MASSAGE_SERVICE_ID', '')
    COUPLES_MASSAGE_SERVICE_NAME_PATTERN = os.getenv(
        'COUPLES_MASSAGE_SERVICE_NAME_PATTERN', 
        'couple'
    ).lower()
    
    # Therapist Configuration
    THERAPIST_IDS = [
        tid.strip() 
        for tid in os.getenv('THERAPIST_TEAM_MEMBER_IDS', '').split(',') 
        if tid.strip()
    ]
    
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

