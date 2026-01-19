// Calendar grid application
let currentData = null;
const TIME_SLOT_MINUTES = 15;
const START_HOUR = 9;  // Start from 9am
const END_HOUR = 23;   // End at 11pm (23:00)

/**
 * Calculate positions for overlapping appointments to display them side by side
 * Returns a map of booking_id -> { left: percentage, width: percentage }
 */
function calculateOverlapPositions(appointments) {
    if (appointments.length === 0) {
        return {};
    }
    
    const positions = {};
    
    // Convert appointments to time ranges
    const ranges = appointments.map(apt => ({
        booking_id: apt.booking_id,
        start: new Date(apt.start_at).getTime(),
        end: new Date(apt.end_at).getTime(),
        appointment: apt
    }));
    
    // Sort by start time
    ranges.sort((a, b) => a.start - b.start);
    
    // Build overlap graph - each appointment knows which others it overlaps with
    const overlapGraph = {};
    ranges.forEach((apt, i) => {
        overlapGraph[apt.booking_id] = [];
        ranges.forEach((other, j) => {
            if (i !== j) {
                // Check if they overlap: not (apt1 ends before apt2 starts OR apt2 ends before apt1 starts)
                const overlaps = !(apt.end <= other.start || other.end <= apt.start);
                if (overlaps) {
                    overlapGraph[apt.booking_id].push(other.booking_id);
                }
            }
        });
    });
    
    // Find connected components (groups of overlapping appointments)
    const visited = new Set();
    const groups = [];
    
    ranges.forEach(apt => {
        if (visited.has(apt.booking_id)) {
            return;
        }
        
        // BFS to find all connected appointments
        const group = [];
        const queue = [apt.booking_id];
        visited.add(apt.booking_id);
        
        while (queue.length > 0) {
            const currentId = queue.shift();
            const currentApt = ranges.find(a => a.booking_id === currentId);
            if (currentApt) {
                group.push(currentApt);
            }
            
            // Add all overlapping appointments to queue
            overlapGraph[currentId].forEach(overlappingId => {
                if (!visited.has(overlappingId)) {
                    visited.add(overlappingId);
                    queue.push(overlappingId);
                }
            });
        }
        
        if (group.length > 0) {
            groups.push(group);
        }
    });
    
    // Calculate positions for each group
    groups.forEach((group, groupIndex) => {
        if (group.length === 1) {
            // Single appointment - full width
            positions[group[0].booking_id] = { left: 0, width: 100 };
        } else {
            // Multiple overlapping appointments - divide width equally
            const widthPercent = 100 / group.length;
            // Sort group by start time for consistent ordering
            group.sort((a, b) => a.start - b.start);
            group.forEach((apt, index) => {
                positions[apt.booking_id] = {
                    left: index * widthPercent,
                    width: widthPercent
                };
            });
            console.log(`Group ${groupIndex}: ${group.length} overlapping appointments`, 
                group.map(a => `${new Date(a.start).toLocaleTimeString()}-${new Date(a.end).toLocaleTimeString()}`),
                positions);
        }
    });
    
    return positions;
}

// Set today's date as default
document.addEventListener('DOMContentLoaded', () => {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('dateInput');
    dateInput.value = today;
    
    // Update time line when date changes
    dateInput.addEventListener('change', () => {
        updateCurrentTimeLine();
    });
    
    checkApiStatus();
    loadDay();
});

async function checkApiStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();
        const statusEl = document.getElementById('apiStatus');
        
        if (status.using_real_api) {
            statusEl.textContent = '✓ Connected to Real Square API';
            statusEl.className = 'api-status real-api';
        } else {
            statusEl.textContent = '⚠ Using Mock Data (Square API not configured)';
            statusEl.className = 'api-status mock-data';
        }
    } catch (error) {
        console.error('Error checking API status:', error);
    }
}

async function loadDay() {
    const date = document.getElementById('dateInput').value;
    if (!date) {
        showError('Please select a date');
        return;
    }

    showLoading(true);
    hideError();
    hideCalendar();

    try {
        const response = await fetch(`/api/day?date=${date}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to load data');
        }

        const data = await response.json();
        console.log('[DEBUG] API response:', {
            date: data.date,
            therapistsCount: data.therapists?.length || 0,
            eventsCount: data.events?.length || 0,
            events: data.events
        });
        currentData = data;
        
        // Show message if no bookings
        if (!data.events || data.events.length === 0) {
            console.log('[DEBUG] No events, showing message');
            showNoBookingsMessage(date);
            hideCalendar(); // Hide calendar when no events
        } else {
            console.log(`[DEBUG] Found ${data.events.length} events, calling renderCalendar`);
            hideNoBookingsMessage();
        }
        
        // Render calendar - this will show therapists and appointments
        renderCalendar(data);
        showUnassigned(data.events);
        showLoading(false);
        showCalendar();
        // Wait for calendar to fully render before adding time line
        setTimeout(() => {
            updateCurrentTimeLine();
        }, 200);
    } catch (error) {
        showError(error.message);
        showLoading(false);
    }
}

function refreshDay() {
    loadDay();
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

function hideError() {
    document.getElementById('errorMessage').style.display = 'none';
}

function showNoBookingsMessage(date) {
    const messageEl = document.getElementById('noBookingsMessage');
    messageEl.innerHTML = `
        <strong>No bookings found for ${date}</strong>
        <div>This date has no appointments in Square. Try selecting a different date.</div>
    `;
    messageEl.style.display = 'block';
}

function hideNoBookingsMessage() {
    document.getElementById('noBookingsMessage').style.display = 'none';
}

function showCalendar() {
    document.getElementById('calendarContainer').style.display = 'block';
}

function hideCalendar() {
    document.getElementById('calendarContainer').style.display = 'none';
}

function renderCalendar(data) {
    console.log('[DEBUG renderCalendar] Called with:', {
        therapistsCount: data.therapists?.length || 0,
        eventsCount: data.events?.length || 0
    });
    
    const grid = document.getElementById('calendarGrid');
    if (!grid) {
        console.error('[DEBUG renderCalendar] Calendar grid not found!');
        return;
    }
    
    grid.innerHTML = '';
    
    if (!data.therapists || data.therapists.length === 0) {
        console.warn('[DEBUG renderCalendar] No therapists found');
        return;
    }
    
    // Set CSS variable for number of therapists
    grid.style.setProperty('--num-therapists', data.therapists.length);

    // Generate time slots (15-minute intervals) for the selected date
    const selectedDate = document.getElementById('dateInput')?.value || new Date().toISOString().split('T')[0];
    console.log('[DEBUG renderCalendar] Selected date:', selectedDate);
    const timeSlots = generateTimeSlots(selectedDate);
    console.log('[DEBUG renderCalendar] Generated', timeSlots.length, 'time slots');
    if (timeSlots.length > 0) {
        console.log('[DEBUG renderCalendar] First slot:', timeSlots[0].toLocaleString(), 'Last slot:', timeSlots[timeSlots.length - 1].toLocaleString());
    }
    
    // Create header row
    const headerRow = document.createElement('div');
    headerRow.className = 'time-header';
    headerRow.textContent = 'Time';
    grid.appendChild(headerRow);

    // Create therapist headers
    data.therapists.forEach(therapist => {
        const header = document.createElement('div');
        header.className = 'therapist-header';
        header.textContent = therapist;
        grid.appendChild(header);
    });

    // Group appointments by therapist
    const appointmentsByTherapist = {};
    data.therapists.forEach(therapist => {
        appointmentsByTherapist[therapist] = data.events.filter(e => e.therapist === therapist);
    });
    
    // Debug: Log all appointments and their times
    console.log('[DEBUG renderCalendar] All appointments:', data.events.length);
    if (timeSlots.length > 0) {
        const firstSlotTime = timeSlots[0].getTime();
        const lastSlotTime = timeSlots[timeSlots.length - 1].getTime() + TIME_SLOT_MINUTES * 60 * 1000;
        console.log('[DEBUG renderCalendar] Time slot range:', new Date(firstSlotTime).toLocaleString(), 'to', new Date(lastSlotTime).toLocaleString());
        
        data.events.forEach((event, idx) => {
            const eventStart = new Date(event.start_at);
            const eventStartTime = eventStart.getTime();
            const inRange = eventStartTime >= firstSlotTime && eventStartTime < lastSlotTime;
            console.log(`  ${idx + 1}. ${event.therapist} - ${event.customer}: ${eventStart.toLocaleString()} (${eventStartTime}), In range: ${inRange}, Room: ${event.room}`);
        });
    }

    // Pre-process appointments to detect overlaps and calculate positions
    // For each therapist, group overlapping appointments
    const appointmentsWithPositions = {};
    data.therapists.forEach(therapist => {
        const appointments = appointmentsByTherapist[therapist] || [];
        appointmentsWithPositions[therapist] = calculateOverlapPositions(appointments);
    });

    // Create time slots and appointment cells
    timeSlots.forEach((timeSlot, slotIndex) => {
        // Time label
        const timeLabel = document.createElement('div');
        timeLabel.className = 'time-slot';
        timeLabel.textContent = formatTime(timeSlot);
        grid.appendChild(timeLabel);

        // Appointment cells for each therapist
        data.therapists.forEach(therapist => {
            const cell = document.createElement('div');
            cell.className = 'appointment-cell';
            cell.dataset.therapist = therapist;
            cell.dataset.timeSlot = slotIndex;
            cell.dataset.timeSlotStart = timeSlot.getTime();
            
            // Find appointments that start in this slot for this therapist
            const appointments = appointmentsByTherapist[therapist] || [];
            const slotStart = timeSlot.getTime();
            const slotEnd = slotStart + TIME_SLOT_MINUTES * 60 * 1000;

            let renderedCount = 0;
            appointments.forEach(appointment => {
                const eventStart = new Date(appointment.start_at).getTime();
                const eventEnd = new Date(appointment.end_at).getTime();
                
                // Only render if this is the starting slot for the appointment
                if (eventStart >= slotStart && eventStart < slotEnd) {
                    const position = appointmentsWithPositions[therapist][appointment.booking_id] || { left: 0, width: 100 };
                    const block = createAppointmentBlock(appointment, timeSlot, slotIndex, timeSlots, position);
                    cell.appendChild(block);
                    renderedCount++;
                    console.log(`[DEBUG] Rendered appointment: ${appointment.customer} at slot ${slotIndex} (${new Date(slotStart).toLocaleString()})`);
                }
            });
            
            // Debug: Log unmatched appointments for first slot only
            if (slotIndex === 0 && appointments.length > 0) {
                const unmatched = appointments.filter(apt => {
                    const aptStart = new Date(apt.start_at).getTime();
                    return !(aptStart >= slotStart && aptStart < slotEnd);
                });
                if (unmatched.length > 0) {
                    console.log(`[DEBUG] Therapist ${therapist}: ${unmatched.length} appointments not in first slot:`, unmatched.map(apt => ({
                        customer: apt.customer,
                        start: new Date(apt.start_at).toLocaleString(),
                        startTime: new Date(apt.start_at).getTime(),
                        slotStart: slotStart
                    })));
                }
            }

            grid.appendChild(cell);
        });
    });
}

function generateTimeSlots(dateString) {
    const slots = [];
    
    // Handle dateString - use today if not provided or invalid
    let start, end;
    if (dateString && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Parse the date string (YYYY-MM-DD) and create date objects for that specific date
        const [year, month, day] = dateString.split('-').map(Number);
        start = new Date(year, month - 1, day, START_HOUR, 0, 0, 0);
        end = new Date(year, month - 1, day, 23, 0, 0, 0); // 11:00 PM
    } else {
        // Fallback to original behavior (use today's date)
        start = new Date();
        start.setHours(START_HOUR, 0, 0, 0);
        end = new Date();
        end.setHours(23, 0, 0, 0); // 11:00 PM
    }

    let current = new Date(start);
    // Generate slots from 9am to 11pm (inclusive of 11pm)
    while (current <= end) {
        slots.push(new Date(current));
        current = new Date(current.getTime() + TIME_SLOT_MINUTES * 60 * 1000);
    }

    return slots;
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

function createAppointmentBlock(appointment, timeSlot, slotIndex, allTimeSlots, position = { left: 0, width: 100 }) {
    const block = document.createElement('div');
    block.className = `appointment-block ${appointment.type} ${appointment.room === 'UNASSIGNED' ? 'unassigned' : ''}`;
    
    const startTime = new Date(appointment.start_at);
    const endTime = new Date(appointment.end_at);
    
    // Calculate how many time slots this appointment spans
    const slotStart = timeSlot.getTime();
    const eventStart = startTime.getTime();
    const eventEnd = endTime.getTime();
    
    // Find the slot index where the event ends
    let endSlotIndex = slotIndex;
    for (let i = slotIndex; i < allTimeSlots.length; i++) {
        const slotEnd = allTimeSlots[i].getTime() + TIME_SLOT_MINUTES * 60 * 1000;
        if (eventEnd <= slotEnd) {
            endSlotIndex = i;
            break;
        }
    }
    
    const numSlots = endSlotIndex - slotIndex + 1;
    
    // Calculate offset within the first slot
    const offsetMinutes = (eventStart - slotStart) / (60 * 1000);
    const topPercent = (offsetMinutes / TIME_SLOT_MINUTES) * 100;
    
    // Calculate total duration in minutes
    const durationMinutes = (eventEnd - eventStart) / (60 * 1000);
    const heightPixels = (durationMinutes / TIME_SLOT_MINUTES) * 30; // 30px per slot
    
    // Apply position for overlapping appointments
    block.style.top = `${topPercent}%`;
    block.style.height = `${heightPixels}px`;
    block.style.left = `${position.left}%`;
    // Use calc to account for margins - each block needs a small gap
    const marginGap = position.width < 100 ? 1 : 0; // Only add gap if not full width
    block.style.width = `calc(${position.width}% - ${marginGap * 2}px)`;
    block.style.zIndex = position.width < 100 ? '15' : '10'; // Higher z-index for side-by-side
    
    // Debug log for overlapping appointments
    if (position.width < 100) {
        console.log(`[OVERLAP] Appointment ${appointment.booking_id.substring(0, 10)}...: left=${position.left.toFixed(1)}%, width=${position.width.toFixed(1)}%`, 
            `Time: ${formatTime(startTime)}-${formatTime(endTime)}`);
    }
    
    // Format time
    const timeStr = `${formatTime(startTime)} - ${formatTime(endTime)}`;
    
    block.innerHTML = `
        <div class="appointment-time">${timeStr}</div>
        <div class="appointment-customer">${appointment.customer}</div>
        <div class="appointment-service">${appointment.service}</div>
        <div class="appointment-room ${appointment.room === 'UNASSIGNED' ? 'unassigned' : ''}" 
             data-booking-id="${appointment.booking_id}"
             data-current-room="${appointment.room}"
             data-appointment-type="${appointment.type}"
             title="点击编辑房间号 (Click to edit room number)">
            ${appointment.room === 'UNASSIGNED' ? 'UNASSIGNED' : `Rm ${appointment.room}`}
        </div>
    `;
    
    // Make room number editable on click
    const roomElement = block.querySelector('.appointment-room');
    
    if (!roomElement) {
        console.error('Room element not found!', block);
        return block;
    }
    
    // Store editing state on the element itself to avoid closure issues
    roomElement._isEditing = false;
    
    // Use a closure to capture roomElement and appointment properly
    (function(el, apt) {
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            e.stopImmediatePropagation();
            
            console.log('=== ROOM ELEMENT CLICKED ===', { 
                isEditing: el._isEditing, 
                roomElement: el,
                appointment: apt.booking_id,
                target: e.target,
                currentText: el.textContent,
                dataset: el.dataset
            });
            
            if (el._isEditing) {
                console.log('Already editing, ignoring click');
                return;
            }
            
            el._isEditing = true;
            const currentRoom = el.dataset.currentRoom;
            const currentText = el.textContent.trim();
            
            console.log('Starting edit mode', { currentRoom, currentText });
        
            // Create input field
            const input = document.createElement('input');
            input.type = 'text';
            // Extract room number from current room (remove 'Rm ' prefix if present)
            let initialValue = currentRoom === 'UNASSIGNED' ? '' : currentRoom;
            if (initialValue.startsWith('Rm ')) {
                initialValue = initialValue.substring(3);
            }
            input.value = initialValue;
            input.className = 'room-input';
            input.style.cssText = `
                width: 60px;
                padding: 2px 4px;
                border: 2px solid #007bff;
                border-radius: 3px;
                font-size: 10px;
                font-weight: bold;
                background: white;
                text-align: center;
                position: relative;
                z-index: 10000;
                outline: none;
            `;
            
            // Replace content with input - use innerHTML to ensure clean state
            el.innerHTML = '';
            el.appendChild(input);
            
            console.log('Input created, attempting focus. Input element:', input);
            
            // Use multiple strategies to ensure focus works
            setTimeout(() => {
                input.focus();
                input.select();
                console.log('Input focused and selected', {
                    activeElement: document.activeElement,
                    isInput: document.activeElement === input,
                    inputValue: input.value,
                    inputVisible: input.offsetWidth > 0,
                    inputHeight: input.offsetHeight
                });
                
                // If focus didn't work, try again
                if (document.activeElement !== input) {
                    console.log('Focus failed, retrying...');
                    setTimeout(() => {
                        input.focus();
                        input.select();
                    }, 50);
                }
            }, 50);
            
            // Handle input completion
            let finishEditCalled = false;
            const finishEdit = async () => {
                if (finishEditCalled) return;
                finishEditCalled = true;
                
                // Trim and normalize input - handle numbers and text
                let newRoom = input.value.trim();
                
                // Convert to uppercase for 02D, but keep numbers as-is
                // Handle "Rm 5" or just "5"
                if (newRoom.toUpperCase().startsWith('RM ')) {
                    newRoom = newRoom.substring(3).trim();
                }
                if (newRoom.toUpperCase().startsWith('ROOM ')) {
                    newRoom = newRoom.substring(5).trim();
                }
                
                // Normalize: keep numbers as string, convert 02d/02D to 02D
                let normalizedRoom;
                if (newRoom.toUpperCase() === '02D' || newRoom.toLowerCase() === '02d') {
                    normalizedRoom = '02D';
                } else if (newRoom.toUpperCase() === 'UNASSIGNED') {
                    normalizedRoom = 'UNASSIGNED';
                } else {
                    // For numbers, keep as string but remove any extra spaces/chars
                    normalizedRoom = newRoom.replace(/[^0-9]/g, ''); // Only keep digits
                    // If it's empty after removing non-digits, try original
                    if (!normalizedRoom && newRoom.match(/^[0-9]$/)) {
                        normalizedRoom = newRoom;
                    }
                }
                
                console.log(`[ROOM INPUT] Raw: "${input.value}", Trimmed: "${newRoom}", Normalized: "${normalizedRoom}"`);
                
                // If empty or same as current, cancel
                if (normalizedRoom === '' || normalizedRoom === currentRoom) {
                    el.textContent = currentText;
                    el._isEditing = false;
                    return;
                }
                
                const validRooms = ['0', '1', '2', '3', '4', '5', '6', '02D', 'UNASSIGNED'];
                
                if (!validRooms.includes(normalizedRoom)) {
                    console.error(`[ROOM INPUT] Invalid room: "${normalizedRoom}" (from "${input.value}")`);
                    alert(`Invalid room number: "${normalizedRoom}". Valid rooms: 0, 1, 2, 3, 4, 5, 6, 02D, UNASSIGNED`);
                    finishEditCalled = false;
                    // Restore input and focus - use the original value we set
                    let originalValue = currentRoom === 'UNASSIGNED' ? '' : currentRoom;
                    if (originalValue.startsWith('Rm ')) {
                        originalValue = originalValue.substring(3);
                    }
                    input.value = originalValue;
                    setTimeout(() => {
                        input.focus();
                        input.select();
                    }, 10);
                    return;
                }
                
                const roomToSave = normalizedRoom === '' ? 'UNASSIGNED' : normalizedRoom;
                console.log(`[ROOM INPUT] Saving room: "${roomToSave}" for booking ${apt.booking_id.substring(0, 10)}...`);
                
                // Show loading
                el.textContent = 'Saving...';
                
                try {
                    // Get current date
                    const date = document.getElementById('dateInput').value;
                    
                    // Update room via API
                    const response = await fetch('/api/room', {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            booking_id: apt.booking_id,
                            room: roomToSave,
                            date: date
                        })
                    });
                    
                    if (!response.ok) {
                        let errorDetail = 'Failed to update room';
                        try {
                            const errorData = await response.json();
                            errorDetail = errorData.detail || errorData.message || errorDetail;
                        } catch (e) {
                            errorDetail = `HTTP ${response.status}: ${response.statusText}`;
                        }
                        console.error(`[ROOM UPDATE] API error:`, {
                            status: response.status,
                            statusText: response.statusText,
                            detail: errorDetail
                        });
                        throw new Error(errorDetail);
                    }
                    
                    const result = await response.json();
                    console.log(`[ROOM UPDATE] Success:`, result);
                    console.log(`[ROOM UPDATE] Reloading calendar...`);
                    
                    // Reload the calendar to show updated assignments
                    // Use a small delay to ensure server has processed the update
                    await new Promise(resolve => setTimeout(resolve, 100));
                    await loadDay();
                    console.log(`[ROOM UPDATE] Calendar reloaded`);
                    
                } catch (error) {
                    console.error('[ROOM UPDATE] Error:', error);
                    alert(`Error updating room: ${error.message}\n\nPlease check the browser console for details.`);
                    el.textContent = currentText;
                    el._isEditing = false;
                }
            };
            
            // Prevent input events from bubbling up
            input.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            
            input.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            input.addEventListener('input', (e) => {
                e.stopPropagation();
                console.log('Input value changed:', e.target.value);
            });
            
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                console.log('Key pressed in input:', e.key);
                
                // Allow all keys including Delete, Backspace, Arrow keys, etc.
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    console.log('Enter pressed, finishing edit');
                    finishEdit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    console.log('Escape pressed, cancelling edit');
                    finishEditCalled = true;
                    el.textContent = currentText;
                    el._isEditing = false;
                }
                // Don't prevent other keys - allow normal typing and deletion
            });
            
            // Handle blur - only finish edit if user clicks away (not when pressing Enter)
            input.addEventListener('blur', (e) => {
                console.log('Input blurred', { finishEditCalled });
                // Use a small delay to allow Enter key handler to run first
                setTimeout(() => {
                    if (!finishEditCalled && document.activeElement !== input) {
                        console.log('Finishing edit from blur');
                        finishEdit();
                    }
                }, 200);
            });
        });
    })(roomElement, appointment);
    
    return block;
}

function showUnassigned(events) {
    const unassigned = events.filter(e => e.room === 'UNASSIGNED');
    const container = document.getElementById('unassignedContainer');
    const list = document.getElementById('unassignedList');

    if (unassigned.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    list.innerHTML = '';

    unassigned.forEach(event => {
        const item = document.createElement('div');
        item.className = 'unassigned-item';
        
        const startTime = new Date(event.start_at);
        const timeStr = formatTime(startTime);
        
        item.innerHTML = `
            <strong>${timeStr}</strong> - ${event.customer} (${event.service}) - ${event.therapist}
            <div class="reason">Reason: ${event.reason || 'No room available'}</div>
        `;
        
        list.appendChild(item);
    });
}

// Current time line management
let currentTimeLineInterval = null;

function updateCurrentTimeLine() {
    console.log('=== updateCurrentTimeLine called ===');
    
    // Clear existing interval
    if (currentTimeLineInterval) {
        clearInterval(currentTimeLineInterval);
        currentTimeLineInterval = null;
    }
    
    // Remove existing time line
    const existingLine = document.querySelector('.current-time-line');
    if (existingLine) {
        existingLine.remove();
        console.log('Time line: Removed existing line');
    }
    
    // Check if viewing today's date
    const dateInput = document.getElementById('dateInput');
    if (!dateInput) {
        console.log('Time line: dateInput not found');
        return;
    }
    
    const selectedDate = dateInput.value;
    const today = new Date().toISOString().split('T')[0];
    console.log('Time line: Selected date:', selectedDate, 'Today:', today);
    
    if (selectedDate !== today) {
        console.log('Time line: Not today, hiding');
        return;
    }
    
    // Create time line element
    const calendarContainer = document.getElementById('calendarContainer');
    if (!calendarContainer) {
        console.log('Time line: calendarContainer not found');
        return;
    }
    
    if (calendarContainer.style.display === 'none') {
        console.log('Time line: calendarContainer is hidden');
        return;
    }
    
    const calendarGrid = document.getElementById('calendarGrid');
    if (!calendarGrid) {
        console.log('Time line: calendarGrid not found');
        return;
    }
    
    const timeLine = document.createElement('div');
    timeLine.className = 'current-time-line';
    timeLine.id = 'currentTimeLine';
    calendarContainer.appendChild(timeLine);
    console.log('Time line: Element created and added to DOM');
    
    // Function to update time line position
    const updatePosition = () => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentSecond = now.getSeconds();
        
        console.log(`Time line: Current time ${currentHour}:${currentMinute}:${currentSecond}`);
        
        // Check if current time is within calendar range (9am - 11pm)
        if (currentHour < START_HOUR || currentHour >= END_HOUR) {
            console.log(`Time line: Outside range (${START_HOUR}-${END_HOUR}), hiding`);
            timeLine.style.display = 'none';
            return;
        }
        
        // Find the calendar grid element
        const grid = document.getElementById('calendarGrid');
        if (!grid) {
            console.log('Time line: Grid not found in updatePosition');
            timeLine.style.display = 'none';
            return;
        }
        
        // Get the first time slot element to calculate offset
        const firstTimeSlot = grid.querySelector('.time-slot');
        if (!firstTimeSlot) {
            console.log('Time line: First time slot not found');
            timeLine.style.display = 'none';
            return;
        }
        
        timeLine.style.display = 'block';
        console.log('Time line: Display set to block');
        
        // Calculate minutes from start of day (9am)
        const minutesFromStart = (currentHour - START_HOUR) * 60 + currentMinute;
        const secondsOffset = currentSecond / 60;
        const totalMinutes = minutesFromStart + secondsOffset;
        
        // Calculate pixel position
        const timeSlotHeight = 30; // Height of each time slot
        const pixelsPerMinute = timeSlotHeight / TIME_SLOT_MINUTES; // 2px per minute
        
        // Get positions
        const containerRect = calendarContainer.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const firstSlotRect = firstTimeSlot.getBoundingClientRect();
        
        // Calculate position
        const headerRowHeight = firstSlotRect.top - gridRect.top;
        const minutesOffset = totalMinutes * pixelsPerMinute;
        const containerPadding = 15;
        const topPosition = containerPadding + headerRowHeight + minutesOffset;
        
        timeLine.style.top = `${topPosition}px`;
        timeLine.style.left = `${containerPadding}px`;
        timeLine.style.width = `calc(100% - ${containerPadding * 2}px)`;
        
        console.log('Time line: Position updated', {
            top: topPosition,
            left: containerPadding,
            width: `calc(100% - ${containerPadding * 2}px)`,
            totalMinutes,
            minutesOffset
        });
    };
    
    // Update immediately
    updatePosition();
    
    // Update every second for smooth movement
    currentTimeLineInterval = setInterval(updatePosition, 1000);
    
    console.log('Time line: Interval started');
}

