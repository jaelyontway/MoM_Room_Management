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
