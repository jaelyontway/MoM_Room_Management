"""One-off refactor: extract booking converter + range fetch for square_service.py."""
from pathlib import Path
import re

p = Path(__file__).resolve().parent.parent / "app" / "square_service.py"
text = p.read_text(encoding="utf-8")

insert_after = "logger = logging.getLogger(__name__)\n\n"
if "_SQUARE_LIST_EXCLUDED_STATUSES" not in text:
    helpers = """
_SQUARE_LIST_EXCLUDED_STATUSES = frozenset({
    'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'DECLINED',
    'NO_SHOW',
})


def _raw_booking_local_date_str(b, local_tz) -> Optional[str]:
    \"\"\"Local calendar YYYY-MM-DD for booking start (for bucketing range reports).\"\"\"
    if isinstance(b, dict):
        start_at = b.get('start_at') or ''
    else:
        start_at = getattr(b, 'start_at', None) or ''
    if not start_at:
        return None
    try:
        dt = parser.parse(str(start_at))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=dateutil_tz.UTC)
        loc = dt.astimezone(local_tz)
        return loc.strftime('%Y-%m-%d')
    except Exception:
        return None

"""
    text = text.replace(insert_after, insert_after + helpers, 1)

marker = "            for booking in active_bookings:\n"
sort_marker = "            # Sort by start time"
i0 = text.index(marker)
i1 = text.index(sort_marker, i0)
loop_block = text[i0:i1]
lines = loop_block.split("\n")
inner_lines = []
for line in lines[1:]:
    if line.startswith("                "):
        inner_lines.append(line[4:])
    elif line.strip() == "":
        inner_lines.append("")
    else:
        inner_lines.append(line)
inner_body = "\n".join(inner_lines)
inner_body = inner_body.replace("booking_id_str = booking.get", "booking_id_str = raw_booking.get")
inner_body = inner_body.replace("getattr(booking, 'id'", "getattr(raw_booking, 'id'")

convert_method = f"""    def _convert_raw_booking_row_to_dict(self, raw_booking) -> Optional[Dict]:
        \"\"\"Convert one Square list/retrieve booking row to internal dict; None if skip.\"\"\"
        booking = raw_booking
{inner_body}
        return None

"""

text_wo_loop = (
    text[:i0]
    + """            for booking in active_bookings:
                conv = self._convert_raw_booking_row_to_dict(booking)
                if conv:
                    converted_bookings.append(conv)

"""
    + text[i1:]
)

idx = text_wo_loop.index("    def get_bookings_for_date(self, date: str)")
text2 = text_wo_loop[:idx] + convert_method + "\n" + text_wo_loop[idx:]

pat = r"    def get_bookings_for_date\(self, date: str\) -> List\[Dict\]:.*?(?=\n    def get_suggested_tips)"
m = re.search(pat, text2, re.DOTALL)
if not m:
    raise SystemExit("pattern not found for get_bookings_for_date")

new_fn = """    def _list_active_square_bookings_utc_window(self, start_at_min: str, start_at_max: str) -> List:
        \"\"\"Single List Bookings merged query + status filter (no per-day conversion).\"\"\"
        if hasattr(self.client, 'list_bookings_merged_for_range'):
            square_bookings = self.client.list_bookings_merged_for_range(start_at_min, start_at_max)
        else:
            square_bookings = self.client.list_bookings(
                start_at_min=start_at_min,
                start_at_max=start_at_max,
            )
        extra_ids = list(getattr(Config, 'SQUARE_SUPPLEMENT_BOOKING_IDS', None) or [])
        if extra_ids and getattr(self.client, 'bulk_retrieve_bookings', None):
            by_id = {
                self.client._booking_raw_id(b): b
                for b in square_bookings
                if self.client._booking_raw_id(b)
            }
            for b in self.client.bulk_retrieve_bookings(extra_ids):
                bid = self.client._booking_raw_id(b)
                if bid:
                    by_id[bid] = b
            square_bookings = list(by_id.values())
        active_bookings = []
        for b in square_bookings:
            if isinstance(b, dict):
                status = b.get('status', '')
            else:
                status = getattr(b, 'status', '') or ''
            st = (status or '').strip().upper()
            if st not in _SQUARE_LIST_EXCLUDED_STATUSES:
                active_bookings.append(b)
        return active_bookings

    def _bucket_active_bookings_by_local_date(
        self, active_bookings: List, local_tz, start_date: str, end_date: str
    ) -> Dict[str, List[Dict]]:
        \"\"\"Assign each active booking to its local start date and convert.\"\"\"
        by_date: Dict[str, List[Dict]] = {}
        for booking in active_bookings:
            ds = _raw_booking_local_date_str(booking, local_tz)
            if not ds or ds < start_date or ds > end_date:
                continue
            conv = self._convert_raw_booking_row_to_dict(booking)
            if conv:
                by_date.setdefault(ds, []).append(conv)
        for k in list(by_date.keys()):
            by_date[k].sort(key=lambda b: b['start_at'])
        return by_date

    def get_bookings_by_local_date_range(self, start_date: str, end_date: str) -> Dict[str, List[Dict]]:
        \"\"\"
        One Square fetch for [start_date, end_date] inclusive (local days), bucketed by local start date.
        Used by customers-hours report to avoid N per-day API calls.
        \"\"\"
        if not self.client:
            return {}
        try:
            local_tz = dateutil_tz.tzlocal()
            d0 = datetime.strptime(start_date, '%Y-%m-%d')
            d1 = datetime.strptime(end_date, '%Y-%m-%d')
            local_start = d0.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
            local_end_exclusive = d1.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz) + timedelta(days=1)
            query_lo = local_start - timedelta(hours=2)
            query_hi = local_end_exclusive + timedelta(hours=2)
            start_at_min = query_lo.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            start_at_max = query_hi.astimezone(dateutil_tz.UTC).isoformat().replace('+00:00', 'Z')
            active = self._list_active_square_bookings_utc_window(start_at_min, start_at_max)
            by_date = self._bucket_active_bookings_by_local_date(active, local_tz, start_date, end_date)
            total = sum(len(v) for v in by_date.values())
            logger.info(
                'Square range %s..%s: %d converted bookings across %d local days (one API window)',
                start_date, end_date, total, len(by_date),
            )
            return by_date
        except Exception as e:
            logger.error('Error fetching bookings range from Square: %s', e, exc_info=True)
            return {}

    def get_bookings_for_date(self, date: str) -> List[Dict]:
        \"\"\"Single local day; uses one range query (same as multi-day path) for consistency.\"\"\"
        if not self.client:
            logger.warning('Square API not configured, returning empty list')
            return []
        m = self.get_bookings_by_local_date_range(date, date)
        out = m.get(date, [])
        logger.info('Fetched %d bookings for %s', len(out), date)
        return out

"""

text3 = text2[: m.start()] + new_fn + text2[m.end() :]

# Remove orphaned old get_bookings_for_date implementation fragments if script run twice
if text3.count("def get_bookings_for_date") > 1:
    raise SystemExit("duplicate get_bookings_for_date")

p.write_text(text3, encoding="utf-8")
print("OK:", p)
