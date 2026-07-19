"""Send SMS (Twilio) and email (SMTP) when bookings have no room."""
import logging
from typing import List

logger = logging.getLogger(__name__)

# Config from parent
try:
    from config import Config
except ImportError:
    Config = None


def _normalize_phone(phone: str) -> str:
    """Ensure phone has +1 for US."""
    s = (phone or "").strip().replace("-", "").replace(" ", "").replace("(", "").replace(")", "")
    if s.startswith("1") and len(s) == 11:
        return "+" + s
    if len(s) == 10:
        return "+1" + s
    if not s.startswith("+"):
        return "+1" + s
    return s


def send_sms_no_room(phone: str, body: str) -> bool:
    """Send SMS via Twilio. Returns True if sent, False if skipped or failed."""
    if not Config or not getattr(Config, "TWILIO_ACCOUNT_SID", None) or not getattr(Config, "TWILIO_AUTH_TOKEN", None):
        logger.warning("Twilio not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN). Skip SMS.")
        return False
    to = _normalize_phone(phone)
    from_num = (getattr(Config, "TWILIO_FROM_NUMBER", None) or "").strip()
    if not from_num:
        logger.warning("TWILIO_FROM_NUMBER not set. Skip SMS.")
        return False
    try:
        from twilio.rest import Client
    except ImportError:
        logger.warning("Twilio not installed (pip install twilio). Skip SMS.")
        return False
    try:
        client = Client(Config.TWILIO_ACCOUNT_SID, Config.TWILIO_AUTH_TOKEN)
        client.messages.create(to=to, from_=from_num, body=body[:1600])
        logger.info("SMS sent to %s", to)
        return True
    except Exception as e:
        logger.exception("SMS failed: %s", e)
        return False


def send_email_no_room(to_email: str, subject: str, body: str) -> bool:
    """Send email via SMTP. Returns True if sent, False if skipped or failed."""
    if not Config or not getattr(Config, "SMTP_HOST", None):
        logger.warning("SMTP not configured (SMTP_HOST). Skip email.")
        return False
    host = Config.SMTP_HOST
    port = getattr(Config, "SMTP_PORT", 587)
    user = getattr(Config, "SMTP_USER", None) or ""
    password = getattr(Config, "SMTP_PASSWORD", None) or ""
    from_addr = (getattr(Config, "SMTP_FROM", None) or user or "").strip()
    if not from_addr:
        from_addr = to_email  # fallback
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to_email
        msg.attach(MIMEText(body, "plain"))
        with smtplib.SMTP(host, port) as server:
            if port == 587:
                server.starttls()
            if user and password:
                server.login(user, password)
            server.sendmail(from_addr, [to_email], msg.as_string())
        logger.info("Email sent to %s", to_email)
        return True
    except Exception as e:
        logger.exception("Email failed: %s", e)
        return False


def build_no_room_message(appointments: List[dict], date: str) -> str:
    """Build human-readable message for SMS/email body (any service: massage, facial, etc.)."""
    lines = [
        "Massage on Main – NO ROOM AVAILABLE",
        "",
        f"Date: {date}",
        "All rooms are booked. The following appointment(s) have no room (any service):",
        "",
    ]
    for a in appointments:
        customer = a.get("customer") or "—"
        service = a.get("service") or "—"
        start = a.get("start_at", "")[:16].replace("T", " ")
        therapist = a.get("therapist") or "—"
        lines.append(f"• {customer} – {service}")
        lines.append(f"  Time: {start} | Therapist: {therapist}")
        lines.append("")
    lines.append("Please assign a room or block time on Square.")
    return "\n".join(lines)


def send_no_room_notifications(date: str, unassigned_appointments: List[dict]) -> bool:
    """Send SMS and email for no-room alert. Returns True if at least one sent."""
    if not unassigned_appointments:
        return False
    body = build_no_room_message(unassigned_appointments, date)
    subject = f"[Massage on Main] No room – appointment(s) unassigned for {date}"
    sms_phone = getattr(Config, "NO_ROOM_SMS_PHONE", None) or "9173787373"
    email_to = getattr(Config, "NO_ROOM_EMAIL_TO", None) or "melispatex@gmail.com"
    ok_sms = send_sms_no_room(sms_phone, body)
    ok_email = send_email_no_room(email_to, subject, body)
    return ok_sms or ok_email
