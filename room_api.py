"""API endpoints for room assignment dashboard."""
import logging
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from room_assignment import RoomAssignment
from database import init_database, update_room_assignment, get_room_assignment

logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static')
CORS(app)  # Enable CORS for frontend

room_assignment = RoomAssignment()


@app.route('/api/bookings', methods=['GET'])
def get_bookings():
    """Get bookings for a specific date with room assignments."""
    try:
        date = request.args.get('date')
        if not date:
            # Default to today
            date = datetime.now().strftime('%Y-%m-%d')
        
        # Validate date format
        try:
            datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        
        bookings = room_assignment.get_bookings_for_date(date)
        
        return jsonify({
            'date': date,
            'bookings': bookings,
            'count': len(bookings)
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting bookings: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/assignments/<booking_id>', methods=['PUT'])
def update_assignment(booking_id):
    """Update room assignment for a booking (manual override)."""
    try:
        data = request.get_json()
        room = data.get('room')
        
        if not room:
            return jsonify({'error': 'room is required'}), 400
        
        # Validate room
        valid_rooms = ['0', '1', '2', '3', '4', '5', '6', '02D']
        if room not in valid_rooms:
            return jsonify({'error': f'Invalid room. Must be one of: {", ".join(valid_rooms)}'}), 400
        
        # Update assignment
        update_room_assignment(booking_id, room, assigned_by='manager')
        
        return jsonify({
            'booking_id': booking_id,
            'room': room,
            'assigned_by': 'manager'
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating assignment: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/assignments/<booking_id>', methods=['GET'])
def get_assignment(booking_id):
    """Get room assignment for a specific booking."""
    try:
        assignment = get_room_assignment(booking_id)
        if assignment:
            return jsonify(assignment), 200
        else:
            return jsonify({'error': 'Assignment not found'}), 404
    except Exception as e:
        logger.error(f"Error getting assignment: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/rooms/available', methods=['GET'])
def get_available_rooms():
    """Get list of available rooms for a booking type."""
    booking_type = request.args.get('type', 'single')  # 'single' or 'couple'
    
    if booking_type == 'couple':
        rooms = ['5', '6', '02D']
    else:
        rooms = ['1', '3', '4', '5', '6', '0', '2']
    
    return jsonify({'rooms': rooms}), 200


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'healthy'}), 200


@app.route('/', methods=['GET'])
def index():
    """Serve the dashboard."""
    return send_from_directory('static', 'index.html')


@app.route('/<path:path>', methods=['GET'])
def serve_static(path):
    """Serve static files."""
    return send_from_directory('static', path)


def run_room_api_server(port=5001):
    """Run the room assignment API server."""
    # Initialize database
    init_database()
    
    logger.info(f"Starting room assignment API server on port {port}")
    app.run(
        host='0.0.0.0',
        port=port,
        debug=False
    )


if __name__ == '__main__':
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    run_room_api_server()


