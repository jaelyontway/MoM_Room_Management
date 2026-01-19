"""SQLAlchemy models for room assignments."""
from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.sql import func
from app.database import Base


class RoomAssignment(Base):
    """Room assignment model."""
    __tablename__ = "room_assignments"

    booking_id = Column(String, primary_key=True, index=True)
    room = Column(String, nullable=False)
    assigned_by = Column(String, nullable=False, default="auto")  # "auto" or "manager"
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    date = Column(String, nullable=False)  # YYYY-MM-DD format
    reason = Column(Text, nullable=True)  # Reason if unassigned

