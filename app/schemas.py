"""Pydantic schemas for API requests/responses."""
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
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
    room_locked: Optional[bool] = None  # True if manager-assigned
    therapist_locked: Optional[bool] = None
    tip_amount: Optional[float] = None
    tip_cash: Optional[bool] = None  # checkout: tip paid in cash
    appointment_locked: Optional[bool] = None  # if True, past appt is editable
    is_past: Optional[bool] = None
    # Couple-only: second masseuse, second tip, check-in times
    therapist_2: Optional[str] = None
    therapist_locked_2: Optional[bool] = None
    tip_amount_2: Optional[float] = None
    tip_split_evenly: Optional[bool] = None
    arrived_at_1: Optional[str] = None   # ISO datetime when client 1 checked in
    arrived_at_2: Optional[str] = None   # ISO datetime when client 2 checked in
    # Luxury package: 30 min mini facial done and who does it (Facial Specialist 1 and 2 for couple)
    luxury_mini_facial_done: Optional[bool] = None
    luxury_separate_mini_facial: Optional[bool] = None  # True = separate FS for last 30 min; False = masseuse full 2hr
    luxury_mini_facial_therapist: Optional[str] = None
    luxury_mini_facial_therapist_2: Optional[str] = None
    # Facial+massage (basic 55min, custom 85min): who does the facial; blank = masseuse does entire package
    facial_specialist: Optional[str] = None
    # True when single + basic/custom facial with massage (55 or 85 min) so UI shows Facial Specialist box
    is_facial_with_massage: Optional[bool] = None
    # Couple in 02D: only one client gets post-massage facial → Rm 0 free during facial (facial in Rm 2)
    couple_02d_single_facial_only: Optional[bool] = None
    is_couple_facial_with_massage: Optional[bool] = None
    facial_segment_start_at: Optional[str] = None  # ISO when facial portion starts (split display / occupancy)
    # When couple split is on: room assigned to the facial-only block (main `room` is couples massage room)
    facial_portion_room: Optional[str] = None
    room_placement_override: Optional[bool] = None  # True = placed despite availability striping (manager confirmed)
    # Add-on note from kiosk (e.g. lavender aromatherapy, cupping)
    addon_note: Optional[str] = None
    # Original values from Square (read-only; editable overrides are therapist, room, etc.)
    original_therapist: Optional[str] = None
    original_room: Optional[str] = None
    customer_phone: Optional[str] = None
    original_tip_paid: Optional[float] = None  # tip from Square payment (shown under Original)
    original_any_available: Optional[bool] = None  # True if booked "with any available" (show next to masseuse)
    prepayment_amount: Optional[float] = None  # prepayment in dollars (show on calendar and under Original)
    created_at: Optional[str] = None  # ISO datetime when booking was created (Square); used for "NEW" highlight
    # Customer profile: visits count from Square custom attribute (1 = first visit → "1stV"; ≥20 → loyalty)
    customer_visits: Optional[int] = None
    # Square customer custom attribute "Massage together with" (couple: other guest name for calendar)
    customer_massage_together_with: Optional[str] = None
    # Square booking notes (shown in NOTES in Square app)
    customer_note: Optional[str] = None  # note from customer when booking
    seller_note: Optional[str] = None    # staff/internal note (e.g. "called to cancel...")
    # Who originally made the booking: "customer" | "us" (from Square source/creator_details)
    booked_by: Optional[str] = None  # "customer" | "us"
    # Package type for display: "luxury" | "exclusive" | None (regular). When set, use display_service for label.
    package_type: Optional[str] = None
    # When set, show this instead of service name (e.g. "Luxury" instead of "Regular")
    display_service: Optional[str] = None
    # Check-in preferences (from BookingOverride)
    customer_id: Optional[str] = None  # Square customer id for last-pressure lookup
    pressure: Optional[str] = None    # deep, deep/medium, medium, medium/light, light (slot 1 or single)
    focus_area: Optional[str] = None  # comma-separated focus areas for slot 1 or single
    pressure_2: Optional[str] = None  # for couple: pressure for second masseuse
    focus_area_2: Optional[str] = None  # for couple: focus areas for second masseuse
    split_minutes_first: Optional[int] = None  # single with 2 SRMs: minutes first therapist did (for prorate)
    # Minutes Square adds for aromatherapy / pain relief oil add-ons (not massage time). UI subtracts from duration display.
    addon_time_neutral_minutes: Optional[int] = None
    # Calendar end can differ from Square when staff corrects a wrong Square block (see duration_adjust_minutes).
    square_end_at: Optional[str] = None  # ISO end from Square before adjustment; for "Original (Square)" time row
    duration_adjust_minutes: Optional[int] = None  # signed minutes added to Square end (positive = longer)
    # Second guest (couples) and actual massage recipient when different from booker (from BookingOverride)
    checkin_partner_name: Optional[str] = None
    checkin_massage_recipient: Optional[str] = None
    # Hints from booking notes (customer_note / seller_note); not persisted
    suggested_partner_name: Optional[str] = None
    suggested_massage_recipient: Optional[str] = None
    # Parsed from notes "couples#2", "couples#3": 2nd/3rd couple booking same guest & start; forces calendar split + skips note-pair room merge
    couples_slot_note: Optional[int] = None
    # Singles: back walking in notes or Exclusive+back walk → needs Rm 1/3/4 (bars); alert if wrong room / unassigned
    back_walking_room_alert: Optional[str] = None

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


class DayLayoutFreezeRequest(BaseModel):
    """Pin or release auto room placements for a date (new Square bookings still assign into gaps)."""
    date: str = Field(..., description="YYYY-MM-DD")
    freeze: bool = Field(..., description="True: promote all auto-assigned rooms to locked pins; False: remove pins and re-run auto-assign")
    # When freeze is False: if set, only remove layout pins promoted at/after this ISO instant (UTC-aware).
    # Omit or null to remove all layout pins for the date.
    unlock_promoted_at_or_after_iso: Optional[str] = Field(
        None,
        description="Partial unlock: only delete __DAY_LAYOUT_FREEZE__ rows with updated_at >= this ISO time",
    )
    # When freeze is True: if set, only promote auto rows for bookings whose Square start_at is >= this ISO instant.
    lock_appointments_starting_at_or_after_iso: Optional[str] = Field(
        None,
        description="Partial lock: only pin auto-assigned rooms for appointments starting at/after this time",
    )


class DayResponse(BaseModel):
    """Response schema for GET /api/day."""
    date: str  # YYYY-MM-DD
    therapists: List[str]
    events: List[Event]
    therapist_order: Optional[List[dict]] = None  # [{"therapist": "Katy M", "order": 1}, ...]
    therapist_service_counts: Optional[dict] = None  # {"Katy M": 5, ...}
    next_couple_available: Optional[dict] = None  # {"time": "ISO", "room": "6"}
    next_single_available: Optional[dict] = None
    no_room_alert: Optional[bool] = None  # True when at least one booking has no room (all rooms booked)
    facial_summary: Optional[dict] = None  # {"count": N, "time_frames": [{"start_at", "end_at", "label"}, ...]}
    # Bookings where customer chose a named masseuse (not "any available"): same filter as "By Customer — {name}"
    customer_requests_summary: Optional[dict] = None  # {"items": [{"requested_masseuse", "customer", "service", "start_at", "end_at", "display_end_at"}, ...]}
    customer_last_pressure: Optional[dict] = None  # {"customer_id": "medium", ...} for prepopulating check-in
    customer_last_partner: Optional[dict] = None  # {"customer_id": "Jane D.", ...} second guest for couples
    # Latest saved front-desk note per kind for this calendar date (customer_id -> {checkin, checkout})
    customer_desk_notes_today: Optional[Dict[str, Dict[str, Optional[str]]]] = None
    # True when this day has layout pins (auto placements promoted so new bookings cannot reshuffle them)
    room_day_layout_frozen: Optional[bool] = None
    # ISO UTC when "Lock Appointments for Day" was last turned on (for hover tooltip)
    room_day_layout_locked_at: Optional[str] = None
    # When any appointment is UNASSIGNED: heuristic least-disruptive fix ideas (room / one move / time nudge)
    unassigned_fix_suggestions: Optional[List[Dict[str, Any]]] = None
    # Names seen in Square bookings that aren't in the roster yet (prompt user to Add or Ignore)
    detected_new_therapists: Optional[List[str]] = None


class RosterActionRequest(BaseModel):
    """Add or ignore a detected (new) therapist name from Square."""
    name: str


class CustomerDeskNoteItem(BaseModel):
    """One saved front-desk note (history row)."""
    date: str
    note_kind: str
    body: str
    created_at: Optional[str] = None


class CustomerDeskNoteListResponse(BaseModel):
    items: List[CustomerDeskNoteItem]


class SaveCustomerDeskNoteRequest(BaseModel):
    customer_id: str
    date: str
    note_kind: str  # checkin | checkout
    body: str
    booking_id: Optional[str] = None


class UpdateCheckinClientNamesRequest(BaseModel):
    """Save second guest (couple) and/or who is receiving the massage; updates last partner when couple + name set."""
    booking_id: str
    date: str
    partner_name: str = ""  # couple: other guest; empty clears
    massage_recipient: str = ""  # single or couple: recipient if not the booker; empty clears
    customer_id: Optional[str] = None  # Square customer id (booker) for last-partner memory
    is_couple: bool = False


class UpdateRoomRequest(BaseModel):
    """Request schema for updating room assignment."""
    booking_id: str
    room: str
    date: str  # YYYY-MM-DD
    # When True, user has confirmed moving a booking that is in progress, checked in, or finished (see PUT /api/room).
    confirmed: bool = False
    # True = acknowledge placing in a room the UI showed as unavailable; False = clear flag. Omit = leave unchanged.
    placement_override: Optional[bool] = None
    # True = remove this booking's RoomAssignment so auto-assign can place it again (used with "Clear OVR").
    unlock_room_for_auto: Optional[bool] = None
    # couple_facial = update facial portion room only (couple massage+facial split); main RoomAssignment unchanged
    room_view_slice: Optional[str] = None


class UnlockRoomRequest(BaseModel):
    booking_id: str
    date: str


class UpdateTherapistRequest(BaseModel):
    booking_id: str
    date: str
    therapist: str
    locked: bool
    slot: Optional[int] = 1  # 1 or 2 for couple (second masseuse)


class UpdateTipRequest(BaseModel):
    booking_id: str
    date: str
    tip_amount: Optional[float] = None  # omit when only updating tip_cash
    tip_amount_2: Optional[float] = None   # for couple
    split_evenly: Optional[bool] = None    # split tip_amount between both
    split_minutes_first: Optional[int] = None  # single with 2 SRMs: minutes first therapist did (prorate tip)
    tip_cash: Optional[bool] = None  # True = cash tip (checkout checkbox)


class CheckInRequest(BaseModel):
    booking_id: str
    date: str
    client_index: int  # 1 or 2 for couple (records arrival time for that client)


class CheckInAddonNoteRequest(BaseModel):
    booking_id: str
    date: str
    note: str  # e.g. "Add-on: lavender aromatherapy, cupping"


class UpdatePressureRequest(BaseModel):
    booking_id: str
    date: str
    pressure: str  # deep, deep/medium, medium, medium/light, light (or empty to clear)
    customer_id: Optional[str] = None  # if set, also update last-pressure for this customer (slot 1 only)
    slot: Optional[int] = 1  # 1 or 2 for couple; slot 2 uses pressure_2


class UpdateFocusAreaRequest(BaseModel):
    booking_id: str
    date: str
    focus_area: Optional[str] = None  # comma-separated; empty to clear
    slot: Optional[int] = 1  # 1 or 2 for couple; slot 2 uses focus_area_2


class UnlockAppointmentRequest(BaseModel):
    booking_id: str
    date: str
    unlocked: bool  # True = allow editing past appt


class UpdatePrepaymentRequest(BaseModel):
    booking_id: str
    date: str
    prepayment_amount: Optional[float] = None  # dollars; null or omit to clear override (use Square/suggested again)


class UpdateLuxuryMiniFacialRequest(BaseModel):
    booking_id: str
    date: str
    done: bool
    therapist: Optional[str] = None   # Facial Specialist 1 (or only for single)
    therapist_2: Optional[str] = None  # Facial Specialist 2 (couple only)
    # When False, clears FS fields; when True, FS dropdowns apply. Omit to leave unchanged.
    separate_specialist: Optional[bool] = None


class SetSplitTimeRequest(BaseModel):
    """Enable/disable time-split for a single booking (two SRMs, prorate tip by minutes)."""
    booking_id: str
    date: str
    minutes_first: Optional[int] = None  # minutes first therapist did; null = clear split


class SetCancelledNoShowRequest(BaseModel):
    """Mark an appointment as cancelled or no-show so it is hidden from the schedule."""
    booking_id: str
    date: str
    cancelled_or_noshow: bool  # True = hide from calendar; False = show again


class SetDurationAdjustRequest(BaseModel):
    """Shift calendar end vs Square: positive = longer, negative = shorter. Omit or null/0 clears."""
    booking_id: str
    date: str
    duration_adjust_minutes: Optional[int] = None  # signed int; None or 0 removes override


class UpdateFacialSpecialistRequest(BaseModel):
    """Set who does the facial part for facial+massage (basic 55min, custom 85min). Blank = masseuse does entire package."""
    booking_id: str
    date: str
    therapist: Optional[str] = None  # Facial Specialist; null = one person did all


class UpdateCouple02dSingleFacialRequest(BaseModel):
    """Couple in Rm 02D with facial+m massage: only one client gets facial (door closed; facial in Rm 2, Rm 0 free)."""
    booking_id: str
    date: str
    single_facial_only: bool  # True = confirm single facial; False = both use 02D whole time


class TherapistOrderItem(BaseModel):
    therapist: str
    order: int


class UpdateTherapistOrderRequest(BaseModel):
    date: str
    order: List[TherapistOrderItem]


class ServiceRow(BaseModel):
    """One row for the services / pay setup table."""
    id: Optional[int] = None
    service_key: str
    parent_service: Optional[str] = None  # optional broad department, e.g. Massage / Facial
    service_subcategory: Optional[str] = None  # finer type: Couples, Singles, Facial, Add-on, Package, …
    # Resolved from Square catalog (same naming path as calendar) when pay key matches a variation name
    calendar_display_name: Optional[str] = None
    service_price: Optional[float] = None   # customer price
    pay_amount: float                        # amount provider is paid
    provider_names: Optional[str] = None    # comma-separated names


class UpdateServiceRequest(BaseModel):
    """Update one service pay rate (by id or service_key)."""
    id: Optional[int] = None
    service_key: Optional[str] = None
    parent_service: Optional[str] = None
    service_subcategory: Optional[str] = None
    service_price: Optional[float] = None
    pay_amount: Optional[float] = None
    provider_names: Optional[str] = None


class ServicesListResponse(BaseModel):
    services: List[ServiceRow]
    therapists: List[str]  # list of provider names for dropdowns


class VoiceBookRequest(BaseModel):
    """Utterance from voice: e.g. 'book me an appointment tonight for 1 hour deep tissue at 8pm'."""
    utterance: str


class VoiceBookResponse(BaseModel):
    success: bool
    message: str  # Spoken back to user, e.g. "Your appointment is booked for tonight at 8 PM."
    booking_id: Optional[str] = None  # Set when actually booked in Square


class AvailabilityAuditSlotIssue(BaseModel):
    """One Square slot that has no matching physical room for the audit duration."""
    start_at: str  # ISO from Square (usually UTC)
    start_at_local: Optional[str] = None  # Same instant in local tz for desk reading
    detail: str = "Square lists this start time but no room in MoM rules fits the full duration."


class AvailabilityAuditServiceBlock(BaseModel):
    """Square vs rooms for one catalog variation (single or couple)."""
    kind: str  # "single" | "couple"
    service_variation_id: Optional[str] = None
    service_variation_version: int = 1
    resolution: str = ""  # e.g. "config_variation_id" | "resolve_voice_service" | "missing"
    catalog_label: Optional[str] = None
    square_slot_count: int = 0
    square_slot_starts: List[str] = Field(default_factory=list)  # capped list of ISO starts from Square
    next_room_available: Optional[dict] = None  # same shape as DayResponse next_* 
    square_open_no_room: List[AvailabilityAuditSlotIssue] = Field(default_factory=list)
    square_fetch_error: Optional[str] = None


class AvailabilityAuditResponse(BaseModel):
    """Compare Square SearchAvailability to MoM room occupancy for one calendar day."""
    date: str
    duration_minutes: int
    single: AvailabilityAuditServiceBlock
    couple: AvailabilityAuditServiceBlock
    summary: Optional[str] = None
