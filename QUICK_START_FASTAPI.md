# Quick Start Guide - Spa Room Management Dashboard

## Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

## Running the Application

### Option 1: Using the run script
```bash
python run.py
```

### Option 2: Using uvicorn directly
```bash
uvicorn app.main:app --reload
```

### Option 3: Using Python module
```bash
python -m uvicorn app.main:app --reload
```

## Access the Dashboard

Once the server is running, open your browser and navigate to:

- **Dashboard**: http://127.0.0.1:8000/
- **API Endpoint**: http://127.0.0.1:8000/api/day?date=2026-01-06

## Testing

The application uses **mock Square data** by default. You'll see:
- Random bookings for the selected date
- Automatic room assignments
- Calendar grid showing therapists vs. time slots

## Database

The SQLite database (`room_assignments.db`) will be automatically created on first run.

## Next Steps

To integrate with real Square API:
1. See TODO comments in `app/main.py`
2. Replace `MockSquareService` with real Square API client
3. Map Square booking format to our event format

## Troubleshooting

- **Port already in use**: Change port in `run.py` or uvicorn command
- **Module not found**: Make sure you're in the project root directory
- **Database errors**: Delete `room_assignments.db` to reset

