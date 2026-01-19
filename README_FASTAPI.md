# Spa Room Management Dashboard

A manager-only dashboard for automatically assigning room numbers to Square appointments.

## Features

- **Calendar View**: Square-like calendar grid (columns = therapists, rows = time slots)
- **Automatic Room Assignment**: Greedy algorithm with priority rules
- **Room Display**: Shows room number on each appointment block (e.g., "Rm 5", "Rm 02D")
- **Conflict Handling**: Highlights unassigned bookings in red
- **Database Persistence**: Stores room assignments in SQLite (does NOT modify Square)

## Tech Stack

- **Backend**: Python, FastAPI, SQLAlchemy, SQLite
- **Frontend**: Plain HTML + CSS Grid + Vanilla JS (no paid libraries)

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Run the Application

```bash
uvicorn app.main:app --reload
```

The dashboard will be available at: http://127.0.0.1:8000/

### 3. Access the Dashboard

Open your browser and navigate to:
- Main dashboard: http://127.0.0.1:8000/
- API endpoint: http://127.0.0.1:8000/api/day?date=2026-01-06

## Room Setup

- **Single rooms (fixed)**: 1, 3, 4
- **Double rooms (fixed, can be single)**: 5, 6
- **Convertible rooms**: 0 and 2
  - Can be used as two singles
  - OR merged into one double called "02D"

## Room Assignment Priority

### COUPLE Appointments:
1. Room 5
2. Room 6
3. Merge 0 + 2 → "02D" (only if BOTH are free for entire duration)

### SINGLE Appointments:
1. Room 1
2. Room 3
3. Room 4
4. Room 2
5. Room 0
6. Room 6
7. Room 5

## API Endpoint

### GET /api/day

Get all bookings for a specific day with room assignments.

**Query Parameters:**
- `date` (required): Date in YYYY-MM-DD format

**Response:**
```json
{
  "date": "2026-01-06",
  "therapists": ["Katy", "May", "Jenny"],
  "events": [
    {
      "booking_id": "abc",
      "therapist": "Katy",
      "start_at": "2026-01-06T10:00:00",
      "end_at": "2026-01-06T11:00:00",
      "customer": "Brian",
      "service": "Swedish Massage",
      "type": "single",
      "room": "1",
      "reason": null
    }
  ]
}
```

## Database

Room assignments are stored in `room_assignments.db` (SQLite) with the following schema:

- `booking_id` (PK): Square booking ID
- `room`: Room number or "UNASSIGNED"
- `assigned_by`: "auto" or "manager"
- `updated_at`: Timestamp
- `date`: Date in YYYY-MM-DD format
- `reason`: Reason if unassigned

**Important**: Manual assignments (`assigned_by = "manager"`) are NOT overwritten by auto-assignment.

## Mock Data

The application currently uses mock Square data for development. To integrate with real Square API:

1. Update `app/mock_square.py` or create a real Square client
2. Replace `MockSquareService` usage in `app/main.py` with real Square API calls
3. See TODO comments in the code for integration points

## Project Structure

```
.
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI application
│   ├── database.py          # Database setup
│   ├── models.py            # SQLAlchemy models
│   ├── schemas.py           # Pydantic schemas
│   ├── room_assigner.py     # Room assignment logic
│   └── mock_square.py       # Mock Square data
├── static/
│   ├── index.html           # Dashboard HTML
│   ├── style.css            # Calendar styling
│   └── app.js               # Frontend JavaScript
├── requirements.txt         # Python dependencies
└── README_FASTAPI.md        # This file
```

## Notes

- Square is READ-ONLY in this project
- Room assignments are stored ONLY in our database
- This is a ROOM MANAGEMENT LAYER, not a scheduler
- Code is deterministic and readable

