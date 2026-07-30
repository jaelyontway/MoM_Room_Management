# Browser UI changes (MoM_Room_Jaelyn)

Date: 2026-07-18

## Requested changes

1. **Appointment box frame** — stop the flashing/pulsing frame; use a solid normal green outline instead.
2. **Massage on Main logo (top left)** — remove the rotating light-beam / electric orbit background.
3. **Appointments Available + 15 min rows** — remove this left sidebar column (including the 15 min / ½ hr rows toggle). Calendar always uses 30-minute rows.
4. **Rooms available** — remove this left sidebar column.
5. **Staff B/A** — remove this left sidebar column (Busy / Avail counts).

## Files changed

| File | What changed |
|------|----------------|
| `static/style.css` | Solid green in-progress frame; logo `::before`/`::after` beam disabled; calendar grid columns updated (Time + therapists/rooms only). |
| `static/app.js` | Stop rendering Staff / Rooms / Capacity headers and cells; force 30-min slots; room-view superheader spans Time column only. |
| `debugging/debugging.md` | This list. |

## Details

### 1. Appointment in-progress frame (solid green)

- **Before:** `.appointment-block.appointment-in-progress` used `appointment-in-progress-glow` keyframes (green/yellow pulsing border).
- **After:** Static green `box-shadow` + `outline`; `animation: none`.
- JS still toggles `.appointment-in-progress` via `syncAppointmentInProgressClasses()` so “happening now” highlighting remains, without flash.

### 2. Logo rotating beam

- **Before:** `.header-logo-wrap::before` / `::after` conic-gradient bands with `logo-electric-orbit` / flicker animations.
- **After:** Pseudo-elements disabled (`content: none; display: none`). Logo shows on a plain white inner box.

### 3–5. Left sidebar columns removed

Removed from the calendar grid:

- Staff B/A (busy / available masseuse counts)
- Rooms available (per-slot free room mini-grid)
- Appointments Available (beds / duration capacity table + “15 min rows” toggle)

Grid layout is now: **Time | room or therapist columns**.

Related layout fixes:

- `grid-template-columns` no longer includes the three sidebar tracks.
- `--calendar-time-sticky-left` set to `0`.
- Room-view superheader corner spans 1 column (Time only); first room group starts at column 2.

## How to verify in the browser

1. Hard-refresh the app (Ctrl+F5) so `style.css` / `app.js` reload.
2. Confirm Massage on Main logo has no spinning light.
3. Confirm an in-progress appointment has a steady green frame (no blink).
4. Confirm the left edge of the calendar starts with the **Time** column (no Staff / Rooms / Appointments Available).

---

## UI color tweaks (2026-07-18)

1. **In-progress appointment frame** — brighter neon green (`#39ff14` / `#76ff03`), thicker glow, still no flash.
2. **Room column colors** — Rm 3 / 4 / 6 no longer match single (blue) or couple (orange) appointment boxes:
   - Rm 3: teal `#0d9488` (was orange)
   - Rm 4: olive `#558b2f` (was blue/teal)
   - Rm 6: indigo `#3f51b5` (was gold/amber)
   - Unchanged: single appt = blue stripe; couple appt = orange stripe

File: `static/style.css`

---

## UI cleanup (check-in / couple line / room header)

1. **Check-In / Check-Out** — top button and side panels hidden from dashboard.
2. **Couple service line** — prefer `Couples · 90 Minutes` on one line.
3. **Requested masseuse chips** — left-aligned with name/service in sandwich cards.
4. **Top Rm header row** — ~50% thicker (`room-header` padding + superheader 32→48px).

---

## Header toolbar cleanup

- Removed from UI: **EN**, **ORI**, day **lock**, **▼** report-links toggle, **Day list**, **Square vs rooms** (DOM kept for JS).
- Restored **By Room / By Masseuse** view toggle.
- Kept **Phone / tablet link** in the header.
- **Connected to Real Square API** + **Load** / **Refresh** stacked at far top-right.
- **Check-in** moved to the calendar toolbar (top-right of the calendar).

---

## Masseuse scheduling sheet (separate page)

- Rules: `static/docs/sheet_rules.md` (also PDF copies under `static/docs/`).
- Page: `/static/masseuse_scheduling_sheet.html` — editable 3×3 + optional extra masseuses.
- Auto-fill: turn order, requested masseuse, couples = 2; Tina=facial/lymphatic; Casey/May=trigger; Note excludes 大套/oils.
- Interactive: editable cells; short NM (first name); click name → detail modal; tip edits → `PUT /api/tip`; name changes re-assign; large fit-to-window scale.

---

## Couple sandwich service lines

- Couple cards show only **`{duration} Couples`** plus **`$99 3 Senses`** (when booked).
- All other couple service lines (massage types, duplicate segments, add-ons) are omitted on the card.

---

## Sandwich card polish (name / duration / icons)

- Do **not** ellipsis-shorten customer name or service lines.
- Top-right icon gap tightened; facial mask ~11.5px (5px +130%; overrides `.appointment-block .calendar-facial-mask-svg` 58px rule).
- **Cupping / other add-ons**: no duration prefix (not `60 min Air Cupping`).
- **Per-segment Square durations**: API now sends `service_segments` (`name`, `duration_minutes`, `is_addon`) from each Square `appointment_segment`. Calendar uses those so Julie shows `60 min Deep Tissue` + `30 min Trigger Point` even when catalog titles omit “60 Minute”. Fall back to title parse / full block length only when segments are missing.

---

## Layout / duration / menu cleanup

1. Durations always in minutes (`90 min`, not `1h 30m`).
2. Removed menu links: Daily grid, Masseuse report, Customers & hours, Service summary, Services & Pay, EN↔中文 glossary.
3. Page order: **calendar first**, then requested therapist / facials, then messages/alerts.
4. Appt card: customer name and start–end on the **same line**, same font/size, with spaces between.

---

## Appointment card sandwich layout

Minimal calendar cards (`CALENDAR_CARD_MINIMAL`):

1. Stack: name → **`{duration} {service}`** per line → start–end → requested masseuse → Rm  
2. Service shorten: Deep Tissue / Swedish / Trigger Point (drop “massage” / “therapy”); keep on one line.  
3. Couples: `90 min Couples` (same duration+label pattern).  
4. Top-right icons: NEW, facial, cupping, bian, 3S, 📞 — **no** yellow “new appt” card color.  
5. Requested-masseuse chips use **Jenny** chip color.  
6. Room columns 0–02D: uniform light cell `#eef1f4`; top Rm header colors unchanged; UNASSIGNED unchanged.

Files: `static/app.js` (`createAppointmentBlock`), `static/style.css`.

---

## Calendar row height (left timestamp / each time row)

### Clarification

User wanted **taller time rows** (left timestamp + grid row vertical size), not taller 30‑minute appointment boxes.

### Change

- Reverted any ~30‑min appointment-box height boost; box height again = duration × slot height only.
- Base slot row height increased from **30px → 44px** at 100% zoom (`CALENDAR_BASE_SLOT_HEIGHT_PX` in `app.js`; CSS `--calendar-slot-height` default updated). Zoom still scales from that base.

---

## Issue: Browser cannot open `http://0.0.0.0:8001/`

### Symptom

After running `start_server_jaelyn.bat`, uvicorn may print something like:

`Uvicorn running on http://0.0.0.0:8001`

Opening that URL in the browser shows an error such as:

> It looks like the webpage at http://0.0.0.0:8001/ might be having issues, or it may have moved permanently to a new web address.

### Cause

`--host 0.0.0.0` means the server **listens on all network interfaces** (so phones on the same Wi‑Fi can connect).  
`0.0.0.0` is a **bind address**, not a URL browsers can navigate to (especially on Windows).

### Solution

The server **is running** — do not use the `0.0.0.0` link from the uvicorn log.

In the browser address bar, type exactly:

- **http://127.0.0.1:8001**
- or **http://localhost:8001**

On a phone (same Wi‑Fi): use `http://YOUR_PC_IP:8001` (from `ipconfig` → IPv4 Address).

### Note

`start_server_jaelyn.bat` now auto-opens `http://127.0.0.1:8001` after starting, so you do not have to click the `0.0.0.0` URL from the console.

---

## Masseuse scheduling sheet — NM/Dur + rules 15–16 (2026-07-19)

### Requested

1. Shorter **NM** and **Dur** columns; bigger readable text.
2. Rule 15: always save last edit.
3. Rule 16: click NM → choose another customer (quick/obvious).

### Changes

| File | What changed |
|------|----------------|
| `static/masseuse_scheduling_sheet.html` | Narrower NM/Dur widths; larger cell fonts; customer picker modal; script `?v=7`. |
| `static/masseuse_scheduling_sheet.js` | Persist full row snapshots to `localStorage` (`mom_mss_edits_v3:`); restore on Load/Refresh; NM click opens searchable day picker with swap/clear; save on edit + `beforeunload` / tab hide. |

### How to use NM picker

- **Click NM** → search today’s appointments → tap a name to assign (swaps if already on another row).
- **Clear this row** in the picker empties that line.
- **View details** (or right‑click a picker row) opens the appointment detail modal.
- **Double‑click NM** to type a name manually.
- **Clear local edits** on the toolbar resets to calendar auto‑fill.

---

## Masseuse scheduling sheet — rules 17–19 (2026-07-19)

### Requested

1. Rule 17: requested appts still count as turns; investigate Casey only showing Robert + Natalie.
2. Rule 18: save each day’s sheet to hard drive folder `appt records` by date.
3. Rule 19: remove “Pick…” placeholder; empty NM still opens customer search.
4. Clarify what `300m` / `150m` next to masseuse names means.

### Root cause (Casey)

- Browser `localStorage` v3 had frozen the entire sheet after edits, so Refresh did not re-run turn/request assignment.
- Roster name is **Cassey T**; skill list said **Casey** (near-match now treated as same).
- Robert / Natalia on Casey’s card can be valid as **couple partners by turn** (they did not request her); her real requests (Eduardo, michael, etc.) were missing because of the freeze.

### Changes

| File | What changed |
|------|----------------|
| `static/masseuse_scheduling_sheet.js` | Turn advances on requested assigns; Casey/Cassey name match; only pin user edits (v4 storage); disk archive; no Pick placeholder; header shows `N min`. |
| `static/masseuse_scheduling_sheet.html` | Rules/hint text; script `?v=8`. |
| `app/main.py` | `booking_id` on request summary; `PUT/GET /api/appt-records/{date}` → `appt records/YYYY-MM-DD.json`. |
| `appt records/` | Folder for daily sheet JSON archives. |

### Note

Hard-refresh the sheet (`Ctrl+F5`). If an old layout still shows, click **Clear local edits** once, then Load.

---

## Masseuse scheduling sheet — remove header total minutes (2026-07-19)

Removed the `300 min` / `150 min` total next to each masseuse name (`masseuse_scheduling_sheet.js` / `.html`, script `?v=9`).

---

## Docs: sheet assign logic explained (2026-07-19)

Added Chinese line-by-line explanation of auto-assignment:

- `static/docs/sheet_assign_logic_explained.md`

---

## Masseuse scheduling sheet — rules 8 / 11 / 20–22 (2026-07-19)

| Rule | Change |
|------|--------|
| 8 | Extra masseuse cards have **×** to remove |
| 11 | Replacing NM customer A with B moves A to fewest-customer free masseuse |
| 20 | Sticky `any_available_snapshot` on `booking_overrides`; any-available turns ignore post-pay therapist |
| 21 | Default cards = working masseuse count (can be &lt; 9), max 9 |
| 22 | Green row while massage is in progress (refreshes each minute) |

Files: `masseuse_scheduling_sheet.js`/`html` (`?v=10`), `app/models.py`, `app/database.py`, `app/main.py`, `app/schemas.py`.

---

## Masseuse scheduling sheet — rules 21 delete+redistribute + 23 no dup names (2026-07-19)

- **× on any card** (not only extras): removes that masseuse, saves remaining as day’s `roster`, clears layout pins, reloads so work redistributes (9→8).
- **No duplicate names**: typing a name already on another card is rejected; roster build dedupes (Casey/Cassey treated as same).
- Storage key `mom_mss_edits_v5:` includes `roster`. Script `?v=11`.

---

## Masseuse scheduling sheet — wider Dur column (2026-07-19)

Dur column widened (~22%); times always show full `h:mm-h:mm` (minutes padded). Script `?v=12`.

---

## Masseuse scheduling sheet — rules 24–27 (2026-07-19)

| Rule | Behavior |
|------|----------|
| 24 | **Manual-only** list (default Lynn): excluded from auto turn; orange name outline; pick NM yourself |
| 25 | Click masseuse name → picker (working white / not working gray) |
| 26 | Skills panel on page; 小工 rows #9+; luxury → **小脸**; fire cupping → **火罐** |
| 27 | `split_minutes_first`: each segment; &lt;30 min = 小工; ≥30 = turn |

Script `?v=13`. Skills stored in `localStorage` key `mom_mss_skills_v1`.

---

## Masseuse scheduling sheet — Clear edits fix + 小工 row #10 (2026-07-19)

- **Clear edits** now wipes `mom_mss_edits_v2`–`v5` for that date (legacy keys were reloading a frozen empty roster).
- Roster defaults to **therapist_order only** (not every Square team member).
- **#1–#9** = customer rows; **#10** = 小工 bar: `小工 | kind | tip | kind | tip | …` (max 3), not NM/RM/Dur columns.
- Auto kinds: luxury → `小脸`, fire cupping → `cupping`, split &lt;30 min → `NNmin`.

Script `?v=14`.

---

## Masseuse scheduling sheet — assign by selected names + layout (2026-07-19)

- **Bug:** `edits.names` relabeled cards *after* turn assign → e.g. Jenny label on empty slot, Tina shown twice.
- **Fix:** merge name picks into `roster` *before* assign (`commitRoster`); clear index remaps; picking a name redistributes.
- Layout: **3 cards per row**; wider NM; tighter Dur + Note. Script `?v=15`.

---

## Masseuse scheduling sheet — NM move + past freeze + redistribute (2026-07-19)

1. Manual NM pick pins customer to that **masseuse name** (not slot index); sheet reloads and redistributes **future** any-available appts around the pin (e.g. facial moved Vicky → Hongxia).
2. **Past** appts (start &lt; now) stay frozen on their masseuse; not reshuffled by turn.
3. Picking a customer already on another card clears the old seat first (no double / vanish). Locked rows skip skill-warn red box.

Script `?v=19`.

---

## Therapist order edit → swap (2026-07-20)

- Calendar **Masseuse N** dropdown: focus opens empty; choosing a name already in the order **swaps** the two positions (no duplicate reject).
- API `PUT /api/therapist-order` drops duplicate therapist names (keep earliest order).
- Scheduling sheet name picker: same swap; field opens empty.

`app.js?v=177` · sheet `?v=20`.

---

## Staff note 正常轮 / 不着人 → turn (2026-07-20)

Seller/customer notes containing **正常轮** or **不着人** force sheet `any_available` (normal turn), even when Square has a named therapist. Persists `any_available_snapshot=True`. Sheet `?v=21`.

---

## Past appts use turn pointer (not Square calendar glue) (2026-07-20)

- **Bug:** `isPastEv` forced Jude→Lillian / Christalle→May / Fay→Sophia from Square columns, skipping turn.
- **Fix:** past + future same walk: fewest customers among free, then turn index #1…#N. Non-request ignores Square therapist name. Request busy/stacked → fall through turn.
- With roster Sophia→Rose→Tina→…: Jude→Sophia, Christalle→Rose, Fay→Tina.
- Sheet `?v=24`.

---

## Request honor if free (not countSoFar===0) (2026-07-20)

- **Bug:** `forceRequest` required `countSoFar===0`, so Casey with morning work skipped Kate 3–4:30 request → Rose.
- **Fix:** true request → assign if free at that time; only busy overlap falls through. Fay-style cases must be classified as turn, not “skip request because she already has a customer.”
- Sheet `?v=25`.

---

## Request = named booking unless staff note 正常轮/不找人 (2026-07-20)

User rule: if guest requested a masseuse but Note for staff says **正常轮** or **不找人** → 不着人 (turn). If those words are absent → treat as request. Backend request bar skips note-forced turn. Sheet `?v=26`.

---

## Cleared bad locks + redistributed 2026-07-20 (2026-07-20)

- Removed Jude past pin + Nagarjuna pin; `edits.rows={}`.
- Reassigned with current rules (roster Sophia→Rose→Tina→Cassey→Lillian→May).
- Load prefers disk when `cleared_locks_at` / redistributed note so browser localStorage locks don’t stick.
- Sheet `?v=27`.

---

## Lock checkbox on # column (2026-07-20)

- Each customer row: checkbox left of the row number.
- Checked → pin on that masseuse (turn will not move them). Unchecked → unlock + redistribute.
- Sheet `?v=28`.

---

## Today walkthrough rules: luxury 90 + Brandi facial split (2026-07-20)

User day analysis → code:
- Luxury: turn masseuse **90min busy only** + Tina **小脸 小工** (not turn).
- Basic facial + 90 massage: massage on turn first if Tina free after; else Tina facial first, massage to turn.
- Staff note names (e.g. Rose Vicky) used as couple requests.
- Sheet `?v=29`.

---

## 小工 = normal bottom rows + note time chips + Split (2026-07-20)

- Removed #10 `小工|kind|tip` bar.
- Per card **+ / −** adds/removes rows; 小工 (小脸/cupping) uses same NM/RM/Dur/Price/Tip/Note at bottom.
- Note: 30-min block chips for the full appt; **Split** button shows `split` under the note.
- Sheet `?v=31` · storage `mom_mss_edits_v7`.

---

## Split drag bar + 小工 section (2026-07-20)

- Time blocks removed from Note; **Split** column has click-drag 30min bar.
- Card has **小工** section under turn rows; Tina 小脸 / cupping go there (not turn count).
- Sheet `?v=32`.

---

## Neat Split under Note + title +/- (2026-07-20)

- No Split column; cell widths restored.
- **split** word under Note (right edge); click opens drag time panel under Note only.
- **+ / −** next to **×** on masseuse name row.
- Sheet `?v=33`.

---

## 小工 button (no purple bar) (2026-07-20)

- Removed purple 小工 section.
- Title: **小工** | + | − | × — 小工 adds `小工#1` row under regulars (same cols).
- Sheet `?v=34`.

---

## Skills button + forever save (2026-07-20)

- Top bar **Skills** button left of **+ Masseuse**; toggles panel (no long summary text).
- Lists persist in `sheet_skills.json` via `GET/PUT /api/sheet-skills` (+ localStorage backup).
- Sheet `?v=36`.

---

## Detail + 15min split (2026-07-20)

- Note col **detail** button → modal with appt info + 15‑min multi-range bar.
- Apply split updates Dur; gaps → facial 小工; both notes show `w/ Partner`.
- Sheet `?v=37`.

---

## Detail UX tweak (2026-07-20)

- Split: click-to-toggle (no drag); chips ~25% prior width.
- Requested: any-available → None; note-mentioned / named Square → names.
- Sheet `?v=38`.

---

## Fix: split pin scrambled turn (2026-07-20)

- Root cause: Apply split auto-pinned main + tip#30 小工; 小工 pin advanced turn.
- Fix: never pin on split; ignore tip≥20 locks; strip bad 小工 pins on Load; note names = request.
- Sheet `?v=39`.

---

## Fix: NM pick no longer reshuffles everyone (2026-07-20)

- Pinning a 2pm customer onto Lillian wiped all unpinned rows + Load → Jude jumped to May.
- Assign/lock now only moves that customer (+ displaced on that row); others stay.
- Sheet `?v=40`.

---

## Default masseuse count by weekday (2026-07-21)

- First open of a day (no saved roster): Mon–Thu **6** cards, Fri–Sun **9**.
- Calendar names fill what they can; remaining cards empty for manual order pick.
- Sheet `?v=41`.

---

## Faster sheet Load (2026-07-21)

- Root: `/api/day` did per-therapist Square booking lists + catalog + tips (~7–10s).
- Sheet uses `?fast=1`: 2-pass bookings, lite enrich (no catalog), parallel customer names, 45s cache.
- Measured: cold ~4s (6 appts) / ~9s (50 appts); cached Load ~5ms; warm without cache ~0.5s.
- Sheet `?v=42`.
