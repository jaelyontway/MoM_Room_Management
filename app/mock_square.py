"""Mock Square Bookings API data for development."""
from typing import List, Dict
from datetime import datetime, timedelta
import random


class MockSquareService:
    """Mock service that simulates Square Bookings API responses."""
    
    # Allowed therapists (case-insensitive matching)
    ALLOWED_THERAPISTS = [
        "cassey t", "hanna I", "hongxia shaw", "jenny l",
        "katy m", "may l", "rose j", "sophia e", "tina r", "vicky w", "amy rz"
    ]
    
    # Mock therapists (for mock data generation)
    THERAPISTS = ["Katy M", "May L", "Jenny L", "Cassey T", 
                  "Hanna I", "Hongxia Shaw", "Rose J", "Sophia E", "Tina R", "Vicky W", "Amy RZ"]
    
    # Mock services
    SERVICES = [
        "Swedish Massage",
        "Deep Tissue Massage",
        "Hot Stone Massage",
        "Couple's Massage",
        "Couple's Spa Package",
        "Aromatherapy Massage",
        "Sports Massage"
    ]
    
    # Mock customers
    CUSTOMERS = [
        "Brian", "Alice", "John", "Mary", "David", 
        "Lisa", "Michael", "Jennifer", "Robert", "Patricia"
    ]
    
    def get_bookings_for_date(self, date: str) -> List[Dict]:
        """
        Get mock bookings for a specific date.
        
        Args:
            date: Date string in YYYY-MM-DD format
            
        Returns:
            List of booking dicts in Square-like format
        """
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        
        # Generate mock bookings
        bookings = []
        
        # Generate 8-12 random bookings throughout the day
        num_bookings = random.randint(8, 12)
        
        for i in range(num_bookings):
            # Random start time between 9 AM and 6 PM
            hour = random.randint(9, 17)
            minute = random.choice([0, 15, 30, 45])
            start_dt = date_obj.replace(hour=hour, minute=minute, second=0)
            
            # Duration: 60 or 90 minutes
            duration = random.choice([60, 90])
            end_dt = start_dt + timedelta(minutes=duration)
            
            # Random therapist (only from allowed list)
            therapist = random.choice(self.ALLOWED_THERAPISTS)
            
            # Random service (higher chance of couple's services)
            service = random.choice(self.SERVICES)
            is_couple = 'couple' in service.lower()
            
            # Random customer
            customer = random.choice(self.CUSTOMERS)
            
            booking = {
                'id': f"booking_{date.replace('-', '')}_{i:03d}",
                'start_at': start_dt.isoformat(),
                'end_at': end_dt.isoformat(),
                'therapist': therapist,
                'service': service,
                'customer': customer,
                'type': 'couple' if is_couple else 'single',
                'status': 'ACCEPTED'
            }
            
            bookings.append(booking)
        
        # Sort by start time
        bookings.sort(key=lambda b: b['start_at'])
        
        return bookings
    
    def get_therapists(self) -> List[str]:
        """Get list of all therapists."""
        return self.ALLOWED_THERAPISTS.copy()
    
    def get_test_scenario_1(self, date: str) -> List[Dict]:
        """Test scenario: 3 couple + 3 single => couples use 5,6,02D; singles use 1,3,4"""
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        base_time = date_obj.replace(hour=10, minute=0, second=0)
        
        bookings = [
            # 3 couple bookings - all at same time
            {
                'id': f"test_c1_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Katy M',
                'service': "Couple's Massage",
                'customer': 'Couple1',
                'type': 'couple',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_c2_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'May L',
                'service': "Couple's Massage",
                'customer': 'Couple2',
                'type': 'couple',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_c3_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Jenny L',
                'service': "Couple's Massage",
                'customer': 'Couple3',
                'type': 'couple',
                'status': 'ACCEPTED'
            },
            # 3 single bookings - all at same time
            {
                'id': f"test_s1_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Amy RZ',
                'service': 'Swedish Massage',
                'customer': 'Single1',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s2_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Rose J',
                'service': 'Deep Tissue',
                'customer': 'Single2',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s3_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Katy M',
                'service': 'Hot Stone',
                'customer': 'Single3',
                'type': 'single',
                'status': 'ACCEPTED'
            },
        ]
        return bookings
    
    def get_test_scenario_2(self, date: str) -> List[Dict]:
        """Test scenario: 2 couple + 5 single => couples 5,6; singles 1,3,4,0,2"""
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        base_time = date_obj.replace(hour=10, minute=0, second=0)
        
        bookings = [
            # 2 couple bookings - all at same time
            {
                'id': f"test_c1_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Katy M',
                'service': "Couple's Massage",
                'customer': 'Couple1',
                'type': 'couple',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_c2_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'May L',
                'service': "Couple's Massage",
                'customer': 'Couple2',
                'type': 'couple',
                'status': 'ACCEPTED'
            },
            # 5 single bookings - all at same time
            {
                'id': f"test_s1_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Jenny L',
                'service': 'Swedish Massage',
                'customer': 'Single1',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s2_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Amy RZ',
                'service': 'Deep Tissue',
                'customer': 'Single2',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s3_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Rose J',
                'service': 'Hot Stone',
                'customer': 'Single3',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s4_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Katy M',
                'service': 'Aromatherapy',
                'customer': 'Single4',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s5_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'May L',
                'service': 'Sports Massage',
                'customer': 'Single5',
                'type': 'single',
                'status': 'ACCEPTED'
            },
        ]
        return bookings
    
    def get_test_scenario_3(self, date: str) -> List[Dict]:
        """Test scenario: 0 couple + 7 single => fill 1,3,4,5,6,0,2 (7 singles total)"""
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        base_time = date_obj.replace(hour=10, minute=0, second=0)
        
        bookings = [
            # 7 single bookings - all at same time
            {
                'id': f"test_s1_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Katy M',
                'service': 'Swedish Massage',
                'customer': 'Single1',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s2_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'May L',
                'service': 'Deep Tissue',
                'customer': 'Single2',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s3_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Jenny L',
                'service': 'Hot Stone',
                'customer': 'Single3',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s4_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Amy RZ',
                'service': 'Aromatherapy',
                'customer': 'Single4',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s5_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Rose J',
                'service': 'Sports Massage',
                'customer': 'Single5',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s6_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'Katy M',
                'service': 'Swedish Massage',
                'customer': 'Single6',
                'type': 'single',
                'status': 'ACCEPTED'
            },
            {
                'id': f"test_s7_{date.replace('-', '')}",
                'start_at': (base_time + timedelta(hours=0)).isoformat(),
                'end_at': (base_time + timedelta(hours=1)).isoformat(),
                'therapist': 'May L',
                'service': 'Deep Tissue',
                'customer': 'Single7',
                'type': 'single',
                'status': 'ACCEPTED'
            },
        ]
        return bookings

