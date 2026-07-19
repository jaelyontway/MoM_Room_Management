"""Database setup and session management."""
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# SQLite database path
SQLALCHEMY_DATABASE_URL = "sqlite:///./room_assignments.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


"""Database setup and session management."""
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# SQLite database path
SQLALCHEMY_DATABASE_URL = "sqlite:///./room_assignments.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def _table_exists(conn, table: str) -> bool:
    r = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"), {"t": table})
    return r.fetchone() is not None


def _column_exists(conn, table: str, column: str) -> bool:
    """SQLite: return True if column exists in table."""
    r = conn.execute(text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in r.fetchall())


def _booking_overrides_has_composite_pk(conn) -> bool:
    """Return True if booking_overrides already has (booking_id, date) as primary key."""
    r = conn.execute(text("SELECT sql FROM sqlite_master WHERE type='table' AND name='booking_overrides'"))
    row = r.fetchone()
    if not row or not row[0]:
        return False
    sql = row[0].upper()
    return "PRIMARY KEY (BOOKING_ID, DATE)" in sql or "PRIMARY KEY (BOOKING_ID,DATE)" in sql


def migrate_booking_overrides():
    """Add couple/therapist2/tip2/arrival columns if missing; migrate to composite PK (booking_id, date)."""
    with engine.connect() as conn:
        if not _table_exists(conn, "booking_overrides"):
            conn.commit()
            return
        # Add new columns if missing (before PK migration)
        cols = [
            ("therapist_override_2", "TEXT"),
            ("therapist_locked_2", "BOOLEAN DEFAULT 0"),
            ("tip_amount_2", "NUMERIC(10,2)"),
            ("tip_split_evenly", "BOOLEAN DEFAULT 0"),
            ("arrived_at_1", "DATETIME"),
            ("arrived_at_2", "DATETIME"),
            ("luxury_mini_facial_done", "BOOLEAN"),
            ("luxury_mini_facial_therapist", "TEXT"),
            ("luxury_mini_facial_therapist_2", "TEXT"),
            ("facial_specialist", "TEXT"),
            ("addon_note", "TEXT"),
            ("pressure", "TEXT"),
            ("focus_area", "TEXT"),
            ("pressure_2", "TEXT"),
            ("focus_area_2", "TEXT"),
            ("split_minutes_first", "INTEGER"),
            ("cancelled_or_noshow", "BOOLEAN DEFAULT 0"),
            ("duration_adjust_minutes", "INTEGER"),
            ("tip_cash", "BOOLEAN DEFAULT 0"),
            ("luxury_separate_mini_facial", "BOOLEAN"),
            ("couple_02d_single_facial_only", "BOOLEAN"),
            ("room_placement_override", "BOOLEAN DEFAULT 0"),
            ("facial_portion_room", "TEXT"),
            ("checkin_partner_name", "TEXT"),
            ("checkin_massage_recipient", "TEXT"),
        ]
        for col_name, col_type in cols:
            if not _column_exists(conn, "booking_overrides", col_name):
                conn.execute(text(f"ALTER TABLE booking_overrides ADD COLUMN {col_name} {col_type}"))
        conn.commit()

        # Migrate to composite primary key (booking_id, date) so overrides are per-date and don't overwrite other days
        if _booking_overrides_has_composite_pk(conn):
            conn.commit()
            return
        r = conn.execute(text("PRAGMA table_info(booking_overrides)"))
        info = r.fetchall()
        # (cid, name, type, notnull, dflt_value, pk)
        col_defs = []
        col_names = []
        for row in info:
            name, typ, notnull, dflt, pk = row[1], row[2] or "TEXT", row[3], row[4], row[5]
            col_names.append(name)
            # For new table both booking_id and date are PK; other columns keep their definition
            if name in ("booking_id", "date"):
                col_defs.append(f"{name} {typ} NOT NULL")
            else:
                nn = " NOT NULL" if notnull else ""
                df = f" DEFAULT {dflt}" if dflt is not None else ""
                col_defs.append(f"{name} {typ}{nn}{df}")
        col_defs.append("PRIMARY KEY (booking_id, date)")
        create_sql = "CREATE TABLE booking_overrides_new (" + ", ".join(col_defs) + ")"
        conn.execute(text(create_sql))
        cols_sql = ", ".join(col_names)
        conn.execute(text(f"INSERT INTO booking_overrides_new ({cols_sql}) SELECT {cols_sql} FROM booking_overrides"))
        conn.execute(text("DROP TABLE booking_overrides"))
        conn.execute(text("ALTER TABLE booking_overrides_new RENAME TO booking_overrides"))
        conn.commit()


def migrate_service_pay_rates():
    """Add service_price and provider_names to service_pay_rates if missing."""
    with engine.connect() as conn:
        if not _table_exists(conn, "service_pay_rates"):
            conn.commit()
            return
        for col_name, col_type in [
            ("service_price", "NUMERIC(10,2)"),
            ("provider_names", "TEXT"),
            ("parent_service", "TEXT"),
            ("service_subcategory", "TEXT"),
        ]:
            if not _column_exists(conn, "service_pay_rates", col_name):
                conn.execute(text(f"ALTER TABLE service_pay_rates ADD COLUMN {col_name} {col_type}"))
        conn.commit()


def migrate_room_assignment_undo():
    """Create room_assignment_undo table if missing (for undo room change)."""
    with engine.connect() as conn:
        if _table_exists(conn, "room_assignment_undo"):
            conn.commit()
            return
        conn.execute(text("""
            CREATE TABLE room_assignment_undo (
                date TEXT NOT NULL PRIMARY KEY,
                snapshot TEXT NOT NULL,
                saved_at TIMESTAMP
            )
        """))
        conn.commit()


def migrate_customer_last_partner():
    """Create customer_last_partner table if missing."""
    with engine.connect() as conn:
        if _table_exists(conn, "customer_last_partner"):
            conn.commit()
            return
        conn.execute(text("""
            CREATE TABLE customer_last_partner (
                customer_id TEXT NOT NULL PRIMARY KEY,
                partner_name TEXT,
                updated_at TIMESTAMP
            )
        """))
        conn.commit()


def migrate_customer_hours_daily_snapshots():
    """Create customer_hours_daily_snapshots table if missing."""
    with engine.connect() as conn:
        if _table_exists(conn, "customer_hours_daily_snapshots"):
            conn.commit()
            return
        conn.execute(text("""
            CREATE TABLE customer_hours_daily_snapshots (
                date TEXT NOT NULL PRIMARY KEY,
                customer_count INTEGER NOT NULL,
                appointment_count INTEGER NOT NULL,
                total_minutes INTEGER NOT NULL,
                schema_version INTEGER NOT NULL DEFAULT 1,
                updated_at TIMESTAMP
            )
        """))
        conn.commit()


def migrate_customer_desk_notes():
    """Create customer_desk_notes table if missing (front desk check-in/checkout notes)."""
    with engine.connect() as conn:
        if _table_exists(conn, "customer_desk_notes"):
            conn.commit()
            return
        conn.execute(text("""
            CREATE TABLE customer_desk_notes (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                customer_id TEXT NOT NULL,
                date TEXT NOT NULL,
                booking_id TEXT,
                note_kind TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TIMESTAMP
            )
        """))
        conn.execute(text("CREATE INDEX ix_customer_desk_notes_customer_date ON customer_desk_notes (customer_id, date)"))
        conn.commit()


def migrate_room_day_layout_freeze_meta():
    """When 'Lock Appointments for Day' is on, store last lock time for tooltip (ISO UTC)."""
    with engine.connect() as conn:
        if _table_exists(conn, "room_day_layout_freeze_meta"):
            conn.commit()
            return
        conn.execute(text("""
            CREATE TABLE room_day_layout_freeze_meta (
                date TEXT NOT NULL PRIMARY KEY,
                locked_at TEXT NOT NULL
            )
        """))
        conn.commit()


def migrate_calendar_screenshots():
    """Store metadata for dashboard calendar PNG screenshots (files on disk)."""
    with engine.connect() as conn:
        if _table_exists(conn, "calendar_screenshots"):
            conn.commit()
            return
        conn.execute(text("""
            CREATE TABLE calendar_screenshots (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                calendar_date TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                filename TEXT NOT NULL
            )
        """))
        conn.execute(text("CREATE INDEX ix_calendar_screenshots_calendar_date ON calendar_screenshots (calendar_date)"))
        conn.execute(text("CREATE INDEX ix_calendar_screenshots_captured_at ON calendar_screenshots (captured_at)"))
        conn.commit()


def migrate_room_day_layout_freeze_events():
    """Append-only lock/unlock history for the day-layout control (unlock modal timeline)."""
    with engine.connect() as conn:
        if _table_exists(conn, "room_day_layout_freeze_events"):
            conn.commit()
            return
        conn.execute(text("""
            CREATE TABLE room_day_layout_freeze_events (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                at_utc TEXT NOT NULL,
                action TEXT NOT NULL
            )
        """))
        conn.execute(text("CREATE INDEX ix_room_day_layout_freeze_events_date ON room_day_layout_freeze_events (date)"))
        conn.commit()


def migrate_booking_prepayment_override():
    """Add prepayment_override to booking_overrides for manual prepayment amount (dashboard)."""
    with engine.connect() as conn:
        if not _table_exists(conn, "booking_overrides"):
            conn.commit()
            return
        if not _column_exists(conn, "booking_overrides", "prepayment_override"):
            conn.execute(text("ALTER TABLE booking_overrides ADD COLUMN prepayment_override NUMERIC(10,2)"))
        conn.commit()


def migrate_customer_hours_snapshot_booked_by_counts():
    """Add booked_online_count / booked_by_us_count to customer_hours_daily_snapshots (schema v2)."""
    with engine.connect() as conn:
        if not _table_exists(conn, "customer_hours_daily_snapshots"):
            conn.commit()
            return
        for col_name, col_type in (
            ("booked_online_count", "INTEGER NOT NULL DEFAULT 0"),
            ("booked_by_us_count", "INTEGER NOT NULL DEFAULT 0"),
        ):
            if not _column_exists(conn, "customer_hours_daily_snapshots", col_name):
                conn.execute(
                    text(f"ALTER TABLE customer_hours_daily_snapshots ADD COLUMN {col_name} {col_type}")
                )
        conn.commit()


def init_db():
    """Initialize database - create all tables and run migrations."""
    Base.metadata.create_all(bind=engine)
    try:
        migrate_booking_overrides()
        migrate_booking_prepayment_override()
        migrate_service_pay_rates()
        migrate_room_assignment_undo()
        migrate_customer_last_partner()
        migrate_customer_hours_daily_snapshots()
        migrate_customer_hours_snapshot_booked_by_counts()
        migrate_customer_desk_notes()
        migrate_room_day_layout_freeze_meta()
        migrate_room_day_layout_freeze_events()
        migrate_calendar_screenshots()
    except Exception:
        pass  # table might not exist yet or columns already exist


def get_db():
    """Dependency for getting database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

