"""Pydantic schemas for API requests/responses."""
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class Event(BaseModel):
    """Event schema matching the required response format."""
    booking_id: str
    therapist: str
    start_at: str  # ISO format datetime
    end_at: str  # ISO format datetime
    customer: str
    service: str
    type: str  # "single" or "couple"
    room: str
    reason: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "booking_id": "abc",
                "therapist": "Katy",
                "start_at": "2026-01-06T10:00:00",
                "end_at": "2026-01-06T11:00:00",
                "customer": "Brian",
                "service": "Swedish Massage",
                "type": "single",
                "room": "1",
                "reason": None
            }
        }


class DayResponse(BaseModel):
    """Response schema for GET /api/day."""
    date: str  # YYYY-MM-DD
    therapists: List[str]
    events: List[Event]


class UpdateRoomRequest(BaseModel):
    """Request schema for updating room assignment."""
    booking_id: str
    room: str
    date: str  # YYYY-MM-DD
