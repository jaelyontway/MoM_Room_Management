"""Room assignment algorithm for bookings."""
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from dateutil import parser
from square_client import SquareBookingsClient
from config import Config
from database import get_assignments_for_date, save_room_assignment

logger = logging.getLogger(__name__)


class RoomAssignment:
    """Handles room assignment logic for bookings."""
    
    # Room priorities
    SINGLE_ROOMS_PRIORITY = ['1', '3', '4', '5', '6', '0', '2']
    COUPLE_ROOMS_PRIORITY = ['5', '6', '02D']  # 02D means rooms 0+2 merged
    
    def __init__(self):
        """Initialize room assignment handler."""
        self.client = SquareBookingsClient()
    
    def is_couple_booking(self, booking: Dict) -> bool:
        """Check if a booking is a couple's massage."""
        return self.client.is_couples_massage(booking)
    
    def extract_booking_info(self, booking: Dict) -> Optional[Dict]:
        """Extract relevant information from a Square booking."""
        try:
            segments = booking.get('appointment_segments', [])
            if not segments:
                return None
            
            segment = segments[0]
            start_at = booking.get('start_at')
            duration_minutes = segment.get('duration_minutes', 60)
            
            # Parse times
            start_dt = parser.parse(start_at)
            end_dt = start_dt + timedelta(minutes=duration_minutes)
            
            # Get service name
            service_name = segment.get('service_variation_name', '')
            
            # Get therapist
            therapist_id = segment.get('team_member_id', '')
            therapist_name = ''  # Could fetch from team members API if needed
            
            # Get customer name
            customer_id = booking.get('customer_id', '')
            customer_name = booking.get('customer_note', '') or 'Unknown'
            
            return {
                'id': booking.get('id'),
                'start_at': start_at,
                'start_dt': start_dt,
                'end_dt': end_dt,
                'duration_minutes': duration_minutes,
                'service_name': service_name,
                'therapist_id': therapist_id,
                'therapist_name': therapist_name,
                'customer_name': customer_name,
                'status': booking.get('status'),
                'type': 'couple' if self.is_couple_booking(booking) else 'single'
            }
        except Exception as e:
            logger.error(f"Error extracting booking info: {e}")
            return None
    
    def assign_rooms(self, bookings: List[Dict], date: str) -> List[Dict]:
        """
        Assign rooms to bookings using greedy algorithm with priorities.
        
        Args:
            bookings: List of booking info dicts (from extract_booking_info)
            date: Date string in YYYY-MM-DD format
            
        Returns:
            List of bookings with room assignments added
        """
        # Get existing assignments for this date
        existing_assignments = get_assignments_for_date(date)
        
        # Track busy times for each room (stored as timestamps)
        busy_until = {
            '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0
        }
        
        # Sort bookings by start time
        sorted_bookings = sorted(bookings, key=lambda b: b['start_dt'])
        
        for booking in sorted_bookings:
            booking_id = booking['id']
            start_ts = booking['start_dt'].timestamp()
            end_ts = booking['end_dt'].timestamp()
            
            # Check if there's an existing manual assignment
            if booking_id in existing_assignments:
                existing = existing_assignments[booking_id]
                if existing['assigned_by'] == 'manager':
                    # Preserve manual assignment, but mark room as busy
                    room = existing['room']
                    if room == '02D':
                        busy_until['0'] = max(busy_until['0'], end_ts)
                        busy_until['2'] = max(busy_until['2'], end_ts)
                    elif room in busy_until:
                        busy_until[room] = max(busy_until[room], end_ts)
                    booking['room'] = room
                    booking['assigned_by'] = 'manager'
                    continue
            
            # Try to assign room
            room, reason = self._find_available_room(
                booking, start_ts, end_ts, busy_until
            )
            
            booking['room'] = room
            booking['reason'] = reason
            
            # Update busy times
            if room == '02D':
                busy_until['0'] = end_ts
                busy_until['2'] = end_ts
            elif room in busy_until:
                busy_until[room] = end_ts
            
            # Save to database
            save_room_assignment(
                booking_id=booking_id,
                room=room,
                assigned_by='auto',
                date=date,
                reason=reason
            )
        
        return sorted_bookings
    
    def _find_available_room(
        self,
        booking: Dict,
        start_ts: float,
        end_ts: float,
        busy_until: Dict[str, float]
    ) -> tuple:
        """
        Find an available room for a booking.
        
        Returns:
            Tuple of (room, reason) where reason is None if assigned successfully
        """
        def is_free(room: str) -> bool:
            return busy_until[room] <= start_ts
        
        if booking['type'] == 'couple':
            # Try couple rooms in priority order
            for room in ['5', '6']:
                if is_free(room):
                    return room, None
            
            # Try merged room 0+2
            if is_free('0') and is_free('2'):
                return '02D', None
            
            return 'UNASSIGNED', 'No double room available (5/6 busy and 0+2 not both free)'
        
        else:  # single
            # Try single rooms in priority order
            for room in self.SINGLE_ROOMS_PRIORITY:
                if is_free(room):
                    return room, None
            
            return 'UNASSIGNED', 'No room available'
    
    def get_bookings_for_date(self, date: str) -> List[Dict]:
        """
        Get all bookings for a specific date with room assignments.
        
        Args:
            date: Date string in YYYY-MM-DD format
            
        Returns:
            List of booking dicts with room assignments
        """
        # Parse date and create time range
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        start_at_min = date_obj.isoformat()
        start_at_max = (date_obj + timedelta(days=1)).isoformat()
        
        # Fetch bookings from Square
        bookings = self.client.list_bookings(
            start_at_min=start_at_min,
            start_at_max=start_at_max
        )
        
        # Filter out cancelled bookings
        active_bookings = [
            b for b in bookings
            if b.get('status') not in ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED']
        ]
        
        # Extract booking info
        booking_infos = []
        for booking in active_bookings:
            info = self.extract_booking_info(booking)
            if info:
                booking_infos.append(info)
        
        # Assign rooms
        assigned_bookings = self.assign_rooms(booking_infos, date)
        
        return assigned_bookings

