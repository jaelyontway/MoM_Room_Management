"""FastAPI main application."""
from fastapi import FastAPI, Depends, Query, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from starlette.requests import Request
from sqlalchemy import text, func
from sqlalchemy.orm import Session
from typing import List, Dict, Optional, Any, Tuple, Set
from datetime import datetime, date as date_type, timedelta, timezone
from dateutil import tz as dateutil_tz
import os
import csv
import io
import json
import re
import uuid
import socket
from dateutil import parser as dateutil_parser

from app.database import init_db, get_db, SessionLocal
from app.schemas import (
    DayResponse, Event, UpdateRoomRequest, DayLayoutFreezeRequest,
    UnlockRoomRequest, UpdateTherapistRequest, UpdateTipRequest,
    SetSplitTimeRequest, SetCancelledNoShowRequest, SetDurationAdjustRequest,
    UnlockAppointmentRequest, UpdatePrepaymentRequest, UpdateTherapistOrderRequest,
    CheckInRequest, CheckInAddonNoteRequest, UpdatePressureRequest, UpdateFocusAreaRequest,
    ServiceRow, UpdateServiceRequest, ServicesListResponse,
    UpdateLuxuryMiniFacialRequest, UpdateFacialSpecialistRequest, UpdateCouple02dSingleFacialRequest,
    VoiceBookRequest, VoiceBookResponse,
    UpdateCheckinClientNamesRequest,
    CustomerDeskNoteListResponse, CustomerDeskNoteItem, SaveCustomerDeskNoteRequest,
    AvailabilityAuditResponse, AvailabilityAuditServiceBlock, AvailabilityAuditSlotIssue,
    RosterActionRequest,
)
from app import roster_store
from app.models import (
    RoomAssignment,
    RoomAssignmentUndo,
    BookingOverride,
    CalendarScreenshot,
    CustomerHoursDailySnapshot,
    CustomerLastPressure,
    CustomerLastPartner,
    CustomerDeskNote,
    TherapistDayOrder,
    ServicePayRate,
    NoRoomNotificationSent,
)
from app.room_assigner import RoomAssigner, booking_requires_back_walking_bar_room
from app.room_occupancy import physical_busy_segments_ts, facial_segment_start_iso, is_couple_facial_with_massage
from app.unassigned_suggestions import compute_unassigned_fix_suggestions
from app import notifications as notifications_module
from app.square_service import SquareService
from app.mock_square import MockSquareService
from config import Config, customer_display_excluded_from_calendar_and_counts
import logging

# Add-ons that don't count toward "service count" for the day (same as time-neutral)
ADDON_NAMES_FOR_COUNT = {
    "pain relief oil",
    "pain relief cream",
    "cupping",
    "eye spa",
    "aromatherapy",
    "tea tree",
    "teatree",
}
MIN_SERVICE_MINUTES_FOR_COUNT = 30
COUPLE_ROOMS = ("5", "6", "02D")
SINGLE_ROOMS = ("1", "3", "4", "2", "0", "6", "5")
# Union so merged busy intervals include every physical key used by single or couple next-available logic.
_AUDIT_ROOM_UNION_FOR_BUSY = tuple(dict.fromkeys(list(COUPLE_ROOMS) + list(SINGLE_ROOMS)))

# Bump when customer headcount or booked-minutes rules change; old snapshot rows are ignored and re-fetched.
CUSTOMERS_HOURS_SNAPSHOT_SCHEMA_VERSION = 4


def _without_square_test_profile_bookings(bookings: List[dict]) -> List[dict]:
    """Drop internal Square test customers (see config.customer_display_excluded_from_calendar_and_counts)."""
    return [b for b in bookings if not customer_display_excluded_from_calendar_and_counts(b.get("customer"))]


# Allowed therapists list (case-insensitive matching). "Staff" = unresolved Square team ID (e.g. staff at other location).
ALLOWED_THERAPISTS = [
    "cassey t", "hanna I", "hongxia shaw", "jenny l",
    "katy m", "may l", "rose j", "sophia e", "tina r", "vicky w", "lillian i", "ruby r", "amy rz", "staff"
]

# Former therapists: kept allowed so their past bookings/history still match and display,
# but NOT force-added as empty columns on days where they have no bookings (they left the spa).
FORMER_THERAPISTS = {"amy rz"}


def effective_allowed_therapists() -> List[str]:
    """Hardcoded allowlist plus any names approved at runtime via the roster store (auto-detect)."""
    base = list(ALLOWED_THERAPISTS)
    try:
        existing = {normalize_therapist_name(x) for x in base}
        for n in roster_store.get_added():
            norm = normalize_therapist_name(n)
            if norm and norm not in existing:
                base.append(n)
                existing.add(norm)
    except Exception:
        pass
    return base


def normalize_therapist_name(name: str) -> str:
    """Normalize therapist name for comparison (lowercase, strip, remove extra spaces)."""
    if not name:
        return ""
    return " ".join(name.lower().strip().split())


def is_allowed_therapist(name: str) -> bool:
    """Check if therapist name matches any allowed therapist (case-insensitive, flexible matching)."""
    if not name:
        return False
    
    normalized = normalize_therapist_name(name)
    
    # Special case: explicitly exclude "amy r" (but allow "amy rz")
    if normalized == "amy r":
        return False
    
    for allowed in effective_allowed_therapists():
        allowed_normalized = normalize_therapist_name(allowed)
        
        # Exact match
        if normalized == allowed_normalized:
            return True
        
        # For "amy rz", require exact match or starts with "amy rz" (don't match "amy r")
        if allowed_normalized == "amy rz":
            if normalized == "amy rz" or normalized.startswith("amy rz"):
                return True
            continue  # Don't do partial matching for "amy rz"
        
        # Check if name starts with allowed (e.g., "Katy M" matches "katy m")
        if normalized.startswith(allowed_normalized) or allowed_normalized.startswith(normalized):
            return True
        
        # Check if first name + last initial matches (e.g., "Katy M" matches "katy m")
        name_parts = normalized.split()
        allowed_parts = allowed_normalized.split()
        if len(name_parts) >= 1 and len(allowed_parts) >= 1:
            # Match first name and check if last initial matches
            if name_parts[0] == allowed_parts[0]:
                if len(name_parts) == 1 or len(allowed_parts) == 1:
                    return True
                # Check if last initial matches
                if len(name_parts) > 1 and len(allowed_parts) > 1:
                    if name_parts[1][0] == allowed_parts[1][0]:
                        return True
    
    return False


def detect_unknown_therapist_names(candidate_names) -> List[str]:
    """Names from Square bookings that aren't in the roster, aren't Staff/unresolved IDs, and weren't ignored.

    Used to prompt the user to Add (new masseuse) or Ignore them.
    """
    out: List[str] = []
    seen = set()
    for raw in candidate_names or []:
        if not raw or not isinstance(raw, str):
            continue
        t = raw.strip()
        if not t:
            continue
        norm = normalize_therapist_name(t)
        if norm in ("staff", "amy r"):
            continue
        if looks_like_unresolved_team_id(t):
            continue
        if is_allowed_therapist(t):
            continue
        if norm in seen:
            continue
        try:
            if roster_store.is_ignored(t):
                continue
        except Exception:
            pass
        seen.add(norm)
        out.append(t)
    return sorted(out)


def looks_like_unresolved_team_id(therapist: str) -> bool:
    """True if therapist looks like a raw Square team_member_id (name lookup failed)."""
    if not therapist or not isinstance(therapist, str):
        return False
    s = therapist.strip()
    # Square IDs are alphanumeric (often prefix like TMa_) and at least 12 chars; names rarely look like this
    if len(s) < 12:
        return False
    if s.startswith(("TM", "tm", "TMa", "team_")):
        return True
    return s.replace("_", "").replace("-", "").isalnum()


def filter_allowed_therapists(therapists: List[str]) -> List[str]:
    """Filter therapists to only include allowed ones."""
    filtered = [t for t in therapists if t is not None and is_allowed_therapist(t)]
    # Also ensure all allowed therapists are included (even if no bookings),
    # except former therapists who only appear when they have bookings that day (preserves history without empty columns).
    allowed_set = set(filtered)
    for allowed in effective_allowed_therapists():
        if normalize_therapist_name(allowed) in FORMER_THERAPISTS:
            continue
        # Try to match existing therapist name or add the allowed name
        matched = False
        for existing in therapists:
            if existing is None or not isinstance(existing, str):
                continue
            if normalize_therapist_name(existing) == normalize_therapist_name(allowed):
                matched = True
                break
        if not matched:
            # Add the allowed name as-is
            allowed_set.add(allowed)
    return sorted(list(allowed_set))


def _clean_suggested_display_name(s: str) -> str:
    s = (s or "").strip()
    if len(s) > 120:
        s = s[:120].rstrip()
    return s


def _suggest_partner_from_booking_notes(customer_note: Optional[str], seller_note: Optional[str]) -> Optional[str]:
    """Guess second guest from Square notes (e.g. 'massage with Jane', 'second guest: Bob')."""
    text = " ".join(x.strip() for x in [customer_note or "", seller_note or ""] if (x or "").strip())
    if not text:
        return None
    patterns = [
        re.compile(
            r"(?i)(?:massages?\s+with|massaging\s+with|massage\s+with)\s+([A-Za-z\u00C0-\u024f]"
            r"[A-Za-z0-9\u00C0-\u024f\s\.'\u2019\-]{1,50})(?=\s*[.,;]|$|\n|\)|—)"
        ),
        re.compile(
            r"(?i)(?:second|2nd|other)\s+(?:person|client|guest|customer)\s*:?\s*"
            r"([A-Za-z\u00C0-\u024f][^\n,;]{1,40})"
        ),
    ]
    for pat in patterns:
        m = pat.search(text)
        if m:
            name = _clean_suggested_display_name(m.group(1))
            if len(name) >= 2:
                return name
    m3 = re.search(
        r"(?i)\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b(?:\s*[.,;]|$|\n)",
        text,
    )
    if m3:
        name = _clean_suggested_display_name(m3.group(1))
        if len(name) >= 2:
            return name
    return None


_COUPLES_SLOT_NOTE_RE = re.compile(r"\bcouples?\s*#\s*(\d+)\b", re.I)


def _couples_slot_note_from_texts(*parts: Optional[str]) -> Optional[int]:
    """Parse couples#N from notes (seller/customer/add-on): 2nd/3rd couple appointment same guest & time."""
    blob = " ".join(str(p or "").strip() for p in parts if (p or "").strip())
    if not blob:
        return None
    m = _COUPLES_SLOT_NOTE_RE.search(blob)
    if not m:
        return None
    try:
        n = int(m.group(1))
    except ValueError:
        return None
    if n < 1:
        return None
    return n


def _suggest_massage_recipient_from_notes(
    customer_note: Optional[str], seller_note: Optional[str], booker_name: str
) -> Optional[str]:
    """Guess actual recipient when different from booker (e.g. 'massage for Emma', 'actually: Maria')."""
    text = " ".join(x.strip() for x in [customer_note or "", seller_note or ""] if (x or "").strip())
    if not text:
        return None
    booker_lower = (booker_name or "").strip().lower()
    patterns = [
        re.compile(
            r"(?i)massage\s+for\s+([A-Za-z\u00C0-\u024f]"
            r"[A-Za-z0-9\u00C0-\u024f\s\.'\u2019\-]{1,50})(?=\s*[.,;]|$|\n|\)|—)"
        ),
        re.compile(
            r"(?i)(?:actually|recipient|getting\s+(?:the\s+)?massage)\s*:?\s*([A-Za-z\u00C0-\u024f]"
            r"[A-Za-z0-9\u00C0-\u024f\s\.'\u2019\-]{1,50})(?=\s*[.,;]|$|\n)"
        ),
    ]
    for pat in patterns:
        m = pat.search(text)
        if m:
            name = _clean_suggested_display_name(m.group(1))
            if len(name) < 2:
                continue
            if booker_lower and name.lower() == booker_lower:
                continue
            return name
    return None


def _is_addon_for_count(service_name: str) -> bool:
    """True if this service name is an add-on (excluded from service count)."""
    lower = (service_name or "").lower()
    return any(addon in lower for addon in ADDON_NAMES_FOR_COUNT)


_ADVERTISED_MIN_TITLE_RE = (
    re.compile(r"\b(\d{1,3})\s*(?:minutes?|min)\b", re.I),
    re.compile(r"\b(\d{1,3})min\b", re.I),
)


def _advertised_duration_minutes_from_service_title(service: Optional[str]) -> Optional[int]:
    """First duration like '90 minute' / '60 min' / '90min' / '2 hour' in the catalog service name (not addon note)."""
    if not (service or "").strip():
        return None
    s = (service or "").strip()
    for pat in _ADVERTISED_MIN_TITLE_RE:
        m = pat.search(s)
        if m:
            n = int(m.group(1))
            if 15 <= n <= 240:
                return n
    sl = s.lower()
    if re.search(r"\b2\s*[-\u2013]?\s*(?:h|hr|hour|hours)\b", sl):
        return 120
    if re.search(r"\b1\.5\s*[-\u2013]?\s*(?:h|hr|hour|hours)\b", sl):
        return 90
    return None


def _addon_padding_minutes_vs_standard_tiers(
    service: Optional[str], duration_min: int, has_cupping: bool, massage_ctx: bool
) -> int:
    """
    When the title has no '120 min' etc., Square's total still often = standard tier (60/90/120…) + 5/10
    (pain relief cream/oil, aromatherapy line item with its own 5m segment, etc.). Treat the excess
    as neutral if it matches exactly, unless this looks like cupping (handled elsewhere with wider delta).
    """
    if not massage_ctx or has_cupping or duration_min < 15:
        return 0
    if _advertised_duration_minutes_from_service_title(service) is not None:
        return 0
    for base in (240, 180, 150, 120, 90, 60):
        d = duration_min - base
        if d in (5, 10):
            return d
    return 0


def _addon_time_neutral_minutes(
    service: Optional[str], combined_notes: Optional[str], duration_min: Optional[int] = None
) -> int:
    """
    Minutes Square often adds for aromatherapy / pain relief / scent add-ons that are not extra *massage* time.
    We treat them as add-ons only: subtract from displayed duration, checkout slot time, and calendar labels.
    Room assignment uses end_at after subtracting this neutral window (see _booking_dict_for_assignment).

    combined_notes: merge of addon_note, seller_note, customer_note (lavender / cream often live in notes only).
    Rose-as-scent is detected only on the catalog service line so a therapist named Rose in notes does not count.

    Also: when the service title advertises N minutes (e.g. '90 minute 3 Senses') but the booked
    block is exactly N+5 or N+10, treat the excess as neutral (common Square catalog padding).

    Cupping (e.g. Air Cupping) is often a separate Square segment with its own minutes even when done
    inside the massage; if the block is longer than the advertised massage length by 5–60 min and the
    title mentions cupping + massage, treat that excess as neutral so the room frees for the real massage end.
    """
    text = f"{service or ''} {combined_notes or ''}".lower()
    has_pain_phrase = "pain relief" in text or "pain-relief" in text
    # "Pain relief cream" split across fields, or "cream" with pain context
    has_pain_cream = "cream" in text and ("pain" in text or "relief" in text)
    has_pain = has_pain_phrase or has_pain_cream
    has_aroma_word = "aromatherapy" in text or "aroma therapy" in text
    # Common Square phrasing: "Swedish Massage, Lavender" (scent = aromatherapy add-on)
    has_lavender_scent = "lavender" in text and (
        "massage" in text or "swedish" in text or "deep" in text or "tissue" in text or "couple" in text
    )
    # Rose scent only on the catalog service line — "Rose" in desk notes is often a therapist name, not aroma.
    svc_l = (service or "").lower()
    has_rose_scent = bool(re.search(r"\brose\b", svc_l, re.I)) and (
        "massage" in svc_l
        or "swedish" in svc_l
        or "deep" in svc_l
        or "tissue" in svc_l
        or "couple" in svc_l
    )
    has_aroma = has_aroma_word or has_lavender_scent or has_rose_scent
    if has_pain and has_aroma:
        return 10
    if has_pain or has_aroma:
        return 5
    if duration_min is not None and duration_min > 0:
        has_cupping = "cupping" in text or bool(
            re.search(r"\bair\s+cup", text, re.I)
        ) or "vacuum cup" in text
        massage_ctx = any(
            k in text
            for k in (
                "massage",
                "swedish",
                "deep tissue",
                "hot stone",
                "prenatal",
                "sports massage",
                "couple",
                "couples",
            )
        )
        advertised = _advertised_duration_minutes_from_service_title(service)
        if advertised is not None:
            delta = duration_min - advertised
            if delta in (5, 10):
                return delta
            if has_cupping and massage_ctx and 5 <= delta <= 60:
                return delta
        # Title has no "90 min" etc. but Square block is massage + parallel cupping line item
        if advertised is None and has_cupping and massage_ctx and duration_min >= 75:
            for base in (120, 90, 60):
                if duration_min > base:
                    d = duration_min - base
                    if 5 <= d <= 45:
                        return d
        pad = _addon_padding_minutes_vs_standard_tiers(
            service, int(duration_min), has_cupping, massage_ctx
        )
        if pad:
            return int(pad)
    return 0


def _duration_minutes(start_at: str, end_at: str) -> int:
    """Parse start/end ISO strings and return duration in minutes."""
    try:
        start = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
        return int((end - start).total_seconds() / 60)
    except Exception:
        return 0


def _facial_massage_minutes(service: Optional[str], duration_min: int) -> tuple:
    """Return (massage_min, facial_min) for tip proration. Total = massage_min + facial_min."""
    lower = (service or "").lower()
    # Custom Facial Package w 90 min Massage — fixed split for tips (must be before generic "60 min" branch)
    if (
        ("custom facial" in lower or "facial custom" in lower or "facial package" in lower)
        and "massage" in lower
        and ("90 min" in lower or "90min" in lower or " 90 " in lower)
    ):
        return (90, 30)
    # "Basic Facial w 60 min Massage" or "60 min massage" + facial → 60 massage, rest facial
    if "60 min" in lower and "massage" in lower:
        massage_min = 60
        facial_min = max(0, duration_min - massage_min)
        return (massage_min, facial_min)
    # "Basic facial" 55 min slot: treat as 30 massage / 25 facial
    if ("basic facial" in lower or "facial basic" in lower) and duration_min <= 65:
        return (30, 25)
    # Custom facial with massage: ~85 min (60+25) or ~90 min (60+30) typical Square duration
    if ("custom facial" in lower or "facial custom" in lower) and 75 <= duration_min <= 105:
        if duration_min >= 88:
            return (60, 30)
        return (60, 25)
    # Default 50/50
    half = duration_min // 2
    return (half, duration_min - half)


def _is_facial_with_massage(service: Optional[str], booking_type: str, start_at: str, end_at: str) -> bool:
    """True if single booking is basic/custom facial with massage — show Facial Specialist + dual tips."""
    if (booking_type or "").lower() != "single":
        return False
    lower = (service or "").lower().strip()
    if not lower:
        return False
    duration_min = _duration_minutes(start_at or "", end_at or "")
    # Basic facial ~55 min (facial-only slot)
    if ("basic facial" in lower or "facial basic" in lower) and 50 <= duration_min <= 65:
        return True
    # Basic facial w 60 min massage (e.g. Relax Package - Basic Facial w 60 min Massage) — 2hr total
    if ("basic facial" in lower or "facial basic" in lower) and "massage" in lower and 85 <= duration_min <= 135:
        return True
    # Custom facial / facial package + massage — allow inflated Square duration (extra segments, room holds)
    if ("custom facial" in lower or "facial custom" in lower or "facial package" in lower) and 70 <= duration_min <= 240:
        return True
    if ("facial" in lower and "massage" in lower) and 70 <= duration_min <= 240:
        return True
    # Explicit 90 + facial + massage in title (duration may not match a tight window)
    if "90" in lower and "facial" in lower and "massage" in lower and 70 <= duration_min <= 240:
        return True
    return False


def _package_type_and_display(
    service: Optional[str], booking_type: str, start_at: str, end_at: str
) -> tuple:
    """
    Return (package_type, display_service) for calendar display.
    package_type: "luxury" | "exclusive" | None
    display_service: e.g. "Luxury" or "Exclusive" when we should not show "Regular".
    """
    lower = (service or "").lower().strip()
    if not lower:
        return (None, None)
    duration_min = _duration_minutes(start_at or "", end_at or "")
    if "luxury" in lower or "luxury package" in lower:
        return ("luxury", "Luxury")
    if "exclusive" in lower or "exclusive package" in lower:
        return ("exclusive", "Exclusive")
    # Couples 2hr "Regular" in Square is often the Luxury package
    if "regular" in lower and (booking_type or "").lower() == "couple" and duration_min >= 110:
        return ("luxury", "Luxury")
    return (None, None)


def _display_service_with_package_addons(
    service: Optional[str], package_type: Optional[str], base_display: Optional[str]
) -> Optional[str]:
    """
    Square joins multi-segment bookings with commas (e.g. Luxury + 30 min scalp).
    Calendar headline uses display_service only — without this, add-ons after the package name disappear.
    """
    if not base_display or not service or package_type not in ("luxury", "exclusive"):
        return base_display
    lower_full = service.lower()
    chunks = [c.strip() for c in service.split(",") if c.strip()]
    if len(chunks) <= 1:
        if "scalp" in lower_full and "scalp" not in base_display.lower():
            return base_display + " · scalp"
        return base_display
    base_l = base_display.lower()
    extras: List[str] = []
    for c in chunks:
        cl = c.lower()
        if cl == "regular":
            continue
        if cl in base_l or (len(cl) > 3 and base_l in cl):
            continue
        if package_type == "luxury" and "luxury" in cl:
            continue
        if package_type == "exclusive" and "exclusive" in cl:
            continue
        extras.append(c)
    if not extras:
        return base_display
    return base_display + " · " + " · ".join(extras)


def _compute_masseuse_pay(service_name: str, duration_min: int) -> float:
    """
    Compute base pay + add-ons for one masseuse from service name and duration.
    Matches: 60 min couples $30, scalp 60 $35, deep/swedish 60 $30 / 90 $45 / 120 $60,
    custom facial $40, basic facial $30 or $25 with massage, 3 senses +$2,
    luxury $80 or $60 (override in caller), exclusive $80,
    cupping +$10, collagen socks/gloves/hydration/heat +$2 each, scrub with socks/gloves +$5,
    trigger point 30min $30 / 60min $50 / 90min $70.
    """
    lower = (service_name or "").lower()
    pay = 0.0

    if "trigger point" in lower:
        if duration_min <= 35:
            pay = 30.0
        elif duration_min <= 65:
            pay = 50.0
        elif duration_min >= 85:
            pay = 70.0
        else:
            pay = 50.0
    elif "luxury" in lower or "luxury package" in lower:
        pay = 80.0
    elif "exclusive" in lower or "exclusive package" in lower:
        pay = 80.0
    elif "couple" in lower or "couples" in lower:
        if duration_min >= 105:
            pay = 60.0
        elif duration_min >= 75:
            pay = 45.0
        else:
            pay = 30.0
    elif "scalp" in lower:
        pay = 35.0
    elif "deep tissue" in lower:
        if duration_min >= 105:
            pay = 60.0
        elif duration_min >= 75:
            pay = 45.0
        else:
            pay = 30.0
    elif "swedish" in lower:
        if duration_min >= 105:
            pay = 60.0
        elif duration_min >= 75:
            pay = 45.0
        else:
            pay = 30.0
    elif "custom facial" in lower or "facial custom" in lower:
        pay = 40.0
    elif "basic facial" in lower or "facial basic" in lower:
        if "massage" in lower or "with massage" in lower:
            pay = 25.0
        else:
            pay = 30.0
    elif duration_min >= 105:
        pay = 60.0
    elif duration_min >= 75:
        pay = 45.0
    elif duration_min >= 25:
        pay = 30.0

    if "cupping" in lower:
        pay += 10.0
    if "scrub" in lower and ("socks" in lower or "gloves" in lower):
        pay += 5.0
    else:
        if "collagen socks" in lower or "socks" in lower:
            pay += 2.0
        if "collagen gloves" in lower or "gloves" in lower:
            pay += 2.0
    if "hydration" in lower:
        pay += 2.0
    if "heat" in lower:
        pay += 2.0
    # 3 senses package: add $2 to 60/90/120 min massage
    if "3 sense" in lower:
        pay += 2.0

    return round(pay, 2)


def _service_counts_for_day(
    events: List[Dict],
    overrides_by_booking: Dict[str, BookingOverride],
    therapists_list: Optional[List[str]] = None,
) -> Dict[str, int]:
    """Count billable services per therapist by displayed/locked name (not Square).
    Exclude add-ons, duration >= 30 min. Keys match calendar column names (therapists_list)."""
    counts = {}
    for ev in events:
        therapist = ev.get("therapist") or ""
        service = ev.get("service") or ""
        if _is_addon_for_count(service):
            continue
        dur = _duration_minutes(ev.get("start_at", ""), ev.get("end_at", ""))
        if dur < MIN_SERVICE_MINUTES_FOR_COUNT:
            continue
        # Use same name as calendar column (from therapists list / locked display name)
        if therapists_list:
            canonical = next(
                (t for t in therapists_list if normalize_therapist_name(t) == normalize_therapist_name(therapist)),
                therapist,
            )
        else:
            canonical = therapist
        counts[canonical] = counts.get(canonical, 0) + 1
    return counts


def _build_merged_room_busy(
    assigned_bookings: List[Dict],
    overrides_by_booking: Optional[Dict[str, BookingOverride]],
    room_list: tuple,
) -> Dict[str, List]:
    """Merged busy intervals per physical room (same rules as calendar occupancy)."""
    room_busy: Dict[str, List] = {}
    ov_map = overrides_by_booking or {}
    for b in assigned_bookings:
        room = b.get("room") or ""
        if room == "UNASSIGNED" or room == "ADDON":
            continue
        ov = ov_map.get(b.get("booking_id"))
        for phys_r, stf, etf in physical_busy_segments_ts(b, ov):
            room_busy.setdefault(phys_r, []).append((stf, etf))
    for r in room_list:
        room_busy.setdefault(r, [])
    if "02D" in room_list:
        room_busy.setdefault("0", [])
        room_busy.setdefault("2", [])
    for r in room_busy:
        room_busy[r].sort(key=lambda x: x[0])
        merged = []
        for s, e in room_busy[r]:
            if merged and s <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))
        room_busy[r] = merged
    return room_busy


def _first_room_fitting_interval(
    room_busy: Dict[str, List],
    room_list: tuple,
    t: int,
    slot_seconds: int,
) -> Optional[str]:
    """If [t, t+slot_seconds) fits in some room in room_list, return that room key; else None."""
    slot_end = t + slot_seconds
    for r in room_list:
        if r == "02D":
            ok0 = not any(
                lo <= t < hi or lo < slot_end <= hi or (t <= lo and slot_end >= hi)
                for lo, hi in room_busy.get("0", [])
            )
            ok2 = not any(
                lo <= t < hi or lo < slot_end <= hi or (t <= lo and slot_end >= hi)
                for lo, hi in room_busy.get("2", [])
            )
            if ok0 and ok2:
                return "02D"
            continue
        if r not in room_busy:
            continue
        if any(lo <= t < hi or lo < slot_end <= hi or (t <= lo and slot_end >= hi) for lo, hi in room_busy[r]):
            continue
        return r
    return None


def _next_available(
    assigned_bookings: List[Dict],
    date_str: str,
    room_list: tuple,
    duration_minutes: int,
    use_today_now: bool,
    overrides_by_booking: Optional[Dict[str, BookingOverride]] = None,
) -> Optional[Dict[str, Any]]:
    """Find next available slot: earliest time when any of the given rooms is free for the full duration. Returns {time: ISO, room: str} or None."""
    from dateutil import tz as dateutil_tz
    from datetime import timezone as dt_tz

    local_tz = dateutil_tz.tzlocal()
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        if use_today_now:
            now = datetime.now(local_tz)
            today = date_obj.replace(tzinfo=local_tz)
            if (date_obj.date() != now.date()):
                start_ts = today.replace(hour=9, minute=0, second=0, microsecond=0)
            else:
                start_ts = now
                # Align to next 15-min boundary (e.g. 3:00 PM not 2:47 PM)
                m = start_ts.minute + start_ts.second / 60.0
                next_q = (int(m // 15) + (1 if m % 15 > 0 else 0)) * 15
                if next_q >= 60:
                    start_ts = (start_ts + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
                else:
                    start_ts = start_ts.replace(minute=next_q, second=0, microsecond=0)
        else:
            start_ts = date_obj.replace(hour=9, minute=0, second=0, microsecond=0, tzinfo=local_tz)
        end_of_day = date_obj.replace(hour=23, minute=0, second=0, microsecond=0, tzinfo=local_tz)
    except Exception:
        return None
    room_busy = _build_merged_room_busy(assigned_bookings, overrides_by_booking, room_list)
    start_ts_float = start_ts.timestamp()
    end_ts_float = end_of_day.timestamp()
    slot_seconds = duration_minutes * 60
    t = int(start_ts_float)
    step = 15 * 60
    while t + slot_seconds <= end_ts_float:
        fit = _first_room_fitting_interval(room_busy, room_list, t, slot_seconds)
        if fit is not None:
            dt = datetime.fromtimestamp(t, tz=dt_tz.utc)
            return {"time": dt.isoformat(), "room": fit}
        t += step
    return None


def _is_appointment_past_checkout(booking_id: str, date_str: str) -> bool:
    """True if the appointment's end time (end_at) has passed. Uses Square/mock for that date."""
    try:
        current_service = get_square_service()
        bookings = (
            current_service.get_bookings_for_date(date_str)
            if current_service.client
            else mock_square.get_bookings_for_date(date_str)
        )
        booking = next((b for b in bookings if b.get("id") == booking_id), None)
        if not booking:
            appt_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            return appt_date < date_type.today()
        end_str = (booking.get("end_at") or "").strip()
        if not end_str:
            appt_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            return appt_date < date_type.today()
        end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
        local_tz = dateutil_tz.get_localzone()
        if end_dt.tzinfo:
            end_local = end_dt.astimezone(local_tz)
        else:
            end_local = end_dt.replace(tzinfo=local_tz)
        now = datetime.now(local_tz)
        return end_local < now
    except Exception:
        return False


def _check_past_locked(db: Session, booking_id: str, date_str: str) -> bool:
    """True if appointment is past checkout time and still locked (no manual override). Block room/therapist/tip changes unless unlocked."""
    if not _is_appointment_past_checkout(booking_id, date_str):
        return False
    override = db.query(BookingOverride).filter(
        BookingOverride.booking_id == booking_id,
        BookingOverride.date == date_str,
    ).first()
    return not (override and override.appointment_locked)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Spa Room Management Dashboard")


def _no_cache_headers() -> Dict[str, str]:
    """Stop browsers from serving stale HTML/JS/CSS (especially on localhost)."""
    return {
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }


@app.middleware("http")
async def disable_static_page_cache(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/":
        for k, v in _no_cache_headers().items():
            response.headers[k] = v
    elif path.startswith("/static/"):
        pl = path.lower()
        if pl.endswith((".html", ".htm", ".js", ".css", ".mjs")):
            for k, v in _no_cache_headers().items():
                response.headers[k] = v
    return response


# Initialize database
init_db()


def seed_default_pay_rates():
    """Apply masseuse pay rates from the official list. Overwrites any prior rates for these keys."""
    db = SessionLocal()
    try:
        defaults = [
            ("60 minute", 30),
            ("60 min", 30),
            ("90 min", 45),
            ("120 min", 60),
            ("60 minute couples", 30),
            ("90 minute couples", 45),
            ("120 minute couples", 60),
            ("scalp", 35),
            ("deep tissue", 30),
            ("swedish", 30),
            ("custom facial", 40),
            ("facial custom", 40),
            ("basic facial", 30),
            ("facial basic", 25),
            ("luxury package", 80),
            ("exclusive package", 80),
            ("trigger point 30", 30),
            ("trigger point 60", 50),
            ("trigger point 90", 70),
            ("cupping", 10),
            ("collagen socks", 2),
            ("collagen gloves", 2),
            ("hydration", 2),
            ("heat", 2),
        ]
        for service_key, pay_amount in defaults:
            r = db.query(ServicePayRate).filter(ServicePayRate.service_key == service_key).first()
            if r:
                r.pay_amount = pay_amount
            else:
                db.add(ServicePayRate(service_key=service_key, pay_amount=pay_amount))
        db.commit()
        logger.info("Applied masseuse pay rates (overrides prior rates for these keys)")
    except Exception as e:
        logger.warning("Could not apply pay rates: %s", e)
        db.rollback()
    finally:
        db.close()


# Apply pay rates on startup (overwrites prior rates for keys in the list)
try:
    seed_default_pay_rates()
except Exception as e:
    logger.warning("Apply pay rates at startup: %s", e)

# Initialize Square service (falls back to mock if not configured)
# Note: This is initialized at module load time
# If .env is updated, you need to restart the server
square_service = SquareService()
mock_square = MockSquareService()  # Keep as fallback

# Log initialization status
if square_service.client:
    logger.info("=" * 60)
    logger.info("Square API: CONNECTED (Using Real API)")
    logger.info("=" * 60)
else:
    logger.warning("=" * 60)
    logger.warning("Square API: NOT CONFIGURED (Using Mock Data)")
    logger.warning("Check your .env file and restart the server")
    logger.warning("=" * 60)


def get_square_service():
    """Get Square service, re-initializing if needed."""
    # Re-check configuration if client is None
    if not square_service.client:
        try:
            # Reload environment variables
            from dotenv import load_dotenv
            load_dotenv(override=True)
            
            # Re-import config to get updated values
            import importlib
            import config
            importlib.reload(config)
            from config import Config
            
            Config.validate()
            # Re-initialize the service
            logger.info("Re-initializing Square service...")
            new_service = SquareService()
            if new_service.client:
                # Update the global service
                square_service.client = new_service.client
                square_service._team_members_cache = new_service._team_members_cache
                logger.info("Square API: Successfully re-initialized!")
                logger.info("=" * 60)
                logger.info("Square API: CONNECTED (Using Real API)")
                logger.info("=" * 60)
            else:
                logger.warning("Square API: Still not configured after re-initialization")
        except Exception as e:
            logger.warning(f"Could not re-initialize Square service: {e}")
    
    return square_service


@app.get("/api/status")
async def get_status():
    """Get API status - whether using real Square API or mock data."""
    # Re-check configuration and re-initialize if needed
    current_service = get_square_service()
    is_configured = current_service.client is not None
    
    # Get environment info safely
    environment = None
    if is_configured:
        try:
            # Try to get environment from config
            from config import Config
            environment = Config.SQUARE_ENVIRONMENT
        except:
            environment = "production"  # Default
    
    return {
        "using_real_api": is_configured,
        "square_configured": is_configured,
        "message": "Using real Square API" if is_configured else "Using mock data (Square API not configured - check .env file and refresh page)",
        "environment": environment
    }


def _collect_lan_ipv4_addresses() -> List[str]:
    """Best-effort list of this machine's non-loopback IPv4 addresses (for same-Wi‑Fi phone/tablet links)."""
    ordered: List[str] = []
    seen: Set[str] = set()
    try:
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            udp.connect(("8.8.8.8", 80))
            ip = udp.getsockname()[0]
        finally:
            udp.close()
        if ip and not ip.startswith("127.") and ip not in seen:
            seen.add(ip)
            ordered.append(ip)
    except Exception:
        pass
    try:
        hn = socket.gethostname()
        for res in socket.getaddrinfo(hn, None, socket.AF_INET, socket.SOCK_STREAM):
            ip = res[4][0]
            if not ip or ip.startswith("127.") or ip in seen:
                continue
            seen.add(ip)
            ordered.append(ip)
    except Exception:
        pass
    return ordered


@app.get("/api/lan-share")
async def lan_share(request: Request):
    """URLs to open this dashboard from other devices on the same LAN (uses request port/scheme)."""
    ips = _collect_lan_ipv4_addresses()
    scheme = (request.url.scheme or "http").lower()
    port = request.url.port
    if port is None:
        port = 443 if scheme == "https" else 80
    omit_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)

    def url_for(ip: str) -> str:
        if omit_port:
            return f"{scheme}://{ip}/"
        return f"{scheme}://{ip}:{port}/"

    urls = [url_for(ip) for ip in ips]
    base = str(request.base_url)
    primary = urls[0] if urls else (base if base.endswith("/") else base + "/")
    return {
        "scheme": scheme,
        "port": port,
        "ips": ips,
        "urls": urls,
        "primary_url": primary,
        "browser_url": base if base.endswith("/") else base + "/",
    }


def _latest_desk_notes_by_customer_for_date(db: Session, date_str: str, customer_ids: set) -> dict:
    """Latest front-desk note body per customer per kind for date. {cid: {checkin, checkout}}."""
    if not customer_ids:
        return {}
    rows = (
        db.query(CustomerDeskNote)
        .filter(
            CustomerDeskNote.date == date_str,
            CustomerDeskNote.customer_id.in_(list(customer_ids)),
        )
        .order_by(CustomerDeskNote.id.desc())
        .all()
    )
    seen = set()
    out = {cid: {"checkin": None, "checkout": None} for cid in customer_ids}
    for r in rows:
        key = (r.customer_id, (r.note_kind or "").strip().lower())
        if key in seen:
            continue
        seen.add(key)
        cid = r.customer_id
        if cid not in out:
            continue
        nk = (r.note_kind or "").strip().lower()
        if nk == "checkin":
            out[cid]["checkin"] = (r.body or "").strip() or None
        elif nk == "checkout":
            out[cid]["checkout"] = (r.body or "").strip() or None
    return out


def _assigned_bookings_for_date(
    db: Session,
    date: str,
    current_service: Any,
    *,
    square_bookings_if_already_loaded: Optional[List[dict]] = None,
) -> Tuple[List[Dict], Dict[str, BookingOverride], List[str], List[str]]:
    """Fetch Square (or use preloaded), filter, assign rooms — same inputs as GET /api/day calendar.

    Returns (assigned_bookings, overrides_by_booking, therapists, detected_new_therapists).
    """
    if square_bookings_if_already_loaded is not None:
        bookings = list(square_bookings_if_already_loaded)
    else:
        if current_service.client:
            logger.info(f"[REAL API] Fetching Square bookings for {date}")
            bookings = current_service.get_bookings_for_date(date)
            logger.info(f"[REAL API] Found {len(bookings)} bookings from Square")
            if len(bookings) == 0:
                logger.info(f"[REAL API] No bookings found for {date} - this is normal if there are no appointments")
        else:
            logger.warning(f"[MOCK DATA] Square API not configured, using mock data for {date}")
            bookings = mock_square.get_bookings_for_date(date)
            logger.info(f"[MOCK DATA] Generated {len(bookings)} mock bookings")

        bookings = _without_square_test_profile_bookings(bookings)

    therapists_from_bookings = set(b.get('therapist') or '' for b in bookings)
    for b in bookings:
        t2 = (b.get('therapist_2') or '').strip() if isinstance(b.get('therapist_2'), str) else ''
        if t2:
            therapists_from_bookings.add(t2)
    therapists_from_bookings.discard('')
    if any(
        looks_like_unresolved_team_id(b.get('therapist') or '') or not (b.get('therapist') or '').strip()
        for b in bookings
    ):
        therapists_from_bookings.add("Staff")
    all_therapists = set(therapists_from_bookings)
    if current_service.client:
        try:
            team_members = current_service.client.get_team_members()
            for member in team_members:
                if isinstance(member, dict):
                    member_id = member.get('id', '')
                    given = member.get('given_name', '')
                    family = member.get('family_name', '')
                    display = member.get('display_name', '')
                else:
                    member_id = getattr(member, 'id', '') or ''
                    given = getattr(member, 'given_name', '') or ''
                    family = getattr(member, 'family_name', '') or ''
                    display = getattr(member, 'display_name', '') or ''

                name = f"{given} {family}".strip() or display or member_id
                if name:
                    all_therapists.add(name)
        except Exception as e:
            logger.warning(f"Could not fetch all team members: {e}")

    therapists = filter_allowed_therapists(list(all_therapists))
    detected_new_therapists = detect_unknown_therapist_names(therapists_from_bookings)

    def booking_should_show(b):
        t = b.get('therapist')
        if t is None or (isinstance(t, str) and not t.strip()):
            return True
        t = t if isinstance(t, str) else str(t)
        if normalize_therapist_name(t) == "amy r":
            return False
        return True

    bookings = [b for b in bookings if booking_should_show(b)]

    override_rows = db.query(BookingOverride).filter(BookingOverride.date == date).all()
    overrides_by_booking = {o.booking_id: o for o in override_rows}
    bookings = [b for b in bookings if not (overrides_by_booking.get(b["id"]) and getattr(overrides_by_booking[b["id"]], "cancelled_or_noshow", False))]
    bookings = [b for b in bookings if str(b.get("status") or "").strip().upper() != "NO_SHOW"]

    bookings_for_assignment = []
    for booking in bookings:
        row = _booking_dict_for_assignment(booking, overrides_by_booking)
        sq_end_pkg = booking.get("square_end_at") or booking.get("end_at") or row.get("end_at") or ""
        pkg_row, disp_row = _package_type_and_display(
            booking.get("service"), booking.get("type", ""), row.get("start_at", ""), sq_end_pkg
        )
        row.update({
            'customer_phone': booking.get('customer_phone', ''),
            'any_available': booking.get('any_available', False),
            'prepayment_amount': booking.get('prepayment_amount'),
            'created_at': booking.get('created_at'),
            'customer_visits': booking.get('customer_visits'),
            'customer_massage_together_with': booking.get('customer_massage_together_with'),
            'booked_by': booking.get('booked_by'),
            'package_type': pkg_row,
            'display_service': disp_row,
            'service_segments': booking.get('service_segments'),
        })
        bookings_for_assignment.append(row)

    protected_booking_ids = _protected_booking_ids_for_date(db, bookings_for_assignment, date)
    freeze_room_booking_ids = _freeze_room_booking_ids_for_date(bookings_for_assignment, date)
    assigner = RoomAssigner(db)
    assigned_bookings = assigner.assign_rooms(
        bookings_for_assignment,
        date,
        protected_booking_ids=protected_booking_ids,
        freeze_room_booking_ids=freeze_room_booking_ids,
        overrides_by_booking=overrides_by_booking,
    )
    return assigned_bookings, overrides_by_booking, therapists, detected_new_therapists


def build_day_response_for_date(
    db: Session,
    date: str,
    *,
    square_bookings_if_already_loaded: Optional[List[dict]] = None,
) -> DayResponse:
    """Build full day payload: Square bookings, room assignment, events, summaries (same as GET /api/day).

    If square_bookings_if_already_loaded is set (e.g. after PUT /api/room already fetched Square),
    skip the duplicate Square list fetch and _without_square_test_profile (caller must have applied both).
    """
    current_service = get_square_service()
    assigned_bookings, overrides_by_booking, therapists, detected_new_therapists = _assigned_bookings_for_date(
        db,
        date,
        current_service,
        square_bookings_if_already_loaded=square_bookings_if_already_loaded,
    )
    
    # Pull suggested tips and prepayments from Square for this date (match payments to bookings by customer_id or note)
    suggested_tips = {}
    suggested_prepayments = {}
    if current_service and getattr(current_service, 'get_suggested_tips_for_bookings', None):
        try:
            result = current_service.get_suggested_tips_for_bookings(date, assigned_bookings)
            if isinstance(result, tuple) and len(result) == 2:
                suggested_tips, suggested_prepayments = result
            else:
                suggested_tips = result or {}
        except Exception:
            suggested_tips = {}
            suggested_prepayments = {}
    
    # Overrides already loaded above for cancelled/no-show filter; load room assignments for this date
    room_assignments = {r.booking_id: r for r in db.query(RoomAssignment).filter(RoomAssignment.date == date).all()}
    
    today_str = date_type.today().isoformat()
    is_today = date == today_str
    
    events = []
    for booking in assigned_bookings:
        bid = booking["booking_id"]
        ov = overrides_by_booking.get(bid)
        ra = room_assignments.get(bid)
        therapist = (ov.therapist_override if (ov and ov.therapist_locked and getattr(ov, "therapist_override", None)) else booking["therapist"]) or booking["therapist"]
        if therapist is None or (isinstance(therapist, str) and not therapist.strip()):
            therapist = "Staff"
        elif looks_like_unresolved_team_id(therapist):
            therapist = "Staff"  # Square ID couldn't be resolved to a name (e.g. staff at different location)
        if ov and getattr(ov, "therapist_locked_2", False):
            therapist_2 = (getattr(ov, "therapist_override_2", None) or "").strip() or None
        else:
            t2raw = (booking.get("therapist_2") or "").strip() if booking.get("therapist_2") else ""
            therapist_2 = None
            if t2raw:
                therapist_2 = "Staff" if looks_like_unresolved_team_id(t2raw) else t2raw
        tip_amount = float(ov.tip_amount) if (ov and ov.tip_amount is not None) else None
        if tip_amount is None and bid in suggested_tips:
            tip_amount = suggested_tips[bid]
        tip_amount_2 = float(ov.tip_amount_2) if (ov and getattr(ov, "tip_amount_2", None) is not None) else None
        tip_split_evenly = bool(ov and getattr(ov, "tip_split_evenly", False))
        room_locked = (ra.assigned_by == "manager") if ra else False
        therapist_locked = bool(ov and ov.therapist_locked)
        therapist_locked_2 = bool(ov and getattr(ov, "therapist_locked_2", False))
        appointment_locked = bool(ov and ov.appointment_locked)
        is_past = date < today_str
        arrived_at_1 = ov.arrived_at_1.isoformat() if (ov and getattr(ov, "arrived_at_1", None)) else None
        arrived_at_2 = ov.arrived_at_2.isoformat() if (ov and getattr(ov, "arrived_at_2", None)) else None
        luxury_mini_facial_done = getattr(ov, "luxury_mini_facial_done", None) if ov else None
        luxury_separate_mini_facial = getattr(ov, "luxury_separate_mini_facial", None) if ov else None
        luxury_mini_facial_therapist = getattr(ov, "luxury_mini_facial_therapist", None) if ov else None
        luxury_mini_facial_therapist_2 = getattr(ov, "luxury_mini_facial_therapist_2", None) if ov else None
        facial_specialist = getattr(ov, "facial_specialist", None) if ov else None
        square_end_for_pkg = booking.get("square_end_at") or booking["end_at"]
        is_facial_with_massage = _is_facial_with_massage(
            booking.get("service"), booking.get("type", ""), booking.get("start_at", ""), square_end_for_pkg
        )
        icfm = is_couple_facial_with_massage(
            booking.get("service"), booking.get("type") or "", booking["start_at"], booking["end_at"]
        )
        fs_seg_at = facial_segment_start_iso(booking, ov) if icfm else None
        couple_sf = getattr(ov, "couple_02d_single_facial_only", None) if ov else None
        facial_portion_room_val = None
        if ov and getattr(ov, "facial_portion_room", None):
            facial_portion_room_val = (ov.facial_portion_room or "").strip() or None
        addon_note_val = getattr(ov, "addon_note", None) if ov else None
        note_blob = " ".join(
            str(x or "").strip()
            for x in (
                addon_note_val,
                booking.get("addon_note"),
                booking.get("seller_note"),
                booking.get("customer_note"),
            )
            if x
        )
        square_end_for_neutral = booking.get("square_end_at") or booking.get("end_at", "") or ""
        block_duration_min = _duration_minutes(
            booking.get("start_at", "") or "", square_end_for_neutral
        )
        addon_neutral_min = _addon_time_neutral_minutes(
            booking.get("service"), note_blob or None, block_duration_min
        )
        original_tip_paid = suggested_tips.get(bid)
        pkg_type, display_svc = _package_type_and_display(
            booking.get("service"), booking.get("type"), booking.get("start_at", ""), square_end_for_pkg
        )
        if display_svc and pkg_type in ("luxury", "exclusive"):
            display_svc = _display_service_with_package_addons(
                booking.get("service"), pkg_type, display_svc
            )
        tip_cash = bool(ov and getattr(ov, "tip_cash", False))
        dm_saved = int(getattr(ov, "duration_adjust_minutes", None) or 0) if ov else 0
        checkin_partner_val = (
            (getattr(ov, "checkin_partner_name", None) or "").strip() or None if ov else None
        )
        suggested_partner_val = None
        if (booking.get("type") or "").lower() == "couple":
            suggested_partner_val = _suggest_partner_from_booking_notes(
                booking.get("customer_note"), booking.get("seller_note")
            )
            if suggested_partner_val:
                suggested_partner_val = suggested_partner_val.strip() or None
        massage_profile = (booking.get("customer_massage_together_with") or "").strip() or None
        couples_slot_note_val = _couples_slot_note_from_texts(
            addon_note_val,
            booking.get("addon_note"),
            booking.get("seller_note"),
            booking.get("customer_note"),
        )
        events.append(Event(
            booking_id=bid,
            therapist=therapist,
            start_at=booking["start_at"],
            end_at=booking["end_at"],
            square_end_at=booking.get("square_end_at") or booking["end_at"],
            duration_adjust_minutes=(dm_saved if dm_saved else None),
            customer=booking["customer"],
            service=booking["service"],
            package_type=pkg_type,
            display_service=display_svc,
            service_segments=booking.get("service_segments") or None,
            type=booking["type"],
            room=booking["room"],
            reason=booking.get("reason"),
            room_locked=room_locked,
            therapist_locked=therapist_locked,
            tip_amount=tip_amount,
            tip_cash=tip_cash,
            appointment_locked=appointment_locked,
            is_past=is_past,
            therapist_2=therapist_2,
            therapist_locked_2=therapist_locked_2,
            tip_amount_2=tip_amount_2,
            tip_split_evenly=tip_split_evenly,
            arrived_at_1=arrived_at_1,
            arrived_at_2=arrived_at_2,
            luxury_mini_facial_done=luxury_mini_facial_done,
            luxury_separate_mini_facial=luxury_separate_mini_facial,
            luxury_mini_facial_therapist=luxury_mini_facial_therapist,
            luxury_mini_facial_therapist_2=luxury_mini_facial_therapist_2,
            facial_specialist=facial_specialist,
            is_facial_with_massage=is_facial_with_massage,
            couple_02d_single_facial_only=couple_sf,
            is_couple_facial_with_massage=(
                icfm if (booking.get("type") or "").lower() == "couple" else None
            ),
            facial_segment_start_at=fs_seg_at,
            facial_portion_room=facial_portion_room_val,
            room_placement_override=(
                True
                if (ov and getattr(ov, "room_placement_override", False))
                else None
            ),
            addon_note=addon_note_val,
            addon_time_neutral_minutes=(addon_neutral_min if addon_neutral_min > 0 else None),
            customer_id=booking.get("customer_id") or None,
            pressure=getattr(ov, "pressure", None) or None,
            focus_area=getattr(ov, "focus_area", None) or None,
            pressure_2=getattr(ov, "pressure_2", None) or None,
            focus_area_2=getattr(ov, "focus_area_2", None) or None,
            split_minutes_first=getattr(ov, "split_minutes_first", None),
            original_therapist=booking["therapist"],
            original_room=None,
            customer_phone=booking.get("customer_phone") or None,
            original_tip_paid=float(original_tip_paid) if original_tip_paid is not None else None,
            original_any_available=booking.get("any_available", False),
            prepayment_amount=(
                float(ov.prepayment_override)
                if (ov and getattr(ov, "prepayment_override", None) is not None)
                else (
                    float(booking["prepayment_amount"])
                    if booking.get("prepayment_amount") is not None
                    else (
                        float(suggested_prepayments[bid])
                        if bid in suggested_prepayments and suggested_prepayments[bid]
                        else None
                    )
                )
            ),
            created_at=booking.get("created_at"),
            customer_visits=booking.get("customer_visits"),
            customer_massage_together_with=massage_profile,
            checkin_partner_name=checkin_partner_val,
            suggested_partner_name=suggested_partner_val,
            couples_slot_note=couples_slot_note_val,
            customer_note=booking.get("customer_note"),
            seller_note=booking.get("seller_note"),
            booked_by=booking.get("booked_by"),
            back_walking_room_alert=_back_walking_room_alert_for_event(booking),
        ))
    
    # Service counts per therapist (for couple and single time-split, both therapists get credit)
    events_for_count = []
    for e in events:
        if e.room == "ADDON":
            continue
        events_for_count.append({"therapist": e.therapist, "service": e.service, "start_at": e.start_at, "end_at": e.end_at})
        if getattr(e, "therapist_2", None):
            events_for_count.append({"therapist": e.therapist_2, "service": e.service, "start_at": e.start_at, "end_at": e.end_at})
    therapist_service_counts = _service_counts_for_day(events_for_count, overrides_by_booking, therapists_list=therapists)
    
    # Next available couple (rooms 5, 6, 02D) and single
    next_couple_available = _next_available(
        assigned_bookings, date, COUPLE_ROOMS, 60, is_today, overrides_by_booking=overrides_by_booking
    )
    next_single_available = _next_available(
        assigned_bookings, date, SINGLE_ROOMS, 60, is_today, overrides_by_booking=overrides_by_booking
    )
    
    # Therapist order for the day
    order_rows = db.query(TherapistDayOrder).filter(TherapistDayOrder.date == date).order_by(TherapistDayOrder.order_number).all()
    therapist_order = [{"therapist": r.therapist_name, "order": r.order_number} for r in order_rows]
    if not therapist_order and therapists:
        therapist_order = [{"therapist": t, "order": i + 1} for i, t in enumerate(therapists)]

    # Facial summary: time frames for facials + luxury package mini facial (last 30 min of 2hr appointment)
    facial_time_frames = []
    for e in events:
        svc = (e.service or "").lower().strip()
        if not svc:
            continue
        start_dt, end_dt = None, None
        try:
            start_dt = dateutil_parser.parse(e.start_at)
            end_dt = dateutil_parser.parse(e.end_at)
        except Exception:
            pass
        if "facial" in svc:
            facial_time_frames.append({
                "start_at": e.start_at,
                "end_at": e.end_at,
                "label": e.service or "Facial",
                "customer": e.customer or "",
            })
        if "luxury" in svc and end_dt is not None:
            # Luxury package includes 30-min mini facial in the last 30 minutes of the appointment
            mini_end = end_dt
            mini_start = end_dt - timedelta(minutes=30)
            facial_time_frames.append({
                "start_at": mini_start.isoformat(),
                "end_at": mini_end.isoformat(),
                "label": "Luxury mini (last 30 min)",
                "customer": e.customer or "",
            })
    facial_summary = {"count": len(facial_time_frames), "time_frames": facial_time_frames} if facial_time_frames else None

    # Customer requested a specific masseuse (not "any available") — summary bar above calendar
    customer_requests_items = []
    for e in events:
        if e.room == "ADDON":
            continue
        if (e.booked_by or "").lower() != "customer":
            continue
        if e.original_any_available:
            continue
        # Assigned masseuse is Staff (dropdown): treat like any available for this summary
        if (e.therapist or "").strip().lower() == "staff":
            continue
        req = (e.original_therapist or "").strip()
        if not req:
            continue
        try:
            end_dt = dateutil_parser.parse(e.end_at)
            dateutil_parser.parse(e.start_at)
        except Exception:
            continue
        neutral = int(e.addon_time_neutral_minutes or 0)
        display_end_dt = end_dt - timedelta(minutes=neutral) if neutral else end_dt
        svc = (e.display_service or e.service or "").strip()
        customer_requests_items.append({
            "booking_id": e.booking_id or "",
            "requested_masseuse": req,
            "customer": e.customer or "",
            "service": svc,
            "start_at": e.start_at,
            "end_at": e.end_at,
            "display_end_at": display_end_dt.isoformat(),
        })
    customer_requests_items.sort(key=lambda x: x["start_at"])
    customer_requests_summary = {"items": customer_requests_items} if customer_requests_items else None

    # No-room alert: if any appointment (any service) has no room, notify immediately; cooldown per date to avoid spam
    unassigned_events = [e for e in events if e.room == "UNASSIGNED"]
    no_room_alert = len(unassigned_events) > 0
    if no_room_alert:
        cooldown_minutes = getattr(__import__("config").Config, "NO_ROOM_ALERT_COOLDOWN_MINUTES", 10)
        last_sent = db.query(NoRoomNotificationSent).filter(NoRoomNotificationSent.date == date).first()
        now_utc = datetime.now(timezone.utc)
        should_send = True
        if last_sent and last_sent.sent_at:
            sent_at = last_sent.sent_at
            if sent_at.tzinfo is None:
                sent_at = sent_at.replace(tzinfo=timezone.utc)
            if (now_utc - sent_at).total_seconds() < cooldown_minutes * 60:
                should_send = False
        if should_send:
            unassigned_appointments = [
                {
                    "customer": e.customer,
                    "service": e.service,
                    "start_at": e.start_at,
                    "therapist": e.therapist,
                }
                for e in unassigned_events
            ]
            try:
                notifications_module.send_no_room_notifications(date, unassigned_appointments)
                if last_sent:
                    last_sent.sent_at = now_utc
                else:
                    db.add(NoRoomNotificationSent(date=date, sent_at=now_utc))
                db.commit()
            except Exception as e:
                logger.exception("No-room notification failed: %s", e)
                db.rollback()

    customer_ids = {b.get("customer_id") for b in assigned_bookings if b.get("customer_id")}
    customer_last_pressure = {}
    if customer_ids:
        rows = db.query(CustomerLastPressure).filter(CustomerLastPressure.customer_id.in_(customer_ids)).all()
        customer_last_pressure = {r.customer_id: (r.pressure or "") for r in rows if r.pressure}
    customer_last_partner = {}
    if customer_ids:
        prow = db.query(CustomerLastPartner).filter(CustomerLastPartner.customer_id.in_(customer_ids)).all()
        customer_last_partner = {
            r.customer_id: (r.partner_name or "").strip()
            for r in prow
            if (r.partner_name or "").strip()
        }

    desk_customer_ids = {e.customer_id for e in events if getattr(e, "customer_id", None)}
    customer_desk_notes_today = _latest_desk_notes_by_customer_for_date(db, date, desk_customer_ids)

    unassigned_fix_suggestions = (
        compute_unassigned_fix_suggestions(events, date) if no_room_alert else None
    )

    return DayResponse(
        date=date,
        therapists=therapists,
        events=events,
        therapist_order=therapist_order,
        therapist_service_counts=therapist_service_counts,
        next_couple_available=next_couple_available,
        next_single_available=next_single_available,
        no_room_alert=no_room_alert,
        facial_summary=facial_summary,
        customer_requests_summary=customer_requests_summary,
        customer_last_pressure=customer_last_pressure,
        customer_last_partner=customer_last_partner or None,
        customer_desk_notes_today=customer_desk_notes_today or None,
        room_day_layout_frozen=_room_day_layout_has_pins(db, date),
        room_day_layout_locked_at=_get_room_day_layout_locked_at_iso(db, date),
        unassigned_fix_suggestions=unassigned_fix_suggestions,
        detected_new_therapists=detected_new_therapists or None,
    )


@app.get("/api/day")
async def get_day(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    db: Session = Depends(get_db)
) -> DayResponse:
    """Get all bookings for a specific day with room assignments."""
    try:
        datetime.strptime(date, '%Y-%m-%d')
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    return build_day_response_for_date(db, date)


@app.get("/api/roster")
async def get_roster():
    """Current roster overrides: hardcoded allowlist plus runtime add/ignore choices."""
    return {
        "allowed": effective_allowed_therapists(),
        "added": roster_store.get_added(),
        "ignored": roster_store.get_ignored(),
    }


@app.post("/api/roster/add")
async def add_roster_therapist(req: RosterActionRequest):
    """Approve a detected name → it becomes an active roster member (shows as a column, matches bookings)."""
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    roster_store.add_therapist(name)
    return {"ok": True, "added": roster_store.get_added()}


@app.post("/api/roster/ignore")
async def ignore_roster_therapist(req: RosterActionRequest):
    """Dismiss a detected name so the app stops suggesting it."""
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    roster_store.ignore_therapist(name)
    return {"ok": True, "ignored": roster_store.get_ignored()}


def _parse_square_availability_start(start_at: Optional[str]) -> Optional[datetime]:
    if not start_at or not isinstance(start_at, str):
        return None
    try:
        return datetime.fromisoformat(start_at.replace("Z", "+00:00"))
    except Exception:
        return None


def _availability_slot_start_at(av: Any) -> Optional[str]:
    if isinstance(av, dict):
        return av.get("start_at") or av.get("startAt")
    return getattr(av, "start_at", None) or getattr(av, "startAt", None)


def _compute_availability_audit_block(
    *,
    kind: str,
    variation_id: Optional[str],
    variation_ver: int,
    resolution: str,
    catalog_label: Optional[str],
    square_client: Any,
    date_str: str,
    duration_minutes: int,
    room_busy: Dict[str, List],
    room_list: tuple,
    assigned_bookings: List[Dict],
    overrides_by_booking: Dict[str, BookingOverride],
    is_today: bool,
) -> AvailabilityAuditServiceBlock:
    """Square SearchAvailability vs MoM room fit for one service variation."""
    next_room = _next_available(
        assigned_bookings, date_str, room_list, duration_minutes, is_today, overrides_by_booking=overrides_by_booking
    )
    if not variation_id:
        return AvailabilityAuditServiceBlock(
            kind=kind,
            service_variation_id=None,
            service_variation_version=variation_ver,
            resolution=resolution or "missing",
            catalog_label=catalog_label,
            square_slot_count=0,
            square_slot_starts=[],
            next_room_available=next_room,
            square_open_no_room=[],
            square_fetch_error="No service_variation_id — set SQUARE_AUDIT_SINGLE_VARIATION_ID / SQUARE_AUDIT_COUPLE_VARIATION_ID or fix catalog name resolution.",
        )

    if not square_client or not getattr(square_client, "search_availability", None):
        return AvailabilityAuditServiceBlock(
            kind=kind,
            service_variation_id=variation_id,
            service_variation_version=variation_ver,
            resolution=resolution,
            catalog_label=catalog_label,
            square_slot_count=0,
            square_slot_starts=[],
            next_room_available=next_room,
            square_open_no_room=[],
            square_fetch_error="Square client not configured (no token / no search_availability).",
        )

    local_tz = dateutil_tz.tzlocal()
    try:
        day0 = datetime.strptime(date_str, "%Y-%m-%d").replace(
            hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz
        )
        day1 = day0 + timedelta(days=1)
        start_at_begin = day0.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        start_at_end = day1.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception as e:
        return AvailabilityAuditServiceBlock(
            kind=kind,
            service_variation_id=variation_id,
            service_variation_version=variation_ver,
            resolution=resolution,
            catalog_label=catalog_label,
            square_slot_count=0,
            square_slot_starts=[],
            next_room_available=next_room,
            square_open_no_room=[],
            square_fetch_error=f"Bad date for audit range: {e}",
        )

    try:
        availabilities = square_client.search_availability(
            start_at_begin=start_at_begin,
            start_at_end=start_at_end,
            service_variation_id=variation_id,
        ) or []
    except Exception as e:
        logger.warning("availability audit search_availability: %s", e)
        return AvailabilityAuditServiceBlock(
            kind=kind,
            service_variation_id=variation_id,
            service_variation_version=variation_ver,
            resolution=resolution,
            catalog_label=catalog_label,
            square_slot_count=0,
            square_slot_starts=[],
            next_room_available=next_room,
            square_open_no_room=[],
            square_fetch_error=str(e),
        )

    slot_seconds = duration_minutes * 60
    date_local = datetime.strptime(date_str, "%Y-%m-%d").date()
    starts_out: List[str] = []
    issues: List[AvailabilityAuditSlotIssue] = []
    max_preview = 80
    max_issues = 120
    on_day_count = 0

    for av in availabilities:
        raw = _availability_slot_start_at(av)
        if not raw:
            continue
        dt_utc = _parse_square_availability_start(raw)
        if not dt_utc:
            continue
        dt_local = dt_utc.astimezone(local_tz)
        if dt_local.date() != date_local:
            continue
        on_day_count += 1
        t = int(dt_utc.timestamp())
        fit = _first_room_fitting_interval(room_busy, room_list, t, slot_seconds)
        if len(starts_out) < max_preview:
            starts_out.append(raw)
        if fit is None and len(issues) < max_issues:
            issues.append(
                AvailabilityAuditSlotIssue(
                    start_at=raw,
                    start_at_local=dt_local.isoformat(),
                    detail="Square lists this start time but no room in MoM rules fits the full duration.",
                )
            )

    return AvailabilityAuditServiceBlock(
        kind=kind,
        service_variation_id=variation_id,
        service_variation_version=variation_ver,
        resolution=resolution,
        catalog_label=catalog_label,
        square_slot_count=on_day_count,
        square_slot_starts=starts_out,
        next_room_available=next_room,
        square_open_no_room=issues,
        square_fetch_error=None,
    )


@app.get("/api/availability-audit", response_model=AvailabilityAuditResponse)
async def availability_audit(
    date: str = Query(..., description="Local calendar date YYYY-MM-DD"),
    duration_minutes: int = Query(
        60,
        ge=15,
        le=300,
        description="Duration to check against rooms (should match the Square variation length you compare online).",
    ),
    single_variation_id: Optional[str] = Query(None, description="Override Square catalog variation id for singles"),
    couple_variation_id: Optional[str] = Query(None, description="Override Square catalog variation id for couples"),
    db: Session = Depends(get_db),
) -> AvailabilityAuditResponse:
    """
    Compare Square Bookings SearchAvailability to MoM physical-room rules for the same day.

    Use `square_open_no_room` to find times Square would sell but you have no room — block those in Square
    (blocked time or appointment settings), or adjust staffing so Square stops offering them.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    current_service = get_square_service()
    assigned_bookings, overrides_by_booking, _therapists, _detected = _assigned_bookings_for_date(
        db, date, current_service, square_bookings_if_already_loaded=None
    )
    room_busy = _build_merged_room_busy(assigned_bookings, overrides_by_booking, _AUDIT_ROOM_UNION_FOR_BUSY)
    is_today = date == date_type.today().isoformat()

    sq = current_service.client
    single_vid = (single_variation_id or "").strip() or (Config.SQUARE_AUDIT_SINGLE_VARIATION_ID or "").strip()
    couple_vid = (couple_variation_id or "").strip() or (Config.SQUARE_AUDIT_COUPLE_VARIATION_ID or "").strip()
    single_ver, couple_ver = 1, 1
    single_res, couple_res = "", ""
    single_label = (Config.SQUARE_AUDIT_SINGLE_SERVICE_NAME or "Swedish Massage").strip()
    couple_label = (Config.SQUARE_AUDIT_COUPLE_SERVICE_NAME or "Couples Massage").strip()

    if sq and getattr(current_service, "resolve_voice_service", None):
        if not single_vid:
            single_vid, single_ver = current_service.resolve_voice_service(single_label, duration_minutes)
            single_res = "resolve_voice_service"
        else:
            single_res = "query_or_config_variation_id"
        if not couple_vid:
            couple_vid, couple_ver = current_service.resolve_voice_service(couple_label, duration_minutes)
            couple_res = "resolve_voice_service"
        else:
            couple_res = "query_or_config_variation_id"
    else:
        if single_vid:
            single_res = "query_or_config_variation_id"
        if couple_vid:
            couple_res = "query_or_config_variation_id"

    eff_dur = duration_minutes if duration_minutes else Config.SQUARE_AUDIT_DURATION_MINUTES

    single_block = _compute_availability_audit_block(
        kind="single",
        variation_id=single_vid or None,
        variation_ver=int(single_ver) if single_ver else 1,
        resolution=single_res or ("missing" if not single_vid else "config"),
        catalog_label=single_label,
        square_client=sq,
        date_str=date,
        duration_minutes=eff_dur,
        room_busy=room_busy,
        room_list=SINGLE_ROOMS,
        assigned_bookings=assigned_bookings,
        overrides_by_booking=overrides_by_booking,
        is_today=is_today,
    )
    couple_block = _compute_availability_audit_block(
        kind="couple",
        variation_id=couple_vid or None,
        variation_ver=int(couple_ver) if couple_ver else 1,
        resolution=couple_res or ("missing" if not couple_vid else "config"),
        catalog_label=couple_label,
        square_client=sq,
        date_str=date,
        duration_minutes=eff_dur,
        room_busy=room_busy,
        room_list=COUPLE_ROOMS,
        assigned_bookings=assigned_bookings,
        overrides_by_booking=overrides_by_booking,
        is_today=is_today,
    )

    n_single = len(single_block.square_open_no_room)
    n_couple = len(couple_block.square_open_no_room)
    summary = (
        f"Single: {n_single} Square slot(s) with no room; Couple: {n_couple}. "
        "Block or adjust Square for those starts, or align duration/service IDs if counts look wrong."
    )
    return AvailabilityAuditResponse(
        date=date,
        duration_minutes=eff_dur,
        single=single_block,
        couple=couple_block,
        summary=summary,
    )


def _past_booking_ids_for_date(bookings: List[Dict], date: str) -> set:
    """Return set of booking_id for appointments that have already ended (end_at < now). Only for today."""
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    if date != today_str:
        return set()
    past = set()
    for b in bookings:
        try:
            end_str = (b.get("end_at") or "").strip()
            if not end_str:
                continue
            end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            if end_dt.tzinfo:
                end_local = end_dt.astimezone().replace(tzinfo=None)
            else:
                end_local = end_dt
            if end_local < now:
                past.add(b["booking_id"])
        except Exception:
            pass
    return past


def _started_booking_ids_for_date(bookings: List[Dict], date: str) -> set:
    """Return booking_ids where the session has started (start_at <= now). Only for today.
    Covers in-progress and completed sessions so auto-assign does not reshuffle rooms after start."""
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    if date != today_str:
        return set()
    started = set()
    for b in bookings:
        try:
            bid = b.get("booking_id")
            start_str = (b.get("start_at") or "").strip()
            if not bid or not start_str:
                continue
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            if start_dt.tzinfo:
                start_local = start_dt.astimezone().replace(tzinfo=None)
            else:
                start_local = start_dt
            if now >= start_local:
                started.add(bid)
        except Exception:
            pass
    return started


# RoomAssignment.reason sentinel: auto placements promoted so assign_rooms will not reshuffle them.
DAY_LAYOUT_FREEZE_REASON = "__DAY_LAYOUT_FREEZE__"


def _room_day_layout_has_pins(db: Session, date: str) -> bool:
    return (
        db.query(RoomAssignment)
        .filter(RoomAssignment.date == date, RoomAssignment.reason == DAY_LAYOUT_FREEZE_REASON)
        .first()
        is not None
    )


def _upsert_room_day_layout_freeze_meta(db: Session, date: str, locked_at_iso: str) -> None:
    try:
        db.execute(
            text(
                "INSERT INTO room_day_layout_freeze_meta (date, locked_at) VALUES (:d, :t) "
                "ON CONFLICT(date) DO UPDATE SET locked_at = excluded.locked_at"
            ),
            {"d": date, "t": locked_at_iso},
        )
    except Exception:
        logger.exception("room_day_layout_freeze_meta upsert failed for %s", date)


def _delete_room_day_layout_freeze_meta(db: Session, date: str) -> None:
    try:
        db.execute(text("DELETE FROM room_day_layout_freeze_meta WHERE date = :d"), {"d": date})
    except Exception:
        logger.exception("room_day_layout_freeze_meta delete failed for %s", date)


def _get_room_day_layout_locked_at_iso(db: Session, date: str) -> Optional[str]:
    """ISO timestamp shown in UI when day layout pins are active (last time Lock was turned on)."""
    if not _room_day_layout_has_pins(db, date):
        return None
    try:
        row = db.execute(
            text("SELECT locked_at FROM room_day_layout_freeze_meta WHERE date = :d"),
            {"d": date},
        ).fetchone()
        if row and row[0]:
            return str(row[0]).strip() or None
    except Exception:
        pass
    m = (
        db.query(func.max(RoomAssignment.updated_at))
        .filter(
            RoomAssignment.date == date,
            RoomAssignment.reason == DAY_LAYOUT_FREEZE_REASON,
        )
        .scalar()
    )
    if m is None:
        return None
    try:
        if hasattr(m, "isoformat"):
            return m.isoformat()
    except Exception:
        pass
    return str(m)


def _sync_freeze_meta_after_pin_change(db: Session, date: str) -> None:
    """After partial or full pin delete: drop meta if no pins left; else set locked_at to earliest surviving pin wave."""
    if not _room_day_layout_has_pins(db, date):
        _delete_room_day_layout_freeze_meta(db, date)
        return
    m = (
        db.query(func.min(RoomAssignment.updated_at))
        .filter(
            RoomAssignment.date == date,
            RoomAssignment.reason == DAY_LAYOUT_FREEZE_REASON,
        )
        .scalar()
    )
    if m is None:
        _delete_room_day_layout_freeze_meta(db, date)
        return
    try:
        locked_at_iso = m.isoformat() if hasattr(m, "isoformat") else str(m)
    except Exception:
        locked_at_iso = str(m)
    _upsert_room_day_layout_freeze_meta(db, date, locked_at_iso)


def _append_freeze_event(db: Session, date: str, action: str, at_iso: Optional[str] = None) -> None:
    """Append lock/unlock to history (best-effort)."""
    t = at_iso or datetime.now(timezone.utc).isoformat()
    try:
        db.execute(
            text(
                "INSERT INTO room_day_layout_freeze_events (date, at_utc, action) VALUES (:d, :t, :a)"
            ),
            {"d": date, "t": t, "a": action},
        )
    except Exception:
        logger.exception("room_day_layout_freeze_events insert failed for %s", date)


def _list_day_layout_freeze_waves(db: Session, date: str) -> List[Dict[str, Any]]:
    """Distinct promotion times for layout pins (each lock click uses one shared updated_at)."""
    rows = (
        db.query(RoomAssignment.updated_at, func.count(RoomAssignment.booking_id))
        .filter(RoomAssignment.date == date, RoomAssignment.reason == DAY_LAYOUT_FREEZE_REASON)
        .group_by(RoomAssignment.updated_at)
        .order_by(RoomAssignment.updated_at)
        .all()
    )
    out: List[Dict[str, Any]] = []
    for ts, cnt in rows:
        if ts is None:
            continue
        try:
            iso = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        except Exception:
            iso = str(ts)
        out.append({"at_iso": iso, "count": int(cnt or 0)})
    return out


def _list_day_layout_freeze_events(db: Session, date: str) -> List[Dict[str, str]]:
    try:
        rows = db.execute(
            text(
                "SELECT at_utc, action FROM room_day_layout_freeze_events WHERE date = :d ORDER BY id ASC"
            ),
            {"d": date},
        ).fetchall()
        return [{"at_iso": str(r[0]), "action": str(r[1])} for r in rows]
    except Exception:
        return []


def _square_bookings_raw_for_date(db: Session, date: str) -> List[Dict[str, Any]]:
    """Square (or mock) bookings for a calendar date, same filters as room reassign."""
    current_service = get_square_service()
    if current_service.client:
        bookings = current_service.get_bookings_for_date(date)
    else:
        bookings = mock_square.get_bookings_for_date(date)
    bookings = _without_square_test_profile_bookings(bookings)
    bookings = [b for b in bookings if is_allowed_therapist(b.get("therapist", ""))]
    overrides = {o.booking_id: o for o in db.query(BookingOverride).filter(BookingOverride.date == date).all()}
    return [
        b
        for b in bookings
        if not (overrides.get(b["id"]) and getattr(overrides[b["id"]], "cancelled_or_noshow", False))
    ]


def _booking_ids_starting_at_or_after(db: Session, date: str, cutoff: datetime) -> Set[str]:
    """Booking ids whose Square start_at is >= cutoff (timezone-aware compare)."""
    ids: Set[str] = set()
    for b in _square_bookings_raw_for_date(db, date):
        st_raw = b.get("start_at")
        if not st_raw:
            continue
        try:
            st = datetime.fromisoformat(str(st_raw).replace("Z", "+00:00"))
        except Exception:
            try:
                st = dateutil_parser.parse(str(st_raw))
            except Exception:
                continue
        if st >= cutoff:
            ids.add(b["id"])
    return ids


def _run_full_room_reassign_for_date(db: Session, date: str) -> DayResponse:
    """Fetch Square day, run RoomAssigner (preserves manager + layout pins), return built day payload."""
    current_service = get_square_service()
    if current_service.client:
        bookings = current_service.get_bookings_for_date(date)
    else:
        bookings = mock_square.get_bookings_for_date(date)
    bookings = _without_square_test_profile_bookings(bookings)
    bookings = [b for b in bookings if is_allowed_therapist(b.get("therapist", ""))]
    overrides = {o.booking_id: o for o in db.query(BookingOverride).filter(BookingOverride.date == date).all()}
    bookings = [b for b in bookings if not (overrides.get(b["id"]) and getattr(overrides[b["id"]], "cancelled_or_noshow", False))]
    bookings_for_assignment = [_booking_dict_for_assignment(b, overrides) for b in bookings]
    protected_booking_ids = _protected_booking_ids_for_date(db, bookings_for_assignment, date)
    freeze_room_booking_ids = _freeze_room_booking_ids_for_date(bookings_for_assignment, date)
    assigner = RoomAssigner(db)
    assigner.assign_rooms(
        bookings_for_assignment,
        date,
        protected_booking_ids=protected_booking_ids,
        freeze_room_booking_ids=freeze_room_booking_ids,
        overrides_by_booking=overrides,
    )
    return build_day_response_for_date(db, date, square_bookings_if_already_loaded=bookings)


def _freeze_room_booking_ids_for_date(bookings: List[Dict], date: str) -> set:
    """
    Past (ended) or session already started (start_at <= now).
    Used to preserve existing DB room during auto-assign and when promoting auto→manager on recalc.
    Early check-in alone does NOT freeze — future appointments can still be re-optimized until start time.
    """
    # Allow last-minute fixes for just-started sessions: do NOT freeze rooms for sessions that started
    # within the last 30 minutes (still protected from UNASSIGNED elsewhere).
    past = _past_booking_ids_for_date(bookings, date)
    started = _started_booking_ids_for_date(bookings, date)
    if not started:
        return past
    now = datetime.now()
    recent_started: set = set()
    for b in bookings:
        try:
            bid = b.get("booking_id")
            if not bid or bid not in started:
                continue
            start_str = (b.get("start_at") or "").strip()
            if not start_str:
                continue
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            if start_dt.tzinfo:
                start_local = start_dt.astimezone().replace(tzinfo=None)
            else:
                start_local = start_dt
            if start_local >= (now - timedelta(minutes=30)):
                recent_started.add(bid)
        except Exception:
            continue
    return past | (started - recent_started)


def _protected_booking_ids_for_date(db: Session, bookings_for_assignment: List[Dict], date: str) -> set:
    """Past (ended), checked-in, or started sessions — must not be unassigned by auto-assign; room moves need confirmation."""
    return (
        _past_booking_ids_for_date(bookings_for_assignment, date)
        | _checked_in_booking_ids_for_date(db, date)
        | _started_booking_ids_for_date(bookings_for_assignment, date)
    )


def _back_walking_room_alert_for_event(booking: Dict) -> Optional[str]:
    """Calendar hint when back walking was requested but room is not a bar room (1/3/4) or none free."""
    if (booking.get("type") or "").lower() == "couple":
        return None
    if not booking_requires_back_walking_bar_room(booking):
        return None
    room = (booking.get("room") or "").strip()
    if room == "UNASSIGNED":
        return "Back walking requested — no bar room (Rm 1, 3, or 4) free for this slot."
    if room in ("ADDON",):
        return None
    if room not in ("1", "3", "4"):
        return "Back walking requested — this room has no ceiling bars; prefer Rm 1, 3, or 4."
    return None


def _adjusted_booking_end_iso(square_end_iso: str, duration_adjust_minutes: int) -> str:
    """Shift Square end time by signed minutes for room grid + calendar (+ = longer block, − = shorter)."""
    if not duration_adjust_minutes or not (square_end_iso or "").strip():
        return square_end_iso
    try:
        end_dt = dateutil_parser.parse(square_end_iso)
        return (end_dt + timedelta(minutes=int(duration_adjust_minutes))).isoformat()
    except Exception:
        return square_end_iso


def _booking_dict_for_assignment(booking: Dict, overrides_by_booking: Dict[str, BookingOverride]) -> Dict:
    """One Square booking -> dict for RoomAssigner with duration_adjust_minutes applied to end_at; preserves square_end_at."""
    bid = booking["id"]
    ov = overrides_by_booking.get(bid)
    dm = int(getattr(ov, "duration_adjust_minutes", None) or 0) if ov else 0
    raw_square_end = booking["end_at"]
    sq_addon = (booking.get("addon_note") or "").strip()
    ov_addon = (getattr(ov, "addon_note", None) or "").strip() if ov else ""
    addon_merged = " ".join(p for p in (sq_addon, ov_addon) if p).strip() or None
    dm_block = _duration_minutes(booking["start_at"], raw_square_end)
    # Match build_day note_blob so cupping/massage parallel time (e.g. air cupping) is not missed when it
    # only appears in seller/customer notes — otherwise end_at stays long and blocks couples rooms.
    note_for_neutral = " ".join(
        str(x or "").strip()
        for x in (
            addon_merged,
            booking.get("seller_note"),
            booking.get("customer_note"),
        )
        if x
    ).strip() or None
    neutral_min = _addon_time_neutral_minutes(
        booking.get("service"), note_for_neutral, dm_block
    )
    occupancy_end_iso = raw_square_end
    if neutral_min and neutral_min > 0:
        try:
            st = datetime.fromisoformat(booking["start_at"].replace("Z", "+00:00"))
            se = datetime.fromisoformat(raw_square_end.replace("Z", "+00:00"))
            cand = se - timedelta(minutes=int(neutral_min))
            if cand > st:
                occupancy_end_iso = cand.isoformat()
        except Exception:
            occupancy_end_iso = raw_square_end
    end_at = _adjusted_booking_end_iso(occupancy_end_iso, dm)
    return {
        "booking_id": bid,
        "therapist": booking["therapist"],
        "therapist_2": (booking.get("therapist_2") or "").strip() or None,
        "start_at": booking["start_at"],
        "end_at": end_at,
        "square_end_at": raw_square_end,
        "customer": booking["customer"],
        "customer_id": booking.get("customer_id") or "",
        "service": booking["service"],
        "type": booking["type"],
        "customer_note": booking.get("customer_note"),
        "seller_note": booking.get("seller_note"),
        "addon_note": addon_merged,
    }


def _room_move_requires_confirmation(
    booking_id: str,
    request_room: str,
    current_room: Optional[str],
    protected_booking_ids: set,
) -> bool:
    """True if changing rooms for an already-assigned booking that is protected (started, checked in, or past)."""
    if not current_room or current_room == "UNASSIGNED":
        return False
    if request_room == current_room:
        return False
    return booking_id in protected_booking_ids


def _checked_in_booking_ids_for_date(db: Session, date: str) -> set:
    """Return set of booking_id that have checked in (arrived_at_1 set) for this date. These must never be unassigned."""
    from app.models import BookingOverride
    rows = db.query(BookingOverride).filter(
        BookingOverride.date == date,
        BookingOverride.arrived_at_1.isnot(None),
    ).all()
    return {r.booking_id for r in rows}


def _save_room_undo_snapshot(db: Session, date: str) -> None:
    """Save current room assignments for date so user can undo the next change.
    Never overwrite an existing snapshot with a worse state (more UNASSIGNED), so undo
    can still restore the last good state even if a second room change was made after things broke.
    """
    rows = db.query(RoomAssignment).filter(RoomAssignment.date == date).all()
    snapshot = [
        {"booking_id": r.booking_id, "room": r.room, "assigned_by": r.assigned_by, "reason": r.reason}
        for r in rows
    ]
    unassigned_count = sum(1 for r in rows if r.room == "UNASSIGNED")
    undo_row = db.query(RoomAssignmentUndo).filter(RoomAssignmentUndo.date == date).first()
    if undo_row:
        try:
            existing = json.loads(undo_row.snapshot)
            existing_unassigned = sum(1 for item in existing if item.get("room") == "UNASSIGNED")
            if unassigned_count > existing_unassigned:
                return
        except Exception:
            pass
        undo_row.snapshot = json.dumps(snapshot)
        undo_row.saved_at = datetime.now()
    else:
        db.add(RoomAssignmentUndo(date=date, snapshot=json.dumps(snapshot)))
    db.commit()


@app.put("/api/room")
async def update_room(
    request: UpdateRoomRequest,
    db: Session = Depends(get_db)
):
    """
    Update a room assignment and recalculate all assignments for the date.
    Past appointments are read-only unless unlocked via /api/appointment/unlock.
    """
    try:
        if _check_past_locked(db, request.booking_id, request.date):
            raise HTTPException(status_code=403, detail="Past appointment is locked. Unlock it first to edit.")
        # UI label "02C" (couples) maps to stored key "02D"
        rv = (request.room or "").strip()
        if rv.upper() == "02C":
            rv = "02D"
        elif rv.upper() == "02D":
            rv = "02D"
        if rv != request.room:
            request = request.model_copy(update={"room": rv})
        # Validate room number
        valid_rooms = ['0', '1', '2', '3', '4', '5', '6', '02D', 'ADDON', 'UNASSIGNED']
        if request.room not in valid_rooms:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid room number. Must be one of: {', '.join(valid_rooms)}"
            )

        # Require explicit confirmation before moving a booking that already has a room and is in progress,
        # checked in, or finished (prevents drag/drop or dropdown from reshuffling live sessions).
        current_service_early = get_square_service()
        if current_service_early.client:
            bookings_early = current_service_early.get_bookings_for_date(request.date)
        else:
            bookings_early = mock_square.get_bookings_for_date(request.date)
        bookings_early = _without_square_test_profile_bookings(bookings_early)
        bookings_early = [b for b in bookings_early if is_allowed_therapist(b.get("therapist", ""))]
        ov_early = {o.booking_id: o for o in db.query(BookingOverride).filter(BookingOverride.date == request.date).all()}
        bookings_early = [
            b for b in bookings_early
            if not (ov_early.get(b["id"]) and getattr(ov_early[b["id"]], "cancelled_or_noshow", False))
        ]
        bookings_for_protection = []
        for booking in bookings_early:
            bookings_for_protection.append({
                "booking_id": booking["id"],
                "therapist": booking["therapist"],
                "start_at": booking["start_at"],
                "end_at": booking["end_at"],
                "customer": booking["customer"],
                "service": booking["service"],
                "type": booking["type"],
            })
        protected_move = _protected_booking_ids_for_date(db, bookings_for_protection, request.date)
        existing_early = db.query(RoomAssignment).filter(
            RoomAssignment.booking_id == request.booking_id
        ).first()
        current_room_early = existing_early.room if existing_early else None
        slice_kind = (request.room_view_slice or "").strip().lower()
        is_couple_facial_slice = slice_kind in ("couple_facial", "02d_facial")

        if is_couple_facial_slice:
            ov_cur = db.query(BookingOverride).filter(
                BookingOverride.booking_id == request.booking_id,
                BookingOverride.date == request.date,
            ).first()
            cur_facial = ((getattr(ov_cur, "facial_portion_room", None) or "").strip() or "UNASSIGNED")
            facial_current_for_confirm = None if cur_facial == "UNASSIGNED" else cur_facial
            if _room_move_requires_confirmation(
                request.booking_id, request.room, facial_current_for_confirm, protected_move
            ) and not request.confirmed:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Room change requires confirmation: client may be in the room or the session has started. "
                        "Submit again with confirmed=true after verifying the destination room."
                    ),
                )
            _save_room_undo_snapshot(db, request.date)
            ov_fb = ov_cur or BookingOverride(booking_id=request.booking_id, date=request.date)
            if not ov_cur:
                db.add(ov_fb)
            ov_fb.facial_portion_room = None if request.room == "UNASSIGNED" else request.room
            if request.placement_override is not None:
                if request.placement_override is True:
                    ov_fb.room_placement_override = True
                else:
                    ov_fb.room_placement_override = False
            ov_fb.updated_at = datetime.now()
            db.commit()
        else:
            if _room_move_requires_confirmation(
                request.booking_id, request.room, current_room_early, protected_move
            ) and not request.confirmed:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Room change requires confirmation: client may be in the room or the session has started. "
                        "Submit again with confirmed=true after verifying the destination room."
                    ),
                )

            # Save snapshot of current room assignments so user can undo
            _save_room_undo_snapshot(db, request.date)

            existing = db.query(RoomAssignment).filter(
                RoomAssignment.booking_id == request.booking_id
            ).first()

            if request.unlock_room_for_auto:
                # Clear manual pin so assign_rooms second pass can move this booking (OVR flag cleared separately).
                if existing:
                    db.delete(existing)
            else:
                if existing:
                    existing.room = request.room
                    existing.assigned_by = 'manager'
                    existing.date = request.date
                    existing.reason = None
                    existing.updated_at = datetime.now()
                else:
                    assignment = RoomAssignment(
                        booking_id=request.booking_id,
                        room=request.room,
                        assigned_by='manager',
                        date=request.date,
                        reason=None
                    )
                    db.add(assignment)

            if request.placement_override is not None:
                ov_po = db.query(BookingOverride).filter(
                    BookingOverride.booking_id == request.booking_id,
                    BookingOverride.date == request.date,
                ).first()
                if request.placement_override is True:
                    if not ov_po:
                        ov_po = BookingOverride(booking_id=request.booking_id, date=request.date)
                        db.add(ov_po)
                    ov_po.room_placement_override = True
                elif ov_po:
                    ov_po.room_placement_override = False
                if ov_po:
                    ov_po.updated_at = datetime.now()

            db.commit()
        
        # Recalculate all assignments for this date
        current_service = get_square_service()
        if current_service.client:
            bookings = current_service.get_bookings_for_date(request.date)
        else:
            bookings = mock_square.get_bookings_for_date(request.date)
        bookings = _without_square_test_profile_bookings(bookings)

        # Filter to only allowed therapists
        bookings = [b for b in bookings if is_allowed_therapist(b.get('therapist', ''))]
        
        # Exclude appointments marked cancelled/no-show (same as get_day)
        room_override_rows = db.query(BookingOverride).filter(BookingOverride.date == request.date).all()
        room_overrides = {o.booking_id: o for o in room_override_rows}
        bookings = [b for b in bookings if not (room_overrides.get(b["id"]) and getattr(room_overrides[b["id"]], "cancelled_or_noshow", False))]
        
        # Convert to assignment format (respect duration adjust vs Square)
        bookings_for_assignment = []
        for booking in bookings:
            bookings_for_assignment.append(_booking_dict_for_assignment(booking, room_overrides))
        
        # Bookings that have ended, checked in, or already started must NEVER be moved to unassigned
        past_booking_ids = _past_booking_ids_for_date(bookings_for_assignment, request.date)
        protected_booking_ids = _protected_booking_ids_for_date(db, bookings_for_assignment, request.date)
        freeze_room_booking_ids = _freeze_room_booking_ids_for_date(bookings_for_assignment, request.date)
        current_assignments = db.query(RoomAssignment).filter(RoomAssignment.date == request.date).all()
        past_snapshot = {r.booking_id: (r.room, r.assigned_by) for r in current_assignments if r.booking_id in past_booking_ids}
        
        # Clear auto-assignments for this date; promote past/started only (not early check-in) so future can re-optimize
        auto_assignments = db.query(RoomAssignment).filter(
            RoomAssignment.date == request.date,
            RoomAssignment.assigned_by == 'auto'
        ).all()
        
        promoted = 0
        for auto_assignment in auto_assignments:
            if auto_assignment.booking_id in freeze_room_booking_ids and auto_assignment.room and auto_assignment.room != 'UNASSIGNED':
                auto_assignment.assigned_by = 'manager'
                auto_assignment.updated_at = datetime.now()
                promoted += 1
            else:
                db.delete(auto_assignment)
        
        db.commit()
        logger.info(f"Cleared {len(auto_assignments)} auto-assignments for {request.date}; promoted {promoted} past/started to manager")
        
        # Reassign all rooms (preserves manager assignments; never unassigns protected)
        assigner = RoomAssigner(db)
        assigned_bookings = assigner.assign_rooms(
            bookings_for_assignment,
            request.date,
            protected_booking_ids=protected_booking_ids,
            freeze_room_booking_ids=freeze_room_booking_ids,
            overrides_by_booking=room_overrides,
        )
        
        # Restore room assignments for past (already-checked-out) bookings so they are never changed to unassigned
        if past_snapshot:
            for bid, (room, assigned_by) in past_snapshot.items():
                row = db.query(RoomAssignment).filter(
                    RoomAssignment.booking_id == bid,
                    RoomAssignment.date == request.date
                ).first()
                if row:
                    row.room = room
                    row.assigned_by = assigned_by
                    row.updated_at = datetime.now()
                else:
                    db.add(RoomAssignment(
                        booking_id=bid,
                        room=room,
                        assigned_by=assigned_by,
                        date=request.date,
                        reason=None
                    ))
            db.commit()
            logger.info(f"Restored room assignments for {len(past_snapshot)} past (checked-out) bookings")
        
        if is_couple_facial_slice:
            logger.info(f"Updated facial portion room: {request.booking_id} -> {request.room}, recalculated assignments")
        else:
            logger.info(f"Updated room assignment: {request.booking_id} -> {request.room}, recalculated all assignments")

        day = build_day_response_for_date(
            db, request.date, square_bookings_if_already_loaded=bookings
        )
        return {
            "success": True,
            "message": (
                f"Facial portion room set to {request.room} (couples massage room unchanged)"
                if is_couple_facial_slice
                else f"Room updated to {request.room} and all assignments recalculated"
            ),
            "updated_booking_id": request.booking_id,
            "new_room": request.room,
            "day": day.model_dump(mode="json"),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating room assignment: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/room/undo-available")
async def room_undo_available(date: str = Query(..., description="YYYY-MM-DD"), db: Session = Depends(get_db)):
    """Return whether undo is available for the last room change on this date."""
    row = db.query(RoomAssignmentUndo).filter(RoomAssignmentUndo.date == date).first()
    return {"available": row is not None}


@app.post("/api/room/undo")
async def room_undo(date: str = Query(..., description="YYYY-MM-DD"), db: Session = Depends(get_db)):
    """Restore room assignments to the state before the last room change for this date."""
    row = db.query(RoomAssignmentUndo).filter(RoomAssignmentUndo.date == date).first()
    if not row:
        raise HTTPException(status_code=404, detail="Nothing to undo for this date.")
    try:
        snapshot = json.loads(row.snapshot)
    except Exception as e:
        logger.error(f"Invalid undo snapshot for {date}: {e}")
        raise HTTPException(status_code=500, detail="Invalid undo data.")
    # Remove all current assignments for this date
    db.query(RoomAssignment).filter(RoomAssignment.date == date).delete()
    # Restore from snapshot
    for item in snapshot:
        db.add(RoomAssignment(
            booking_id=item["booking_id"],
            room=item["room"],
            assigned_by=item.get("assigned_by", "auto"),
            date=date,
            reason=item.get("reason"),
        ))
    # Remove the undo snapshot so we don't undo again by mistake (one-shot undo)
    db.delete(row)
    db.commit()
    logger.info(f"Undid room assignments for {date}, restored {len(snapshot)} assignments")
    day = build_day_response_for_date(db, date)
    return {
        "success": True,
        "message": "Room assignments restored to before the last change.",
        "day": day.model_dump(mode="json"),
    }


@app.post("/api/room/unlock")
async def unlock_room(request: UnlockRoomRequest, db: Session = Depends(get_db)):
    """Remove manager room assignment so the room can be auto-assigned again."""
    if _check_past_locked(db, request.booking_id, request.date):
        raise HTTPException(status_code=403, detail="Past appointment is locked. Unlock it first to edit.")
    ra = db.query(RoomAssignment).filter(
        RoomAssignment.booking_id == request.booking_id,
        RoomAssignment.date == request.date,
    ).first()
    if ra:
        db.delete(ra)
        db.commit()
    day = _run_full_room_reassign_for_date(db, request.date)
    return {
        "success": True,
        "message": "Room unlocked and recalculated",
        "day": day.model_dump(mode="json"),
    }


@app.get("/api/room/day-layout-freeze-context")
async def day_layout_freeze_context(
    date: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Waves of layout-pin promotions (for partial unlock) and lock/unlock event log for the date."""
    date = (date or "").strip()
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    return {
        "waves": _list_day_layout_freeze_waves(db, date),
        "events": _list_day_layout_freeze_events(db, date),
    }


@app.post("/api/room/day-layout-freeze")
async def day_layout_freeze(request: DayLayoutFreezeRequest, db: Session = Depends(get_db)):
    """
    Pin every auto-assigned room for this date so new Square bookings do not reshuffle existing placements.
    Manual manager locks (reason not set to layout sentinel) are unchanged. Turning freeze off removes only
    layout pins and re-runs auto-assign (manual placements stay).
    """
    date = (request.date or "").strip()
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    promoted = 0
    if request.freeze:
        lock_from_raw = (request.lock_appointments_starting_at_or_after_iso or "").strip()
        eligible_ids: Optional[Set[str]] = None
        if lock_from_raw:
            try:
                lock_cutoff = dateutil_parser.isoparse(lock_from_raw)
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid lock_appointments_starting_at_or_after_iso (use ISO-8601, e.g. 2026-05-09T14:40:00-05:00)",
                )
            eligible_ids = _booking_ids_starting_at_or_after(db, date, lock_cutoff)
        rows = (
            db.query(RoomAssignment)
            .filter(
                RoomAssignment.date == date,
                RoomAssignment.assigned_by == "auto",
                RoomAssignment.room.notin_(("UNASSIGNED", "ADDON")),
            )
            .all()
        )
        if eligible_ids is not None:
            rows = [r for r in rows if r.booking_id in eligible_ids]
        batch_ts = datetime.now(timezone.utc)
        locked_at_iso = batch_ts.isoformat()
        for r in rows:
            r.assigned_by = "manager"
            r.reason = DAY_LAYOUT_FREEZE_REASON
            r.updated_at = batch_ts
            promoted += 1
        if promoted > 0 or not lock_from_raw:
            _upsert_room_day_layout_freeze_meta(db, date, locked_at_iso)
        if promoted > 0 or not lock_from_raw:
            _append_freeze_event(db, date, "lock", locked_at_iso)
        db.commit()
        logger.info(
            "Day layout freeze ON for %s: promoted %s auto rows (partial_by_start=%s)",
            date,
            promoted,
            bool(lock_from_raw),
        )
    else:
        partial_iso = (request.unlock_promoted_at_or_after_iso or "").strip()
        n = 0
        if partial_iso:
            try:
                cutoff = dateutil_parser.isoparse(partial_iso)
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid unlock_promoted_at_or_after_iso (use ISO-8601, e.g. 2026-05-09T14:40:00+00:00)",
                )
            n = (
                db.query(RoomAssignment)
                .filter(
                    RoomAssignment.date == date,
                    RoomAssignment.reason == DAY_LAYOUT_FREEZE_REASON,
                    RoomAssignment.updated_at >= cutoff,
                )
                .delete(synchronize_session=False)
            )
        else:
            n = (
                db.query(RoomAssignment)
                .filter(RoomAssignment.date == date, RoomAssignment.reason == DAY_LAYOUT_FREEZE_REASON)
                .delete(synchronize_session=False)
            )
        _sync_freeze_meta_after_pin_change(db, date)
        _append_freeze_event(db, date, "unlock")
        db.commit()
        logger.info(
            "Day layout freeze OFF for %s: removed %s layout pin rows (partial=%s)",
            date,
            n,
            bool(partial_iso),
        )
    day = _run_full_room_reassign_for_date(db, date)
    if request.freeze:
        lock_from_msg = (request.lock_appointments_starting_at_or_after_iso or "").strip()
        if lock_from_msg and promoted == 0:
            msg = (
                "No auto-assigned appointments start at or after that time — nothing was pinned. "
                "Earlier pins and other assignments are unchanged."
            )
        elif lock_from_msg:
            msg = (
                f"Pinned {promoted} auto-assigned room(s) for appointments starting at or after the chosen time. "
                "Earlier auto assignments were left unchanged. New bookings still slot into free rooms."
            )
        else:
            msg = "Day layout locked: auto-assigned rooms are pinned. New bookings still slot into free rooms."
    elif (request.unlock_promoted_at_or_after_iso or "").strip():
        msg = (
            "Removed layout pins promoted at or after the selected time; older pins stay. "
            "Auto-assign recalculated. Manual room locks were not removed."
        )
    else:
        msg = "Day layout pins cleared: auto-assign recalculated. Manual room locks were not removed."
    return {"success": True, "message": msg, "day": day.model_dump(mode="json")}


@app.put("/api/therapist")
async def update_therapist(request: UpdateTherapistRequest, db: Session = Depends(get_db)):
    """Set or clear therapist override for a booking (slot 1 or 2 for couple)."""
    if _check_past_locked(db, request.booking_id, request.date):
        raise HTTPException(status_code=403, detail="Past appointment is locked. Unlock it first to edit.")
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date, therapist_locked=False)
        db.add(ov)
    slot = getattr(request, "slot", 1) or 1
    if slot == 2:
        ov.therapist_override_2 = request.therapist if request.locked else None
        ov.therapist_locked_2 = request.locked
    else:
        ov.therapist_override = request.therapist if request.locked else None
        ov.therapist_locked = request.locked
    ov.updated_at = datetime.now()
    db.commit()
    if slot == 2:
        return {"success": True, "therapist": ov.therapist_override_2, "locked": ov.therapist_locked_2}
    return {"success": True, "therapist": ov.therapist_override, "locked": ov.therapist_locked}


@app.get("/api/customer-last-pressure")
async def get_customer_last_pressure(customer_id: str = Query(..., description="Square customer id"), db: Session = Depends(get_db)):
    """Return the last pressure preference for this customer (for prepopulating check-in)."""
    row = db.query(CustomerLastPressure).filter(CustomerLastPressure.customer_id == customer_id).first()
    if not row or not row.pressure:
        return {"pressure": None}
    return {"pressure": row.pressure}


@app.put("/api/pressure")
async def update_pressure(request: UpdatePressureRequest, db: Session = Depends(get_db)):
    """Set pressure for a booking (slot 1 or 2 for couple); if customer_id and slot 1, also update last-pressure."""
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date)
        db.add(ov)
    slot = getattr(request, "slot", 1) or 1
    val = request.pressure.strip() or None
    if slot == 2:
        ov.pressure_2 = val
    else:
        ov.pressure = val
        if request.customer_id and request.customer_id.strip():
            last_row = db.query(CustomerLastPressure).filter(CustomerLastPressure.customer_id == request.customer_id.strip()).first()
            if not last_row:
                last_row = CustomerLastPressure(customer_id=request.customer_id.strip(), pressure=None)
                db.add(last_row)
            last_row.pressure = ov.pressure
            last_row.updated_at = datetime.now()
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "pressure": ov.pressure_2 if slot == 2 else ov.pressure}


@app.put("/api/focus-area")
async def update_focus_area(request: UpdateFocusAreaRequest, db: Session = Depends(get_db)):
    """Set focus area(s) for a booking (slot 1 or 2 for couple); comma-separated."""
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date)
        db.add(ov)
    slot = getattr(request, "slot", 1) or 1
    val = (request.focus_area or "").strip() or None
    if slot == 2:
        ov.focus_area_2 = val
    else:
        ov.focus_area = val
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "focus_area": ov.focus_area_2 if slot == 2 else ov.focus_area}


@app.put("/api/tip")
async def update_tip(request: UpdateTipRequest, db: Session = Depends(get_db)):
    """Set tip amount(s) for a booking. For facial+massage or luxury with a different Facial Specialist, prorate by time."""
    if _check_past_locked(db, request.booking_id, request.date):
        raise HTTPException(status_code=403, detail="Past appointment is locked. Unlock it first to edit.")
    try:
        unset = request.model_dump(exclude_unset=True)
    except Exception:
        unset = {}
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date)
        db.add(ov)

    if "tip_cash" in unset:
        ov.tip_cash = bool(request.tip_cash)

    if "tip_amount" not in unset or request.tip_amount is None:
        if "tip_cash" in unset:
            ov.updated_at = datetime.now()
            db.commit()
            return {"success": True, "tip_cash": bool(ov.tip_cash)}
        raise HTTPException(status_code=400, detail="Provide tip_amount or tip_cash")

    total_tip = float(request.tip_amount)
    # If client sends tip_amount_2 or split_evenly explicitly (e.g. couple), use them
    explicit_tip2 = getattr(request, "tip_amount_2", None)
    explicit_split = getattr(request, "split_evenly", None)

    # Fetch booking to detect facial+massage or luxury and get primary therapist
    current_service = get_square_service()
    bookings = (current_service.get_bookings_for_date(request.date) if current_service.client
                else mock_square.get_bookings_for_date(request.date))
    booking = next((b for b in bookings if b.get("id") == request.booking_id), None)
    primary = (ov.therapist_override if (ov.therapist_locked and getattr(ov, "therapist_override", None)) else None) or (booking.get("therapist") if booking else "") or ""
    primary = (primary or "").strip()
    is_couple = (booking.get("type") or "").lower() == "couple" if booking else False

    # Couple: more than one service provider — split tip pro rata on time (both full duration → 50/50)
    if is_couple and explicit_tip2 is None and explicit_split is None:
        half = round(total_tip * 0.5, 2)
        ov.tip_amount = half
        ov.tip_amount_2 = half
        ov.tip_split_evenly = False
        ov.updated_at = datetime.now()
        db.commit()
        return {"success": True, "tip_amount": float(ov.tip_amount), "tip_amount_2": float(ov.tip_amount_2), "allocated": True}

    # Single custom facial + massage: optional 50/50 between masseuse and Facial Specialist (when both set)
    if (
        not is_couple
        and explicit_tip2 is None
        and explicit_split is True
        and booking
    ):
        service = booking.get("service") or ""
        start_at = booking.get("start_at") or ""
        end_at = booking.get("end_at") or ""
        if _is_facial_with_massage(service, "single", start_at, end_at):
            facial_spec = (getattr(ov, "facial_specialist", None) or "").strip()
            if facial_spec and facial_spec != primary:
                half = round(total_tip * 0.5, 2)
                ov.tip_amount = half
                ov.tip_amount_2 = half
                ov.tip_split_evenly = True
                ov.updated_at = datetime.now()
                db.commit()
                return {"success": True, "tip_amount": float(ov.tip_amount), "tip_amount_2": float(ov.tip_amount_2), "allocated": True}

    # explicit_split not True: allows time-based proration when split_evenly is false or omitted (single facial)
    if not is_couple and explicit_tip2 is None and explicit_split is not True and booking:
        service = booking.get("service") or ""
        start_at = booking.get("start_at") or ""
        end_at = booking.get("end_at") or ""
        duration_min = _duration_minutes(start_at, end_at)
        service_lower = (service or "").lower()

        # Luxury: 90 min main, 30 min Facial Specialist (default split unless customer sets Tip 2 manually)
        if ("luxury" in service_lower or "luxury package" in service_lower) and duration_min >= 100:
            facial_spec = (getattr(ov, "luxury_mini_facial_therapist", None) or "").strip()
            if _luxury_separate_fs_active(ov) and facial_spec and facial_spec != primary:
                ov.tip_amount = round(total_tip * 90 / 120, 2)
                ov.tip_amount_2 = round(total_tip * 30 / 120, 2)
                ov.tip_split_evenly = False
                ov.updated_at = datetime.now()
                db.commit()
                return {"success": True, "tip_amount": float(ov.tip_amount), "tip_amount_2": float(ov.tip_amount_2), "allocated": True}

        # Facial+massage: prorate by massage vs facial minutes
        if _is_facial_with_massage(service, "single", start_at, end_at):
            facial_spec = (getattr(ov, "facial_specialist", None) or "").strip()
            if facial_spec and facial_spec != primary:
                massage_min, facial_min = _facial_massage_minutes(service, duration_min)
                total_min = massage_min + facial_min
                if total_min > 0:
                    ov.tip_amount = round(total_tip * massage_min / total_min, 2)
                    ov.tip_amount_2 = round(total_tip * facial_min / total_min, 2)
                    ov.tip_split_evenly = False
                    ov.updated_at = datetime.now()
                    db.commit()
                    return {"success": True, "tip_amount": float(ov.tip_amount), "tip_amount_2": float(ov.tip_amount_2), "allocated": True}

        # Single with time-split (two SRMs): prorate tip by split_minutes_first
        therapist_2_val = (getattr(ov, "therapist_override_2", None) or "").strip()
        split_min = getattr(request, "split_minutes_first", None)
        if split_min is None:
            split_min = getattr(ov, "split_minutes_first", None)
        if therapist_2_val and split_min is not None and duration_min and duration_min > 0:
            split_min = max(0, min(int(split_min), duration_min))
            ov.split_minutes_first = split_min
            min2 = duration_min - split_min
            ov.tip_amount = round(total_tip * split_min / duration_min, 2)
            ov.tip_amount_2 = round(total_tip * min2 / duration_min, 2)
            ov.tip_split_evenly = False
            ov.updated_at = datetime.now()
            db.commit()
            return {"success": True, "tip_amount": float(ov.tip_amount), "tip_amount_2": float(ov.tip_amount_2), "allocated": True}

    # Store split_minutes_first from request if provided (for single split)
    split_min_request = getattr(request, "split_minutes_first", None)
    if split_min_request is not None:
        ov.split_minutes_first = split_min_request if split_min_request >= 0 else None

    # Default: single total or couple explicit amounts (for luxury couple, tip_amount_2 null = one total → 4-way split in report)
    ov.tip_amount = total_tip
    try:
        set_fields = request.model_dump(exclude_unset=True)
        if "tip_amount_2" in set_fields:
            ov.tip_amount_2 = request.tip_amount_2
    except Exception:
        if explicit_tip2 is not None:
            ov.tip_amount_2 = explicit_tip2
    if explicit_split is not None:
        ov.tip_split_evenly = explicit_split
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "tip_amount": float(ov.tip_amount)}


@app.put("/api/booking/split-time")
async def set_split_time(request: SetSplitTimeRequest, db: Session = Depends(get_db)):
    """Enable or clear time-split for a single booking (two SRMs; tip prorated by minutes). minutes_first=null clears split."""
    if _check_past_locked(db, request.booking_id, request.date):
        raise HTTPException(status_code=403, detail="Past appointment is locked. Unlock it first to edit.")
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date)
        db.add(ov)
    if request.minutes_first is None:
        ov.split_minutes_first = None
        ov.therapist_override_2 = None
        ov.therapist_locked_2 = False
        ov.tip_amount_2 = None
    else:
        ov.split_minutes_first = max(0, int(request.minutes_first))
        ov.therapist_locked_2 = True  # show SRM 2 dropdown; therapist_override_2 set when they pick
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "minutes_first": ov.split_minutes_first}


@app.put("/api/booking/cancelled-noshow")
async def set_cancelled_noshow(request: SetCancelledNoShowRequest, db: Session = Depends(get_db)):
    """Mark an appointment as cancelled or no-show so it is hidden from the schedule. Set to False to show again."""
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date, cancelled_or_noshow=request.cancelled_or_noshow)
        db.add(ov)
    else:
        ov.cancelled_or_noshow = request.cancelled_or_noshow
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "cancelled_or_noshow": ov.cancelled_or_noshow}


@app.put("/api/booking/couple-02d-single-facial")
async def set_couple_02d_single_facial(request: UpdateCouple02dSingleFacialRequest, db: Session = Depends(get_db)):
    """Couple in Rm 5, 6, or 02D with facial+m massage: only one client gets the facial — split calendar blocks; drag facial to a room."""
    if _check_past_locked(db, request.booking_id, request.date):
        raise HTTPException(status_code=403, detail="Past appointment is locked. Unlock it first to edit.")
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(
            booking_id=request.booking_id,
            date=request.date,
            couple_02d_single_facial_only=request.single_facial_only,
        )
        db.add(ov)
    else:
        ov.couple_02d_single_facial_only = request.single_facial_only
    if not request.single_facial_only:
        ov.facial_portion_room = None
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "single_facial_only": ov.couple_02d_single_facial_only}


@app.put("/api/booking/duration-adjust")
async def set_duration_adjust(request: SetDurationAdjustRequest, db: Session = Depends(get_db)):
    """Apply signed minutes to Square end for calendar/rooms only (+ longer, − shorter). Null/0 clears."""
    if _check_past_locked(db, request.booking_id, request.date):
        raise HTTPException(status_code=403, detail="Past appointment is locked. Unlock it first to edit.")
    raw = request.duration_adjust_minutes
    clear = raw is None or raw == 0
    if not clear:
        try:
            raw = int(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="duration_adjust_minutes must be an integer")
        if abs(raw) > 24 * 60:
            raise HTTPException(status_code=400, detail="Adjustment must be within ±1440 minutes")
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if clear:
        if ov:
            ov.duration_adjust_minutes = None
            ov.updated_at = datetime.now()
        db.commit()
        return {"success": True, "duration_adjust_minutes": None}
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date, duration_adjust_minutes=raw)
        db.add(ov)
    else:
        ov.duration_adjust_minutes = raw
        ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "duration_adjust_minutes": raw}


@app.post("/api/check-in")
async def check_in(request: CheckInRequest, db: Session = Depends(get_db)):
    """Record check-in time for client 1 or 2 on a couple booking (sets arrived_at_1 or arrived_at_2)."""
    if request.client_index not in (1, 2):
        raise HTTPException(status_code=400, detail="client_index must be 1 or 2")
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date)
        db.add(ov)
    now = datetime.now(timezone.utc)
    if request.client_index == 1:
        ov.arrived_at_1 = now
    else:
        ov.arrived_at_2 = now
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "client_index": request.client_index, "arrived_at": now.isoformat()}


@app.get("/api/customer-desk-notes", response_model=CustomerDeskNoteListResponse)
async def list_customer_desk_notes(
    customer_id: str = Query(..., min_length=1),
    limit: int = Query(40, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Saved front-desk check-in / check-out notes for this customer (newest batch, chronological in response)."""
    cid = customer_id.strip()
    rows = (
        db.query(CustomerDeskNote)
        .filter(CustomerDeskNote.customer_id == cid)
        .order_by(CustomerDeskNote.id.desc())
        .limit(limit)
        .all()
    )
    items = []
    for r in reversed(rows):
        items.append(
            CustomerDeskNoteItem(
                date=r.date,
                note_kind=(r.note_kind or "").strip(),
                body=(r.body or "").strip(),
                created_at=r.created_at.isoformat() if r.created_at else None,
            )
        )
    return CustomerDeskNoteListResponse(items=items)


@app.get("/api/customer/{customer_id}/recent-bookings")
async def customer_recent_square_bookings(
    customer_id: str,
    limit: int = Query(10, ge=1, le=30),
):
    """Recent Square bookings for desk risk UI (includes NO_SHOW). Uses Square only, not local cancelled/no-show."""
    cid = (customer_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="customer_id required")
    svc = get_square_service()
    if not svc or not svc.client:
        return {
            "items": [],
            "profile_flags": {"had_square_no_show": False, "online_only_note": None},
        }
    items, flags = svc.list_recent_bookings_for_customer(cid, limit)
    return {"items": items, "profile_flags": flags}


@app.get("/api/recent-booked-appointments")
async def recent_booked_appointments(limit: int = Query(10, ge=1, le=30)):
    """
    Most recently created Square reservations (created_at), not tied to calendar date.
    Includes NO_SHOW in history scan; omits cancelled/declined from the list.
    """
    lim = max(1, min(int(limit or 10), 30))
    svc = get_square_service()
    if svc.client:
        items = svc.list_newest_booked_appointments_report(lim)
        return {"items": items, "using_real_api": True}
    items = mock_square.list_newest_booked_appointments_report(lim)
    return {"items": items, "using_real_api": False}


@app.post("/api/customer-desk-notes")
async def save_customer_desk_note(request: SaveCustomerDeskNoteRequest, db: Session = Depends(get_db)):
    """Append a front-desk note for a customer on a visit date (history preserved)."""
    kind = (request.note_kind or "").strip().lower()
    if kind not in ("checkin", "checkout"):
        raise HTTPException(status_code=400, detail="note_kind must be checkin or checkout")
    cid = (request.customer_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="customer_id required")
    try:
        datetime.strptime(request.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")
    body = (request.body or "").strip()
    if len(body) > 4000:
        raise HTTPException(status_code=400, detail="Note too long (max 4000 characters)")
    bid = (request.booking_id or "").strip() or None
    row = CustomerDeskNote(
        customer_id=cid,
        date=request.date,
        booking_id=bid,
        note_kind=kind,
        body=body,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True, "id": row.id}


@app.get("/api/check-in/lookup")
async def check_in_lookup(
    date: str = Query(..., description="Date YYYY-MM-DD"),
    q: str = Query(..., min_length=1, description="Customer name search"),
    db: Session = Depends(get_db),
):
    """Look up today's appointments by customer name for kiosk check-in. Returns room and therapist so kiosk can announce them."""
    current_service = get_square_service()
    if current_service.client:
        bookings = current_service.get_bookings_for_date(date)
    else:
        bookings = MockSquareService().get_bookings_for_date(date)
    bookings = _without_square_test_profile_bookings(bookings)
    bookings = [b for b in bookings if is_allowed_therapist(b.get("therapist", ""))]
    overrides_ci = {o.booking_id: o for o in db.query(BookingOverride).filter(BookingOverride.date == date).all()}
    bookings_for_assignment = []
    for b in bookings:
        row = _booking_dict_for_assignment(b, overrides_ci)
        row.update({
            "customer_id": b.get("customer_id", ""),
            "customer_phone": b.get("customer_phone", ""),
        })
        bookings_for_assignment.append(row)
    assigner = RoomAssigner(db)
    assigned_bookings = assigner.assign_rooms(
        bookings_for_assignment, date, overrides_by_booking=overrides_ci
    )
    q_lower = q.strip().lower()
    if not q_lower:
        return {"date": date, "matches": []}
    results = []
    for b in assigned_bookings:
        customer = (b.get("customer") or "").strip()
        if not customer or q_lower not in customer.lower():
            continue
        start_at = b.get("start_at") or ""
        end_at = b.get("end_at") or ""
        duration_minutes = 0
        if start_at and end_at:
            try:
                start_dt = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
                duration_minutes = int((end_dt - start_dt).total_seconds() / 60)
            except Exception:
                pass
        room = b.get("room") or ""
        therapist = b.get("therapist") or ""
        results.append({
            "booking_id": b.get("booking_id", b.get("id", "")),
            "customer": customer,
            "service": b.get("service") or "",
            "start_at": start_at,
            "end_at": end_at,
            "type": b.get("type") or "single",
            "duration_minutes": duration_minutes,
            "room": room,
            "therapist": therapist,
        })
    return {"date": date, "matches": results}


@app.post("/api/check-in/addon-note")
async def check_in_addon_note(request: CheckInAddonNoteRequest, db: Session = Depends(get_db)):
    """Save add-on note from kiosk (e.g. lavender aromatherapy, pain relief oil, cupping)."""
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date)
        db.add(ov)
    existing = (ov.addon_note or "").strip()
    new_note = (request.note or "").strip()
    ov.addon_note = (existing + " " + new_note).strip() if existing else new_note
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "addon_note": ov.addon_note}


@app.put("/api/appointment/unlock")
async def unlock_appointment(request: UnlockAppointmentRequest, db: Session = Depends(get_db)):
    """Allow editing a past appointment (unlock) or lock it again."""
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date, appointment_locked=False)
        db.add(ov)
    ov.appointment_locked = request.unlocked
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "unlocked": ov.appointment_locked}


@app.put("/api/booking/prepayment")
async def update_booking_prepayment(request: UpdatePrepaymentRequest, db: Session = Depends(get_db)):
    """Set or clear manual prepayment amount (overrides Square/suggested for display and reports)."""
    if _check_past_locked(db, request.booking_id, request.date):
        raise HTTPException(status_code=403, detail="Past appointment is locked. Unlock it first to edit.")
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date)
        db.add(ov)
    amt = request.prepayment_amount
    if amt is None:
        ov.prepayment_override = None
    elif float(amt) <= 0:
        ov.prepayment_override = None
    else:
        ov.prepayment_override = round(float(amt), 2)
    ov.updated_at = datetime.now()
    db.commit()
    val = float(ov.prepayment_override) if ov.prepayment_override is not None else None
    return {"success": True, "prepayment_amount": val}


@app.put("/api/booking/luxury-mini-facial")
async def update_luxury_mini_facial(request: UpdateLuxuryMiniFacialRequest, db: Session = Depends(get_db)):
    """Set whether 30 min mini facial was done for a luxury package and who did it (affects pay: $80 vs $60 + $20 to mini facial therapist)."""
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date)
        db.add(ov)
    ov.luxury_mini_facial_done = request.done
    ss = getattr(request, "separate_specialist", None)
    if ss is not None:
        ov.luxury_separate_mini_facial = ss
    if ss is False:
        ov.luxury_mini_facial_therapist = None
        ov.luxury_mini_facial_therapist_2 = None
    else:
        ov.luxury_mini_facial_therapist = request.therapist.strip() if request.therapist else None
        ov.luxury_mini_facial_therapist_2 = (getattr(request, "therapist_2", None) or "").strip() or None
    ov.updated_at = datetime.now()
    db.commit()
    return {
        "success": True,
        "done": ov.luxury_mini_facial_done,
        "separate_specialist": getattr(ov, "luxury_separate_mini_facial", None),
        "therapist": ov.luxury_mini_facial_therapist,
        "therapist_2": getattr(ov, "luxury_mini_facial_therapist_2", None),
    }


@app.put("/api/booking/facial-specialist")
async def update_facial_specialist(request: UpdateFacialSpecialistRequest, db: Session = Depends(get_db)):
    """Set who does the facial part for facial+massage (basic 55min, custom 85min). Blank = masseuse does entire package (pay differs)."""
    ov = db.query(BookingOverride).filter(
        BookingOverride.booking_id == request.booking_id,
        BookingOverride.date == request.date,
    ).first()
    if not ov:
        ov = BookingOverride(booking_id=request.booking_id, date=request.date)
        db.add(ov)
    ov.facial_specialist = request.therapist.strip() if request.therapist else None
    ov.updated_at = datetime.now()
    db.commit()
    return {"success": True, "therapist": ov.facial_specialist}


@app.get("/api/therapist-order")
async def get_therapist_order(date: str = Query(..., description="YYYY-MM-DD"), db: Session = Depends(get_db)):
    """Get therapist rotation order for the day."""
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date. Use YYYY-MM-DD")
    rows = db.query(TherapistDayOrder).filter(TherapistDayOrder.date == date).order_by(TherapistDayOrder.order_number).all()
    return {"date": date, "order": [{"therapist": r.therapist_name, "order": r.order_number} for r in rows]}


@app.put("/api/therapist-order")
async def update_therapist_order(request: UpdateTherapistOrderRequest, db: Session = Depends(get_db)):
    """Set therapist rotation order for the day."""
    try:
        datetime.strptime(request.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date. Use YYYY-MM-DD")
    db.query(TherapistDayOrder).filter(TherapistDayOrder.date == request.date).delete()
    for item in request.order:
        row = TherapistDayOrder(date=request.date, therapist_name=item.therapist, order_number=item.order)
        db.add(row)
    db.commit()
    return {"success": True, "date": request.date}


def _luxury_separate_fs_active(ov) -> bool:
    """Luxury: use separate Facial Specialist for last 30 min (tip/pay split). False = masseuse did full 2hr."""
    if not ov:
        return False
    flag = getattr(ov, "luxury_separate_mini_facial", None)
    if flag is False:
        return False
    if flag is True:
        return True
    # Legacy NULL: treat as separate only if FS was recorded
    if (getattr(ov, "luxury_mini_facial_therapist", None) or "").strip():
        return True
    if (getattr(ov, "luxury_mini_facial_therapist_2", None) or "").strip():
        return True
    return False


def _report_primary_second_therapists(b: dict, overrides: dict) -> tuple:
    """Primary and second therapist for daily pay/tip: couple (two SRMs) or single time-split (Amy+Tina by minutes)."""
    bid = b.get("booking_id") or b.get("id")
    ov = overrides.get(bid) if bid else None
    primary = (ov.therapist_override if (ov and ov.therapist_locked and getattr(ov, "therapist_override", None)) else b.get("therapist")) or b.get("therapist") or ""
    second = None
    if b.get("type") == "couple" and ov and getattr(ov, "therapist_locked_2", False) and getattr(ov, "therapist_override_2", None):
        second = ov.therapist_override_2
    elif (b.get("type") or "").lower() != "couple" and ov and getattr(ov, "therapist_locked_2", False) and getattr(ov, "split_minutes_first", None) is not None:
        t2 = (getattr(ov, "therapist_override_2", None) or "").strip()
        if t2:
            second = t2
    return primary, second


def _build_one_day_report(date: str, db: Session, current_service, pay_rates: Dict[str, float]):
    """Build report for one day. Returns (therapists_list, day_total_pay, day_total_tip). Excludes cancelled/no-show."""
    bookings = current_service.get_bookings_for_date(date) if current_service.client else mock_square.get_bookings_for_date(date)
    bookings = _without_square_test_profile_bookings(bookings)
    bookings = [b for b in bookings if is_allowed_therapist(b.get("therapist", ""))]
    overrides = {o.booking_id: o for o in db.query(BookingOverride).filter(BookingOverride.date == date).all()}
    bookings = [b for b in bookings if not (overrides.get(b["id"]) and getattr(overrides[b["id"]], "cancelled_or_noshow", False))]
    bookings_for_assignment = [_booking_dict_for_assignment(b, overrides) for b in bookings]
    assigner = RoomAssigner(db)
    assigned = assigner.assign_rooms(
        bookings_for_assignment, date, overrides_by_booking=overrides
    )

    def therapists_for_booking(b):
        return _report_primary_second_therapists(b, overrides)

    def tips_for_booking(b):
        """Return (tip1_primary, tip2_second, fs1_name, fs1_tip, fs2_name, fs2_tip). Luxury couple: 90/30 split per side."""
        ov = overrides.get(b["booking_id"])
        if not ov or ov.tip_amount is None:
            return 0.0, 0.0, None, 0.0, None, 0.0
        total = float(ov.tip_amount)
        if getattr(ov, "tip_split_evenly", False):
            half = total / 2.0
            return half, half, None, 0.0, None, 0.0
        tip2_val = float(ov.tip_amount_2) if getattr(ov, "tip_amount_2", None) is not None else 0.0
        is_couple = (b.get("type") or "").lower() == "couple"
        service = (b.get("service") or "").lower()
        is_luxury = "luxury" in service or "luxury package" in service

        if is_couple and is_luxury:
            primary, second = therapists_for_booking(b)
            sep_fs = _luxury_separate_fs_active(ov)
            fs1 = (getattr(ov, "luxury_mini_facial_therapist", None) or "").strip()
            fs2 = (getattr(ov, "luxury_mini_facial_therapist_2", None) or "").strip()
            # One tip for whole service: half per customer ($120 each from $240), then per side 90/30 if separate FS else masseuse gets full half
            one_total_tip = getattr(ov, "tip_amount_2", None) is None or (tip2_val or 0) == 0
            if one_total_tip:
                half = round(total / 2.0, 2)
                if sep_fs and fs1 and fs1 != primary:
                    m1 = round(half * 90 / 120, 2)
                    fs1_tip = round(half * 30 / 120, 2)
                else:
                    m1, fs1_tip = half, 0.0
                    fs1 = None
                if sep_fs and fs2 and fs2 != second:
                    m2 = round(half * 90 / 120, 2)
                    fs2_tip = round(half * 30 / 120, 2)
                else:
                    m2, fs2_tip = half, 0.0
                    fs2 = None
                return (m1, m2, fs1, fs1_tip, fs2, fs2_tip)
            # Two tips (side 1, side 2): each side's total split 90/30 if that side has separate FS
            if sep_fs and fs1 and fs1 != primary:
                m1 = round(total * 90 / 120, 2)
                fs1_tip = round(total * 30 / 120, 2)
            else:
                m1, fs1_tip = total, 0.0
                fs1 = None
            if sep_fs and fs2 and fs2 != second:
                m2 = round(tip2_val * 90 / 120, 2)
                fs2_tip = round(tip2_val * 30 / 120, 2)
            else:
                m2, fs2_tip = tip2_val, 0.0
                fs2 = None
            return (m1, m2, fs1, fs1_tip, fs2, fs2_tip)

        if is_couple:
            return total, tip2_val, None, 0.0, None, 0.0
        # Single with facial specialist: tip2 is for facial specialist
        facial_spec = (getattr(ov, "facial_specialist", None) or "").strip() if ov else ""
        if facial_spec and tip2_val:
            return total, 0.0, facial_spec, tip2_val, None, 0.0
        if not facial_spec and _luxury_separate_fs_active(ov) and (getattr(ov, "luxury_mini_facial_therapist", None) or "").strip():
            lux_spec = (ov.luxury_mini_facial_therapist or "").strip()
            if lux_spec and tip2_val:
                return total, 0.0, lux_spec, tip2_val, None, 0.0
        return total, tip2_val, None, 0.0, None, 0.0

    def pay_for_service(service_name: str, duration_min: int, is_couple: bool, booking_id: str, start_at: str = "", end_at: str = "") -> tuple:
        """Returns (primary_pay, second_pay, bonus_list). second_pay is same as primary for couple else None. bonus_list = [(name, amount, suffix), ...]."""
        if _is_addon_for_count(service_name):
            return 0.0, None, []
        service_lower = (service_name or "").lower()
        ov = overrides.get(booking_id)
        # Luxury package: $80 if mini facial done, else $60; Facial Specialist(s) get $20 each for mini facial
        if "luxury" in service_lower or "luxury package" in service_lower:
            main_pay = 60.0
            if ov and getattr(ov, "luxury_mini_facial_done", None):
                main_pay = 80.0
            bonus_list = []
            if ov and getattr(ov, "luxury_mini_facial_done", None):
                t1 = (getattr(ov, "luxury_mini_facial_therapist", None) or "").strip()
                if t1 and _luxury_separate_fs_active(ov):
                    bonus_list.append((t1, 20.0, " (mini facial)"))
                if is_couple:
                    t2 = (getattr(ov, "luxury_mini_facial_therapist_2", None) or "").strip()
                    if t2 and _luxury_separate_fs_active(ov):
                        bonus_list.append((t2, 20.0, " (mini facial 2)"))
            return (main_pay, main_pay if is_couple else None, bonus_list)
        # Facial+massage (basic 55min, custom 85min): if Facial Specialist set, split pay; else primary gets full package pay
        if not is_couple and _is_facial_with_massage(service_name, "single", start_at, end_at):
            full_pay = _compute_masseuse_pay(service_name, duration_min)
            if full_pay == 0.0:
                for key, amount in sorted(pay_rates.items(), key=lambda x: -len(x[0])):
                    if key in service_lower:
                        full_pay = amount
                        break
            facial_spec = (getattr(ov, "facial_specialist", None) or "").strip() if ov else ""
            if facial_spec:
                half = round(full_pay / 2.0, 2)
                return (half, None, [(facial_spec, half, " (facial)")])
            return (full_pay, None, [])
        pay = _compute_masseuse_pay(service_name, duration_min)
        if pay == 0.0:
            for key, amount in sorted(pay_rates.items(), key=lambda x: -len(x[0])):
                if key in service_lower:
                    pay = amount
                    break
        # Single time-split (two masseuses): prorate provider pay by minutes (same ratio as tips)
        if (
            not is_couple
            and ov
            and getattr(ov, "split_minutes_first", None) is not None
            and getattr(ov, "therapist_locked_2", False)
            and (getattr(ov, "therapist_override_2", None) or "").strip()
        ):
            sm = max(0, min(int(ov.split_minutes_first), duration_min))
            min2 = max(0, duration_min - sm)
            if duration_min > 0:
                p1 = round(pay * sm / duration_min, 2)
                p2 = round(pay * min2 / duration_min, 2)
                return (p1, p2, [])
        return (pay, pay if is_couple else None, [])

    by_therapist = {}
    for b in assigned:
        primary, second = therapists_for_booking(b)
        service = b.get("service") or ""
        dur = _duration_minutes(b.get("start_at", ""), b.get("end_at", ""))
        if _is_addon_for_count(service) or dur < MIN_SERVICE_MINUTES_FOR_COUNT:
            continue
        is_couple = (b.get("type") or "").lower() == "couple"
        primary_pay, second_pay, bonus_pays = pay_for_service(
            service, dur, is_couple, b.get("booking_id", ""), b.get("start_at", ""), b.get("square_end_at") or b.get("end_at", "")
        )
        tip1, tip2, fs1_name, fs1_tip, fs2_name, fs2_tip = tips_for_booking(b)
        if primary:
            if primary not in by_therapist:
                by_therapist[primary] = {"services": [], "total_tip": 0.0, "total_pay": 0.0, "service_count": 0}
            by_therapist[primary]["services"].append({"service": service, "duration_min": dur, "pay": primary_pay})
            by_therapist[primary]["total_pay"] += primary_pay
            by_therapist[primary]["total_tip"] += tip1
            by_therapist[primary]["service_count"] += 1
        if second and second_pay is not None:
            if second not in by_therapist:
                by_therapist[second] = {"services": [], "total_tip": 0.0, "total_pay": 0.0, "service_count": 0}
            by_therapist[second]["services"].append({"service": service, "duration_min": dur, "pay": second_pay})
            by_therapist[second]["total_pay"] += second_pay
            by_therapist[second]["total_tip"] += tip2
            by_therapist[second]["service_count"] += 1
        if fs1_name and fs1_tip:
            if fs1_name not in by_therapist:
                by_therapist[fs1_name] = {"services": [], "total_tip": 0.0, "total_pay": 0.0, "service_count": 0}
            by_therapist[fs1_name]["total_tip"] += fs1_tip
        if fs2_name and fs2_tip:
            if fs2_name not in by_therapist:
                by_therapist[fs2_name] = {"services": [], "total_tip": 0.0, "total_pay": 0.0, "service_count": 0}
            by_therapist[fs2_name]["total_tip"] += fs2_tip
        for bonus_item in bonus_pays:
            therapist_name, bonus_amount, suffix = bonus_item[0], bonus_item[1], bonus_item[2]
            if therapist_name:
                if therapist_name not in by_therapist:
                    by_therapist[therapist_name] = {"services": [], "total_tip": 0.0, "total_pay": 0.0, "service_count": 0}
                by_therapist[therapist_name]["services"].append({"service": service + suffix, "duration_min": dur, "pay": bonus_amount})
                by_therapist[therapist_name]["total_pay"] += bonus_amount

    therapists_list = [
        {
            "name": name,
            "service_count": data["service_count"],
            "services": data["services"],
            "total_pay": round(data["total_pay"], 2),
            "total_tip": round(data["total_tip"], 2),
        }
        for name, data in sorted(by_therapist.items())
    ]
    day_total_pay = sum(t["total_pay"] for t in therapists_list)
    day_total_tip = sum(t["total_tip"] for t in therapists_list)
    return therapists_list, day_total_pay, day_total_tip


def _customer_short_name(full_name: Optional[str]) -> str:
    """First name + last initial, e.g. 'John Smith' -> 'John S.'"""
    if not full_name or not isinstance(full_name, str):
        return full_name or ""
    parts = full_name.strip().split()
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return parts[0] + " " + (parts[-1][0:1].upper()) + "."


def _is_appointment_future(start_at: str) -> bool:
    """True if appointment start time (CST) is after now (CST)."""
    if not start_at:
        return False
    try:
        dt = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
        cst = dateutil_tz.gettz("America/Chicago")
        if dt.tzinfo:
            dt = dt.astimezone(cst)
        now = datetime.now(cst)
        return dt > now
    except Exception:
        return False


def _format_time_frame(start_at: str, end_at: str) -> str:
    """Format as '11:30 am - 12:30 pm' in CST (Central Time)."""
    try:
        start = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
        cst = dateutil_tz.gettz("America/Chicago")
        if start.tzinfo:
            start = start.astimezone(cst)
        if end.tzinfo:
            end = end.astimezone(cst)
        # e.g. "11:30 am", "12:30 pm" (lowercase am/pm, no leading zero on hour)
        def fmt(dt):
            s = dt.strftime("%I:%M %p")
            if s.startswith("0") and len(s) > 7:  # "09:30 AM" -> "9:30 am"
                s = s[1:]
            return s.replace(" AM", " am").replace(" PM", " pm")
        return fmt(start) + " - " + fmt(end)
    except Exception:
        return (start_at or "") + " - " + (end_at or "")


def _build_day_grid(date: str, db: Session, current_service, pay_rates: Dict[str, float]) -> List[Dict]:
    """
    Build grid data for daily sheet: list of { name, appointments } for up to 9 therapists (3x3).
    Each appointment: appt_num, customer (short), service, room, time_frame, pay, tip.
    Uses same pay/tip logic as _build_one_day_report. Excludes cancelled/no-show.
    """
    bookings = current_service.get_bookings_for_date(date) if current_service.client else mock_square.get_bookings_for_date(date)
    bookings = _without_square_test_profile_bookings(bookings)
    bookings = [b for b in bookings if is_allowed_therapist(b.get("therapist", ""))]
    overrides = {o.booking_id: o for o in db.query(BookingOverride).filter(BookingOverride.date == date).all()}
    bookings = [b for b in bookings if not (overrides.get(b["id"]) and getattr(overrides[b["id"]], "cancelled_or_noshow", False))]
    bookings_for_assignment = [_booking_dict_for_assignment(b, overrides) for b in bookings]
    assigner = RoomAssigner(db)
    assigned = assigner.assign_rooms(
        bookings_for_assignment, date, overrides_by_booking=overrides
    )

    def therapists_for_booking(b):
        return _report_primary_second_therapists(b, overrides)

    def tips_for_booking(b):
        ov = overrides.get(b["booking_id"])
        if not ov or ov.tip_amount is None:
            return 0.0, 0.0, None, 0.0, None, 0.0
        total = float(ov.tip_amount)
        if getattr(ov, "tip_split_evenly", False):
            half = total / 2.0
            return half, half, None, 0.0, None, 0.0
        tip2_val = float(ov.tip_amount_2) if getattr(ov, "tip_amount_2", None) is not None else 0.0
        is_couple = (b.get("type") or "").lower() == "couple"
        service = (b.get("service") or "").lower()
        is_luxury = "luxury" in service or "luxury package" in service
        if is_couple and is_luxury:
            primary, second = therapists_for_booking(b)
            sep_fs = _luxury_separate_fs_active(ov)
            fs1 = (getattr(ov, "luxury_mini_facial_therapist", None) or "").strip()
            fs2 = (getattr(ov, "luxury_mini_facial_therapist_2", None) or "").strip()
            one_total_tip = getattr(ov, "tip_amount_2", None) is None or (tip2_val or 0) == 0
            if one_total_tip:
                half = round(total / 2.0, 2)
                if sep_fs and fs1 and fs1 != primary:
                    m1, fs1_tip = round(half * 90 / 120, 2), round(half * 30 / 120, 2)
                else:
                    m1, fs1_tip = half, 0.0
                    fs1 = None
                if sep_fs and fs2 and fs2 != second:
                    m2, fs2_tip = round(half * 90 / 120, 2), round(half * 30 / 120, 2)
                else:
                    m2, fs2_tip = half, 0.0
                    fs2 = None
                return (m1, m2, fs1, fs1_tip, fs2, fs2_tip)
            if sep_fs and fs1 and fs1 != primary:
                m1, fs1_tip = round(total * 90 / 120, 2), round(total * 30 / 120, 2)
            else:
                m1, fs1_tip = total, 0.0
                fs1 = None
            if sep_fs and fs2 and fs2 != second:
                m2, fs2_tip = round(tip2_val * 90 / 120, 2), round(tip2_val * 30 / 120, 2)
            else:
                m2, fs2_tip = tip2_val, 0.0
                fs2 = None
            return (m1, m2, fs1, fs1_tip, fs2, fs2_tip)
        if is_couple:
            return total, tip2_val, None, 0.0, None, 0.0
        facial_spec = (getattr(ov, "facial_specialist", None) or "").strip() if ov else ""
        if facial_spec and tip2_val:
            return total, 0.0, facial_spec, tip2_val, None, 0.0
        if not facial_spec and _luxury_separate_fs_active(ov) and (getattr(ov, "luxury_mini_facial_therapist", None) or "").strip():
            lux_spec = (ov.luxury_mini_facial_therapist or "").strip()
            if lux_spec and tip2_val:
                return total, 0.0, lux_spec, tip2_val, None, 0.0
        return total, tip2_val, None, 0.0, None, 0.0

    def pay_for_service(service_name: str, duration_min: int, is_couple: bool, booking_id: str, start_at: str = "", end_at: str = "") -> tuple:
        if _is_addon_for_count(service_name):
            return 0.0, None, []
        service_lower = (service_name or "").lower()
        ov = overrides.get(booking_id)
        if "luxury" in service_lower or "luxury package" in service_lower:
            main_pay = 80.0 if (ov and getattr(ov, "luxury_mini_facial_done", None)) else 60.0
            bonus_list = []
            if ov and getattr(ov, "luxury_mini_facial_done", None):
                t1 = (getattr(ov, "luxury_mini_facial_therapist", None) or "").strip()
                if t1 and _luxury_separate_fs_active(ov):
                    bonus_list.append((t1, 20.0, " (mini facial)"))
                if is_couple:
                    t2 = (getattr(ov, "luxury_mini_facial_therapist_2", None) or "").strip()
                    if t2 and _luxury_separate_fs_active(ov):
                        bonus_list.append((t2, 20.0, " (mini facial 2)"))
            return (main_pay, main_pay if is_couple else None, bonus_list)
        if not is_couple and _is_facial_with_massage(service_name, "single", start_at, end_at):
            full_pay = _compute_masseuse_pay(service_name, duration_min) or next((amt for k, amt in sorted(pay_rates.items(), key=lambda x: -len(x[0])) if k in service_lower), 0.0)
            facial_spec = (getattr(ov, "facial_specialist", None) or "").strip() if ov else ""
            if facial_spec:
                return (round(full_pay / 2.0, 2), None, [(facial_spec, round(full_pay / 2.0, 2), " (facial)")])
            return (full_pay, None, [])
        pay = _compute_masseuse_pay(service_name, duration_min) or next((amt for k, amt in sorted(pay_rates.items(), key=lambda x: -len(x[0])) if k in service_lower), 0.0)
        if (
            not is_couple
            and ov
            and getattr(ov, "split_minutes_first", None) is not None
            and getattr(ov, "therapist_locked_2", False)
            and (getattr(ov, "therapist_override_2", None) or "").strip()
        ):
            sm = max(0, min(int(ov.split_minutes_first), duration_min))
            min2 = max(0, duration_min - sm)
            if duration_min > 0:
                p1 = round(pay * sm / duration_min, 2)
                p2 = round(pay * min2 / duration_min, 2)
                return (p1, p2, [])
        return (pay, pay if is_couple else None, [])

    by_therapist: Dict[str, List[Dict]] = {}
    for b in assigned:
        bid = b.get("booking_id", "")
        primary, second = therapists_for_booking(b)
        service = b.get("service") or ""
        dur = _duration_minutes(b.get("start_at", ""), b.get("end_at", ""))
        if _is_addon_for_count(service) or dur < MIN_SERVICE_MINUTES_FOR_COUNT:
            continue
        is_couple = (b.get("type") or "").lower() == "couple"
        primary_pay, second_pay, bonus_pays = pay_for_service(
            service, dur, is_couple, bid, b.get("start_at", ""), b.get("square_end_at") or b.get("end_at", "")
        )
        tip1, tip2, fs1_name, fs1_tip, fs2_name, fs2_tip = tips_for_booking(b)
        room = b.get("room") or "—"
        time_frame = _format_time_frame(b.get("start_at", ""), b.get("end_at", ""))
        customer = _customer_short_name(b.get("customer"))
        is_future = _is_appointment_future(b.get("start_at", ""))

        def add_row(th_name: str, pay_amt: float, tip_amt: float, svc: str):
            if not th_name:
                return
            if th_name not in by_therapist:
                by_therapist[th_name] = []
            by_therapist[th_name].append({
                "start_at": b.get("start_at", ""),
                "customer": customer,
                "service": svc,
                "room": room,
                "time_frame": time_frame,
                "pay": round(pay_amt, 2),
                "tip": round(tip_amt, 2),
                "is_future": is_future,
            })

        if primary:
            add_row(primary, primary_pay, tip1, service)
        if second and second_pay is not None:
            add_row(second, second_pay, tip2, service)
        for bonus_item in bonus_pays:
            bonus_name = bonus_item[0] if isinstance(bonus_item, (list, tuple)) else bonus_item[0]
            bonus_amt = bonus_item[1] if isinstance(bonus_item, (list, tuple)) else bonus_item[1]
            suffix = (bonus_item[2] if len(bonus_item) > 2 else " (bonus)") if isinstance(bonus_item, (list, tuple)) else " (bonus)"
            if bonus_name:
                add_row(bonus_name, bonus_amt, 0.0, service + suffix)
        if fs1_name and fs1_tip:
            add_row(fs1_name, 0.0, fs1_tip, service + " (FS)")
        if fs2_name and fs2_tip:
            add_row(fs2_name, 0.0, fs2_tip, service + " (FS)")

    order_rows = db.query(TherapistDayOrder).filter(TherapistDayOrder.date == date).order_by(TherapistDayOrder.order_number).all()
    order_map = {r.therapist_name: r.order_number for r in order_rows}
    seen = set()
    ordered_names = []
    for r in order_rows:
        if r.therapist_name not in seen:
            seen.add(r.therapist_name)
            ordered_names.append(r.therapist_name)
    for name in by_therapist:
        if name not in seen:
            seen.add(name)
            ordered_names.append(name)
    sorted_therapists = ordered_names[:9]
    result = []
    for name in sorted_therapists[:9]:
        rows = sorted(by_therapist.get(name, []), key=lambda r: r["start_at"])
        for i, row in enumerate(rows, 1):
            row["appt_num"] = i
            del row["start_at"]
        result.append({"name": name, "appointments": rows})
    while len(result) < 9:
        result.append({"name": "", "appointments": []})
    return result


@app.get("/api/day/grid")
async def get_day_grid(
    date: str = Query(..., description="Date YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    """Daily grid sheet by masseuse (3x3). Each therapist has list of appointments with #, customer, service, room, time, pay, tip."""
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date. Use YYYY-MM-DD")
    current_service = get_square_service()
    pay_rates = {r.service_key.lower(): float(r.pay_amount) for r in db.query(ServicePayRate).all()}
    therapists = _build_day_grid(date, db, current_service, pay_rates)
    return {"date": date, "therapists": therapists}


# ---------- Services / Pay setup (for provider pay per service) ----------


def _best_calendar_name_for_service_key(service_key: str, catalog_lines: List[Dict[str, str]]) -> Optional[str]:
    """
    Pick the longest catalog name that contains the pay key (case-insensitive).
    Aligns with pay matching that uses substring containment (longest key wins in reports).
    """
    if not service_key or not catalog_lines:
        return None
    k = service_key.strip().lower()
    if not k:
        return None
    best: Optional[str] = None
    best_len = -1
    for row in catalog_lines:
        name = (row.get("name") or "").strip()
        if not name or k not in name.lower():
            continue
        if len(name) > best_len:
            best_len = len(name)
            best = name
    return best


def _service_pay_rows_sorted(db: Session):
    """Rows ordered by subcategory (blank last), then optional parent, then service_key."""
    rows = db.query(ServicePayRate).all()

    def sort_key(r):
        sub = (getattr(r, "service_subcategory", None) or "").strip().lower()
        p = (getattr(r, "parent_service", None) or "").strip().lower()
        sk = (r.service_key or "").lower()
        return (sub if sub else "\uffff", p if p else "\uffff", sk)

    rows.sort(key=sort_key)
    return rows


@app.get("/api/services", response_model=ServicesListResponse)
async def get_services(db: Session = Depends(get_db)):
    """List all services with price, provider pay, and which providers can do the service."""
    rows = _service_pay_rows_sorted(db)
    catalog_lines: List[Dict[str, str]] = []
    try:
        sq = get_square_service()
        if sq:
            catalog_lines = sq.list_calendar_catalog_lines()
    except Exception as e:
        logger.warning("Service pay page: could not load Square catalog lines: %s", e)
    services = [
        ServiceRow(
            id=r.id,
            service_key=r.service_key,
            parent_service=getattr(r, "parent_service", None) or None,
            service_subcategory=getattr(r, "service_subcategory", None) or None,
            calendar_display_name=_best_calendar_name_for_service_key(r.service_key, catalog_lines),
            service_price=float(r.service_price) if r.service_price is not None else None,
            pay_amount=float(r.pay_amount),
            provider_names=getattr(r, "provider_names", None) or None,
        )
        for r in rows
    ]
    therapists = list(ALLOWED_THERAPISTS)
    return ServicesListResponse(services=services, therapists=therapists)


@app.put("/api/services")
async def update_services(updates: List[UpdateServiceRequest], db: Session = Depends(get_db)):
    """Update one or more service rows (by id or service_key)."""
    for u in updates:
        if u.id is not None:
            r = db.query(ServicePayRate).filter(ServicePayRate.id == u.id).first()
        elif u.service_key:
            r = db.query(ServicePayRate).filter(ServicePayRate.service_key == u.service_key).first()
        else:
            continue
        if not r:
            if u.service_key and u.pay_amount is not None:
                r = ServicePayRate(service_key=u.service_key, pay_amount=u.pay_amount)
                db.add(r)
            else:
                continue
        if u.service_price is not None:
            r.service_price = u.service_price
        if u.pay_amount is not None:
            r.pay_amount = u.pay_amount
        if u.provider_names is not None:
            setattr(r, "provider_names", u.provider_names)
        if u.parent_service is not None:
            ps = (u.parent_service or "").strip()
            setattr(r, "parent_service", ps if ps else None)
        if u.service_subcategory is not None:
            sc = (u.service_subcategory or "").strip()
            setattr(r, "service_subcategory", sc if sc else None)
    db.commit()
    return {"success": True, "updated": len(updates)}


@app.get("/api/services/export")
async def export_services_csv(db: Session = Depends(get_db)):
    """Export services table as CSV for filling in provider pay and providers."""
    rows = _service_pay_rows_sorted(db)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        ["service_subcategory", "parent_service", "service_key", "service_price", "pay_amount", "provider_names"]
    )
    for r in rows:
        w.writerow([
            getattr(r, "service_subcategory", None) or "",
            getattr(r, "parent_service", None) or "",
            r.service_key,
            r.service_price if r.service_price is not None else "",
            r.pay_amount,
            getattr(r, "provider_names", None) or "",
        ])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=services_pay_rates.csv"},
    )


@app.post("/api/services/import")
async def import_services_csv(file: UploadFile = None, db: Session = Depends(get_db)):
    """Import CSV to update service pay rates. CSV columns: service_key, pay_amount; optional service_subcategory, parent_service, service_price, provider_names."""
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    try:
        content = await file.read()
        text = content.decode("utf-8-sig").strip()
        buf = io.StringIO(text)
        r = csv.DictReader(buf)
        if not r.fieldnames or "service_key" not in r.fieldnames or "pay_amount" not in r.fieldnames:
            raise HTTPException(status_code=400, detail="CSV must have columns: service_key, pay_amount (and optionally service_price, provider_names)")
        count = 0
        for row in r:
            sk = (row.get("service_key") or "").strip()
            if not sk:
                continue
            pay_val = row.get("pay_amount", "").strip()
            try:
                pay_amount = float(pay_val) if pay_val else None
            except ValueError:
                continue
            if pay_amount is None:
                continue
            rec = db.query(ServicePayRate).filter(ServicePayRate.service_key == sk).first()
            if not rec:
                rec = ServicePayRate(service_key=sk, pay_amount=pay_amount)
                db.add(rec)
                count += 1
            else:
                rec.pay_amount = pay_amount
                count += 1
            price_val = row.get("service_price", "").strip()
            if price_val:
                try:
                    rec.service_price = float(price_val)
                except ValueError:
                    pass
            prov = (row.get("provider_names") or "").strip()
            if prov is not None:
                setattr(rec, "provider_names", prov if prov else None)
            fnames = [f.strip() for f in (r.fieldnames or []) if f]
            if "parent_service" in fnames:
                parent = (row.get("parent_service") or "").strip()
                setattr(rec, "parent_service", parent if parent else None)
            if "service_subcategory" in fnames:
                sub = (row.get("service_subcategory") or "").strip()
                setattr(rec, "service_subcategory", sub if sub else None)
        db.commit()
        return {"success": True, "imported": count}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {e}")


def _customer_hours_yesterday_iso() -> str:
    """Local calendar yesterday (YYYY-MM-DD). Days before this use DB snapshots when Square is configured."""
    return (datetime.now(dateutil_tz.tzlocal()).date() - timedelta(days=1)).strftime("%Y-%m-%d")


def _customer_hours_contiguous_segments(dates: List[str], need_fetch: List[bool]) -> List[tuple[str, str]]:
    """dates and need_fetch same length; return [(start, end), ...] inclusive YYYY-MM-DD for each run where need_fetch is True."""
    segs: List[tuple[str, str]] = []
    n = len(dates)
    i = 0
    while i < n:
        while i < n and not need_fetch[i]:
            i += 1
        if i >= n:
            break
        j = i
        while j < n and need_fetch[j]:
            j += 1
        segs.append((dates[i], dates[j - 1]))
        i = j
    return segs


def _fetch_bookings_by_date_for_customer_hours_report(
    current_service: SquareService,
    seg_start: str,
    seg_end: str,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Load Square bookings for [seg_start, seg_end] bucketed by local day.

    Uses merged_list=False (two-pass location merge only) to avoid dozens of
    list calls on wide ranges, and chunks by ~28 days so a single List Bookings
    window is never huge (avoids empty results / failures on refresh).
    """
    out: Dict[str, List[Dict[str, Any]]] = {}
    d0 = datetime.strptime(seg_start, "%Y-%m-%d")
    d1 = datetime.strptime(seg_end, "%Y-%m-%d")
    chunk_days = 28
    walk = d0
    while walk <= d1:
        chunk_end = min(walk + timedelta(days=chunk_days - 1), d1)
        cs = walk.strftime("%Y-%m-%d")
        ce = chunk_end.strftime("%Y-%m-%d")
        part = current_service.get_bookings_by_local_date_range(
            cs,
            ce,
            merged_list=False,
            enrich_bookings=False,
        )
        for ds, lst in (part or {}).items():
            if not lst:
                continue
            bucket = out.setdefault(ds, [])
            seen = {str(b.get("id") or "") for b in bucket if b.get("id")}
            for b in lst:
                bid = b.get("id")
                sk = str(bid) if bid else ""
                if sk and sk in seen:
                    continue
                if sk:
                    seen.add(sk)
                bucket.append(b)
        walk = chunk_end + timedelta(days=1)

    n_bookings = sum(len(v) for v in out.values())
    logger.info(
        "Customer-hours Square fetch %s..%s: %d booking(s) across %d local days (chunked, two-pass)",
        seg_start,
        seg_end,
        n_bookings,
        len(out),
    )
    span_days = (d1 - d0).days + 1
    if span_days > 3 and n_bookings == 0:
        logger.warning(
            "Customer-hours: zero bookings from Square for %d-day span %s..%s — "
            "check SQUARE_ENVIRONMENT vs merchant, SQUARE_LOCATION_ID, token, and prior ERROR logs.",
            span_days,
            seg_start,
            seg_end,
        )
    return out


def _upsert_customer_hours_snapshot(db: Session, date_str: str, stats: Dict[str, Any]) -> None:
    row = (
        db.query(CustomerHoursDailySnapshot)
        .filter(CustomerHoursDailySnapshot.date == date_str)
        .first()
    )
    if row:
        row.customer_count = int(stats["customer_count"])
        row.appointment_count = int(stats["appointment_count"])
        row.total_minutes = int(stats["total_minutes"])
        row.booked_online_count = int(stats.get("booked_online_count") or 0)
        row.booked_by_us_count = int(stats.get("booked_by_us_count") or 0)
        row.schema_version = CUSTOMERS_HOURS_SNAPSHOT_SCHEMA_VERSION
    else:
        db.add(
            CustomerHoursDailySnapshot(
                date=date_str,
                customer_count=int(stats["customer_count"]),
                appointment_count=int(stats["appointment_count"]),
                total_minutes=int(stats["total_minutes"]),
                booked_online_count=int(stats.get("booked_online_count") or 0),
                booked_by_us_count=int(stats.get("booked_by_us_count") or 0),
                schema_version=CUSTOMERS_HOURS_SNAPSHOT_SCHEMA_VERSION,
            )
        )


def _booking_included_in_customer_hours_stats(b: Dict[str, Any]) -> bool:
    """Same visibility as main calendar booking_should_show (count all real appointments, not only allowed-name matches)."""
    if customer_display_excluded_from_calendar_and_counts(b.get("customer")):
        return False
    t = b.get("therapist")
    if t is None or (isinstance(t, str) and not t.strip()):
        return True
    t = t if isinstance(t, str) else str(t)
    if normalize_therapist_name(t) == "amy r":
        return False
    return True


def _customer_hours_stats_from_bookings(
    date: str,
    bookings: List[Dict[str, Any]],
    overrides_by_booking: Dict[str, BookingOverride],
) -> Dict[str, Any]:
    """Customer headcount (2 per couple, 1 per single) and total booked minutes; excludes cancelled/no-show."""
    bookings = [b for b in bookings if _booking_included_in_customer_hours_stats(b)]
    bookings = [
        b for b in bookings
        if not (
            (bid := b.get("id"))
            and overrides_by_booking.get(bid)
            and getattr(overrides_by_booking[bid], "cancelled_or_noshow", False)
        )
    ]
    bookings = [b for b in bookings if str(b.get("status") or "").strip().upper() != "NO_SHOW"]

    customer_headcount = 0
    total_minutes = 0
    booked_online_count = 0
    booked_by_us_count = 0
    for b in bookings:
        is_couple = (b.get("type") or "").strip().lower() == "couple"
        customer_headcount += 2 if is_couple else 1
        bb = (b.get("booked_by") or "").strip().lower()
        if bb == "customer":
            booked_online_count += 1
        elif bb == "us":
            booked_by_us_count += 1
        bd = _booking_dict_for_assignment(b, overrides_by_booking)
        try:
            s = dateutil_parser.parse(bd["start_at"])
            e = dateutil_parser.parse(bd["end_at"])
            total_minutes += max(0, int(round((e - s).total_seconds() / 60)))
        except Exception:
            pass

    return {
        "date": date,
        "customer_count": customer_headcount,
        "appointment_count": len(bookings),
        "total_minutes": total_minutes,
        "booked_online_count": booked_online_count,
        "booked_by_us_count": booked_by_us_count,
    }


@app.get("/api/reports/customers-hours")
async def get_customers_hours_report(
    start_date: str = Query(..., description="Start date YYYY-MM-DD (inclusive)"),
    end_date: str = Query(..., description="End date YYYY-MM-DD (inclusive)"),
    refresh_from_api: bool = Query(
        False,
        description="If true, re-fetch Square for all days before yesterday and overwrite stored snapshots",
    ),
    db: Session = Depends(get_db),
):
    """
    Per-day customer headcount (couple appointments count as 2) and total appointment duration (minutes).
    Range capped at 800 days (~2+ years). Days strictly before local **yesterday** use SQLite snapshots (no Square) once
    populated; yesterday, today, and future are loaded from Square in **one request per contiguous block** (not
    one HTTP round-trip per day). Use refresh_from_api=true to rebuild past snapshots.
    """
    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date. Use YYYY-MM-DD")
    if end_dt < start_dt:
        raise HTTPException(status_code=400, detail="end_date must be >= start_date")
    max_days = 800  # ~2+ calendar years for customers-hours calendar / list
    if (end_dt - start_dt).days + 1 > max_days:
        raise HTTPException(
            status_code=400,
            detail=f"Date range too large (max {max_days} days)",
        )
    current_service = get_square_service()
    yesterday_iso = _customer_hours_yesterday_iso()

    override_rows = (
        db.query(BookingOverride)
        .filter(BookingOverride.date >= start_date, BookingOverride.date <= end_date)
        .all()
    )
    overrides_by_date: Dict[str, Dict[str, BookingOverride]] = {}
    for o in override_rows:
        overrides_by_date.setdefault(o.date, {})[o.booking_id] = o

    cached_by_date: Dict[str, CustomerHoursDailySnapshot] = {}
    if current_service.client and not refresh_from_api:
        cached_by_date = {
            row.date: row
            for row in db.query(CustomerHoursDailySnapshot)
            .filter(
                CustomerHoursDailySnapshot.date >= start_date,
                CustomerHoursDailySnapshot.date <= end_date,
                CustomerHoursDailySnapshot.date < yesterday_iso,
                CustomerHoursDailySnapshot.schema_version == CUSTOMERS_HOURS_SNAPSHOT_SCHEMA_VERSION,
            )
            .all()
        }

    all_dates: List[str] = []
    cur = start_dt
    while cur <= end_dt:
        all_dates.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)

    need_fetch: List[bool] = []
    for date_str in all_dates:
        use_snapshot = (
            current_service.client
            and not refresh_from_api
            and date_str < yesterday_iso
            and date_str in cached_by_date
        )
        need_fetch.append(not use_snapshot)

    bookings_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for seg_start, seg_end in _customer_hours_contiguous_segments(all_dates, need_fetch):
        if current_service.client:
            seg_map = _fetch_bookings_by_date_for_customer_hours_report(
                current_service, seg_start, seg_end
            )
        else:
            seg_map = mock_square.get_bookings_by_local_date_range(seg_start, seg_end)
        d0 = datetime.strptime(seg_start, "%Y-%m-%d")
        d1 = datetime.strptime(seg_end, "%Y-%m-%d")
        walk = d0
        while walk <= d1:
            ds = walk.strftime("%Y-%m-%d")
            bookings_by_date[ds] = seg_map.get(ds, [])
            walk += timedelta(days=1)

    days_out: List[Dict[str, Any]] = []
    snapshots_dirty = False
    for date_str in all_dates:
        day_overrides = overrides_by_date.get(date_str, {})

        use_snapshot = (
            current_service.client
            and not refresh_from_api
            and date_str < yesterday_iso
            and date_str in cached_by_date
        )
        if use_snapshot:
            snap = cached_by_date[date_str]
            days_out.append(
                {
                    "date": date_str,
                    "customer_count": snap.customer_count,
                    "appointment_count": snap.appointment_count,
                    "total_minutes": snap.total_minutes,
                    "booked_online_count": int(getattr(snap, "booked_online_count", 0) or 0),
                    "booked_by_us_count": int(getattr(snap, "booked_by_us_count", 0) or 0),
                    "from_cache": True,
                }
            )
            continue

        day_bookings = bookings_by_date.get(date_str, [])
        stats = _customer_hours_stats_from_bookings(date_str, day_bookings, day_overrides)
        stats["from_cache"] = False
        days_out.append(stats)

        if current_service.client and date_str < yesterday_iso:
            raw_n = len(day_bookings or [])
            z = (
                (stats.get("customer_count") or 0) == 0
                and (stats.get("appointment_count") or 0) == 0
                and (stats.get("total_minutes") or 0) == 0
                and (stats.get("booked_online_count") or 0) == 0
                and (stats.get("booked_by_us_count") or 0) == 0
            )
            if raw_n > 0 and z:
                logger.warning(
                    "Skipping customer-hours snapshot for %s: %d raw bookings produced all-zero stats (not saving; avoids blank-cache bug)",
                    date_str,
                    raw_n,
                )
            else:
                _upsert_customer_hours_snapshot(db, date_str, stats)
                snapshots_dirty = True

    if snapshots_dirty:
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise

    return {
        "start_date": start_date,
        "end_date": end_date,
        "days": days_out,
        "snapshot_schema_version": CUSTOMERS_HOURS_SNAPSHOT_SCHEMA_VERSION,
        "cache_before": yesterday_iso,
    }


@app.get("/api/reports/daily-summary")
async def get_daily_summary(
    date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD for multi-day"),
    db: Session = Depends(get_db),
):
    """Daily or multi-day report: services and tips per therapist. Add-ons excluded; services >= 30 min only."""
    try:
        start_dt = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date. Use YYYY-MM-DD")
    end_dt = None
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date. Use YYYY-MM-DD")
        if end_dt < start_dt:
            raise HTTPException(status_code=400, detail="end_date must be >= date")

    current_service = get_square_service()
    pay_rates = {r.service_key.lower(): float(r.pay_amount) for r in db.query(ServicePayRate).all()}

    if end_dt is None:
        therapists_list, day_total_pay, day_total_tip = _build_one_day_report(date, db, current_service, pay_rates)
        return {
            "start_date": date,
            "end_date": date,
            "days": [{
                "date": date,
                "therapists": therapists_list,
                "day_total_pay": day_total_pay,
                "day_total_tip": day_total_tip,
            }],
        }

    days_result = []
    cur = start_dt
    while cur <= end_dt:
        date_str = cur.strftime("%Y-%m-%d")
        therapists_list, day_total_pay, day_total_tip = _build_one_day_report(date_str, db, current_service, pay_rates)
        days_result.append({
            "date": date_str,
            "therapists": therapists_list,
            "day_total_pay": day_total_pay,
            "day_total_tip": day_total_tip,
        })
        cur += timedelta(days=1)

    return {
        "start_date": date,
        "end_date": end_date,
        "days": days_result,
    }


def _parse_voice_utterance(utterance: str) -> dict:
    """Extract time, duration, service from a phrase like 'book me an appointment tonight for 1 hour deep tissue at 8pm'.
    Returns dict with date_str, time_str, duration_minutes, service_name (or None if not found).
    """
    import re
    u = (utterance or "").lower().strip()
    out = {"date_str": None, "time_str": None, "duration_minutes": 60, "service_name": None}

    # Time: "at 8pm", "at 8 pm", "at 3:30", "8pm", "8 am"
    time_m = re.search(r"\b(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", u, re.I)
    if time_m:
        h, m = int(time_m.group(2)), int(time_m.group(3) or 0)
        if time_m.group(4):
            if time_m.group(4).lower() == "pm" and h != 12:
                h += 12
            elif time_m.group(4).lower() == "am" and h == 12:
                h = 0
        out["time_str"] = f"{h:02d}:{m:02d}"

    # Duration: "1 hour", "90 min", "1.5 hours", "60 minutes"
    if re.search(r"1\s*hour|60\s*min", u):
        out["duration_minutes"] = 60
    elif re.search(r"90\s*min|1\.5\s*hour|1\s*and\s*1\s*half", u):
        out["duration_minutes"] = 90
    elif re.search(r"2\s*hour|120\s*min", u):
        out["duration_minutes"] = 120
    elif re.search(r"30\s*min|half\s*hour", u):
        out["duration_minutes"] = 30

    # Date: "tonight", "today", "tomorrow"
    today = date_type.today()
    if "tonight" in u or "today" in u:
        out["date_str"] = today.isoformat()
    elif "tomorrow" in u:
        out["date_str"] = (today + timedelta(days=1)).isoformat()

    # Service: "deep tissue", "couples", "swedish", "relax", etc.
    if "deep tissue" in u:
        out["service_name"] = "Deep Tissue Massage"
    elif "couples" in u or "couple" in u:
        out["service_name"] = "Couples Massage"
    elif "swedish" in u:
        out["service_name"] = "Swedish Massage"
    elif "prenatal" in u:
        out["service_name"] = "Prenatal Massage"
    elif "trigger" in u:
        out["service_name"] = "Trigger Point Therapy"
    else:
        out["service_name"] = "Massage"  # fallback

    return out


@app.post("/api/voice-book", response_model=VoiceBookResponse)
async def voice_book(request: VoiceBookRequest):
    """
    Parse a voice utterance (e.g. 'book me an appointment tonight for 1 hour deep tissue at 8pm'),
    search Square availability, create a booking in Square, and return a message to speak back.
    Payment is NOT charged here; Square Bookings API creates the appointment only. Payment is
    collected when the customer pays at the spa or via a separate payment flow.
    """
    utterance = (request.utterance or "").strip()
    if not utterance:
        return VoiceBookResponse(success=False, message="I didn't hear anything. Please try again.")

    parsed = _parse_voice_utterance(utterance)
    date_str = parsed["date_str"]
    time_str = parsed["time_str"]
    duration = parsed["duration_minutes"]
    service_name = parsed["service_name"] or "massage"

    current_service = get_square_service()
    if not current_service or not getattr(current_service, "client", None) or not current_service.client:
        message = (
            f"We understood: {duration} minute {service_name}. "
            "Square is not connected right now. Please book online or call the spa."
        )
        return VoiceBookResponse(success=False, message=message)

    variation_id, variation_version = current_service.resolve_voice_service(service_name, duration)
    if not variation_id:
        message = (
            f"We couldn't find a matching service for '{service_name}' ({duration} min) in Square. "
            "Please book online or call the spa."
        )
        return VoiceBookResponse(success=False, message=message)

    if not date_str or not time_str:
        message = (
            "Please say a date and time, for example: tonight at 8pm, or tomorrow at 10am."
        )
        return VoiceBookResponse(success=False, message=message)

    try:
        local_tz = dateutil_tz.tzlocal()
        start_local = datetime.strptime(
            f"{date_str} {time_str}", "%Y-%m-%d %H:%M"
        ).replace(tzinfo=local_tz)
        start_at = start_local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        range_start = start_local.replace(hour=0, minute=0, second=0, microsecond=0)
        range_end = range_start + timedelta(days=1)
        start_at_begin = range_start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        start_at_end = range_end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception as e:
        logging.getLogger(__name__).warning(f"voice_book parse datetime: {e}")
        message = "Could not understand the date or time. Try: tonight at 8pm."
        return VoiceBookResponse(success=False, message=message)

    availabilities = current_service.client.search_availability(
        start_at_begin=start_at_begin,
        start_at_end=start_at_end,
        service_variation_id=variation_id,
    )
    if not availabilities:
        message = (
            f"Sorry, there are no available slots for {service_name} on that date. "
            "Please try another day or book online."
        )
        return VoiceBookResponse(success=False, message=message)

    def slot_start(slot):
        return (slot.get("start_at") or "") if isinstance(slot, dict) else (getattr(slot, "start_at", None) or "")

    chosen_start = None
    for av in availabilities:
        if slot_start(av) == start_at:
            chosen_start = start_at
            break
    if chosen_start is None and availabilities:
        chosen_start = slot_start(availabilities[0])

    if not chosen_start:
        message = "No matching slot found. Please try another time."
        return VoiceBookResponse(success=False, message=message)

    booking = current_service.client.create_appointment_booking(
        start_at=chosen_start,
        service_variation_id=variation_id,
        service_variation_version=variation_version,
        duration_minutes=duration,
        any_team_member=True,
        customer_id=None,
        customer_note="Voice booking",
    )
    if not booking:
        message = (
            "The slot was available but we couldn't create the booking. Please try again or call the spa."
        )
        return VoiceBookResponse(success=False, message=message)

    booking_id = booking.get("id") if isinstance(booking, dict) else getattr(booking, "id", None)
    try:
        chosen_dt = datetime.fromisoformat(chosen_start.replace("Z", "+00:00")).astimezone(local_tz)
        when_text = chosen_dt.strftime("%A %B %d at %I:%M %p").lstrip("0").replace(" 0", " ")
    except Exception:
        when_text = f"{date_str} at {time_str}"

    message = (
        f"Your appointment is booked. {duration} minute {service_name}, {when_text}. "
        "Payment is not charged now; you will pay when you come in. See you then."
    )
    return VoiceBookResponse(success=True, message=message, booking_id=booking_id)


_MAX_CALENDAR_SCREENSHOT_BYTES = 12 * 1024 * 1024


def _calendar_screenshots_dir() -> str:
    d = os.path.join(os.path.dirname(os.path.dirname(__file__)), "calendar_screenshots")
    os.makedirs(d, exist_ok=True)
    return d


@app.post("/api/calendar-screenshots")
async def upload_calendar_screenshot(
    calendar_date: str = Form(...),
    captured_at_iso: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Save a PNG/JPEG of the calendar grid for a spa calendar date."""
    date = (calendar_date or "").strip()
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid calendar_date (use YYYY-MM-DD)")
    cap = (captured_at_iso or "").strip() or datetime.now(timezone.utc).isoformat()
    ct = (file.content_type or "").lower()
    if ct not in ("image/png", "image/jpeg", "image/jpg"):
        raise HTTPException(status_code=400, detail="File must be image/png or image/jpeg")
    raw = await file.read()
    if len(raw) > _MAX_CALENDAR_SCREENSHOT_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 12MB)")
    ext = ".png" if "png" in ct else ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(_calendar_screenshots_dir(), fname)
    with open(path, "wb") as out:
        out.write(raw)
    row = CalendarScreenshot(calendar_date=date, captured_at=cap, filename=fname)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "calendar_date": row.calendar_date,
        "captured_at": row.captured_at,
        "image_url": f"/api/calendar-screenshots/{row.id}/image",
    }


@app.get("/api/calendar-screenshots")
async def list_calendar_screenshots(
    limit: int = Query(100, ge=1, le=300),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    rows = (
        db.query(CalendarScreenshot)
        .order_by(CalendarScreenshot.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "calendar_date": r.calendar_date,
            "captured_at": r.captured_at,
            "image_url": f"/api/calendar-screenshots/{r.id}/image",
        }
        for r in rows
    ]


@app.get("/api/calendar-screenshots/{screenshot_id:int}/image")
async def get_calendar_screenshot_image(screenshot_id: int, db: Session = Depends(get_db)):
    row = db.get(CalendarScreenshot, screenshot_id)
    if not row:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    path = os.path.join(_calendar_screenshots_dir(), row.filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Screenshot file missing")
    mt = "image/png" if row.filename.lower().endswith(".png") else "image/jpeg"
    return FileResponse(path, media_type=mt)


@app.delete("/api/calendar-screenshots/{screenshot_id:int}")
async def delete_calendar_screenshot(screenshot_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    row = db.get(CalendarScreenshot, screenshot_id)
    if not row:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    path = os.path.join(_calendar_screenshots_dir(), row.filename)
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass
    db.delete(row)
    db.commit()
    return {"success": True, "id": screenshot_id}


def _appt_records_dir() -> str:
    """Hard-drive folder for daily masseuse scheduling sheet archives."""
    d = os.path.join(os.path.dirname(os.path.dirname(__file__)), "appt records")
    os.makedirs(d, exist_ok=True)
    return d


def _appt_record_path(date: str) -> str:
    return os.path.join(_appt_records_dir(), f"{date}.json")


@app.put("/api/appt-records/{date}")
async def save_appt_record(date: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Save one day's scheduling sheet JSON under appt records/YYYY-MM-DD.json."""
    date = (date or "").strip()
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date (use YYYY-MM-DD)")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    body = dict(payload)
    body["date"] = date
    body["saved_at"] = body.get("saved_at") or datetime.now(timezone.utc).isoformat()
    path = _appt_record_path(date)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, indent=2)
    return {"success": True, "date": date, "path": path}


@app.get("/api/appt-records/{date}")
async def get_appt_record(date: str) -> Dict[str, Any]:
    """Load a previously saved scheduling sheet for a date, if present."""
    date = (date or "").strip()
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date (use YYYY-MM-DD)")
    path = _appt_record_path(date)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="No saved sheet for this date")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="Corrupt appt record")
    return data


@app.get("/api/appt-records")
async def list_appt_records() -> Dict[str, Any]:
    """List dates that have a saved scheduling sheet on disk."""
    d = _appt_records_dir()
    dates = sorted(
        name[:-5]
        for name in os.listdir(d)
        if name.endswith(".json") and len(name) == 15
    )
    return {"dates": dates, "folder": d}


# Serve static files (mount AFTER API routes to avoid conflicts)
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def root():
    """Serve the main dashboard page."""
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, headers=_no_cache_headers())
    return {"message": "Dashboard not found. Please create static/index.html"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)

