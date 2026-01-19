"""Core logic for syncing couple's massage bookings."""
import logging
from typing import Optional, Dict
from square_client import SquareBookingsClient

logger = logging.getLogger(__name__)


class BookingSync:
    """Handles syncing couple's massage bookings to block two therapists."""
    
    def __init__(self):
        """Initialize the booking sync handler."""
        self.client = SquareBookingsClient()
        # Store mapping of original booking ID to secondary booking ID
        self.booking_mappings = {}
    
    def process_new_booking(self, booking_id: str) -> Optional[Dict]:
        """
        Process a new booking and create a secondary block if it's a couple's massage.
        
        Args:
            booking_id: The ID of the booking to process
            
        Returns:
            The secondary booking if created, None otherwise
        """
        try:
            # Get the booking details
            booking = self.client.get_booking(booking_id)
            if not booking:
                logger.error(f"Could not retrieve booking {booking_id}")
                return None
            
            # Check if this is already a secondary booking (avoid recursion)
            if booking.get('customer_note', '').startswith('SYNC_BLOCK:'):
                logger.info(f"Booking {booking_id} is already a secondary block, skipping")
                return None
            
            # Check if this is a couple's massage
            if not self.client.is_couples_massage(booking):
                logger.info(f"Booking {booking_id} is not a couple's massage, skipping")
                return None
            
            # Get the primary therapist (first appointment segment)
            segments = booking.get('appointment_segments', [])
            if not segments:
                logger.warning(f"Booking {booking_id} has no appointment segments")
                return None
            
            primary_therapist_id = segments[0].get('team_member_id')
            if not primary_therapist_id:
                logger.warning(f"Booking {booking_id} has no team member assigned")
                return None
            
            # Get booking details
            start_at = booking.get('start_at')
            duration_minutes = segments[0].get('duration_minutes', 60)
            
            # Check if we've already created a secondary booking for this
            if booking_id in self.booking_mappings:
                logger.info(f"Secondary booking already exists for {booking_id}")
                return None
            
            # Find an available therapist
            available_therapist = self.client.get_available_team_member(
                start_at=start_at,
                duration_minutes=duration_minutes,
                exclude_team_member_id=primary_therapist_id
            )
            
            if not available_therapist:
                logger.warning(
                    f"No available therapist found for couple's massage booking {booking_id}"
                )
                return None
            
            # Create blocked time for the second therapist
            # Use the same service variation as the original booking if available
            from square.client.models import AppointmentSegment
            
            original_segment = segments[0]
            service_variation_id = original_segment.get('service_variation_id')
            service_variation_version = original_segment.get('service_variation_version', 1)
            
            secondary_segments = [
                AppointmentSegment(
                    team_member_id=available_therapist.get('id'),
                    service_variation_id=service_variation_id,
                    service_variation_version=service_variation_version,
                    duration_minutes=duration_minutes
                )
            ]
            
            # Create blocked time for the second therapist
            secondary_booking = self.client.create_blocked_time(
                team_member_id=available_therapist.get('id'),
                start_at=start_at,
                duration_minutes=duration_minutes,
                appointment_segments=secondary_segments
            )
            
            if secondary_booking:
                secondary_id = secondary_booking.get('id')
                self.booking_mappings[booking_id] = secondary_id
                logger.info(
                    f"Created secondary booking {secondary_id} for therapist "
                    f"{available_therapist.get('id')} linked to primary booking {booking_id}"
                )
                
                # Store the mapping in the secondary booking's note
                # Note: Square API may not support updating notes, but we'll track it locally
                return secondary_booking
            else:
                logger.error(f"Failed to create secondary booking for {booking_id}")
                return None
                
        except Exception as e:
            logger.error(f"Exception processing booking {booking_id}: {e}", exc_info=True)
            return None
    
    def process_cancellation(self, booking_id: str):
        """
        Handle cancellation of a booking - cancel the linked secondary booking if it exists.
        
        Args:
            booking_id: The ID of the booking that was cancelled
        """
        try:
            # Check if this is a primary booking with a secondary linked
            if booking_id in self.booking_mappings:
                secondary_id = self.booking_mappings[booking_id]
                logger.info(f"Cancelling secondary booking {secondary_id} for cancelled primary {booking_id}")
                
                # Get the secondary booking to get its version
                secondary_booking = self.client.get_booking(secondary_id)
                if secondary_booking:
                    version = secondary_booking.get('version', 0)
                    self.client.cancel_booking(secondary_id, version)
                
                # Remove from mappings
                del self.booking_mappings[booking_id]
            
            # Check if this is a secondary booking
            elif booking_id in self.booking_mappings.values():
                # Find the primary booking ID
                primary_id = None
                for pid, sid in self.booking_mappings.items():
                    if sid == booking_id:
                        primary_id = pid
                        break
                
                if primary_id:
                    logger.info(f"Secondary booking {booking_id} cancelled, removing mapping")
                    del self.booking_mappings[primary_id]
                
        except Exception as e:
            logger.error(f"Exception processing cancellation for {booking_id}: {e}", exc_info=True)
    
    def process_reschedule(self, booking_id: str):
        """
        Handle rescheduling of a booking - update the linked secondary booking.
        
        Args:
            booking_id: The ID of the booking that was rescheduled
        """
        try:
            # Check if this is a primary booking with a secondary linked
            if booking_id in self.booking_mappings:
                # Cancel the old secondary booking
                secondary_id = self.booking_mappings[booking_id]
                secondary_booking = self.client.get_booking(secondary_id)
                if secondary_booking:
                    version = secondary_booking.get('version', 0)
                    self.client.cancel_booking(secondary_id, version)
                
                # Remove the old mapping
                del self.booking_mappings[booking_id]
                
                # Process as a new booking to create a new secondary block
                logger.info(f"Processing rescheduled booking {booking_id} as new booking")
                self.process_new_booking(booking_id)
            else:
                # Check if it's a couple's massage but no secondary exists
                booking = self.client.get_booking(booking_id)
                if booking and self.client.is_couples_massage(booking):
                    logger.info(f"Processing rescheduled couple's massage {booking_id}")
                    self.process_new_booking(booking_id)
                
        except Exception as e:
            logger.error(f"Exception processing reschedule for {booking_id}: {e}", exc_info=True)

