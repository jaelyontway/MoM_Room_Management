"""Database models and operations for room assignments."""
import sqlite3
import logging
from datetime import datetime
from typing import Optional, Dict, List
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DB_PATH = 'room_assignments.db'


@contextmanager
def get_db_connection():
    """Get a database connection with proper cleanup."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_database():
    """Initialize the database and create tables if they don't exist."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS room_assignments (
                booking_id TEXT PRIMARY KEY,
                room TEXT NOT NULL,
                assigned_by TEXT NOT NULL DEFAULT 'auto',
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                date TEXT NOT NULL,
                reason TEXT
            )
        ''')
        
        # Create index for date queries
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_date 
            ON room_assignments(date)
        ''')
        
        logger.info("Database initialized successfully")


def get_room_assignment(booking_id: str) -> Optional[Dict]:
    """Get room assignment for a booking."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT * FROM room_assignments WHERE booking_id = ?',
            (booking_id,)
        )
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None


def get_assignments_for_date(date: str) -> Dict[str, Dict]:
    """Get all room assignments for a specific date.
    
    Returns:
        Dictionary mapping booking_id to assignment dict
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT * FROM room_assignments WHERE date = ?',
            (date,)
        )
        rows = cursor.fetchall()
        return {row['booking_id']: dict(row) for row in rows}


def save_room_assignment(
    booking_id: str,
    room: str,
    assigned_by: str = 'auto',
    date: str = None,
    reason: str = None
):
    """Save or update a room assignment."""
    if not date:
        # Extract date from booking_id or use current date
        date = datetime.now().strftime('%Y-%m-%d')
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO room_assignments 
            (booking_id, room, assigned_by, updated_at, date, reason)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (booking_id, room, assigned_by, datetime.now().isoformat(), date, reason))
        logger.info(f"Saved room assignment: booking={booking_id}, room={room}, by={assigned_by}")


def update_room_assignment(
    booking_id: str,
    room: str,
    assigned_by: str = 'manager'
):
    """Update room assignment (typically manual override by manager)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Get existing assignment to preserve date
        existing = get_room_assignment(booking_id)
        date = existing['date'] if existing else datetime.now().strftime('%Y-%m-%d')
        
        cursor.execute('''
            INSERT OR REPLACE INTO room_assignments 
            (booking_id, room, assigned_by, updated_at, date, reason)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (booking_id, room, assigned_by, datetime.now().isoformat(), date, None))
        logger.info(f"Updated room assignment: booking={booking_id}, room={room}, by={assigned_by}")


def delete_room_assignment(booking_id: str):
    """Delete a room assignment."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'DELETE FROM room_assignments WHERE booking_id = ?',
            (booking_id,)
        )
        logger.info(f"Deleted room assignment: booking={booking_id}")


