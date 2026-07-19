"""SQLAlchemy models for room assignments and booking overrides."""
from sqlalchemy import Column, String, DateTime, Text, Integer, Numeric, Boolean
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


class RoomAssignmentUndo(Base):
    """Snapshot of room assignments for a date, saved before a room change so user can undo."""
    __tablename__ = "room_assignment_undo"

    date = Column(String, primary_key=True)  # YYYY-MM-DD
    snapshot = Column(Text, nullable=False)  # JSON array of {booking_id, room, assigned_by, reason}
    saved_at = Column(DateTime(timezone=True), server_default=func.now())


class BookingOverride(Base):
    """Per-booking per-date overrides: therapist(s), tip(s), arrival, and whether past appointment is locked."""
    __tablename__ = "booking_overrides"

    booking_id = Column(String, primary_key=True, index=True)
    date = Column(String, primary_key=True, nullable=False, index=True)  # YYYY-MM-DD; composite PK (booking_id, date)
    therapist_override = Column(String, nullable=True)  # masseuse 1 (or only for single)
    therapist_locked = Column(Boolean, nullable=False, default=False)
    therapist_override_2 = Column(String, nullable=True)  # second masseuse for couple
    therapist_locked_2 = Column(Boolean, nullable=False, default=False)
    tip_amount = Column(Numeric(10, 2), nullable=True)   # tip for masseuse 1 (or total if split)
    tip_amount_2 = Column(Numeric(10, 2), nullable=True)  # tip for masseuse 2 (couple)
    tip_cash = Column(Boolean, nullable=False, default=False)  # True if tip was paid in cash (checkout flag)
    tip_split_evenly = Column(Boolean, nullable=False, default=False)  # if True, split tip_amount between both
    # Manual prepayment display ($); when set, overrides Square/suggested prepayment for calendar + detail modal
    prepayment_override = Column(Numeric(10, 2), nullable=True)
    arrived_at_1 = Column(DateTime(timezone=True), nullable=True)  # check-in time client 1 (couple)
    arrived_at_2 = Column(DateTime(timezone=True), nullable=True)  # check-in time client 2 (couple)
    appointment_locked = Column(Boolean, nullable=False, default=False)
    # Luxury package: whether 30 min mini facial was done and which therapist(s) did it (couple can have FS1 + FS2)
    luxury_mini_facial_done = Column(Boolean, nullable=True)  # True = package pay $80 + $20 to mini facial therapist
    # True = different person does mini facial (last 30 min); False = masseuse did full 2hr (no FS split / no FS bonus line)
    luxury_separate_mini_facial = Column(Boolean, nullable=True)
    luxury_mini_facial_therapist = Column(String, nullable=True)  # Facial Specialist 1 (or only for single)
    luxury_mini_facial_therapist_2 = Column(String, nullable=True)  # Facial Specialist 2 (couple only)
    # Facial+massage (basic 55min, custom 85min): who does the facial part; blank = main therapist does entire package
    facial_specialist = Column(String, nullable=True)  # therapist name who does facial; null = masseuse does all
    # Couple + facial+m massage: only one client gets facial — split calendar/occupancy (02D, Rm 5, or Rm 6)
    couple_02d_single_facial_only = Column(Boolean, nullable=True)
    # When split is on: room for the facial-only portion (drag facial box); null = UNASSIGNED / default (Rm 2 for 02D)
    facial_portion_room = Column(String, nullable=True)
    # Manager placed this booking in a room the calendar showed as unavailable (explicit acknowledge)
    room_placement_override = Column(Boolean, nullable=False, default=False)
    addon_note = Column(Text, nullable=True)  # e.g. "Add-on: lavender aromatherapy, cupping" from kiosk
    pressure = Column(String, nullable=True)  # deep, deep/medium, medium, medium/light, light (slot 1 or single)
    focus_area = Column(Text, nullable=True)  # comma-separated focus areas for slot 1 or single
    pressure_2 = Column(String, nullable=True)  # for couple: pressure for second masseuse
    focus_area_2 = Column(Text, nullable=True)  # for couple: focus areas for second masseuse
    split_minutes_first = Column(Integer, nullable=True)  # single with 2 SRMs: minutes first therapist did (prorate tip)
    cancelled_or_noshow = Column(Boolean, nullable=False, default=False)  # True = hide from schedule (cancelled or no-show)
    # Signed minutes added to Square end_at for this app only (+ = longer block, − = shorter). NULL/0 = use Square.
    duration_adjust_minutes = Column(Integer, nullable=True)
    # Check-in / front desk: second guest (couples) and who is actually receiving massage if not the booker
    checkin_partner_name = Column(Text, nullable=True)
    checkin_massage_recipient = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CustomerLastPressure(Base):
    """Last pressure preference per customer (for prepopulating check-in)."""
    __tablename__ = "customer_last_pressure"

    customer_id = Column(String, primary_key=True, index=True)
    pressure = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CustomerLastPartner(Base):
    """Last recorded second guest name for couples (per Square customer_id of booker)."""
    __tablename__ = "customer_last_partner"

    customer_id = Column(String, primary_key=True, index=True)
    partner_name = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TherapistDayOrder(Base):
    """Daily rotation order for therapists (1 = first for unassigned, etc.)."""
    __tablename__ = "therapist_day_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    therapist_name = Column(String, nullable=False, index=True)
    order_number = Column(Integer, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ServicePayRate(Base):
    """Pay amount per service (for daily report). Optional customer price and which providers can do the service."""
    __tablename__ = "service_pay_rates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    service_key = Column(String, nullable=False, unique=True)  # e.g. "60 min", "90 min", "facial basic"
    parent_service = Column(String, nullable=True)  # optional broad bucket, e.g. Massage / Facial (often redundant)
    service_subcategory = Column(String, nullable=True)  # finer grouping: Couples, Singles, Facial, Add-on, Package, etc.
    service_price = Column(Numeric(10, 2), nullable=True)   # customer-facing price (optional)
    pay_amount = Column(Numeric(10, 2), nullable=False)    # amount provider is paid
    provider_names = Column(Text, nullable=True)           # comma-separated list of providers who can do this service


class NoRoomNotificationSent(Base):
    """Tracks that we already sent SMS+email for 'no room' on this date (avoid duplicate alerts)."""
    __tablename__ = "no_room_notification_sent"

    date = Column(String, primary_key=True)  # YYYY-MM-DD
    sent_at = Column(DateTime(timezone=True), server_default=func.now())


class CustomerDeskNote(Base):
    """Front-desk check-in / check-out notes per customer per visit day (append-only log for history)."""

    __tablename__ = "customer_desk_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(String, nullable=False, index=True)
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD (visit day)
    booking_id = Column(String, nullable=True)
    note_kind = Column(String, nullable=False)  # "checkin" | "checkout"
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CalendarScreenshot(Base):
    """Saved PNG captures of the dashboard calendar grid (per spa calendar date)."""

    __tablename__ = "calendar_screenshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    calendar_date = Column(String, nullable=False, index=True)  # YYYY-MM-DD the grid was showing
    captured_at = Column(String, nullable=False)  # ISO UTC when the screenshot was taken
    filename = Column(String, nullable=False)  # file name under calendar_screenshots/


class CustomerHoursDailySnapshot(Base):
    """Frozen customers-hours stats per day (after overrides). Past days read from here; bump schema_version in code if formulas change."""

    __tablename__ = "customer_hours_daily_snapshots"

    date = Column(String, primary_key=True)  # YYYY-MM-DD
    customer_count = Column(Integer, nullable=False)
    appointment_count = Column(Integer, nullable=False)
    total_minutes = Column(Integer, nullable=False)
    booked_online_count = Column(Integer, nullable=False, default=0)  # Square booked_by == customer
    booked_by_us_count = Column(Integer, nullable=False, default=0)  # staff / merchant
    schema_version = Column(Integer, nullable=False, default=1)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

