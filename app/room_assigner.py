"""Room assignment logic with priority rules."""
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
from app.models import RoomAssignment
from sqlalchemy.orm import Session


class RoomAssigner:
    """Handles automatic room assignment based on priority rules."""
    
    # Room setup
    SINGLE_ROOMS = ['1', '3', '4']  # Fixed single rooms
    DOUBLE_ROOMS = ['5', '6']  # Fixed double rooms (can be single)
    CONVERTIBLE_ROOMS = ['0', '2']  # Can be single or merged into "02D"
    
    # Priority for COUPLE appointments
    COUPLE_PRIORITY = ['5', '6', '02D']
    
    # Priority for SINGLE appointments
    SINGLE_PRIORITY = ['1', '3', '4', '2', '0', '6', '5']
    
    def __init__(self, db: Session):
        """Initialize room assigner with database session."""
        self.db = db
    
    def assign_rooms(
        self, 
        bookings: List[Dict], 
        date: str
    ) -> List[Dict]:
        """
        Assign rooms to bookings using greedy algorithm.
        
        Args:
            bookings: List of booking dicts with start_at, end_at, type, etc.
            date: Date string in YYYY-MM-DD format
            
        Returns:
            List of bookings with room assignments added
        """
        # Get existing manual assignments (don't overwrite)
        existing_assignments = {
            row.booking_id: row
            for row in self.db.query(RoomAssignment).filter(
                RoomAssignment.date == date,
                RoomAssignment.assigned_by == 'manager'
            ).all()
        }
        
        # Track busy times for each room (timestamp when room becomes free)
        busy_until = {
            '0': 0.0, '1': 0.0, '2': 0.0, '3': 0.0, 
            '4': 0.0, '5': 0.0, '6': 0.0
        }
        
        # Sort bookings by start time
        def get_start_time(booking):
            start_str = booking['start_at']
            if start_str.endswith('Z'):
                start_str = start_str.replace('Z', '+00:00')
            return datetime.fromisoformat(start_str)
        
        sorted_bookings = sorted(bookings, key=get_start_time)
        
        # IMPORTANT: First pass - apply all manual assignments and mark rooms as busy
        # This ensures manual assignments are respected and rooms are properly blocked
        # Also validate that manual assignments don't conflict with each other
        import logging
        logger = logging.getLogger(__name__)
        
        # Validate manual assignments don't conflict with each other
        manual_conflicts = []
        for i, booking1 in enumerate(sorted_bookings):
            booking1_id = booking1['booking_id']
            if booking1_id not in existing_assignments:
                continue
            
            room1 = existing_assignments[booking1_id].room
            if room1 == 'UNASSIGNED':
                continue
            
            start1 = get_start_time(booking1)
            end1 = datetime.fromisoformat(booking1['end_at'].replace('Z', '+00:00') if booking1['end_at'].endswith('Z') else booking1['end_at'])
            
            # Check against other manual assignments
            for booking2 in sorted_bookings[i+1:]:
                booking2_id = booking2['booking_id']
                if booking2_id not in existing_assignments:
                    continue
                
                room2 = existing_assignments[booking2_id].room
                if room2 == 'UNASSIGNED':
                    continue
                
                # Check if same physical room
                check_rooms = set([room1])
                if room1 == '02D':
                    check_rooms = {'0', '2'}
                elif room2 == '02D':
                    check_rooms = {'0', '2'}
                
                if room2 in check_rooms or (room2 == '02D' and room1 in {'0', '2'}):
                    start2 = get_start_time(booking2)
                    end2 = datetime.fromisoformat(booking2['end_at'].replace('Z', '+00:00') if booking2['end_at'].endswith('Z') else booking2['end_at'])
                    
                    # Check for time overlap
                    if not (end1 <= start2 or end2 <= start1):
                        manual_conflicts.append({
                            'booking1_id': booking1_id,
                            'booking2_id': booking2_id,
                            'room': room1,
                            'time1': f"{start1} - {end1}",
                            'time2': f"{start2} - {end2}"
                        })
        
        if manual_conflicts:
            conflict_msg = "; ".join([
                f"Bookings {c['booking1_id'][:10]}... and {c['booking2_id'][:10]}... both use room {c['room']} at overlapping times ({c['time1']} vs {c['time2']})"
                for c in manual_conflicts
            ])
            logger.error(f"Manual assignment conflicts detected for {date}: {conflict_msg}")
            # Don't raise error - just log it, as we still want to proceed with assignment
        
        # Apply manual assignments and mark rooms as busy
        for booking in sorted_bookings:
            booking_id = booking['booking_id']
            
            # Check if there's a manual assignment
            if booking_id in existing_assignments:
                existing = existing_assignments[booking_id]
                booking['room'] = existing.room
                booking['reason'] = existing.reason
                # Mark room as busy BEFORE auto-assigning others (skip UNASSIGNED)
                if existing.room != 'UNASSIGNED':
                    self._mark_room_busy(
                        existing.room,
                        booking['start_at'],
                        booking['end_at'],
                        busy_until
                    )
        
        # Second pass - assign rooms for bookings without manual assignments
        import logging
        logger = logging.getLogger(__name__)
        
        unassigned_count = 0
        for booking in sorted_bookings:
            booking_id = booking['booking_id']
            
            # Skip if already manually assigned
            if booking_id in existing_assignments:
                continue
            
            # Try to assign room automatically
            room, reason = self._find_available_room(
                booking,
                busy_until
            )
            
            booking['room'] = room
            booking['reason'] = reason
            
            if room == 'UNASSIGNED':
                unassigned_count += 1
                start_time = get_start_time(booking)
                logger.warning(
                    f"Could not assign room for booking {booking_id[:20]}... "
                    f"(type: {booking.get('type', 'single')}, "
                    f"time: {start_time}, reason: {reason})"
                )
                # Log current busy_until state for debugging
                busy_state_str = ", ".join([
                    f"Room {r}: {'free' if t <= start_time.timestamp() else datetime.fromtimestamp(t).strftime('%H:%M')}"
                    for r, t in sorted(busy_until.items())
                ])
                logger.warning(f"  Busy state at {start_time.strftime('%H:%M')}: {busy_state_str}")
                
                # Double-check: Is room 5 actually free?
                room5_busy_until = busy_until.get('5', 0.0)
                if room5_busy_until <= start_time.timestamp():
                    logger.error(f"  ⚠ CRITICAL BUG: Room 5 is FREE (busy until {datetime.fromtimestamp(room5_busy_until).strftime('%H:%M') if room5_busy_until > 0 else 'never'}) but booking was marked UNASSIGNED!")
                    logger.error(f"  This suggests a bug in _find_available_room - it should have found room 5")
                
                # Don't mark UNASSIGNED as busy - it doesn't block any room
                continue
            
            # Mark room as busy
            self._mark_room_busy(room, booking['start_at'], booking['end_at'], busy_until)
            
            # Save to database (only if not already exists or is auto-assigned)
            existing = self.db.query(RoomAssignment).filter(
                RoomAssignment.booking_id == booking_id
            ).first()
            
            if not existing:
                assignment = RoomAssignment(
                    booking_id=booking_id,
                    room=room,
                    assigned_by='auto',
                    date=date,
                    reason=reason
                )
                self.db.add(assignment)
            elif existing.assigned_by == 'auto':
                # Update auto-assignment
                existing.room = room
                existing.reason = reason
                existing.updated_at = datetime.now()
        
        self.db.commit()
        
        if unassigned_count > 0:
            logger.warning(
                f"Room assignment completed with {unassigned_count} unassigned bookings for {date}. "
                f"This may indicate a capacity issue or algorithm problem."
            )
        
        # Validate: Check for room conflicts (overbooking)
        # Group bookings by room and check for time overlaps
        room_bookings = {}
        for booking in sorted_bookings:
            room = booking.get('room')
            if room and room != 'UNASSIGNED':
                if room not in room_bookings:
                    room_bookings[room] = []
                room_bookings[room].append(booking)
        
        # Check for overlaps in each room
        conflicts = []
        for room, bookings in room_bookings.items():
            if room == '02D':
                # For 02D, check both room 0 and 2
                room_list = ['0', '2']
            else:
                room_list = [room]
            
            for r in room_list:
                # Get all bookings that use this physical room
                relevant_bookings = []
                for b in sorted_bookings:
                    b_room = b.get('room')
                    if b_room == r or (b_room == '02D' and r in ['0', '2']):
                        relevant_bookings.append(b)
                
                # Check for time overlaps
                for i, b1 in enumerate(relevant_bookings):
                    start1 = get_start_time(b1)
                    end1 = datetime.fromisoformat(b1['end_at'].replace('Z', '+00:00') if b1['end_at'].endswith('Z') else b1['end_at'])
                    for j, b2 in enumerate(relevant_bookings[i+1:], i+1):
                        start2 = get_start_time(b2)
                        end2 = datetime.fromisoformat(b2['end_at'].replace('Z', '+00:00') if b2['end_at'].endswith('Z') else b2['end_at'])
                        
                        # Check if times overlap
                        if not (end1 <= start2 or end2 <= start1):
                            conflicts.append({
                                'room': r,
                                'booking1': b1['booking_id'],
                                'booking2': b2['booking_id'],
                                'time1': f"{start1} - {end1}",
                                'time2': f"{start2} - {end2}"
                            })
        
        if conflicts:
            logger.warning(f"Room assignment conflicts detected for {date}:")
            for conflict in conflicts:
                logger.warning(f"  Room {conflict['room']} overbooked: {conflict['booking1'][:20]}... and {conflict['booking2'][:20]}...")
                logger.warning(f"    Times: {conflict['time1']} vs {conflict['time2']}")
                
                # Fix conflicts: Manager assignments have priority
                # If one is manager-assigned and the other is auto-assigned, unassign the auto one
                b1 = next((b for b in sorted_bookings if b['booking_id'] == conflict['booking1']), None)
                b2 = next((b for b in sorted_bookings if b['booking_id'] == conflict['booking2']), None)
                
                if b1 and b2:
                    # Check assignment types
                    b1_assignment = self.db.query(RoomAssignment).filter(
                        RoomAssignment.booking_id == conflict['booking1']
                    ).first()
                    b2_assignment = self.db.query(RoomAssignment).filter(
                        RoomAssignment.booking_id == conflict['booking2']
                    ).first()
                    
                    b1_is_manager = b1_assignment and b1_assignment.assigned_by == 'manager'
                    b2_is_manager = b2_assignment and b2_assignment.assigned_by == 'manager'
                    
                    # Priority rule: Manager assignments > Auto assignments
                    # If both are manager-assigned, keep the first one (booking1) and unassign booking2
                    # If one is manager and one is auto, unassign the auto one
                    # If both are auto, unassign the second one (booking2)
                    
                    if b1_is_manager and b2_is_manager:
                        # Both are manager-assigned: keep booking1, unassign booking2
                        logger.warning(f"  Both are manager-assigned: keeping {conflict['booking1'][:20]}..., unassigning {conflict['booking2'][:20]}...")
                        if b2_assignment:
                            self.db.delete(b2_assignment)
                        b2['room'] = 'UNASSIGNED'
                        b2['reason'] = f"Conflict with manager-assigned booking {conflict['booking1'][:20]}..."
                    elif b1_is_manager:
                        # booking1 is manager-assigned, booking2 is auto: unassign booking2
                        logger.info(f"  Manager assignment priority: keeping {conflict['booking1'][:20]}..., unassigning auto-assigned {conflict['booking2'][:20]}...")
                        if b2_assignment:
                            self.db.delete(b2_assignment)
                        b2['room'] = 'UNASSIGNED'
                        b2['reason'] = f"Conflict with manager-assigned booking {conflict['booking1'][:20]}..."
                    elif b2_is_manager:
                        # booking2 is manager-assigned, booking1 is auto: unassign booking1
                        logger.info(f"  Manager assignment priority: keeping {conflict['booking2'][:20]}..., unassigning auto-assigned {conflict['booking1'][:20]}...")
                        if b1_assignment:
                            self.db.delete(b1_assignment)
                        b1['room'] = 'UNASSIGNED'
                        b1['reason'] = f"Conflict with manager-assigned booking {conflict['booking2'][:20]}..."
                    else:
                        # Both are auto-assigned: unassign booking2 (the later one)
                        logger.info(f"  Both are auto-assigned: keeping {conflict['booking1'][:20]}..., unassigning {conflict['booking2'][:20]}...")
                        if b2_assignment:
                            self.db.delete(b2_assignment)
                        b2['room'] = 'UNASSIGNED'
                        b2['reason'] = f"Conflict with auto-assigned booking {conflict['booking1'][:20]}..."
            
            self.db.commit()
        
        return sorted_bookings
    
    def _find_available_room(
        self,
        booking: Dict,
        busy_until: Dict[str, float]
    ) -> Tuple[str, Optional[str]]:
        """
        Find an available room for a booking.
        
        Returns:
            Tuple of (room, reason) where reason is None if assigned successfully
        """
        import logging
        logger = logging.getLogger(__name__)
        
        # Parse datetime, handling both with and without timezone
        start_str = booking['start_at']
        end_str = booking['end_at']
        
        if start_str.endswith('Z'):
            start_str = start_str.replace('Z', '+00:00')
        if end_str.endswith('Z'):
            end_str = end_str.replace('Z', '+00:00')
        
        start_dt = datetime.fromisoformat(start_str)
        end_dt = datetime.fromisoformat(end_str)
        start_ts = start_dt.timestamp()
        end_ts = end_dt.timestamp()
        
        booking_id = booking.get('booking_id', 'unknown')[:20]
        booking_type = booking.get('type', 'single')
        
        logger.debug(f"Finding room for booking {booking_id} (type: {booking_type}, time: {start_dt.strftime('%H:%M')}-{end_dt.strftime('%H:%M')})")
        logger.debug(f"Current busy_until state: {[(r, datetime.fromtimestamp(t).strftime('%H:%M') if t > 0 else 'free') for r, t in sorted(busy_until.items())]}")
        
        def is_free(room: str) -> bool:
            """Check if room is free for the entire duration."""
            # Room is free if it becomes available before or at the start time
            room_busy_until = busy_until.get(room, 0.0)
            is_available = room_busy_until <= start_ts
            if not is_available:
                busy_time = datetime.fromtimestamp(room_busy_until)
                logger.debug(f"  Room {room} is BUSY until {busy_time.strftime('%H:%M')} (booking starts at {start_dt.strftime('%H:%M')})")
            else:
                logger.debug(f"  Room {room} is FREE (busy until: {datetime.fromtimestamp(room_busy_until).strftime('%H:%M') if room_busy_until > 0 else 'never'})")
            return is_available
        
        def can_use_02d() -> bool:
            """Check if 02D (merged room 0+2) can be used."""
            # Both 0 and 2 must be free at the start time
            # Also check that neither is blocked by an existing 02D assignment
            # (which would have set both to the same end time)
            return is_free('0') and is_free('2')
        
        if booking_type == 'couple':
            # COUPLE priority: 5 -> 6 -> 02D
            logger.debug(f"  Checking couple rooms in priority order: 5, 6, 02D")
            for room in ['5', '6']:
                if is_free(room):
                    logger.info(f"  ✓ Assigned room {room} to couple booking {booking_id}")
                    return room, None
            
            # Try merged room 0+2 (HARD RULE: both must be free for entire duration)
            # If either 0 or 2 is used by a single, 02D CANNOT be used
            if can_use_02d():
                logger.info(f"  ✓ Assigned room 02D to couple booking {booking_id}")
                return '02D', None
            
            # Build detailed reason for failure
            reasons = []
            if not is_free('5'):
                busy_time = datetime.fromtimestamp(busy_until.get('5', 0))
                reasons.append(f"Room 5 busy until {busy_time.strftime('%H:%M')}")
            if not is_free('6'):
                busy_time = datetime.fromtimestamp(busy_until.get('6', 0))
                reasons.append(f"Room 6 busy until {busy_time.strftime('%H:%M')}")
            if not is_free('0'):
                busy_time = datetime.fromtimestamp(busy_until.get('0', 0))
                reasons.append(f"Room 0 busy until {busy_time.strftime('%H:%M')}")
            if not is_free('2'):
                busy_time = datetime.fromtimestamp(busy_until.get('2', 0))
                reasons.append(f"Room 2 busy until {busy_time.strftime('%H:%M')}")
            
            logger.warning(f"  ✗ Could not assign couple room to {booking_id}. Reasons: {'; '.join(reasons)}")
            return 'UNASSIGNED', f"No double room available. {'; '.join(reasons)}"
        
        else:  # single
            # SINGLE priority: 1 -> 3 -> 4 -> 2 -> 0 -> 6 -> 5
            # Try each room in priority order
            logger.debug(f"  Checking single rooms in priority order: {', '.join(self.SINGLE_PRIORITY)}")
            for room in self.SINGLE_PRIORITY:
                if is_free(room):
                    logger.info(f"  ✓ Assigned room {room} to single booking {booking_id}")
                    return room, None
            
            # If no room available, check if 02D is blocking 0 and 2
            # If so, we might be able to use 6 or 5 (but they're already checked)
            # Build detailed reason
            reasons = []
            for room in self.SINGLE_PRIORITY:
                if not is_free(room):
                    busy_time = datetime.fromtimestamp(busy_until.get(room, 0))
                    reasons.append(f"Room {room} busy until {busy_time.strftime('%H:%M')}")
            
            logger.warning(f"  ✗ Could not assign single room to {booking_id}. Reasons: {'; '.join(reasons)}")
            # Special check: if room 5 is actually free, log it prominently and FIX IT
            if is_free('5'):
                logger.error(f"  ⚠ BUG DETECTED: Room 5 is FREE but was not assigned! Start time: {start_dt.strftime('%H:%M')}, Room 5 busy until: {datetime.fromtimestamp(busy_until.get('5', 0)).strftime('%H:%M')}")
                logger.error(f"  🔧 FIXING: Assigning room 5 to {booking_id}")
                return '5', "Room 5 was available but not checked properly - fixed"
            return 'UNASSIGNED', f"No room available. {'; '.join(reasons)}"
    
    def _mark_room_busy(
        self,
        room: str,
        start_at: str,
        end_at: str,
        busy_until: Dict[str, float]
    ):
        """Mark room(s) as busy until end time."""
        end_str = end_at
        if end_str.endswith('Z'):
            end_str = end_str.replace('Z', '+00:00')
        end_dt = datetime.fromisoformat(end_str)
        end_ts = end_dt.timestamp()
        
        if room == '02D':
            # HARD RULE: Merged room blocks BOTH 0 and 2 until end time
            # This ensures that if 02D is used, neither 0 nor 2 can be used by singles
            busy_until['0'] = max(busy_until['0'], end_ts)
            busy_until['2'] = max(busy_until['2'], end_ts)
        elif room in busy_until:
            busy_until[room] = max(busy_until[room], end_ts)

