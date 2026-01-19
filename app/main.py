"""FastAPI main application."""
from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import os

from app.database import init_db, get_db
from app.schemas import DayResponse, Event, UpdateRoomRequest
from app.models import RoomAssignment
from app.room_assigner import RoomAssigner
from app.square_service import SquareService
from app.mock_square import MockSquareService
import logging

# Allowed therapists list (case-insensitive matching)
ALLOWED_THERAPISTS = [
    "cassey t", "hanna I", "hongxia shaw", "jenny l",
    "katy m", "may l", "rose j", "sophia e", "tina r", "vicky w", "amy rz"
]


def normalize_therapist_name(name: str) -> str:
    """Normalize therapist name for comparison (lowercase, strip, remove extra spaces)."""
    if not name:
        return ""
    return " ".join(name.lower().strip().split())


def is_allowed_therapist(name: str) -> bool:
    """Check if therapist name matches any allowed therapist (case-insensitive, flexible matching)."""
    if not name:
        return False
    
    normalized = normalize_therapist_name(name)
    
    # Special case: explicitly exclude "amy r" (but allow "amy rz")
    if normalized == "amy r":
        return False
    
    for allowed in ALLOWED_THERAPISTS:
        allowed_normalized = normalize_therapist_name(allowed)
        
        # Exact match
        if normalized == allowed_normalized:
            return True
        
        # For "amy rz", require exact match or starts with "amy rz" (don't match "amy r")
        if allowed_normalized == "amy rz":
            if normalized == "amy rz" or normalized.startswith("amy rz"):
                return True
            continue  # Don't do partial matching for "amy rz"
        
        # Check if name starts with allowed (e.g., "Katy M" matches "katy m")
        if normalized.startswith(allowed_normalized) or allowed_normalized.startswith(normalized):
            return True
        
        # Check if first name + last initial matches (e.g., "Katy M" matches "katy m")
        name_parts = normalized.split()
        allowed_parts = allowed_normalized.split()
        if len(name_parts) >= 1 and len(allowed_parts) >= 1:
            # Match first name and check if last initial matches
            if name_parts[0] == allowed_parts[0]:
                if len(name_parts) == 1 or len(allowed_parts) == 1:
                    return True
                # Check if last initial matches
                if len(name_parts) > 1 and len(allowed_parts) > 1:
                    if name_parts[1][0] == allowed_parts[1][0]:
                        return True
    
    return False


def filter_allowed_therapists(therapists: List[str]) -> List[str]:
    """Filter therapists to only include allowed ones."""
    filtered = [t for t in therapists if is_allowed_therapist(t)]
    # Also ensure all allowed therapists are included (even if no bookings)
    allowed_set = set(filtered)
    for allowed in ALLOWED_THERAPISTS:
        # Try to match existing therapist name or add the allowed name
        matched = False
        for existing in therapists:
            if normalize_therapist_name(existing) == normalize_therapist_name(allowed):
                matched = True
                break
        if not matched:
            # Add the allowed name as-is
            allowed_set.add(allowed)
    return sorted(list(allowed_set))

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Spa Room Management Dashboard")

# Initialize database
init_db()

# Initialize Square service (falls back to mock if not configured)
# Note: This is initialized at module load time
# If .env is updated, you need to restart the server
square_service = SquareService()
mock_square = MockSquareService()  # Keep as fallback

# Log initialization status
if square_service.client:
    logger.info("=" * 60)
    logger.info("Square API: CONNECTED (Using Real API)")
    logger.info("=" * 60)
else:
    logger.warning("=" * 60)
    logger.warning("Square API: NOT CONFIGURED (Using Mock Data)")
    logger.warning("Check your .env file and restart the server")
    logger.warning("=" * 60)


def get_square_service():
    """Get Square service, re-initializing if needed."""
    # Re-check configuration if client is None
    if not square_service.client:
        try:
            # Reload environment variables
            from dotenv import load_dotenv
            load_dotenv(override=True)
            
            # Re-import config to get updated values
            import importlib
            import config
            importlib.reload(config)
            from config import Config
            
            Config.validate()
            # Re-initialize the service
            logger.info("Re-initializing Square service...")
            new_service = SquareService()
            if new_service.client:
                # Update the global service
                square_service.client = new_service.client
                square_service._team_members_cache = new_service._team_members_cache
                logger.info("Square API: Successfully re-initialized!")
                logger.info("=" * 60)
                logger.info("Square API: CONNECTED (Using Real API)")
                logger.info("=" * 60)
            else:
                logger.warning("Square API: Still not configured after re-initialization")
        except Exception as e:
            logger.warning(f"Could not re-initialize Square service: {e}")
    
    return square_service


@app.get("/api/status")
async def get_status():
    """Get API status - whether using real Square API or mock data."""
    # Re-check configuration and re-initialize if needed
    current_service = get_square_service()
    is_configured = current_service.client is not None
    
    # Get environment info safely
    environment = None
    if is_configured:
        try:
            # Try to get environment from config
            from config import Config
            environment = Config.SQUARE_ENVIRONMENT
        except:
            environment = "production"  # Default
    
    return {
        "using_real_api": is_configured,
        "square_configured": is_configured,
        "message": "Using real Square API" if is_configured else "Using mock data (Square API not configured - check .env file and refresh page)",
        "environment": environment
    }


@app.get("/api/day")
async def get_day(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    db: Session = Depends(get_db)
) -> DayResponse:
    """
    Get all bookings for a specific day with room assignments.
    
    Response format matches requirements:
    {
        "date": "2026-01-06",
        "therapists": ["Katy", "May", "Jenny"],
        "events": [...]
    }
    """
    try:
        # Validate date format
        datetime.strptime(date, '%Y-%m-%d')
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    # Get Square service (will re-initialize if needed)
    current_service = get_square_service()
    
    # Fetch bookings from Square API (or use mock if not configured)
    if current_service.client:
        logger.info(f"[REAL API] Fetching Square bookings for {date}")
        bookings = current_service.get_bookings_for_date(date)
        logger.info(f"[REAL API] Found {len(bookings)} bookings from Square")
        if len(bookings) == 0:
            logger.info(f"[REAL API] No bookings found for {date} - this is normal if there are no appointments")
    else:
        logger.warning(f"[MOCK DATA] Square API not configured, using mock data for {date}")
        bookings = mock_square.get_bookings_for_date(date)
        logger.info(f"[MOCK DATA] Generated {len(bookings)} mock bookings")
    
    # Get all therapists - show ALL team members, not just those with bookings
    # This ensures all staff appear in the calendar even if they have no appointments
    therapists_from_bookings = set(b['therapist'] for b in bookings)
    
    # Also get all team members from Square
    all_therapists = set(therapists_from_bookings)
    if current_service.client:
        try:
            team_members = current_service.client.get_team_members()
            for member in team_members:
                # Get team member name
                if isinstance(member, dict):
                    member_id = member.get('id', '')
                    given = member.get('given_name', '')
                    family = member.get('family_name', '')
                    display = member.get('display_name', '')
                else:
                    member_id = getattr(member, 'id', '') or ''
                    given = getattr(member, 'given_name', '') or ''
                    family = getattr(member, 'family_name', '') or ''
                    display = getattr(member, 'display_name', '') or ''
                
                name = f"{given} {family}".strip() or display or member_id
                if name:
                    all_therapists.add(name)
        except Exception as e:
            logger.warning(f"Could not fetch all team members: {e}")
            # Fallback to just therapists from bookings
            pass
    
    # Filter to only allowed therapists
    therapists = filter_allowed_therapists(list(all_therapists))
    
    # Also filter bookings to only include allowed therapists
    bookings = [b for b in bookings if is_allowed_therapist(b.get('therapist', ''))]
    
    # Convert bookings to event format for room assignment
    bookings_for_assignment = []
    for booking in bookings:
        bookings_for_assignment.append({
            'booking_id': booking['id'],
            'therapist': booking['therapist'],
            'start_at': booking['start_at'],
            'end_at': booking['end_at'],
            'customer': booking['customer'],
            'service': booking['service'],
            'type': booking['type']
        })
    
    # Assign rooms
    assigner = RoomAssigner(db)
    assigned_bookings = assigner.assign_rooms(bookings_for_assignment, date)
    
    # Convert to Event schema
    events = []
    for booking in assigned_bookings:
        event = Event(
            booking_id=booking['booking_id'],
            therapist=booking['therapist'],
            start_at=booking['start_at'],
            end_at=booking['end_at'],
            customer=booking['customer'],
            service=booking['service'],
            type=booking['type'],
            room=booking['room'],
            reason=booking.get('reason')
        )
        events.append(event)
    
    return DayResponse(
        date=date,
        therapists=therapists,
        events=events
    )


@app.put("/api/room")
async def update_room(
    request: UpdateRoomRequest,
    db: Session = Depends(get_db)
):
    """
    Update a room assignment and recalculate all assignments for the date.
    """
    try:
        # Validate room number
        valid_rooms = ['0', '1', '2', '3', '4', '5', '6', '02D', 'UNASSIGNED']
        if request.room not in valid_rooms:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid room number. Must be one of: {', '.join(valid_rooms)}"
            )
        
        # Manager's manual assignment always has priority
        # We don't check for conflicts here - manager's change is always allowed
        # If there are conflicts, we'll handle them during recalculation by making other bookings unassigned
        
        # Get or create room assignment with manager override
        existing = db.query(RoomAssignment).filter(
            RoomAssignment.booking_id == request.booking_id
        ).first()
        
        if existing:
            existing.room = request.room
            existing.assigned_by = 'manager'
            existing.date = request.date
            existing.reason = None
            existing.updated_at = datetime.now()
        else:
            assignment = RoomAssignment(
                booking_id=request.booking_id,
                room=request.room,
                assigned_by='manager',
                date=request.date,
                reason=None
            )
            db.add(assignment)
        
        db.commit()
        
        # IMPORTANT: Clear all auto-assignments for this date before recalculating
        # This prevents conflicts when manually changing rooms
        # Only keep manager (manual) assignments
        auto_assignments = db.query(RoomAssignment).filter(
            RoomAssignment.date == request.date,
            RoomAssignment.assigned_by == 'auto'
        ).all()
        
        for auto_assignment in auto_assignments:
            db.delete(auto_assignment)
        
        db.commit()
        logger.info(f"Cleared {len(auto_assignments)} auto-assignments for {request.date} before recalculating")
        
        # Recalculate all assignments for this date
        # This will respect all manager assignments (including the one we just updated)
        # Manager assignments have priority - conflicts will be resolved by making other bookings unassigned
        current_service = get_square_service()
        if current_service.client:
            bookings = current_service.get_bookings_for_date(request.date)
        else:
            bookings = mock_square.get_bookings_for_date(request.date)
        
        # Filter to only allowed therapists
        bookings = [b for b in bookings if is_allowed_therapist(b.get('therapist', ''))]
        
        # Convert to assignment format
        bookings_for_assignment = []
        for booking in bookings:
            bookings_for_assignment.append({
                'booking_id': booking['id'],
                'therapist': booking['therapist'],
                'start_at': booking['start_at'],
                'end_at': booking['end_at'],
                'customer': booking['customer'],
                'service': booking['service'],
                'type': booking['type']
            })
        
        # Reassign all rooms (this will preserve all manager assignments including the one we just updated)
        assigner = RoomAssigner(db)
        assigned_bookings = assigner.assign_rooms(bookings_for_assignment, request.date)
        
        logger.info(f"Updated room assignment: {request.booking_id} -> {request.room}, recalculated all assignments")
        
        return {
            "success": True,
            "message": f"Room updated to {request.room} and all assignments recalculated",
            "updated_booking_id": request.booking_id,
            "new_room": request.room
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating room assignment: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# Serve static files (mount AFTER API routes to avoid conflicts)
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def root():
    """Serve the main dashboard page."""
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Dashboard not found. Please create static/index.html"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)

