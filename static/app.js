// Calendar grid application
let currentData = null;
let momDayLayoutUnlockPendingDate = '';
let momDayLayoutUnlockOnEscape = null;
let momDayLayoutLockPendingDate = '';
let momDayLayoutLockOnEscape = null;

/** Update one event in memory so UI can refresh without waiting on GET /api/day (heavy Square + room assigner). */
function patchEventInCurrentData(bookingId, patch) {
    if (!bookingId || !patch || typeof patch !== 'object') return false;
    if (!currentData || !Array.isArray(currentData.events)) return false;
    const ev = currentData.events.find(e => e.booking_id === bookingId);
    if (!ev) return false;
    Object.assign(ev, patch);
    return true;
}

/** Apply JSON from PUT /api/tip to the cached event (supports allocated tip_amount / tip_amount_2). */
function applyTipApiResponseToEvent(bookingId, data, fallback) {
    if (!bookingId) return;
    const patch = {};
    if (data && typeof data === 'object') {
        if (data.tip_amount != null) patch.tip_amount = data.tip_amount;
        if (data.tip_amount_2 != null) patch.tip_amount_2 = data.tip_amount_2;
        if (Object.prototype.hasOwnProperty.call(data, 'tip_cash')) patch.tip_cash = !!data.tip_cash;
    }
    if (fallback && typeof fallback === 'object') {
        for (const k of Object.keys(fallback)) {
            if (!(k in patch)) patch[k] = fallback[k];
        }
    }
    if (Object.keys(patch).length) patchEventInCurrentData(bookingId, patch);
}

/** FastAPI often sends { detail: string | array }; plain HTML/text on some 500s — never assume JSON on error. */
function errorMessageFromApiBody(parsed) {
    if (!parsed || typeof parsed !== 'object') return '';
    const d = parsed.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
        return d.map((x) => (typeof x === 'string' ? x : (x && x.msg) || JSON.stringify(x))).join('; ');
    }
    if (parsed.message) return String(parsed.message);
    return '';
}

/**
 * Read response body as text once, then JSON-parse. On !ok, throw Error with a readable message (not JSON.parse on HTML).
 */
async function parseFetchResponseAsJson(response) {
    const text = await response.text();
    if (!response.ok) {
        let msg = '';
        try {
            const j = JSON.parse(text);
            msg = errorMessageFromApiBody(j) || text.trim().slice(0, 800);
        } catch (e) {
            msg = (text && text.trim()) ? text.trim().slice(0, 800) : `${response.status} ${response.statusText || ''}`.trim();
        }
        throw new Error(msg || `Request failed (${response.status})`);
    }
    if (!text.trim()) return {};
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error('Server returned invalid JSON');
    }
}

const CANCELLED_ALERTS_KEY = 'mom_cancelled_alerts';
const RESCHEDULE_ALERTS_KEY = 'mom_reschedule_alerts';
const CHECKOUT_DONE_KEY_PREFIX = 'mom_checkout_done_';
const CHECKOUT_SERVICES_PAID_KEY_PREFIX = 'mom_checkout_services_paid_';
const UNASSIGNED_FLASH_DISMISSED_KEY_PREFIX = 'mom_unassigned_flash_dismissed_';
/** After user changes date via ‹ › or the date picker, skip the “after 9pm → tomorrow” auto-jump while viewing today (fresh page load still allows it). */
let momSuppressAfterNineAutoAdvance = false;
/** HTML for custom date hover (customer count + total time); avoids native tooltip under cursor. */
let momDateHoverSummaryHtml = '';
/** Speed up switching days: in-memory cache of recent /api/day responses. */
const MOM_DAY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const momDayCache = new Map(); // dateStr -> { at:number, data:object }

/** Local calendar dates strictly before yesterday: treat as stable history (no Square on revisit; use localStorage + Refresh / soft reload). */
function isCalendarHistoryDay(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const yesterday = addDaysToDate(getTodayLocal(), -1);
    return dateStr < yesterday;
}

function momDayHistoryLocalKey(dateStr) {
    return 'mom_day_history_v1:' + dateStr;
}

function readDayHistoryFromLocal(dateStr) {
    try {
        const s = localStorage.getItem(momDayHistoryLocalKey(dateStr));
        if (!s) return null;
        const o = JSON.parse(s);
        if (!o || typeof o !== 'object' || o.date !== dateStr) return null;
        return o;
    } catch (e) {
        return null;
    }
}

function writeDayHistoryToLocal(dateStr, payload) {
    try {
        if (!dateStr || !payload) return;
        localStorage.setItem(momDayHistoryLocalKey(dateStr), JSON.stringify(payload));
    } catch (e) {
        console.warn('Day history localStorage save failed', e);
    }
}

const PRESSURE_OPTIONS = ['', 'deep', 'deep/med', 'med', 'med/light', 'light'];
const FOCUS_AREA_OPTIONS = ['Lower back', 'Upper back', 'Back', 'Neck', 'Shoulders', 'Traps', 'Feet', 'Calves', 'Hamstrings', 'Legs', 'Hips', 'IT band', 'Arms', 'Hands', 'Glutes', 'Quads', 'Chest', 'Jaw/TMJ', 'Scalp'];
// Body diagram: 4 views in one image (front, back, left side, right side). Each entry: { v: view 0-3, x: % left, y: % top, r: % radius }.
const FOCUS_AREA_DIAGRAM_MAP = {
    'Lower back': [{ v: 1, x: 50, y: 72, r: 14 }],
    'Upper back': [{ v: 1, x: 50, y: 38, r: 14 }],
    'Neck': [{ v: 0, x: 50, y: 24, r: 9 }, { v: 1, x: 50, y: 20, r: 9 }],
    'Shoulders': [{ v: 0, x: 50, y: 32, r: 16 }, { v: 1, x: 50, y: 30, r: 16 }],
    'Traps': [{ v: 1, x: 50, y: 26, r: 12 }],
    'Feet': [{ v: 0, x: 50, y: 94, r: 8 }, { v: 1, x: 50, y: 94, r: 8 }],
    'Calves': [{ v: 1, x: 30, y: 78, r: 10 }, { v: 1, x: 70, y: 78, r: 10 }],
    'Hamstrings': [{ v: 1, x: 30, y: 68, r: 10 }, { v: 1, x: 70, y: 68, r: 10 }],
    'Hips': [{ v: 0, x: 50, y: 58, r: 12 }, { v: 1, x: 50, y: 58, r: 12 }],
    'IT band': [{ v: 2, x: 55, y: 68, r: 10 }, { v: 3, x: 45, y: 68, r: 10 }],
    'Arms': [{ v: 0, x: 28, y: 52, r: 10 }, { v: 0, x: 72, y: 52, r: 10 }],
    'Hands': [{ v: 0, x: 24, y: 74, r: 7 }, { v: 0, x: 76, y: 74, r: 7 }],
    'Glutes': [{ v: 1, x: 50, y: 64, r: 12 }],
    'Quads': [{ v: 0, x: 50, y: 74, r: 14 }],
    'Chest': [{ v: 0, x: 50, y: 42, r: 14 }],
    'Jaw/TMJ': [{ v: 0, x: 50, y: 28, r: 7 }],
    'Scalp': [{ v: 0, x: 50, y: 10, r: 10 }],
};
FOCUS_AREA_DIAGRAM_MAP['Back'] = (FOCUS_AREA_DIAGRAM_MAP['Upper back'] || []).concat(FOCUS_AREA_DIAGRAM_MAP['Lower back'] || []);
FOCUS_AREA_DIAGRAM_MAP['Legs'] = ['Feet', 'Calves', 'Hamstrings', 'Quads', 'IT band'].reduce(
    (acc, k) => acc.concat(FOCUS_AREA_DIAGRAM_MAP[k] || []),
    [],
);
const FOCUS_OTHER_TO_DIAGRAM = {
    jaw: 'Jaw/TMJ',
    tmj: 'Jaw/TMJ',
    glutes: 'Glutes',
    back: 'Back',
    legs: 'Legs',
    'lower back': 'Lower back',
    'upper back': 'Upper back',
    neck: 'Neck',
    shoulders: 'Shoulders',
    traps: 'Traps',
    feet: 'Feet',
    calves: 'Calves',
    hamstrings: 'Hamstrings',
    hips: 'Hips',
    'it band': 'IT band',
    arms: 'Arms',
    hands: 'Hands',
    quads: 'Quads',
    chest: 'Chest',
    scalp: 'Scalp',
};
const FOCUS_LEG_SUBKEYS = ['Feet', 'Calves', 'Hamstrings', 'Quads', 'IT band'];
const FOCUS_AREA_SIDE_TOKENS = new Set(['Left', 'Right']);
const CANCELLED_ALERT_TTL_MS = 60 * 60 * 1000; // 1 hour

function uiT(key, fallback) {
    if (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.t) {
        return window.MOM_I18N.t(key, fallback);
    }
    return fallback;
}

/** Square catalog line (service / description): EN / 中文 / 中英 — not for person names. */
function uiCatalogLine(text) {
    if (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.catalogLine) {
        return window.MOM_I18N.catalogLine(text);
    }
    return text == null ? '' : String(text);
}

/**
 * Calendar 📝 hover: EN mode translates Chinese notes to English; 中英 shows English then original;
 * 中文 keeps English→Chinese catalog behavior for Latin text.
 */
function uiNotesHoverText(fullNotes) {
    if (!fullNotes || typeof fullNotes !== 'string') return '';
    const mode = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.getMode) ? window.MOM_I18N.getMode() : 'en';
    const hasCJK = /[\u3000-\u9fff\uf900-\ufaff]/.test(fullNotes);
    const n2e = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.notesToEnglish)
        ? window.MOM_I18N.notesToEnglish
        : null;
    if (mode === 'en') {
        return (hasCJK && n2e) ? n2e(fullNotes) : fullNotes;
    }
    if (mode === 'both' && hasCJK && n2e) {
        const en = n2e(fullNotes);
        if (en && en.trim() !== fullNotes.trim()) return en + '\n\n—\n\n' + fullNotes;
    }
    return fullNotes
        .split(/\n{2,}/)
        .map((chunk) => {
            const c = chunk.trim();
            return c ? uiCatalogLine(c) : '';
        })
        .filter(Boolean)
        .join('\n\n');
}

/** Staff/customer free-form notes in appointment modal (same rules as 📝 hover). */
function uiFreeformNoteDisplay(text) {
    if (!text) return '';
    const mode = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.getMode) ? window.MOM_I18N.getMode() : 'en';
    const hasCJK = /[\u3000-\u9fff\uf900-\ufaff]/.test(text);
    const n2e = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.notesToEnglish)
        ? window.MOM_I18N.notesToEnglish
        : null;
    if (mode === 'en' && hasCJK && n2e) return n2e(text);
    if (mode === 'both' && hasCJK && n2e) {
        const en = n2e(text);
        if (en && en.trim() !== text.trim()) return en + '\n\n' + text;
    }
    return uiCatalogLine(text);
}

function uiFreeformNoteDisplayHtml(text) {
    return escapeHtml(uiFreeformNoteDisplay(text)).replace(/\n/g, '<br>');
}

/** Check-in / check-out panel: hover preview for 📝 / 📋 desk notes (session, independent of header EN/中文/中英). */
const MOM_CHECKIN_CHECKOUT_NOTE_LANG_KEY = 'mom_checkin_checkout_note_preview_lang';
/** When true, check-in and check-out time selectors stay on the same slot (session). */
const MOM_CHECKIN_CHECKOUT_TIME_SYNC_KEY = 'mom_checkin_checkout_time_sync';

function getCheckinCheckoutNotePreviewLang() {
    try {
        const s = sessionStorage.getItem(MOM_CHECKIN_CHECKOUT_NOTE_LANG_KEY);
        if (s === 'en' || s === 'zh') return s;
    } catch (e) { /* ignore */ }
    const mode = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.getMode) ? window.MOM_I18N.getMode() : 'en';
    return mode === 'zh' ? 'zh' : 'en';
}

function formatDeskNotePreviewBody(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const lang = getCheckinCheckoutNotePreviewLang();
    const hasCJK = (s) => /[\u3000-\u9fff\uf900-\ufaff]/.test(s);
    const zhFn = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.catalogLineZh)
        ? window.MOM_I18N.catalogLineZh
        : null;
    const n2e = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.notesToEnglish)
        ? window.MOM_I18N.notesToEnglish
        : null;
    const blocks = raw.split(/\n{2,}/);
    return blocks.map((block) => {
        const b = block.trim();
        if (!b) return '';
        if (lang === 'zh') {
            if (hasCJK(b)) return b;
            return (zhFn ? zhFn(b) : b) || b;
        }
        if (hasCJK(b) && n2e) return n2e(b);
        return b;
    }).filter(Boolean).join('\n\n');
}

function syncDeskNoteLangToggleButtons() {
    const lang = getCheckinCheckoutNotePreviewLang();
    document.querySelectorAll('.checkin-checkout-note-lang-toggle .desk-note-lang-btn').forEach((btn) => {
        const on = btn.getAttribute('data-desk-note-lang') === lang;
        btn.classList.toggle('desk-note-lang-btn--active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

function setCheckinCheckoutNotePreviewLang(lang) {
    if (lang !== 'en' && lang !== 'zh') return;
    try {
        sessionStorage.setItem(MOM_CHECKIN_CHECKOUT_NOTE_LANG_KEY, lang);
    } catch (e) { /* ignore */ }
    syncDeskNoteLangToggleButtons();
    hideMomDeskNoteTooltipNow();
}

/** Comma/semicolon focus list: localize known body areas, keep unknown segments as-is. */
function uiFocusAreasDisplay(focusStr) {
    if (!focusStr || typeof focusStr !== 'string') return '';
    const parts = focusStr.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    if (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.focusAreaLabel) {
        return parts.map(p => window.MOM_I18N.focusAreaLabel(p)).join(', ');
    }
    return parts.join(', ');
}
function uiTParams(key, vars, fallback) {
    if (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.tParams) {
        return window.MOM_I18N.tParams(key, vars, fallback);
    }
    let s = fallback;
    if (vars && s) {
        Object.keys(vars).forEach(k => {
            s = s.split('{' + k + '}').join(String(vars[k]));
        });
    }
    return s;
}

/** Pressure dropdown options: value stays English for API; label is localized. */
function uiPressureOptionsHtml() {
    return PRESSURE_OPTIONS.map(p => {
        const pl = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.pressureLabel)
            ? window.MOM_I18N.pressureLabel(p)
            : (p || '—');
        return `<option value="${escapeHtml(p)}">${escapeHtml(pl)}</option>`;
    }).join('');
}

function uiFocusLabel(count) {
    if (!count) return uiT('label.focus', 'Focus');
    return uiTParams('label.focusN', { n: String(count) }, 'Focus (' + count + ')');
}

function getUnassignedFlashDismissed(dateStr) {
    try {
        const raw = sessionStorage.getItem(UNASSIGNED_FLASH_DISMISSED_KEY_PREFIX + (dateStr || ''));
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) { return new Set(); }
}
function setUnassignedFlashDismissed(dateStr, bookingId) {
    try {
        const key = UNASSIGNED_FLASH_DISMISSED_KEY_PREFIX + (dateStr || '');
        const set = getUnassignedFlashDismissed(dateStr);
        set.add(bookingId);
        sessionStorage.setItem(key, JSON.stringify([...set]));
    } catch (e) {}
}

function getCheckoutDoneKey(dateStr, bookingId) {
    return CHECKOUT_DONE_KEY_PREFIX + dateStr + '_' + (bookingId || '');
}
function isCheckoutDone(dateStr, bookingId) {
    try {
        return sessionStorage.getItem(getCheckoutDoneKey(dateStr, bookingId)) === '1';
    } catch (e) { return false; }
}
function setCheckoutDone(dateStr, bookingId, done) {
    try {
        const key = getCheckoutDoneKey(dateStr, bookingId);
        if (done) sessionStorage.setItem(key, '1');
        else sessionStorage.removeItem(key);
    } catch (e) {}
}

function getCheckoutServicesPaidKey(dateStr, bookingId) {
    return CHECKOUT_SERVICES_PAID_KEY_PREFIX + dateStr + '_' + (bookingId || '');
}
function isCheckoutServicesPaid(dateStr, bookingId) {
    try {
        return sessionStorage.getItem(getCheckoutServicesPaidKey(dateStr, bookingId)) === '1';
    } catch (e) {
        return false;
    }
}
function setCheckoutServicesPaid(dateStr, bookingId, paid) {
    try {
        const key = getCheckoutServicesPaidKey(dateStr, bookingId);
        if (paid) sessionStorage.setItem(key, '1');
        else sessionStorage.removeItem(key);
    } catch (e) { /* ignore */ }
}

/** Luxury: separate Facial Specialist for last 30 min (tip defaults 90/30 vs masseuse). */
function luxurySeparateMiniFacialChecked(apt) {
    if (!apt) return false;
    if (apt.luxury_separate_mini_facial === false) return false;
    if (apt.luxury_separate_mini_facial === true) return true;
    return !!(apt.luxury_mini_facial_therapist || apt.luxury_mini_facial_therapist_2);
}

/** Single (non-couple) luxury with separate mini facial — staffing tooltips split massage vs mini wall time and tips. */
function luxurySeparateMiniSingleBooking(ev) {
    if (!ev || String(ev.type || '').toLowerCase() === 'couple') return false;
    const svc = String(ev.service || ev.display_service || '').toLowerCase();
    if (!svc.includes('luxury')) return false;
    return luxurySeparateMiniFacialChecked(ev);
}

/**
 * Wall-clock massage vs mini-facial segment for single luxury + separate mini (matches eventFacialAppointmentIntervals).
 * Massage: start → (square_end_at or end_at) minus 30m. Mini: last 30m up to that end.
 */
function luxurySeparateMiniWallClockMs(ev) {
    if (!ev || !ev.start_at || !ev.end_at) return null;
    const start = new Date(ev.start_at).getTime();
    const end = new Date(ev.end_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const luxEndRaw = ev.square_end_at ? new Date(ev.square_end_at).getTime() : end;
    const le = Number.isFinite(luxEndRaw) ? luxEndRaw : end;
    const miniMs = 30 * 60 * 1000;
    const miniStartMs = Math.max(start, le - miniMs);
    const massageEndMs = le - miniMs;
    if (miniStartMs >= le || massageEndMs <= start) return null;
    return { massageStartMs: start, massageEndMs, miniStartMs, miniEndMs: le };
}

function luxurySeparateMiniTipParts(ev) {
    const t1 = ev.tip_amount != null && ev.tip_amount !== '' ? Number(ev.tip_amount) : null;
    const t2 = ev.tip_amount_2 != null && ev.tip_amount_2 !== '' ? Number(ev.tip_amount_2) : null;
    const n1 = t1 != null && Number.isFinite(t1) ? t1 : null;
    const n2 = t2 != null && Number.isFinite(t2) ? t2 : null;
    return { n1, n2 };
}

/** Tip shown on massage “So far / later” staffing row (matches PUT /api/tip 90/120 vs 30/120 when one total). */
function luxurySeparateMiniMassageTipDisplay(ev) {
    if (!luxurySeparateMiniSingleBooking(ev)) return null;
    const { n1, n2 } = luxurySeparateMiniTipParts(ev);
    if (n1 != null && n2 != null) return n1;
    if (n1 != null) return Math.round(n1 * (90 / 120) * 100) / 100;
    return null;
}

/** Tip shown on facial staffing row for the mini segment only. */
function luxurySeparateMiniFacialTipDisplay(ev) {
    if (!luxurySeparateMiniSingleBooking(ev)) return null;
    const { n1, n2 } = luxurySeparateMiniTipParts(ev);
    if (n1 != null && n2 != null) return n2;
    if (n1 != null) return Math.round(n1 * (30 / 120) * 100) / 100;
    return null;
}

function staffingFacialTooltipRowFromEvent(ev) {
    if (luxurySeparateMiniSingleBooking(ev)) {
        const w = luxurySeparateMiniWallClockMs(ev);
        if (w) {
            const tipLux = luxurySeparateMiniFacialTipDisplay(ev);
            return {
                ev,
                tip: tipLux != null ? tipLux : facialTipCombinedForEvent(ev),
                _momSegStartMs: w.miniStartMs,
                _momSegEndMs: w.miniEndMs,
            };
        }
    }
    return { ev, tip: facialTipCombinedForEvent(ev) };
}

function getCancelledAlerts() {
    try {
        const raw = sessionStorage.getItem(CANCELLED_ALERTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const now = Date.now();
        const valid = list.filter(a => !a.dismissed && (now - new Date(a.stored_at).getTime()) < CANCELLED_ALERT_TTL_MS);
        const pruned = list.filter(a => (now - new Date(a.stored_at).getTime()) < CANCELLED_ALERT_TTL_MS);
        if (pruned.length !== list.length) {
            sessionStorage.setItem(CANCELLED_ALERTS_KEY, JSON.stringify(pruned));
        }
        return valid;
    } catch (e) {
        return [];
    }
}

function saveCancelledAlerts(list) {
    try {
        sessionStorage.setItem(CANCELLED_ALERTS_KEY, JSON.stringify(list));
    } catch (e) {}
}

function addCancelledAlerts(events) {
    const storedAt = new Date().toISOString();
    try {
        const raw = sessionStorage.getItem(CANCELLED_ALERTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const now = Date.now();
        const pruned = list.filter(a => (now - new Date(a.stored_at).getTime()) < CANCELLED_ALERT_TTL_MS);
        events.forEach(ev => {
            pruned.push({
                booking_id: ev.booking_id,
                customer: ev.customer || '',
                service: ev.service || '',
                start_at: ev.start_at,
                end_at: ev.end_at,
                stored_at: storedAt,
                dismissed: false
            });
        });
        sessionStorage.setItem(CANCELLED_ALERTS_KEY, JSON.stringify(pruned));
    } catch (e) {}
}

function getRescheduleAlerts() {
    try {
        const raw = sessionStorage.getItem(RESCHEDULE_ALERTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const now = Date.now();
        const valid = list.filter(a => !a.dismissed && (now - new Date(a.stored_at).getTime()) < CANCELLED_ALERT_TTL_MS);
        const pruned = list.filter(a => (now - new Date(a.stored_at).getTime()) < CANCELLED_ALERT_TTL_MS);
        if (pruned.length !== list.length) {
            sessionStorage.setItem(RESCHEDULE_ALERTS_KEY, JSON.stringify(pruned));
        }
        return valid;
    } catch (e) {
        return [];
    }
}

function addRescheduleAlerts(items) {
    const storedAt = new Date().toISOString();
    try {
        const raw = sessionStorage.getItem(RESCHEDULE_ALERTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const now = Date.now();
        const pruned = list.filter(a => (now - new Date(a.stored_at).getTime()) < CANCELLED_ALERT_TTL_MS);
        items.forEach(item => {
            pruned.push({
                booking_id: item.booking_id,
                customer: item.customer || '',
                service: item.service || '',
                from_start_at: item.from_start_at,
                from_end_at: item.from_end_at,
                to_start_at: item.to_start_at,
                to_end_at: item.to_end_at,
                stored_at: storedAt,
                dismissed: false
            });
        });
        sessionStorage.setItem(RESCHEDULE_ALERTS_KEY, JSON.stringify(pruned));
    } catch (e) {}
}

let calendarViewMode = 'room'; // 'room' (default) | 'therapist'
const TIME_SLOT_MINUTES = 15;
/** Calendar column width (px): bed/slot summary + Single/Couple counts by appointment length. */
const CALENDAR_CAPACITY_COL_PX = 188;
/** New bookings that could fit entirely in window [slotStart, slotStart+duration). */
const APPOINTMENT_CAP_DURATIONS_MIN = [60, 90, 120, 150, 180];
const PHYSICAL_ROOM_IDS_CAP = ['0', '1', '2', '3', '4', '5', '6'];
/** Calendar grid: left column width for per-slot masseuse busy / available counts */
const CALENDAR_STAFF_COL_PX = 52;
// Room display order in room view: Rm 0, Rm 2, Rm 1, then 3–6, 02D, UNASSIGNED
const CALENDAR_ROOM_LIST = ['0', '2', '1', '3', '4', '5', '6', '02D', 'UNASSIGNED'];
/** Top header groups in room view (must cover every column in CALENDAR_ROOM_LIST). */
const CALENDAR_ROOM_GROUP_SINGLE = new Set(['0', '2', '1', '3', '4']);
const CALENDAR_ROOM_GROUP_COUPLE = new Set(['5', '6', '02D']);
/** Left "Rooms available" column order — matches room view (no UNASSIGNED). */
const ROOMS_AVAILABLE_COL_ORDER = CALENDAR_ROOM_LIST.filter((r) => r !== 'UNASSIGNED');

/** Couple in Rm 5, 6, or 02D with “only one client gets the facial” — backend sends facial_segment_start_at. */
const COUPLE_FACIAL_SPLIT_ROOMS = new Set(['5', '6', '02D']);

function eventCoupleSingleFacialSplitActive(ev) {
    if (!ev || ev.couple_02d_single_facial_only !== true) return false;
    if (!COUPLE_FACIAL_SPLIT_ROOMS.has(ev.room)) return false;
    if (ev.is_couple_facial_with_massage !== true || !ev.facial_segment_start_at) return false;
    return true;
}

function coupleSplitFacialStartMs(ev) {
    if (!eventCoupleSingleFacialSplitActive(ev)) return null;
    const fs = new Date(ev.facial_segment_start_at).getTime();
    const st = new Date(ev.start_at).getTime();
    const en = new Date(ev.end_at).getTime();
    if (!Number.isFinite(fs) || fs <= st || fs >= en) return null;
    return fs;
}

/** True if ev occupies physical roomId during [slotStartMs, slotEndMs). */
function eventUsesPhysicalRoomInSlot(ev, slotStartMs, slotEndMs, roomId) {
    if (!ev || ev.room === 'UNASSIGNED' || ev.room === 'ADDON') return false;
    const start = new Date(ev.start_at).getTime();
    let busyEnd = eventPhysicalRoomBusyEndMs(ev);
    if (!Number.isFinite(busyEnd)) busyEnd = new Date(ev.end_at).getTime();
    if (start >= slotEndMs || busyEnd <= slotStartMs) return false;
    const fs = coupleSplitFacialStartMs(ev);
    const cr = ev.room;
    if (fs != null && (cr === '02D' || cr === '5' || cr === '6')) {
        const fr = (ev.facial_portion_room || '').trim();
        if (cr === '02D') {
            if (roomId === '0') {
                const massageBusyEnd = Math.min(busyEnd, fs);
                return slotStartMs < massageBusyEnd && slotEndMs > start;
            }
            if (roomId === '2') {
                return slotStartMs < busyEnd && slotEndMs > start;
            }
            if (fr && fr !== '2' && fr === roomId) {
                return slotStartMs < busyEnd && slotEndMs > fs;
            }
            return false;
        }
        if (cr === '5' || cr === '6') {
            if (roomId === cr) {
                return slotStartMs < fs && slotEndMs > start;
            }
            if (fr && fr === roomId) {
                return slotStartMs < busyEnd && slotEndMs > fs;
            }
            return false;
        }
    }
    if (ev.room === '02D') return roomId === '0' || roomId === '2';
    return ev.room === roomId;
}

function roomsPhysicallyUsedInSlotForEvents(events, slotStartMs, slotEndMs) {
    const used = new Set();
    for (const rid of PHYSICAL_ROOM_IDS_CAP) {
        for (const ev of events || []) {
            if (eventUsesPhysicalRoomInSlot(ev, slotStartMs, slotEndMs, rid)) {
                used.add(rid);
                break;
            }
        }
    }
    return used;
}

/** Legacy single key; migrated once to per-weekday keys below. */
const MOM_STAFF_MASSEUSES_KEY = 'mom_staff_masseuses_today';
const MOM_STAFF_MASSEUSES_WD_PREFIX = 'mom_staff_masseuses_wd_';
/** Legacy single key for facial count; migrated to per-weekday keys. */
const MOM_STAFF_FACIAL_SPECIALISTS_KEY = 'mom_staff_facial_specialists_today';
const MOM_STAFF_FACIAL_WD_PREFIX = 'mom_staff_facial_wd_';
/** Max massage / facial staff in header dropdown and staffing popover. */
const MOM_MAX_PLANNED_STAFF = 9;

function massageStaffStorageKeyForWeekday(wd) {
    return MOM_STAFF_MASSEUSES_WD_PREFIX + wd;
}

function facialStaffStorageKeyForWeekday(wd) {
    return MOM_STAFF_FACIAL_WD_PREFIX + wd;
}

const MOM_THERAPISTS_LIST_CACHE_KEY = 'mom_therapists_pick_list_json';
const MOM_STAFF_MASSAGE_PICK_WD_PREFIX = 'mom_staff_massage_pick_wd_';
const MOM_STAFF_FACIAL_PICK_WD_PREFIX = 'mom_staff_facial_pick_wd_';
const STAFFING_AVAIL_TURN_PREVIEW_TICK_MS = 60000;
let staffingAvailTurnPreviewTickerId = null;

function clearStaffingAvailTurnPreviewTicker() {
    if (staffingAvailTurnPreviewTickerId != null) {
        clearInterval(staffingAvailTurnPreviewTickerId);
        staffingAvailTurnPreviewTickerId = null;
    }
}

/** Per calendar date (YYYY-MM-DD), not weekday — each day has its own staffing pick + turn order. */
function massageStaffPickStorageKeyForDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return MOM_STAFF_MASSAGE_PICK_WD_PREFIX + 'invalid';
    return 'mom_staff_massage_pick_date_' + dateStr;
}

function facialStaffPickStorageKeyForDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return MOM_STAFF_FACIAL_PICK_WD_PREFIX + 'invalid';
    return 'mom_staff_facial_pick_date_' + dateStr;
}

function massageStaffTurnMapStorageKeyForDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return 'mom_staff_massage_turnmap_date_invalid';
    return 'mom_staff_massage_turnmap_date_' + dateStr;
}

function facialStaffTurnMapStorageKeyForDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return 'mom_staff_facial_turnmap_date_invalid';
    return 'mom_staff_facial_turnmap_date_' + dateStr;
}

function staffTurnMapStorageKeyForDate(dateStr, kind) {
    return kind === 'facial' ? facialStaffTurnMapStorageKeyForDate(dateStr) : massageStaffTurnMapStorageKeyForDate(dateStr);
}

function loadSavedStaffTurnMap(dateStr, kind) {
    try {
        const raw = localStorage.getItem(staffTurnMapStorageKeyForDate(dateStr, kind));
        if (!raw) return {};
        const o = JSON.parse(raw);
        if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
        return o;
    } catch (e) {
        return {};
    }
}

function rememberTherapistsForStaffingPick(therapists) {
    try {
        if (Array.isArray(therapists) && therapists.length) {
            sessionStorage.setItem(MOM_THERAPISTS_LIST_CACHE_KEY, JSON.stringify(therapists));
        }
    } catch (e) { /* ignore */ }
}

function rosterNameForStaffingPick(t) {
    const n = (t || '').trim();
    if (!n) return false;
    if (n.toLowerCase() === 'staff') return false;
    return true;
}

function getTherapistsForStaffingPickList() {
    let raw = [];
    if (currentData && Array.isArray(currentData.therapists) && currentData.therapists.length) {
        raw = currentData.therapists.filter(rosterNameForStaffingPick);
    } else {
        try {
            const s = sessionStorage.getItem(MOM_THERAPISTS_LIST_CACHE_KEY);
            if (s) {
                const arr = JSON.parse(s);
                if (Array.isArray(arr)) raw = arr.filter(rosterNameForStaffingPick);
            }
        } catch (e) { /* ignore */ }
    }
    return sortStaffingPickListForPopover(raw);
}

function loadSavedStaffPickSet(dateStr, kind, list) {
    const key = kind === 'facial' ? facialStaffPickStorageKeyForDate(dateStr) : massageStaffPickStorageKeyForDate(dateStr);
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const set = new Set();
        for (const n of arr) {
            if (typeof n === 'string' && list.includes(n)) set.add(n);
        }
        return set.size ? set : null;
    } catch (e) {
        return null;
    }
}

/** Staffing pick list length for this calendar date (drives "Staff today" / facial count dropdown). */
function savedStaffPickCountForDate(dateStr, kind) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return null;
    try {
        const key = kind === 'facial' ? facialStaffPickStorageKeyForDate(dateStr) : massageStaffPickStorageKeyForDate(dateStr);
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return null;
        const n = arr.filter((x) => typeof x === 'string' && String(x).trim()).length;
        if (kind === 'facial') {
            if (n < 1) return null;
            return Math.max(0, Math.min(MOM_MAX_PLANNED_STAFF, n));
        }
        if (n < 1) return null;
        return Math.max(1, Math.min(MOM_MAX_PLANNED_STAFF, n));
    } catch (e) {
        return null;
    }
}

function clearSavedStaffPickForDate(dateStr, kind) {
    try {
        localStorage.removeItem(kind === 'facial' ? facialStaffPickStorageKeyForDate(dateStr) : massageStaffPickStorageKeyForDate(dateStr));
        localStorage.removeItem(staffTurnMapStorageKeyForDate(dateStr, kind));
    } catch (e) { /* ignore */ }
}

/**
 * Massage staff in staffing-popover order for this calendar date (saved pick, else calendar-derived, else first N roster).
 */
function getMassageStaffPickOrderedNamesForDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return [];
    const list = getTherapistsForStaffingPickList();
    if (!list.length) return [];
    const dup = buildTherapistFirstNameDuplicates(list);
    let ordered = [];
    try {
        const raw = localStorage.getItem(massageStaffPickStorageKeyForDate(dateStr));
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                for (const entry of arr) {
                    if (typeof entry !== 'string') continue;
                    const hit = list.find((r) => therapistNamesMatchForCalendar(r, entry.trim(), dup));
                    if (hit && !ordered.some((x) => therapistNamesMatchForCalendar(x, hit, dup))) ordered.push(hit);
                }
            }
        }
    } catch (e) { /* ignore */ }
    if (ordered.length) return ordered;
    const initial = new Set();
    if (currentData && String(currentData.date) === String(dateStr) && Array.isArray(currentData.events)) {
        const fromCal = collectMassageTherapistNamesOnLocalDate(currentData.events, dateStr, list);
        for (const nm of fromCal) initial.add(nm);
    }
    if (initial.size) return list.filter((n) => initial.has(n));
    const targetN = getPlannedMassageStaffTodayCount();
    return list.slice(0, Math.min(targetN, list.length));
}

/** Massage block length in minutes (Square window minus neutral add-on time). */
function eventMassageDurationMinutes(apt) {
    if (!apt) return 60;
    const s = new Date(apt.start_at).getTime();
    const e = new Date(apt.end_at).getTime();
    const neutral = effectiveAddonTimeNeutralMinutes(apt);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 60;
    const mins = Math.round((e - s) / 60000) - neutral;
    if (!Number.isFinite(mins) || mins < 15) return 60;
    return Math.min(300, mins);
}

/**
 * First advertised duration in catalog service title (matches server _advertised_duration_minutes_from_service_title).
 */
function advertisedDurationMinutesFromServiceTitle(service) {
    const s = String(service || '').trim();
    if (!s) return null;
    const pats = [/\b(\d{1,3})\s*(?:minutes?|min)\b/i, /\b(\d{1,3})min\b/i];
    for (let i = 0; i < pats.length; i++) {
        const m = pats[i].exec(s);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n >= 15 && n <= 240) return n;
        }
    }
    const sl = s.toLowerCase();
    if (/\b2\s*[-\u2013]?\s*(?:h|hr|hour|hours)\b/i.test(sl)) return 120;
    if (/\b1\.5\s*[-\u2013]?\s*(?:h|hr|hour|hours)\b/i.test(sl)) return 90;
    return null;
}

/** Mirror server _addon_padding_minutes_vs_standard_tiers (no title minutes, but block = 60/90/120… + 5/10). */
function addonPaddingMinutesVsStandardTiers(service, durationMin, hasCupping, massageCtx) {
    if (!massageCtx || hasCupping || durationMin < 15) return 0;
    if (advertisedDurationMinutesFromServiceTitle(service) != null) return 0;
    for (const base of [240, 180, 150, 120, 90, 60]) {
        const d = durationMin - base;
        if (d === 5 || d === 10) return d;
    }
    return 0;
}

/**
 * Client-side mirror of server _addon_time_neutral_minutes when API omits addon_time_neutral_minutes (stale server / cache).
 */
function inferAddonTimeNeutralMinutes(ev) {
    if (!ev || ev._roomViewSlice) return 0;
    const service = String(ev.service || '');
    const displayService = String(ev.display_service || '');
    const noteBlob = [ev.addon_note, ev.customer_note, ev.seller_note].filter(Boolean).join(' ');
    const text = `${service} ${displayService} ${noteBlob}`.toLowerCase();
    const catalogLower = `${service} ${displayService}`.toLowerCase();
    const hasPainPhrase = text.includes('pain relief') || text.includes('pain-relief');
    const hasPainCream = text.includes('cream') && (text.includes('pain') || text.includes('relief'));
    const hasPain = hasPainPhrase || hasPainCream;
    const hasAromaWord = text.includes('aromatherapy') || text.includes('aroma therapy');
    const massageCtx = text.includes('massage') || text.includes('swedish') || text.includes('deep') || text.includes('tissue') || text.includes('couple');
    const hasLavenderScent = text.includes('lavender') && massageCtx;
    const massageCtxCatalog =
        catalogLower.includes('massage') ||
        catalogLower.includes('swedish') ||
        catalogLower.includes('deep') ||
        catalogLower.includes('tissue') ||
        catalogLower.includes('couple');
    const hasRoseScent = massageCtxCatalog && /\brose\b/i.test(catalogLower);
    const hasAroma = hasAromaWord || hasLavenderScent || hasRoseScent;
    if (hasPain && hasAroma) return 10;
    if (hasPain || hasAroma) return 5;
    let durationMin = 0;
    try {
        const st = new Date(ev.start_at).getTime();
        const en = new Date(ev.end_at).getTime();
        if (Number.isFinite(st) && Number.isFinite(en) && en > st) {
            durationMin = Math.round((en - st) / 60000);
        }
    } catch (_) { /* ignore */ }
    if (durationMin > 0) {
        const hasCupping =
            text.includes('cupping') ||
            /\bair\s+cup/i.test(text) ||
            text.includes('vacuum cup');
        const massageCtx =
            text.includes('massage') ||
            text.includes('swedish') ||
            text.includes('deep tissue') ||
            text.includes('hot stone') ||
            text.includes('prenatal') ||
            text.includes('sports massage') ||
            text.includes('couple') ||
            text.includes('couples');
        const advertised = advertisedDurationMinutesFromServiceTitle(service);
        if (advertised != null) {
            const delta = durationMin - advertised;
            if (delta === 5 || delta === 10) return delta;
            if (hasCupping && massageCtx && delta >= 5 && delta <= 60) return delta;
        } else if (hasCupping && massageCtx && durationMin >= 75) {
            for (const base of [120, 90, 60]) {
                if (durationMin > base) {
                    const d = durationMin - base;
                    if (d >= 5 && d <= 45) return d;
                }
            }
        }
        const pad = addonPaddingMinutesVsStandardTiers(service, durationMin, hasCupping, massageCtx);
        if (pad) return pad;
    }
    return 0;
}

/** Use API neutral when set; otherwise infer (lavender / aromatherapy / title vs block length). Room slices: always 0. */
function effectiveAddonTimeNeutralMinutes(ev) {
    if (!ev || ev._roomViewSlice) return 0;
    const n = Number(ev.addon_time_neutral_minutes) || 0;
    if (n > 0) return n;
    return inferAddonTimeNeutralMinutes(ev);
}

/** When Square extends end_at for scent/oil line items, physical room is free at real massage checkout. */
function eventPhysicalRoomBusyEndMs(ev) {
    if (!ev || !ev.end_at) return NaN;
    const startMs = new Date(ev.start_at).getTime();
    const endMs = new Date(ev.end_at).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return NaN;
    const neutral = effectiveAddonTimeNeutralMinutes(ev);
    const out = endMs - neutral * 60000;
    return Math.max(startMs, out);
}

/** Calendar column overlap / capacity: end instant for wall-clock session (not Square billing tail). */
function calendarColumnEventWallEndMs(ev) {
    const t = eventPhysicalRoomBusyEndMs(ev);
    return Number.isFinite(t) ? t : (ev && ev.end_at ? new Date(ev.end_at).getTime() : 0);
}

/** Roster for matching therapist strings on loaded calendar (same day as currentData). */
function rosterForStaffingTurnCounts() {
    if (currentData && Array.isArray(currentData.therapists) && currentData.therapists.length) {
        return currentData.therapists.filter(rosterNameForStaffingPick);
    }
    return getTherapistsForStaffingPickList();
}

function countMassageTurnSlotsForTherapistInEvent(ev, rosterName, dup) {
    if (!ev || !rosterName) return 0;
    let c = 0;
    for (const field of [ev.therapist, ev.therapist_2]) {
        if (!field || String(field).trim().toLowerCase() === 'staff') continue;
        if (therapistNamesMatchForCalendar(rosterName, field, dup)) c++;
    }
    return c;
}

function countFacialTurnSlotsForTherapistInEvent(ev, rosterName, dup) {
    if (!ev || !rosterName) return 0;
    let c = 0;
    for (const field of [ev.facial_specialist, ev.luxury_mini_facial_therapist, ev.luxury_mini_facial_therapist_2]) {
        if (!field || String(field).trim().toLowerCase() === 'staff') continue;
        if (therapistNamesMatchForCalendar(rosterName, field, dup)) c++;
    }
    return c;
}

let momFacialStaffingSimCache = { sig: '', sim: null };
let momMassageAnyStaffSimCache = { sig: '', sim: null };

function invalidateMomFacialStaffingSimCache() {
    momFacialStaffingSimCache.sig = '';
    momFacialStaffingSimCache.sim = null;
}

function invalidateMomMassageAnyStaffSimCache() {
    momMassageAnyStaffSimCache.sig = '';
    momMassageAnyStaffSimCache.sim = null;
}

function rosterNameKeyLower(name) {
    return String(name || '').trim().toLowerCase();
}

function hashEventsLightForFacialSim(events) {
    let h = 0;
    for (const ev of events || []) {
        const s = String(ev.booking_id || '')
            + (ev.facial_specialist || '')
            + (ev.luxury_mini_facial_therapist || '')
            + (ev.luxury_mini_facial_therapist_2 || '')
            + (ev.end_at || '')
            + (ev.therapist || '');
        for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return String(h);
}

/** Customer requested this name as masseuse but they are not assigned on that booking — same rule as facial pool hints. */
function masseuseRequestConflictForFacialPoolMember(name, events, aMs, bMs, dup, roster) {
    for (const ev of events || []) {
        if (!ev || ev.room === 'ADDON' || ev.original_any_available) continue;
        const ori = (ev.original_therapist || '').trim();
        if (!ori || !therapistNamesMatchForCalendar(name, ori, dup)) continue;
        const est = new Date(ev.start_at).getTime();
        const en = new Date(ev.end_at).getTime();
        if (!Number.isFinite(est) || !Number.isFinite(en) || en <= est) continue;
        if (!calendarEventsOverlapRange(est, en, aMs, bMs)) continue;
        const assignedHere =
            therapistNamesMatchForCalendar(name, ev.therapist, dup)
            || (ev.therapist_2 && therapistNamesMatchForCalendar(name, ev.therapist_2, dup));
        if (assignedHere || isAssignedTherapistStaff(ev)) continue;
        return true;
    }
    return false;
}

function explicitFacialProviderNamesInOrder(ev, roster, dup) {
    const out = [];
    const seen = new Set();
    function add(raw) {
        const t = (raw || '').trim();
        if (!t || t.toLowerCase() === 'staff') return;
        const hit = roster.find((r) => therapistNamesMatchForCalendar(r, t, dup));
        const full = hit || t;
        const k = full.trim().toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        out.push(full);
    }
    add(ev.facial_specialist);
    add(ev.luxury_mini_facial_therapist);
    add(ev.luxury_mini_facial_therapist_2);
    return out;
}

/** True when calendar stores Staff on a facial field (off-rotation / unnamed FS — not pool round-robin). */
function facialFieldsContainExplicitStaff(ev) {
    if (!ev) return false;
    for (const f of [ev.facial_specialist, ev.luxury_mini_facial_therapist, ev.luxury_mini_facial_therapist_2]) {
        if (String(f || '').trim().toLowerCase() === 'staff') return true;
    }
    return false;
}

/**
 * "So Far" facial sim must not assign pool members when the booking explicitly says Staff and no named FS
 * resolved to the roster (e.g. Hongxia did it but only Staff appears in Square — avoids crediting May).
 */
function facialStaffingSkipPoolRoundRobinForEvent(ev, roster, dup) {
    return facialFieldsContainExplicitStaff(ev) && explicitFacialProviderNamesInOrder(ev, roster, dup).length === 0;
}

/**
 * Whether an event counts toward the loaded calendar day for staffing / turn counts.
 * Prefer matching ev.date when set; if it disagrees with start_at's calendar day, treat start_at as authoritative
 * so counts stay aligned with the customer-request bar (that summary does not drop events on ev.date alone).
 */
function eventIsOnStaffingCalendarDay(ev, dayStr) {
    if (!ev || !dayStr || !String(dayStr).trim()) return true;
    const ds = String(dayStr).trim();
    const dField = ev.date != null ? String(ev.date).trim() : '';
    const startIso = ev.start_at ? String(ev.start_at) : '';
    const startDay = startIso.length >= 10 ? startIso.slice(0, 10) : '';
    if (dField && dField === ds) return true;
    if (startDay && startDay === ds) return true;
    if (!dField) return true;
    return false;
}

/**
 * When checked facial specialists exist (saved pick), attribute each facial work unit on the day to a pool member:
 * explicit facial fields first, else round-robin by saved order among those who are free (no overlap, no masseuse-request conflict).
 * If the calendar has Staff on facial fields and no named FS on the roster, skip round-robin (Staff = off-rotation / unnamed).
 */
function computeFacialStaffingAttributionCore(dateStr, events, roster, dup, orderedPool) {
    const empty = () => ({
        mode: 'none',
        orderedPool: orderedPool || [],
        countPast: new Map(),
        countFuture: new Map(),
        itemsPast: new Map(),
        itemsFuture: new Map(),
        busyIntervalsByName: new Map(),
    });
    if (!orderedPool || !orderedPool.length) return empty();
    const dayStr = dateStr;
    const nowMs = Date.now();
    const dayEvents = (events || []).filter((ev) => {
        if (!ev || ev.room === 'ADDON') return false;
        if (!eventIsOnStaffingCalendarDay(ev, dayStr)) return false;
        return true;
    });
    const units = [];
    for (const ev of dayEvents) {
        const ints = eventFacialAppointmentIntervals(ev);
        if (!ints.length) continue;
        const expl = explicitFacialProviderNamesInOrder(ev, roster, dup);
        let g = 0;
        for (const it of ints) {
            for (let i = 0; i < it.n; i++) {
                const explicitName = g < expl.length ? expl[g] : null;
                g++;
                units.push({ ev, a: it.a, b: it.b, explicitName });
            }
        }
    }
    units.sort((u1, u2) => {
        if (u1.a !== u2.a) return u1.a - u2.a;
        const t1 = new Date(u1.ev.start_at).getTime();
        const t2 = new Date(u2.ev.start_at).getTime();
        if (t1 !== t2) return t1 - t2;
        return String(u1.ev.booking_id || '').localeCompare(String(u2.ev.booking_id || ''));
    });
    function inPool(fullName) {
        return orderedPool.some((p) => therapistNamesMatchForCalendar(p, fullName, dup));
    }
    function canonKeyFor(name) {
        const hit = orderedPool.find((p) => therapistNamesMatchForCalendar(p, name, dup));
        return rosterNameKeyLower(hit || name);
    }
    function pushBusyInterval(simBusy, key, a, b) {
        if (!simBusy.has(key)) simBusy.set(key, []);
        simBusy.get(key).push({ a, b });
    }
    const busy = [];
    const simBusy = new Map();
    let rr = 0;
    const countPast = new Map();
    const countFuture = new Map();
    const itemsPast = new Map();
    const itemsFuture = new Map();
    function overlapsBusy(a, b, key) {
        return busy.some((g) => g.key === key && !(b <= g.a || a >= g.b));
    }
    function tryAssignNamed(fullName, ev, a, b, isFuture) {
        if (!fullName || !inPool(fullName)) return false;
        if (masseuseRequestConflictForFacialPoolMember(fullName, events, a, b, dup, roster)) return false;
        const key = canonKeyFor(fullName);
        if (overlapsBusy(a, b, key)) return false;
        if (therapistBusyAsProviderExcludingBooking(fullName, events, a, b, dup, roster, ev.booking_id)) return false;
        busy.push({ key, a, b });
        pushBusyInterval(simBusy, key, a, b);
        const m = isFuture ? countFuture : countPast;
        m.set(key, (m.get(key) || 0) + 1);
        const imap = isFuture ? itemsFuture : itemsPast;
        if (!imap.has(key)) imap.set(key, []);
        const arr = imap.get(key);
        const bid = ev.booking_id || '';
        if (!arr.some((x) => x.ev.booking_id === bid)) arr.push(staffingFacialTooltipRowFromEvent(ev));
        return true;
    }
    for (const u of units) {
        const ev = u.ev;
        const { a, b, explicitName } = u;
        const evStartMs = new Date(ev.start_at).getTime();
        const isFuture = Number.isFinite(evStartMs) && evStartMs > nowMs;
        if (explicitName && tryAssignNamed(explicitName, ev, a, b, isFuture)) continue;
        if (!explicitName && facialStaffingSkipPoolRoundRobinForEvent(ev, roster, dup)) continue;
        let assigned = false;
        for (let j = 0; j < orderedPool.length; j++) {
            const cand = orderedPool[(rr + j) % orderedPool.length];
            if (masseuseRequestConflictForFacialPoolMember(cand, events, a, b, dup, roster)) continue;
            const ck = rosterNameKeyLower(cand);
            if (overlapsBusy(a, b, ck)) continue;
            if (therapistBusyAsProviderExcludingBooking(cand, events, a, b, dup, roster, ev.booking_id)) continue;
            busy.push({ key: ck, a, b });
            pushBusyInterval(simBusy, ck, a, b);
            rr = (rr + j + 1) % orderedPool.length;
            const m = isFuture ? countFuture : countPast;
            m.set(ck, (m.get(ck) || 0) + 1);
            const imap = isFuture ? itemsFuture : itemsPast;
            if (!imap.has(ck)) imap.set(ck, []);
            const arr = imap.get(ck);
            const bid = ev.booking_id || '';
            if (!arr.some((x) => x.ev.booking_id === bid)) arr.push(staffingFacialTooltipRowFromEvent(ev));
            assigned = true;
            break;
        }
        if (!assigned) {
            /* No checked FS free for this facial window — not attributed in popover counts */
        }
    }
    return {
        mode: 'sim',
        orderedPool,
        countPast,
        countFuture,
        itemsPast,
        itemsFuture,
        busyIntervalsByName: simBusy,
    };
}

/** While the facial staffing popover is open, use checked names in turn order (turn inputs, then list order). */
function getFacialStaffPickLiveOrderedFromPopover() {
    const root = document.getElementById('staffingAvailPopover');
    if (!root || root.hidden || root.dataset.staffingKind !== 'facial') return null;
    const listEl = document.getElementById('staffingAvailPopoverList');
    if (!listEl) return null;
    const items = [];
    listEl.querySelectorAll('.staffing-avail-popover-row').forEach((row, rowIndex) => {
        const cb = row.querySelector('input[type="checkbox"]');
        const inp = row.querySelector('.staffing-avail-turn-input');
        if (!cb || !cb.checked) return;
        const name = (cb.value || '').trim();
        if (!name) return;
        const raw = inp ? String(inp.value || '').trim() : '';
        const n = parseInt(raw, 10);
        const turn = Number.isFinite(n) && n > 0 ? n : null;
        items.push({ name, turn, rowIndex });
    });
    if (!items.length) return null;
    items.sort((a, b) => {
        if (a.turn != null && b.turn != null && a.turn !== b.turn) return a.turn - b.turn;
        if (a.turn == null && b.turn != null) return 1;
        if (a.turn != null && b.turn == null) return -1;
        return a.rowIndex - b.rowIndex;
    });
    return items.map((x) => x.name);
}

function getMomFacialStaffingSimulationCached(dateStr, events, roster, dup) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) {
        return computeFacialStaffingAttributionCore(dateStr, events, roster, dup, null);
    }
    const live = getFacialStaffPickLiveOrderedFromPopover();
    const saved = getFacialSpecialistPickNamesForDate(dateStr, dup);
    const pool = live && live.length ? live : saved;
    const poolKey = live && live.length
        ? `L:${live.map((p) => rosterNameKeyLower(p)).join('|')}`
        : `S:${saved && saved.length ? saved.map((p) => rosterNameKeyLower(p)).join('|') : ''}`;
    const sig = `${dateStr}|${poolKey}|${hashEventsLightForFacialSim(events)}`;
    if (momFacialStaffingSimCache.sig === sig && momFacialStaffingSimCache.sim) return momFacialStaffingSimCache.sim;
    const sim = computeFacialStaffingAttributionCore(dateStr, events, roster, dup, pool);
    momFacialStaffingSimCache = { sig, sim };
    return sim;
}

/** Future massage slots that are still Staff/empty on an “any staff” booking (one unit per slot; couple → up to 2). */
function collectFutureAnyStaffOpenMassageUnits(events, dayStr) {
    const nowMs = Date.now();
    const units = [];
    for (const ev of events || []) {
        if (!ev || ev.room === 'ADDON') continue;
        if (!eventIsOnStaffingCalendarDay(ev, dayStr)) continue;
        const startMs = new Date(ev.start_at).getTime();
        if (!Number.isFinite(startMs) || startMs <= nowMs) continue;
        if (!customerAnyAvailEffective(ev)) continue;
        const a = startMs;
        const b = startMs + eventMassageDurationMinutes(ev) * 60000;
        if (!Number.isFinite(b) || b <= a) continue;
        const isCouple = String(ev.type || '').toLowerCase() === 'couple';
        if (isCouple) {
            if (isSlotTherapistUnset(ev.therapist)) units.push({ ev, slot: 1, a, b });
            if (isSlotTherapistUnset(ev.therapist_2)) units.push({ ev, slot: 2, a, b });
        } else if (isSlotTherapistUnset(ev.therapist)) {
            units.push({ ev, slot: 1, a, b });
        }
    }
    units.sort((u1, u2) => {
        if (u1.a !== u2.a) return u1.a - u2.a;
        const t1 = new Date(u1.ev.start_at).getTime() - new Date(u2.ev.start_at).getTime();
        if (t1 !== 0) return t1;
        const c = String(u1.ev.booking_id || '').localeCompare(String(u2.ev.booking_id || ''));
        if (c !== 0) return c;
        return u1.slot - u2.slot;
    });
    return units;
}

function hashEventsLightForMassageAnyStaffSim(events) {
    let h = 0;
    for (const ev of events || []) {
        const s = String(ev.booking_id || '')
            + (ev.therapist || '')
            + (ev.therapist_2 || '')
            + String(ev.type || '')
            + String(ev.original_any_available || '')
            + (isAssignedTherapistStaff(ev) ? '1' : '0')
            + (ev.customer_note || '')
            + (ev.seller_note || '')
            + (ev.addon_note || '')
            + (ev.start_at || '')
            + (ev.end_at || '');
        for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return String(h);
}

/**
 * Past massage slots attributed from notes/Square (customer request summary) when this roster is not on therapist/therapist_2.
 * Single booking: at most 1; couple: at most min(2, number of matching request rows for this roster).
 */
function massagePastExtraSlotCountForRoster(ev, rosterName, dup, crItems) {
    if (!ev || !rosterName || !crItems || !crItems.length) return 0;
    const startMs = new Date(ev.start_at).getTime();
    if (!Number.isFinite(startMs) || startMs > Date.now()) return 0;
    if (countMassageTurnSlotsForTherapistInEvent(ev, rosterName, dup) > 0) return 0;
    if (!eventHasCustomerRequestLineForRoster(rosterName, ev, dup, crItems)) return 0;
    const bid = String(ev.booking_id || '');
    let n = 0;
    for (let i = 0; i < crItems.length; i++) {
        const it = crItems[i];
        if (String(it.booking_id || '') !== bid) continue;
        if (therapistNamesMatchForCalendar(rosterName, it.requested_masseuse, dup)) n++;
    }
    const maxSlots = String(ev.type || '').toLowerCase() === 'couple' ? 2 : 1;
    return Math.min(maxSlots, n);
}

/** Distinct requested masseuse names on a booking (from customer-request summary), for pool vs note split. */
function massageDistinctRequestNameCountForBooking(ev, crItems, dup, roster) {
    const bid = String(ev && ev.booking_id || '');
    if (!bid || !crItems || !crItems.length) return 0;
    const seen = new Set();
    let n = 0;
    for (let i = 0; i < crItems.length; i++) {
        const it = crItems[i];
        if (String(it.booking_id || '') !== bid) continue;
        const hit = roster.find((r) => therapistNamesMatchForCalendar(r, it.requested_masseuse, dup));
        const canon = (hit || String(it.requested_masseuse || '').trim()).trim().toLowerCase();
        if (!canon) continue;
        if (seen.has(canon)) continue;
        seen.add(canon);
        n++;
    }
    return n;
}

/**
 * Past Staff/empty massage slots filled by pool simulation. Bookings with note/Square requests: only the
 * Staff slots *after* the first N unset slots are assumed covered by those N distinct requests (see massagePastExtraSlotCountForRoster).
 */
function collectPastMassagePoolOnlyUnits(events, dayStr, crItems) {
    const nowMs = Date.now();
    const units = [];
    const crList = Array.isArray(crItems) ? crItems : [];
    const roster = rosterForStaffingTurnCounts();
    const dup = buildTherapistFirstNameDuplicates(roster);
    for (const ev of events || []) {
        if (!ev || ev.room === 'ADDON') continue;
        if (!eventIsOnStaffingCalendarDay(ev, dayStr)) continue;
        const startMs = new Date(ev.start_at).getTime();
        if (!Number.isFinite(startMs) || startMs > nowMs) continue;
        const a = startMs;
        const b = startMs + eventMassageDurationMinutes(ev) * 60000;
        if (!Number.isFinite(b) || b <= a) continue;
        const isCouple = String(ev.type || '').toLowerCase() === 'couple';
        const slots = [];
        if (isCouple) {
            if (isSlotTherapistUnset(ev.therapist)) slots.push(1);
            if (isSlotTherapistUnset(ev.therapist_2)) slots.push(2);
        } else if (isSlotTherapistUnset(ev.therapist)) {
            slots.push(1);
        }
        if (!slots.length) continue;
        const nReq = massageDistinctRequestNameCountForBooking(ev, crList, dup, roster);
        const claimed = Math.min(nReq, slots.length);
        const poolSlots = slots.slice(claimed);
        for (const slot of poolSlots) {
            units.push({ ev, slot, a, b, phase: 'past_pool' });
        }
    }
    units.sort((u1, u2) => {
        if (u1.a !== u2.a) return u1.a - u2.a;
        const t1 = new Date(u1.ev.start_at).getTime() - new Date(u2.ev.start_at).getTime();
        if (t1 !== 0) return t1;
        const c = String(u1.ev.booking_id || '').localeCompare(String(u2.ev.booking_id || ''));
        if (c !== 0) return c;
        return u1.slot - u2.slot;
    });
    return units;
}

function massageBasePastLoadForRosterName(rosterName, events, dayStr, crItems, dup, nowMs) {
    let total = 0;
    for (const ev of events || []) {
        if (!ev || ev.room === 'ADDON') continue;
        if (!eventIsOnStaffingCalendarDay(ev, dayStr)) continue;
        const startMs = new Date(ev.start_at).getTime();
        if (!Number.isFinite(startMs) || startMs > nowMs) continue;
        total += countMassageTurnSlotsForTherapistInEvent(ev, rosterName, dup);
        total += massagePastExtraSlotCountForRoster(ev, rosterName, dup, crItems);
    }
    return total;
}

/** While the massage staffing popover is open, use checked names in turn order (turn inputs, then list order). */
function getMassageStaffPickLiveOrderedFromPopover() {
    const root = document.getElementById('staffingAvailPopover');
    if (!root || root.hidden || root.dataset.staffingKind !== 'massage') return null;
    const listEl = document.getElementById('staffingAvailPopoverList');
    if (!listEl) return null;
    const items = [];
    listEl.querySelectorAll('.staffing-avail-popover-row').forEach((row, rowIndex) => {
        const cb = row.querySelector('input[type="checkbox"]');
        const inp = row.querySelector('.staffing-avail-turn-input');
        if (!cb || !cb.checked) return;
        const name = (cb.value || '').trim();
        if (!name) return;
        const raw = inp ? String(inp.value || '').trim() : '';
        const n = parseInt(raw, 10);
        const turn = Number.isFinite(n) && n > 0 ? n : null;
        items.push({ name, turn, rowIndex });
    });
    if (!items.length) return null;
    items.sort((a, b) => {
        if (a.turn != null && b.turn != null && a.turn !== b.turn) return a.turn - b.turn;
        if (a.turn == null && b.turn != null) return 1;
        if (a.turn != null && b.turn == null) return -1;
        return a.rowIndex - b.rowIndex;
    });
    return items.map((x) => x.name);
}

/**
 * Assign (1) past Staff slots on bookings with no request lines, and (2) future open “any staff” massage slots,
 * in chronological order. Picks among the checked pool who are free: **least** simulated load so far
 * (calendar past + note requests + slots already assigned in this run), then earliest in turn order.
 * Skips masseuse-request conflicts and overlapping provider work (massage + facial).
 */
function computeMassageAnyStaffAttributionCore(dateStr, events, roster, dup, orderedPool, crItems) {
    const crList = Array.isArray(crItems) ? crItems : [];
    const empty = () => ({
        mode: 'none',
        orderedPool: orderedPool || [],
        countAnyStaffFutureByKey: new Map(),
        itemsAnyStaffFutureByKey: new Map(),
        countPastPoolByKey: new Map(),
        itemsPastPoolByKey: new Map(),
    });
    if (!orderedPool || !orderedPool.length) return empty();
    const nowMs = Date.now();
    const countAnyStaffFutureByKey = new Map();
    const itemsAnyStaffFutureByKey = new Map();
    const countPastPoolByKey = new Map();
    const itemsPastPoolByKey = new Map();
    const pastPool = collectPastMassagePoolOnlyUnits(events, dateStr, crList);
    const futAny = collectFutureAnyStaffOpenMassageUnits(events, dateStr).map((u) => (
        { ev: u.ev, slot: u.slot, a: u.a, b: u.b, phase: 'any_staff_future' }
    ));
    const units = pastPool.concat(futAny);
    units.sort((u1, u2) => {
        if (u1.a !== u2.a) return u1.a - u2.a;
        const t1 = new Date(u1.ev.start_at).getTime() - new Date(u2.ev.start_at).getTime();
        if (t1 !== 0) return t1;
        const c = String(u1.ev.booking_id || '').localeCompare(String(u2.ev.booking_id || ''));
        if (c !== 0) return c;
        if (u1.phase !== u2.phase) return u1.phase === 'past_pool' ? -1 : 1;
        return u1.slot - u2.slot;
    });
    if (!units.length) {
        return {
            mode: 'sim',
            orderedPool,
            countAnyStaffFutureByKey,
            itemsAnyStaffFutureByKey,
            countPastPoolByKey,
            itemsPastPoolByKey,
        };
    }
    const baseLoadByKey = new Map();
    for (const p of orderedPool) {
        const k = rosterNameKeyLower(p);
        baseLoadByKey.set(k, massageBasePastLoadForRosterName(p, events, dateStr, crList, dup, nowMs));
    }
    const simAddPast = new Map();
    const simAddAnyFut = new Map();
    function currentLoad(ck) {
        return (baseLoadByKey.get(ck) || 0) + (simAddPast.get(ck) || 0) + (simAddAnyFut.get(ck) || 0);
    }
    const busy = [];
    function overlapsBusy(a, b, key) {
        return busy.some((g) => g.key === key && !(b <= g.a || a >= g.b));
    }
    function pushAnyFut(key, ev, slot) {
        const arr = itemsAnyStaffFutureByKey.has(key) ? itemsAnyStaffFutureByKey.get(key) : null;
        const bid = String(ev.booking_id || '');
        const st = slot === 2 ? 2 : 1;
        if (arr && arr.some((x) => String(x.ev.booking_id || '') === bid && x.slot === st)) return;
        if (!itemsAnyStaffFutureByKey.has(key)) itemsAnyStaffFutureByKey.set(key, []);
        itemsAnyStaffFutureByKey.get(key).push({
            ev,
            slot: st,
            tip: st === 2 ? ev.tip_amount_2 : ev.tip_amount,
        });
        countAnyStaffFutureByKey.set(key, (countAnyStaffFutureByKey.get(key) || 0) + 1);
    }
    function pushPastPool(key, ev, slot) {
        const arr = itemsPastPoolByKey.has(key) ? itemsPastPoolByKey.get(key) : null;
        const bid = String(ev.booking_id || '');
        const st = slot === 2 ? 2 : 1;
        if (arr && arr.some((x) => String(x.ev.booking_id || '') === bid && x.slot === st)) return;
        if (!itemsPastPoolByKey.has(key)) itemsPastPoolByKey.set(key, []);
        itemsPastPoolByKey.get(key).push({
            ev,
            slot: st,
            tip: st === 2 ? ev.tip_amount_2 : ev.tip_amount,
        });
        countPastPoolByKey.set(key, (countPastPoolByKey.get(key) || 0) + 1);
    }
    for (const u of units) {
        const { ev, a, b, slot, phase } = u;
        const candIdx = [];
        for (let j = 0; j < orderedPool.length; j++) {
            const cand = orderedPool[j];
            if (masseuseRequestConflictForFacialPoolMember(cand, events, a, b, dup, roster)) continue;
            const ck = rosterNameKeyLower(cand);
            if (overlapsBusy(a, b, ck)) continue;
            if (therapistBusyAsProviderExcludingBooking(cand, events, a, b, dup, roster, ev.booking_id)) continue;
            candIdx.push(j);
        }
        if (!candIdx.length) continue;
        let bestIdx = candIdx[0];
        let bestLoad = currentLoad(rosterNameKeyLower(orderedPool[bestIdx]));
        for (let x = 1; x < candIdx.length; x++) {
            const j = candIdx[x];
            const L = currentLoad(rosterNameKeyLower(orderedPool[j]));
            if (L < bestLoad || (L === bestLoad && j < bestIdx)) {
                bestLoad = L;
                bestIdx = j;
            }
        }
        const cand = orderedPool[bestIdx];
        const ck = rosterNameKeyLower(cand);
        busy.push({ key: ck, a, b });
        if (phase === 'past_pool') {
            simAddPast.set(ck, (simAddPast.get(ck) || 0) + 1);
            pushPastPool(ck, ev, slot);
        } else {
            simAddAnyFut.set(ck, (simAddAnyFut.get(ck) || 0) + 1);
            pushAnyFut(ck, ev, slot);
        }
    }
    return {
        mode: 'sim',
        orderedPool,
        countAnyStaffFutureByKey,
        itemsAnyStaffFutureByKey,
        countPastPoolByKey,
        itemsPastPoolByKey,
    };
}

function getMomMassageAnyStaffSimulationCached(dateStr, events, roster, dup) {
    const crPayload = buildCustomerRequestsSummaryFromEvents(events, roster);
    const crItems = crPayload && crPayload.items ? crPayload.items : [];
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) {
        return computeMassageAnyStaffAttributionCore(dateStr, events, roster, dup, null, crItems);
    }
    const live = getMassageStaffPickLiveOrderedFromPopover();
    const saved = getMassageStaffPickOrderedNamesForDate(dateStr);
    const pool = live && live.length ? live : (saved && saved.length ? saved : null);
    const poolKey = live && live.length
        ? `L:${live.map((p) => rosterNameKeyLower(p)).join('|')}`
        : `S:${saved && saved.length ? saved.map((p) => rosterNameKeyLower(p)).join('|') : ''}`;
    const sig = `${dateStr}|${poolKey}|${hashEventsLightForMassageAnyStaffSim(events)}`;
    if (momMassageAnyStaffSimCache.sig === sig && momMassageAnyStaffSimCache.sim) return momMassageAnyStaffSimCache.sim;
    const sim = computeMassageAnyStaffAttributionCore(dateStr, events, roster, dup, pool, crItems);
    momMassageAnyStaffSimCache = { sig, sim };
    return sim;
}

function massageAnyStaffAssignedFutureCount(rosterName, sim, dup) {
    if (!rosterName || !sim || sim.mode !== 'sim') return 0;
    const hit = sim.orderedPool.find((p) => therapistNamesMatchForCalendar(rosterName, p, dup));
    const key = rosterNameKeyLower(hit || rosterName);
    return sim.countAnyStaffFutureByKey.get(key) || 0;
}

function facialStaffingCountForRoster(rosterName, kind, dup, roster, events, dayStr, sim) {
    if (kind !== 'facial' || sim.mode !== 'sim') return null;
    const hit = sim.orderedPool.find((p) => therapistNamesMatchForCalendar(rosterName, p, dup));
    const key = rosterNameKeyLower(hit || rosterName);
    return {
        past: sim.countPast.get(key) || 0,
        future: sim.countFuture.get(key) || 0,
    };
}

function staffingPopoverLoadedCalendarDateStr() {
    if (currentData && currentData.date && /^\d{4}-\d{2}-\d{2}$/.test(String(currentData.date))) {
        return String(currentData.date);
    }
    const inp = document.getElementById('dateInput');
    if (inp && inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value)) return inp.value;
    return getTodayLocal();
}

/**
 * Massage/facial slot counts for the loaded day, split by whether the appointment has started yet (local time).
 * "So far" = start_at <= now (includes in progress); "Booked later" = start_at > now. ADDON excluded.
 * Massage "Booked later": same rules as the requested-therapist bar (crItems) plus this roster on therapist / therapist_2.
 * Facial: when a checked FS pool exists (saved pick for this calendar date, or live picks while the facial popover is open), counts use
 * simulated assignment (turn order + availability, no masseuse-request conflict); otherwise explicit facial fields only on calendar.
 * Day membership uses eventIsOnStaffingCalendarDay (ev.date and/or start_at date vs loaded day).
 */
function countStaffTurnsForLoadedDayPastFuture(rosterName, kind, crItems) {
    const roster = rosterForStaffingTurnCounts();
    if (!rosterName || !roster || !roster.length) return { past: 0, future: 0 };
    const dup = buildTherapistFirstNameDuplicates(roster);
    const events = (currentData && Array.isArray(currentData.events)) ? currentData.events : [];
    const crList = Array.isArray(crItems) ? crItems : [];
    const dayStr = staffingPopoverLoadedCalendarDateStr();
    const nowMs = Date.now();
    const facial = kind === 'facial';
    if (facial) {
        const sim = getMomFacialStaffingSimulationCached(dayStr, events, roster, dup);
        const simCounts = facialStaffingCountForRoster(rosterName, kind, dup, roster, events, dayStr, sim);
        if (simCounts) return simCounts;
    }
    let past = 0;
    let future = 0;
    for (const ev of events) {
        if (!ev || ev.room === 'ADDON') continue;
        if (!eventIsOnStaffingCalendarDay(ev, dayStr)) continue;
        const startMs = new Date(ev.start_at).getTime();
        if (!Number.isFinite(startMs)) continue;
        const isFuture = startMs > nowMs;

        if (facial) {
            const slots = countFacialTurnSlotsForTherapistInEvent(ev, rosterName, dup);
            if (slots <= 0) continue;
            if (isFuture) future += slots;
            else past += slots;
        } else {
            if (isFuture) {
                future += staffingFutureMassageRequestedSlotCount(rosterName, ev, dup, crList);
            } else {
                past += countMassageTurnSlotsForTherapistInEvent(ev, rosterName, dup);
                past += massagePastExtraSlotCountForRoster(ev, rosterName, dup, crList);
            }
        }
    }
    if (!facial) {
        const simM = getMomMassageAnyStaffSimulationCached(dayStr, events, roster, dup);
        if (simM.mode === 'sim' && simM.countPastPoolByKey) {
            const hit = simM.orderedPool.find((p) => therapistNamesMatchForCalendar(rosterName, p, dup));
            const k = rosterNameKeyLower(hit || rosterName);
            past += simM.countPastPoolByKey.get(k) || 0;
        }
    }
    return { past, future };
}

function formatTipDollarsOrDash(val) {
    if (val == null || val === '') return '—';
    const n = Number(val);
    if (!Number.isFinite(n)) return '—';
    return '$' + n.toFixed(2);
}

/** Combined recorded tips for the booking (facial popover has no separate FS tip fields). */
function facialTipCombinedForEvent(ev) {
    let sum = 0;
    let any = false;
    for (const key of ['tip_amount', 'tip_amount_2']) {
        const v = ev && ev[key];
        if (v == null || v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        sum += n;
        any = true;
    }
    return any ? sum : null;
}

/**
 * Rows for hover tooltip: same filters as countStaffTurnsForLoadedDayPastFuture.
 * Massage: one row per matching therapist slot (couple may yield two rows). Facial: one row per event.
 */
function collectStaffingTurnTooltipRows(rosterName, kind, bucket) {
    const roster = rosterForStaffingTurnCounts();
    if (!rosterName || !roster || !roster.length) return [];
    const dup = buildTherapistFirstNameDuplicates(roster);
    const events = (currentData && Array.isArray(currentData.events)) ? currentData.events : [];
    const crPayload = buildCustomerRequestsSummaryFromEvents(events, roster);
    const crItems = crPayload && crPayload.items ? crPayload.items : [];
    const dayStr = staffingPopoverLoadedCalendarDateStr();
    const nowMs = Date.now();
    const facial = kind === 'facial';
    if (facial) {
        const sim = getMomFacialStaffingSimulationCached(dayStr, events, roster, dup);
        if (sim.mode === 'sim') {
            const hit = sim.orderedPool.find((p) => therapistNamesMatchForCalendar(rosterName, p, dup));
            const key = rosterNameKeyLower(hit || rosterName);
            const arr = bucket === 'past' ? sim.itemsPast.get(key) : sim.itemsFuture.get(key);
            const base = arr && arr.length ? arr.slice() : [];
            base.sort((a, b) => new Date(a.ev.start_at).getTime() - new Date(b.ev.start_at).getTime());
            return base;
        }
    }
    const out = [];
    for (const ev of events) {
        if (!ev || ev.room === 'ADDON') continue;
        if (!eventIsOnStaffingCalendarDay(ev, dayStr)) continue;
        const startMs = new Date(ev.start_at).getTime();
        if (!Number.isFinite(startMs)) continue;
        const isFuture = startMs > nowMs;
        if (bucket === 'past' && isFuture) continue;
        if (bucket === 'future' && !isFuture) continue;

        if (facial) {
            const slots = countFacialTurnSlotsForTherapistInEvent(ev, rosterName, dup);
            if (slots <= 0) continue;
            out.push(staffingFacialTooltipRowFromEvent(ev));
        } else {
            const m1 = therapistNamesMatchForCalendar(rosterName, ev.therapist, dup);
            const m2 = therapistNamesMatchForCalendar(rosterName, ev.therapist_2, dup);
            if (bucket === 'future') {
                if (!eventHasCustomerRequestLineForRoster(rosterName, ev, dup, crItems)) continue;
                const slotTotal = staffingFutureMassageRequestedSlotCount(rosterName, ev, dup, crItems);
                if (slotTotal <= 0) continue;
                let pushed = 0;
                if (m1) {
                    const wLux = luxurySeparateMiniWallClockMs(ev);
                    if (luxurySeparateMiniSingleBooking(ev) && wLux) {
                        out.push({
                            ev,
                            tip: luxurySeparateMiniMassageTipDisplay(ev),
                            _momSegStartMs: wLux.massageStartMs,
                            _momSegEndMs: wLux.massageEndMs,
                        });
                    } else {
                        out.push({ ev, tip: ev.tip_amount });
                    }
                    pushed++;
                }
                if (m2) {
                    out.push({ ev, tip: ev.tip_amount_2 });
                    pushed++;
                }
                while (pushed < slotTotal) {
                    out.push({ ev, tip: ev.tip_amount, _momUnassignedRequestSlot: pushed });
                    pushed++;
                }
            } else {
                if (m1) {
                    const wLux = luxurySeparateMiniWallClockMs(ev);
                    if (luxurySeparateMiniSingleBooking(ev) && wLux) {
                        out.push({
                            ev,
                            tip: luxurySeparateMiniMassageTipDisplay(ev),
                            _momSegStartMs: wLux.massageStartMs,
                            _momSegEndMs: wLux.massageEndMs,
                        });
                    } else {
                        out.push({ ev, tip: ev.tip_amount });
                    }
                }
                if (m2) out.push({ ev, tip: ev.tip_amount_2 });
                const xn = massagePastExtraSlotCountForRoster(ev, rosterName, dup, crItems);
                if (xn > 0) {
                    out.push({ ev, tip: ev.tip_amount });
                }
            }
        }
    }
    if (!facial && bucket === 'past') {
        const simM = getMomMassageAnyStaffSimulationCached(dayStr, events, roster, dup);
        if (simM.mode === 'sim' && simM.itemsPastPoolByKey) {
            const hit = simM.orderedPool.find((p) => therapistNamesMatchForCalendar(rosterName, p, dup));
            const key = rosterNameKeyLower(hit || rosterName);
            for (const row of simM.itemsPastPoolByKey.get(key) || []) {
                const st = row.slot || 1;
                if (!out.some((o) => o.ev === row.ev && (o._momSlot || 1) === st)) {
                    out.push({ ev: row.ev, tip: row.tip, _momSlot: st });
                }
            }
        }
    }
    out.sort((a, b) => new Date(a.ev.start_at).getTime() - new Date(b.ev.start_at).getTime());
    return out;
}

/** Start time label for the earliest appointment counted in “Booked later” (same rows as that column’s tooltip). */
function earliestBookedLaterStartDisplayForRoster(rosterName, kind, crItems) {
    const rows = collectStaffingTurnTooltipRows(rosterName, kind, 'future');
    if (!rows.length) return '—';
    let minMs = Infinity;
    for (let i = 0; i < rows.length; i++) {
        const ev = rows[i].ev;
        if (!ev || !ev.start_at) continue;
        const t = new Date(ev.start_at).getTime();
        if (Number.isFinite(t) && t < minMs) minMs = t;
    }
    if (minMs === Infinity) return '—';
    const s = formatTimeCompactUS(new Date(minMs));
    return s || '—';
}

/**
 * Future massage bookings on the loaded calendar day with no named customer request (Square “any available”
 * or Staff in masseuse slot). One entry per booking_id; ADDON omitted; start_at > now (local).
 */
function collectFutureAnyStaffMassageBookings() {
    const events = (currentData && Array.isArray(currentData.events)) ? currentData.events : [];
    const dayStr = staffingPopoverLoadedCalendarDateStr();
    const nowMs = Date.now();
    const out = [];
    const seenBid = new Set();
    for (const ev of events) {
        if (!ev || ev.room === 'ADDON') continue;
        if (!eventIsOnStaffingCalendarDay(ev, dayStr)) continue;
        const startMs = new Date(ev.start_at).getTime();
        if (!Number.isFinite(startMs) || startMs <= nowMs) continue;
        if (!customerAnyAvailEffective(ev)) continue;
        const bid = String(ev.booking_id || '');
        if (!bid || seenBid.has(bid)) continue;
        seenBid.add(bid);
        out.push(ev);
    }
    out.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    return out;
}

function buildStaffingAnyStaffFutureTooltipHtml(kind, rosterNameOpt) {
    if (kind === 'facial') {
        return '<p class="mom-staffing-turn-tooltip-empty">' +
            escapeHtml(uiT('staff.availTurnTipAnyStaffFacial', 'This column applies to massage staffing only.')) +
            '</p>';
    }
    const roster = rosterForStaffingTurnCounts();
    const dup = buildTherapistFirstNameDuplicates(roster || []);
    const events = (currentData && Array.isArray(currentData.events)) ? currentData.events : [];
    const dayStr = staffingPopoverLoadedCalendarDateStr();
    const sim = getMomMassageAnyStaffSimulationCached(dayStr, events, roster, dup);
    const rosterName = rosterNameOpt && String(rosterNameOpt).trim() ? String(rosterNameOpt).trim() : '';
    if (rosterName && sim.mode !== 'sim') {
        return '<p class="mom-staffing-turn-tooltip-empty">' +
            escapeHtml(uiT(
                'staff.availTurnTipAnyStaffNoPool',
                'Check at least one massage therapist to preview how “any staff” slots are shared.',
            )) +
            '</p>';
    }
    if (rosterName && sim.mode === 'sim') {
        const hit = sim.orderedPool.find((p) => therapistNamesMatchForCalendar(rosterName, p, dup));
        const key = rosterNameKeyLower(hit || rosterName);
        const rows = sim.itemsAnyStaffFutureByKey.get(key) || [];
        if (!rows.length) {
            return '<p class="mom-staffing-turn-tooltip-empty">' +
                escapeHtml(uiT(
                    'staff.availTurnTipAnyStaffRosterEmpty',
                    'No “any staff” slots assigned to this therapist in the current turn order (or none remain open).',
                )) +
                '</p>';
        }
        const hNum = escapeHtml(uiT('staff.availTurnTipColNum', '#'));
        const hTime = escapeHtml(uiT('staff.availTurnTipColTime', 'Start–end'));
        const hSvc = escapeHtml(uiT('staff.availTurnTipColService', 'Service'));
        const hCust = escapeHtml(uiT('staff.availTurnTipColCustomer', 'Customer'));
        const hTip = escapeHtml(uiT('staff.availTurnTipColTip', 'Tip'));
        const thead =
            '<thead><tr class="mom-staffing-turn-tooltip-head-row">' +
            '<th scope="col" class="mom-staffing-turn-tooltip-th mom-staffing-turn-tooltip-th--num">' + hNum + '</th>' +
            '<th scope="col" class="mom-staffing-turn-tooltip-th">' + hTime + '</th>' +
            '<th scope="col" class="mom-staffing-turn-tooltip-th">' + hSvc + '</th>' +
            '<th scope="col" class="mom-staffing-turn-tooltip-th mom-staffing-turn-tooltip-th--tip">' + hTip + '</th>' +
            '<th scope="col" class="mom-staffing-turn-tooltip-th">' + hCust + '</th>' +
            '</tr></thead>';
        const parts = [];
        rows.forEach((row, i) => {
            const ev = row.ev;
            const endIso = ev.display_end_at || ev.end_at;
            const time = endIso
                ? formatTimeRangeSmart(ev.start_at, endIso)
                : formatTimeCompactUS(new Date(ev.start_at));
            const slotNote = row.slot === 2
                ? ' <span class="mom-staffing-turn-tooltip-slot2">(' + escapeHtml(uiT('staff.availTurnTipCoupleSlot2', '2nd masseuse')) + ')</span>'
                : '';
            const svcRaw = ev.display_service || ev.service || '';
            const svc = escapeHtml(uiCatalogLine(svcRaw));
            const tipStr = escapeHtml(formatTipDollarsOrDash(row.tip));
            const cust = escapeHtml(customerShortName(ev.customer || ''));
            const byUsPhone = (ev.booked_by || '').toLowerCase() === 'us'
                ? ' <span class="mom-staffing-turn-tooltip-by-us" role="img" aria-label="' +
                    escapeHtml(uiT('staff.availTurnTipByUsAria', 'Booked by us')) + '">📞</span>'
                : '';
            parts.push(
                '<tr class="mom-staffing-turn-tooltip-tr">' +
                '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--num">' + (i + 1) + '</td>' +
                '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--time">' +
                escapeHtml(time) + slotNote + '</td>' +
                '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--svc">' + svc + '</td>' +
                '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--tip">' + tipStr + '</td>' +
                '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--cust"><i>' + cust + '</i>' + byUsPhone + '</td>' +
                '</tr>',
            );
        });
        return '<table class="mom-staffing-turn-tooltip-table">' + thead + '<tbody>' + parts.join('') + '</tbody></table>';
    }
    const rows = collectFutureAnyStaffMassageBookings();
    if (!rows.length) {
        return '<p class="mom-staffing-turn-tooltip-empty">' +
            escapeHtml(uiT('staff.availTurnTipAnyStaffEmpty', 'No upcoming bookings in the “any staff” queue.')) +
            '</p>';
    }
    const hNum = escapeHtml(uiT('staff.availTurnTipColNum', '#'));
    const hTime = escapeHtml(uiT('staff.availTurnTipColTime', 'Start–end'));
    const hSvc = escapeHtml(uiT('staff.availTurnTipColService', 'Service'));
    const hCust = escapeHtml(uiT('staff.availTurnTipColCustomer', 'Customer'));
    const thead =
        '<thead><tr class="mom-staffing-turn-tooltip-head-row">' +
        '<th scope="col" class="mom-staffing-turn-tooltip-th mom-staffing-turn-tooltip-th--num">' + hNum + '</th>' +
        '<th scope="col" class="mom-staffing-turn-tooltip-th">' + hTime + '</th>' +
        '<th scope="col" class="mom-staffing-turn-tooltip-th">' + hSvc + '</th>' +
        '<th scope="col" class="mom-staffing-turn-tooltip-th">' + hCust + '</th>' +
        '</tr></thead>';
    const parts = [];
    rows.forEach((ev, i) => {
        const endIso = ev.display_end_at || ev.end_at;
        const time = endIso
            ? formatTimeRangeSmart(ev.start_at, endIso)
            : formatTimeCompactUS(new Date(ev.start_at));
        const svcRaw = ev.display_service || ev.service || '';
        const svc = escapeHtml(uiCatalogLine(svcRaw));
        const cust = escapeHtml(customerShortName(ev.customer || ''));
        const byUsPhone = (ev.booked_by || '').toLowerCase() === 'us'
            ? ' <span class="mom-staffing-turn-tooltip-by-us" role="img" aria-label="' +
                escapeHtml(uiT('staff.availTurnTipByUsAria', 'Booked by us')) + '">📞</span>'
            : '';
        parts.push(
            '<tr class="mom-staffing-turn-tooltip-tr">' +
            '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--num">' + (i + 1) + '</td>' +
            '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--time">' + escapeHtml(time) + '</td>' +
            '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--svc">' + svc + '</td>' +
            '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--cust"><i>' + cust + '</i>' + byUsPhone + '</td>' +
            '</tr>',
        );
    });
    return '<table class="mom-staffing-turn-tooltip-table">' + thead + '<tbody>' + parts.join('') + '</tbody></table>';
}

function buildStaffingTurnCountTooltipHtml(rosterName, kind, bucket) {
    const rows = collectStaffingTurnTooltipRows(rosterName, kind, bucket);
    if (!rows.length) {
        return '<p class="mom-staffing-turn-tooltip-empty">' +
            escapeHtml(uiT('staff.availTurnTipEmpty', 'No appointments in this category.')) +
            '</p>';
    }
    const roster = rosterForStaffingTurnCounts();
    const dup = buildTherapistFirstNameDuplicates(roster || []);
    const events = (currentData && Array.isArray(currentData.events)) ? currentData.events : [];
    const crPayload = buildCustomerRequestsSummaryFromEvents(events, roster);
    const crItems = crPayload && crPayload.items ? crPayload.items : [];
    const showReqCol = kind !== 'facial';
    const hReqTitle = escapeHtml(uiT('staff.availTurnTipRequestedColTitle', 'Customer requested this therapist'));
    const hReqShort = escapeHtml(uiT('staff.availTurnTipRequestedColShort', 'Req'));
    const hReqAria = escapeHtml(uiT('staff.availTurnTipRequestedAria', 'Customer requested this therapist'));
    const hNum = escapeHtml(uiT('staff.availTurnTipColNum', '#'));
    const hTime = escapeHtml(uiT('staff.availTurnTipColTime', 'Start–end'));
    const hSvc = escapeHtml(uiT('staff.availTurnTipColService', 'Service'));
    const hTip = escapeHtml(uiT('staff.availTurnTipColTip', 'Tip'));
    const hCust = escapeHtml(uiT('staff.availTurnTipColCustomer', 'Customer'));
    const thead =
        '<thead><tr class="mom-staffing-turn-tooltip-head-row">' +
        '<th scope="col" class="mom-staffing-turn-tooltip-th mom-staffing-turn-tooltip-th--num">' + hNum + '</th>' +
        '<th scope="col" class="mom-staffing-turn-tooltip-th">' + hTime + '</th>' +
        '<th scope="col" class="mom-staffing-turn-tooltip-th">' + hSvc + '</th>' +
        '<th scope="col" class="mom-staffing-turn-tooltip-th mom-staffing-turn-tooltip-th--tip">' + hTip + '</th>' +
        '<th scope="col" class="mom-staffing-turn-tooltip-th">' + hCust + '</th>' +
        (showReqCol
            ? '<th scope="col" class="mom-staffing-turn-tooltip-th mom-staffing-turn-tooltip-th--req" title="' + hReqTitle + '" aria-label="' + hReqAria + '">' + hReqShort + '</th>'
            : '') +
        '</tr></thead>';
    const parts = [];
    rows.forEach((row, i) => {
        const ev = row.ev;
        const endIso = ev.display_end_at || ev.end_at;
        const time = (row._momSegStartMs != null && row._momSegEndMs != null)
            ? formatTimeRangeSmart(new Date(row._momSegStartMs), new Date(row._momSegEndMs))
            : (endIso
                ? formatTimeRangeSmart(ev.start_at, endIso)
                : formatTimeCompactUS(new Date(ev.start_at)));
        const svcRaw = ev.display_service || ev.service || '';
        const svc = escapeHtml(uiCatalogLine(svcRaw));
        const tipStr = escapeHtml(formatTipDollarsOrDash(row.tip));
        const cust = escapeHtml(customerShortName(ev.customer || ''));
        const byUsPhone = bucket === 'future' && (ev.booked_by || '').toLowerCase() === 'us'
            ? ' <span class="mom-staffing-turn-tooltip-by-us" role="img" aria-label="' +
                escapeHtml(uiT('staff.availTurnTipByUsAria', 'Booked by us')) + '">📞</span>'
            : '';
        const reqMark = showReqCol && staffingTooltipCustomerRequestedThisRoster(rosterName, ev, dup, crItems)
            ? '<span class="mom-staffing-turn-tooltip-requested" title="' + hReqTitle + '" aria-label="' + hReqAria + '">\u2713</span>'
            : '';
        parts.push(
            '<tr class="mom-staffing-turn-tooltip-tr">' +
            '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--num">' + (i + 1) + '</td>' +
            '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--time">' + escapeHtml(time) + '</td>' +
            '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--svc">' + svc + '</td>' +
            '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--tip">' + tipStr + '</td>' +
            '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--cust"><i>' + cust + '</i>' + byUsPhone + '</td>' +
            (showReqCol ? '<td class="mom-staffing-turn-tooltip-td mom-staffing-turn-tooltip-td--req">' + reqMark + '</td>' : '') +
            '</tr>',
        );
    });
    return '<table class="mom-staffing-turn-tooltip-table">' + thead + '<tbody>' + parts.join('') + '</tbody></table>';
}

let momStaffingTurnTooltipHideT = null;
function ensureMomStaffingTurnTooltipEl() {
    let el = document.getElementById('momStaffingTurnTooltip');
    if (!el) {
        el = document.createElement('div');
        el.id = 'momStaffingTurnTooltip';
        el.className = 'mom-staffing-turn-tooltip';
        el.setAttribute('role', 'tooltip');
        el.style.display = 'none';
        document.body.appendChild(el);
    }
    return el;
}

function ensureMomStaffingTurnConnectorSvg() {
    let svg = document.getElementById('momStaffingTurnConnector');
    if (svg) return svg;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'momStaffingTurnConnector';
    svg.setAttribute('class', 'mom-staffing-turn-connector');
    svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'mom-staffing-turn-connector-line');
    svg.appendChild(line);
    svg.style.display = 'none';
    document.body.appendChild(svg);
    return svg;
}

function updateMomStaffingTurnConnector(anchorRect, tipEl) {
    const svg = ensureMomStaffingTurnConnectorSvg();
    const line = svg.querySelector('line');
    if (!anchorRect || !tipEl || tipEl.style.display === 'none' || !line) {
        svg.style.display = 'none';
        return;
    }
    const tr = tipEl.getBoundingClientRect();
    if (tr.width < 2 || tr.height < 2) {
        svg.style.display = 'none';
        return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const ay = anchorRect.top + anchorRect.height / 2;
    let x1;
    let y1;
    let x2;
    let y2;
    if (tr.left >= anchorRect.right - 4) {
        x1 = anchorRect.right;
        y1 = ay;
        x2 = tr.left - 2;
        y2 = Math.min(Math.max(ay, tr.top + 12), tr.bottom - 12);
    } else if (tr.right <= anchorRect.left + 4) {
        x1 = anchorRect.left;
        y1 = ay;
        x2 = tr.right + 2;
        y2 = Math.min(Math.max(ay, tr.top + 12), tr.bottom - 12);
    } else {
        x1 = (anchorRect.left + anchorRect.right) / 2;
        y1 = anchorRect.bottom;
        x2 = (tr.left + tr.right) / 2;
        y2 = tr.top;
    }
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    svg.style.display = 'block';
}

function hideMomStaffingTurnConnectorNow() {
    const conn = document.getElementById('momStaffingTurnConnector');
    if (conn) conn.style.display = 'none';
}

function hideMomStaffingTurnTooltipNow() {
    if (momStaffingTurnTooltipHideT) {
        clearTimeout(momStaffingTurnTooltipHideT);
        momStaffingTurnTooltipHideT = null;
    }
    const tip = document.getElementById('momStaffingTurnTooltip');
    if (tip) tip.style.display = 'none';
    hideMomStaffingTurnConnectorNow();
}

function hideMomStaffingTurnTooltipSoon() {
    if (momStaffingTurnTooltipHideT) clearTimeout(momStaffingTurnTooltipHideT);
    momStaffingTurnTooltipHideT = setTimeout(() => {
        const tip = document.getElementById('momStaffingTurnTooltip');
        if (tip) tip.style.display = 'none';
        hideMomStaffingTurnConnectorNow();
        momStaffingTurnTooltipHideT = null;
    }, 150);
}

/** Extra top offset for “So far” tooltip vs tooltip body line-height (1.5 lines). */
const MOM_STAFFING_SO_FAR_TOOLTIP_EXTRA_TOP_PX = Math.round(12 * 1.35 * 1.5);

function positionMomStaffingTurnTooltip(el, anchorRect, pointerX, extraTopPx) {
    if (!el || !anchorRect) return;
    const gapFromCell = 40;
    const gapPastPointer = 28;
    const nudge = Number(extraTopPx) || 0;
    el.style.display = 'block';
    el.style.visibility = 'hidden';
    const tw = el.offsetWidth || 320;
    const th = el.offsetHeight || 120;
    el.style.visibility = '';
    let left = anchorRect.right + gapFromCell;
    if (pointerX != null && Number.isFinite(pointerX)) {
        left = Math.max(left, pointerX + gapPastPointer);
    }
    let top = anchorRect.top + nudge;
    const margin = 10;
    if (left + tw > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - tw - margin);
    }
    if (left < margin) left = margin;
    if (top + th > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - th - margin);
    }
    if (top < margin) top = margin;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    requestAnimationFrame(() => {
        updateMomStaffingTurnConnector(anchorRect, el);
    });
}

function onStaffingTurnCountPointerenter(ev) {
    const cell = ev.currentTarget;
    if (!cell) return;
    const bucket = cell.getAttribute('data-staffing-bucket');
    if (bucket !== 'past' && bucket !== 'future') return;
    const root = document.getElementById('staffingAvailPopover');
    const kind = root && root.dataset.staffingKind === 'facial' ? 'facial' : 'massage';
    const tip = ensureMomStaffingTurnTooltipEl();
    if (momStaffingTurnTooltipHideT) {
        clearTimeout(momStaffingTurnTooltipHideT);
        momStaffingTurnTooltipHideT = null;
    }
    const enc = cell.getAttribute('data-staffing-roster');
    if (!enc) return;
    let rosterName = '';
    try {
        rosterName = decodeURIComponent(enc);
    } catch (e) {
        return;
    }
    tip.innerHTML = buildStaffingTurnCountTooltipHtml(rosterName, kind, bucket);
    const soFarNudge = bucket === 'past' ? MOM_STAFFING_SO_FAR_TOOLTIP_EXTRA_TOP_PX : 0;
    positionMomStaffingTurnTooltip(tip, cell.getBoundingClientRect(), ev.clientX, soFarNudge);
}

function onStaffingTurnCountPointerleave() {
    hideMomStaffingTurnTooltipSoon();
}

function bindStaffingTurnCountTooltipCells(bodyEl) {
    if (!bodyEl) return;
    bodyEl.querySelectorAll('.staffing-avail-turn-preview-row-count[data-staffing-bucket]').forEach((cell) => {
        if (cell._momStaffingTipBound) return;
        cell._momStaffingTipBound = true;
        cell.addEventListener('pointerenter', onStaffingTurnCountPointerenter);
        cell.addEventListener('pointerleave', onStaffingTurnCountPointerleave);
    });
}

function refreshStaffingTurnPreviewList() {
    hideMomStaffingTurnTooltipNow();
    const root = document.getElementById('staffingAvailPopover');
    const bodyEl = document.getElementById('staffingAvailPopoverTurnPreviewBody');
    const listEl = document.getElementById('staffingAvailPopoverList');
    if (!root || !bodyEl || !listEl) return;

    const rows = [...listEl.querySelectorAll('.staffing-avail-popover-row')];
    const items = [];
    rows.forEach((row, rowIndex) => {
        const cb = row.querySelector('input[type="checkbox"]');
        const inp = row.querySelector('.staffing-avail-turn-input');
        if (!cb || !inp) return;
        const name = (cb.value || '').trim();
        if (!name || !cb.checked) return;
        const raw = String(inp.value || '').trim();
        const n = parseInt(raw, 10);
        const turn = Number.isFinite(n) && n > 0 ? n : null;
        items.push({ name, turn, rowIndex });
    });

    if (!items.length) {
        bodyEl.innerHTML = '<div class="staffing-avail-turn-preview-empty">' +
            escapeHtml(uiT('staff.availTurnPreviewEmpty', 'No one checked yet.')) +
            '</div>';
        return;
    }

    const sorted = items.slice().sort((a, b) => {
        if (a.turn != null && b.turn != null && a.turn !== b.turn) return a.turn - b.turn;
        if (a.turn == null && b.turn != null) return 1;
        if (a.turn != null && b.turn == null) return -1;
        return a.rowIndex - b.rowIndex;
    });

    const kind = root.dataset.staffingKind === 'facial' ? 'facial' : 'massage';
    const rosterForCr = rosterForStaffingTurnCounts();
    const crPayload = buildCustomerRequestsSummaryFromEvents(currentData && currentData.events ? currentData.events : [], rosterForCr);
    const crItems = crPayload && crPayload.items ? crPayload.items : [];
    const peerNames = sorted.map((x) => x.name);
    const encName = (name) => encodeURIComponent(name);
    const nextLaterAria = escapeHtml(uiT(
        'staff.availTurnNextLaterTitle',
        'Start time of the next appointment in the Booked later count (earliest future slot)'
    ));
    const lines = sorted.map((x) => {
        const shortN = therapistTurnOrderShortLabel(x.name, peerNames);
        const prefix = x.turn != null ? `${x.turn}. ` : '';
        const { past, future } = countStaffTurnsForLoadedDayPastFuture(x.name, kind, crItems);
        const rosterEnc = encName(x.name);
        const nextLater = escapeHtml(earliestBookedLaterStartDisplayForRoster(x.name, kind, crItems));
        return (
            '<div class="staffing-avail-turn-preview-row">' +
            '<span class="staffing-avail-turn-preview-row-order">' + escapeHtml(prefix + shortN) + '</span>' +
            '<span class="staffing-avail-turn-preview-row-count staffing-avail-turn-preview-row-count--tip" ' +
            'data-staffing-bucket="past" data-staffing-roster="' + escapeHtml(rosterEnc) + '">' +
            escapeHtml(String(past)) + '</span>' +
            '<span class="staffing-avail-turn-preview-row-count staffing-avail-turn-preview-row-count--future staffing-avail-turn-preview-row-count--tip" ' +
            'data-staffing-bucket="future" data-staffing-roster="' + escapeHtml(rosterEnc) + '">' +
            escapeHtml(String(future)) + '</span>' +
            '<span class="staffing-avail-turn-preview-row-next" aria-label="' + nextLaterAria + '">' + nextLater + '</span>' +
            '</div>'
        );
    });
    bodyEl.innerHTML = lines.join('');
    bindStaffingTurnCountTooltipCells(bodyEl);
}

function positionStaffingAvailPopoverPanel(anchorEl) {
    const root = document.getElementById('staffingAvailPopover');
    const panel = root && root.querySelector('.staffing-avail-popover-panel');
    if (!root || !panel || !anchorEl) return;
    const ar = anchorEl.getBoundingClientRect();
    const margin = 6;
    panel.style.left = '0px';
    panel.style.top = '0px';
    const pr = panel.getBoundingClientRect();
    let left = ar.left;
    let top = ar.bottom + margin;
    if (top + pr.height > window.innerHeight - 10) {
        top = Math.max(10, ar.top - pr.height - margin);
    }
    if (left + pr.width > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - pr.width - 10);
    }
    if (left < 10) left = 10;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
}

function closeStaffingAvailabilityPopover() {
    const root = document.getElementById('staffingAvailPopover');
    if (!root) return;
    hideMomStaffingTurnTooltipNow();
    clearStaffingAvailTurnPreviewTicker();
    root.hidden = true;
    root.dataset.staffingKind = '';
    root.dataset.staffingPastUnlocked = '';
    const pastBan = document.getElementById('staffingAvailPopoverPastBanner');
    if (pastBan) {
        pastBan.hidden = true;
        pastBan.innerHTML = '';
    }
    document.removeEventListener('keydown', staffingAvailPopoverOnKeydown);
}

function isCalendarDateBeforeTodayLocal(dateStr) {
    return !!(dateStr && /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr)) && dateStr < getTodayLocal());
}

/** One-time delegated click for “Unlock to edit” on past days (banner is re-rendered when opening). */
function initStaffingPastUnlockClickOnce() {
    const root = document.getElementById('staffingAvailPopover');
    const banner = document.getElementById('staffingAvailPopoverPastBanner');
    if (!root || !banner || banner.dataset.momUnlockBound) return;
    banner.dataset.momUnlockBound = '1';
    banner.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest && ev.target.closest('.staffing-avail-past-unlock-btn');
        if (!btn) return;
        ev.preventDefault();
        const ok = window.confirm(
            uiT(
                'staff.pastDayUnlockConfirm',
                'Are you sure you want to change staffing for a prior day? This updates saved turn order for that date.',
            ),
        );
        if (!ok) return;
        root.dataset.staffingPastUnlocked = '1';
        banner.hidden = true;
        banner.innerHTML = '';
        const listEl = document.getElementById('staffingAvailPopoverList');
        const applyBtn = document.getElementById('staffingAvailPopoverApply');
        if (listEl) {
            listEl.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.disabled = false; });
            listEl.querySelectorAll('.staffing-avail-turn-input').forEach((el) => {
                el.disabled = false;
                el.readOnly = false;
            });
        }
        if (applyBtn) applyBtn.disabled = false;
        refreshStaffingTurnPreviewList();
    });
}

function setStaffingAvailPopoverPastDateLock(root, listEl, applyBtn, ds) {
    const banner = document.getElementById('staffingAvailPopoverPastBanner');
    if (!banner || !listEl) return;
    const locked = isCalendarDateBeforeTodayLocal(ds) && root.dataset.staffingPastUnlocked !== '1';
    if (!isCalendarDateBeforeTodayLocal(ds)) {
        banner.hidden = true;
        banner.innerHTML = '';
        listEl.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.disabled = false; });
        listEl.querySelectorAll('.staffing-avail-turn-input').forEach((el) => {
            el.disabled = false;
            el.readOnly = false;
        });
        if (applyBtn) applyBtn.disabled = false;
        return;
    }
    if (locked) {
        banner.hidden = false;
        const msg = escapeHtml(uiT('staff.pastDayLockedBanner', 'This date is in the past — staffing is locked.'));
        const btnLabel = escapeHtml(uiT('staff.pastDayUnlockBtn', 'Unlock to edit'));
        banner.innerHTML =
            '<span class="staffing-avail-past-banner-msg">' + msg + '</span> ' +
            '<button type="button" class="staffing-avail-past-unlock-btn">' + btnLabel + '</button>';
        listEl.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.disabled = true; });
        listEl.querySelectorAll('.staffing-avail-turn-input').forEach((el) => {
            el.readOnly = true;
            el.disabled = true;
        });
        if (applyBtn) applyBtn.disabled = true;
    } else {
        banner.hidden = true;
        banner.innerHTML = '';
        listEl.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.disabled = false; });
        listEl.querySelectorAll('.staffing-avail-turn-input').forEach((el) => {
            el.disabled = false;
            el.readOnly = false;
        });
        if (applyBtn) applyBtn.disabled = false;
    }
}

function staffingAvailPopoverOnKeydown(ev) {
    if (ev.key === 'Escape') {
        ev.preventDefault();
        closeStaffingAvailabilityPopover();
    }
}

function openStaffingAvailabilityPopover(kind, anchorEl) {
    const root = document.getElementById('staffingAvailPopover');
    const titleEl = document.getElementById('staffingAvailPopoverTitle');
    const hintEl = document.getElementById('staffingAvailPopoverHint');
    const listEl = document.getElementById('staffingAvailPopoverList');
    const applyBtn = document.getElementById('staffingAvailPopoverApply');
    if (!root || !titleEl || !hintEl || !listEl || !anchorEl) return;

    const inp = document.getElementById('dateInput');
    const ds = inp && inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value) ? inp.value : getTodayLocal();
    root.dataset.staffingPastUnlocked = '';
    const list = getTherapistsForStaffingPickList();
    const sel = document.getElementById(kind === 'facial' ? 'facialSpecialistsTodaySelect' : 'masseusesTodaySelect');
    const pickCount = savedStaffPickCountForDate(ds, kind);
    const rawN = sel ? parseInt(sel.value, 10) : NaN;
    let targetN = kind === 'facial'
        ? (isNaN(rawN) ? 0 : Math.max(0, Math.min(MOM_MAX_PLANNED_STAFF, rawN)))
        : (isNaN(rawN) ? 1 : Math.max(1, Math.min(MOM_MAX_PLANNED_STAFF, rawN)));
    if (pickCount != null) targetN = pickCount;

    titleEl.textContent = kind === 'facial'
        ? uiT('staff.availTitleFacial', 'Facial specialists available today')
        : uiT('staff.availTitleMassage', 'Massage staff available today');

    const previewCol = document.getElementById('staffingAvailPopoverPreviewCol');
    const turnPreviewBody = document.getElementById('staffingAvailPopoverTurnPreviewBody');
    const popMain = document.getElementById('staffingAvailPopoverMain');

    if (!list.length) {
        hintEl.textContent = uiT('staff.availHintNoRoster', 'Load the calendar once (Load) to list therapists by name. You can still set the count with the number menu.');
        hintEl.hidden = false;
        listEl.innerHTML = '';
        if (turnPreviewBody) turnPreviewBody.innerHTML = '';
        if (previewCol) previewCol.hidden = true;
        if (popMain) popMain.hidden = true;
        const pastBanEmpty = document.getElementById('staffingAvailPopoverPastBanner');
        if (pastBanEmpty) {
            pastBanEmpty.hidden = true;
            pastBanEmpty.innerHTML = '';
        }
        if (applyBtn) applyBtn.disabled = false;
    } else {
        if (popMain) popMain.hidden = false;
        hintEl.hidden = true;
        hintEl.textContent = '';
        if (previewCol) previewCol.hidden = false;
        let initial = loadSavedStaffPickSet(ds, kind, list);
        if (!initial) {
            initial = new Set();
            if (kind === 'massage' && currentData && currentData.date === ds && Array.isArray(currentData.events)) {
                const fromCal = collectMassageTherapistNamesOnLocalDate(currentData.events, ds, list);
                for (const nm of fromCal) initial.add(nm);
            }
            if (initial.size === 0) {
                const n = Math.min(targetN, list.length);
                for (let i = 0; i < n; i++) initial.add(list[i]);
            }
        }
        const turnMap = loadSavedStaffTurnMap(ds, kind);
        const rows = list.map((name, idx) => {
            const id = `staffingAvailCb_${kind}_${idx}`;
            const checked = initial.has(name) ? ' checked' : '';
            const savedTurn = turnMap[name];
            let turnVal = '';
            if (savedTurn != null && savedTurn !== '') {
                const p = parseInt(String(savedTurn).trim(), 10);
                if (Number.isFinite(p) && p > 0) turnVal = String(p);
            }
            const turnAttr = escapeHtml(turnVal);
            const inpTitle = escapeHtml(uiT('staff.availTurnInputTitle', 'Turn number'));
            const displayName = therapistTurnOrderShortLabel(name, list);
            const displayEsc = escapeHtml(displayName);
            return (
                '<div class="staffing-avail-popover-row" data-staff-name="' + escapeHtml(name) + '">' +
                '<label class="staffing-avail-popover-row-main" for="' + escapeHtml(id) + '">' +
                '<input type="checkbox" id="' + escapeHtml(id) + '" value="' + escapeHtml(name) + '"' + checked + ' />' +
                '<span>' + displayEsc + '</span></label>' +
                '<input type="text" class="staffing-avail-turn-input" inputmode="numeric" pattern="[0-9]*" ' +
                'title="' + inpTitle + '" aria-label="' + inpTitle + ' ' + displayEsc + '" ' +
                'placeholder="—" value="' + turnAttr + '" />' +
                '</div>'
            );
        });
        listEl.innerHTML = rows.join('');
        if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
            window.MOM_I18N.applyStaticI18n();
        }
        syncStaffingCountSelectFromPopoverChecks(kind, listEl, sel);
        refreshStaffingTurnPreviewList();
        setStaffingAvailPopoverPastDateLock(root, listEl, applyBtn, ds);
    }

    root.dataset.staffingKind = kind;
    root.hidden = false;
    clearStaffingAvailTurnPreviewTicker();
    if (list.length) {
        staffingAvailTurnPreviewTickerId = window.setInterval(() => {
            const r = document.getElementById('staffingAvailPopover');
            if (!r || r.hidden) {
                clearStaffingAvailTurnPreviewTicker();
                return;
            }
            refreshStaffingTurnPreviewList();
        }, STAFFING_AVAIL_TURN_PREVIEW_TICK_MS);
    }
    positionStaffingAvailPopoverPanel(anchorEl);
    requestAnimationFrame(() => positionStaffingAvailPopoverPanel(anchorEl));
    document.addEventListener('keydown', staffingAvailPopoverOnKeydown);
}

function syncStaffingCountSelectFromPopoverChecks(kind, listEl, sel) {
    if (!listEl || !sel) return;
    const checked = listEl.querySelectorAll('input[type="checkbox"]:checked').length;
    if (checked < 1 && kind === 'massage') return;
    const count = kind === 'facial'
        ? Math.max(0, Math.min(MOM_MAX_PLANNED_STAFF, checked))
        : Math.max(1, Math.min(MOM_MAX_PLANNED_STAFF, checked));
    sel.value = String(count);
}

function commitStaffingAvailabilityPopover() {
    const root = document.getElementById('staffingAvailPopover');
    const listEl = document.getElementById('staffingAvailPopoverList');
    if (!root || !listEl) return;
    const kind = root.dataset.staffingKind === 'facial' ? 'facial' : 'massage';
    const inp = document.getElementById('dateInput');
    const ds = inp && inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value) ? inp.value : getTodayLocal();
    if (isCalendarDateBeforeTodayLocal(ds) && root.dataset.staffingPastUnlocked !== '1') {
        closeStaffingAvailabilityPopover();
        return;
    }
    const list = getTherapistsForStaffingPickList();
    const sel = document.getElementById(kind === 'facial' ? 'facialSpecialistsTodaySelect' : 'masseusesTodaySelect');
    if (!sel) {
        closeStaffingAvailabilityPopover();
        return;
    }

    if (!list.length) {
        closeStaffingAvailabilityPopover();
        return;
    }

    const rowMeta = [];
    listEl.querySelectorAll('.staffing-avail-popover-row').forEach((row, rowIndex) => {
        const cb = row.querySelector('input[type="checkbox"]');
        const inp = row.querySelector('.staffing-avail-turn-input');
        if (!cb) return;
        const name = (cb.value || '').trim();
        if (!name) return;
        const raw = inp ? String(inp.value || '').trim() : '';
        const n = parseInt(raw, 10);
        const turn = Number.isFinite(n) && n > 0 ? n : null;
        rowMeta.push({ name, checked: cb.checked, turn, rowIndex });
    });

    let orderedPick = rowMeta.filter((r) => r.checked);
    orderedPick.sort((a, b) => {
        if (a.turn != null && b.turn != null && a.turn !== b.turn) return a.turn - b.turn;
        if (a.turn == null && b.turn != null) return 1;
        if (a.turn != null && b.turn == null) return -1;
        return a.rowIndex - b.rowIndex;
    });
    let ordered = orderedPick.map((r) => r.name).filter((n) => list.includes(n));
    if (kind === 'massage' && ordered.length === 0 && list.length) {
        ordered = [list[0]];
    }
    ordered = ordered.slice(0, MOM_MAX_PLANNED_STAFF);

    const turnMapOut = {};
    listEl.querySelectorAll('.staffing-avail-popover-row').forEach((row) => {
        const cb = row.querySelector('input[type="checkbox"]');
        const inp = row.querySelector('.staffing-avail-turn-input');
        if (!cb || !inp) return;
        const name = (cb.value || '').trim();
        if (!name) return;
        const raw = String(inp.value || '').trim();
        const tn = parseInt(raw, 10);
        if (Number.isFinite(tn) && tn > 0) turnMapOut[name] = tn;
    });
    const count = kind === 'facial'
        ? Math.max(0, Math.min(MOM_MAX_PLANNED_STAFF, ordered.length))
        : Math.max(1, Math.min(MOM_MAX_PLANNED_STAFF, ordered.length));

    sel.value = String(count);
    try {
        const wd = weekdayFromDateString(ds);
        localStorage.setItem(
            kind === 'facial' ? facialStaffStorageKeyForWeekday(wd) : massageStaffStorageKeyForWeekday(wd),
            String(count),
        );
        localStorage.setItem(
            kind === 'facial' ? facialStaffPickStorageKeyForDate(ds) : massageStaffPickStorageKeyForDate(ds),
            JSON.stringify(ordered),
        );
        localStorage.setItem(staffTurnMapStorageKeyForDate(ds, kind), JSON.stringify(turnMapOut));
    } catch (e) { /* ignore */ }

    invalidateMomFacialStaffingSimCache();
    invalidateMomMassageAnyStaffSimCache();
    closeStaffingAvailabilityPopover();
    if (currentData) renderCalendar(currentData);
}

function initStaffingAvailabilityPopover() {
    const root = document.getElementById('staffingAvailPopover');
    if (!root || root.dataset.momPopoverInit) return;
    root.dataset.momPopoverInit = '1';
    const backdrop = document.getElementById('staffingAvailPopoverBackdrop');
    const applyBtn = document.getElementById('staffingAvailPopoverApply');
    const cancelBtn = document.getElementById('staffingAvailPopoverCancel');
    if (backdrop) {
        backdrop.addEventListener('click', () => closeStaffingAvailabilityPopover());
    }
    if (applyBtn) {
        applyBtn.addEventListener('click', () => commitStaffingAvailabilityPopover());
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => closeStaffingAvailabilityPopover());
    }
    const massageBtn = document.getElementById('staffingMassageNamesBtn');
    const facialBtn = document.getElementById('staffingFacialNamesBtn');
    if (massageBtn) {
        massageBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openStaffingAvailabilityPopover('massage', massageBtn);
        });
    }
    if (facialBtn) {
        facialBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openStaffingAvailabilityPopover('facial', facialBtn);
        });
    }

    const popMain = document.getElementById('staffingAvailPopoverMain');
    if (popMain && !popMain.dataset.momTurnPreviewBound) {
        popMain.dataset.momTurnPreviewBound = '1';
        popMain.addEventListener('input', () => refreshStaffingTurnPreviewList());
        popMain.addEventListener('change', (ev) => {
            refreshStaffingTurnPreviewList();
            if (ev.target && ev.target.type === 'checkbox') {
                const root = document.getElementById('staffingAvailPopover');
                const listEl = document.getElementById('staffingAvailPopoverList');
                if (!root || root.hidden || !listEl) return;
                const kind = root.dataset.staffingKind === 'facial' ? 'facial' : 'massage';
                const sel = document.getElementById(kind === 'facial' ? 'facialSpecialistsTodaySelect' : 'masseusesTodaySelect');
                syncStaffingCountSelectFromPopoverChecks(kind, listEl, sel);
            }
        });
    }
}

/**
 * Default massage staff count by weekday (calendar date in local time).
 * getDay(): Sun=0, Mon=1, … Sat=6 — Mon/Thu 6, Tue/Wed 5, Fri/Sat/Sun 9.
 */
function defaultMassageStaffForWeekday(wd) {
    const map = { 0: 9, 1: 6, 2: 5, 3: 5, 4: 6, 5: 9, 6: 9 };
    const v = map[wd];
    return v != null ? v : 4;
}

/**
 * Default facial specialist count by weekday — Fri/Sat/Sun 3; Mon–Thu 2.
 * getDay(): Sun=0 … Sat=6.
 */
function defaultFacialSpecialistsForWeekday(wd) {
    const map = { 0: 3, 1: 2, 2: 2, 3: 2, 4: 2, 5: 3, 6: 3 };
    const v = map[wd];
    return v != null ? v : 2;
}

function weekdayFromDateString(yyyyMmDd) {
    if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) {
        return new Date().getDay();
    }
    const p = yyyyMmDd.split('-');
    const y = parseInt(p[0], 10);
    const m = parseInt(p[1], 10) - 1;
    const d = parseInt(p[2], 10);
    return new Date(y, m, d).getDay();
}

/** Canonical massage name on roster for staffing-day helpers (non-Staff). */
function canonMassageTherapistOnRosterForDay(raw, roster, dup) {
    const t = String(raw || '').trim();
    if (!t || t.toLowerCase() === 'staff') return null;
    for (const r of roster) {
        if (therapistNamesMatchForCalendar(r, t, dup)) return r;
    }
    return t;
}

/**
 * Distinct masseuses assigned on therapist / therapist_2 for events on this local calendar date (singles + couples).
 */
function collectMassageTherapistNamesOnLocalDate(events, dateStr, therapistRoster) {
    const roster = (therapistRoster || []).filter(rosterNameForStaffingPick);
    const dup = buildTherapistFirstNameDuplicates(roster);
    const seen = new Set();
    if (!Array.isArray(events) || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return seen;
    for (const ev of events) {
        if (!ev || ev.room === 'ADDON') continue;
        const evDate = getLocalDateStringFromISO(ev.start_at);
        if (!evDate || evDate !== dateStr) continue;
        const isCouple = String(ev.type || '').toLowerCase() === 'couple';
        const fields = isCouple ? [ev.therapist, ev.therapist_2] : [ev.therapist];
        for (const field of fields) {
            const c = canonMassageTherapistOnRosterForDay(field, roster, dup);
            if (c) seen.add(c);
        }
    }
    return seen;
}

/**
 * Distinct facial specialists (facial / luxury mini fields) on events for this local calendar date.
 * @returns {Set<string>}
 */
function collectFacialSpecialistNamesOnLocalDate(events, dateStr, therapistRoster) {
    const roster = (therapistRoster || []).filter(rosterNameForStaffingPick);
    const dup = buildTherapistFirstNameDuplicates(roster);
    const seen = new Set();
    if (!Array.isArray(events) || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return seen;
    for (const ev of events) {
        if (!ev || ev.room === 'ADDON') continue;
        const evDate = getLocalDateStringFromISO(ev.start_at);
        if (!evDate || evDate !== dateStr) continue;
        for (const field of [ev.facial_specialist, ev.luxury_mini_facial_therapist, ev.luxury_mini_facial_therapist_2]) {
            const c = canonMassageTherapistOnRosterForDay(field, roster, dup);
            if (c) seen.add(c);
        }
    }
    return seen;
}

/**
 * Couple bookings need two masseuses; each missing non-Staff slot adds to staffing headcount (same calendar date).
 */
function countCoupleMassageSlotShortfallOnLocalDate(events, dateStr) {
    if (!Array.isArray(events) || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return 0;
    let short = 0;
    for (const ev of events) {
        if (!ev || ev.room === 'ADDON') continue;
        if (String(ev.type || '').toLowerCase() !== 'couple') continue;
        const evDate = getLocalDateStringFromISO(ev.start_at);
        if (!evDate || evDate !== dateStr) continue;
        let c = 0;
        for (const field of [ev.therapist, ev.therapist_2]) {
            const t = String(field || '').trim();
            if (t && t.toLowerCase() !== 'staff') c++;
        }
        if (c < 2) short += 2 - c;
    }
    return short;
}

/**
 * Default "Staff today": distinct masseuses on the calendar plus one slot per missing couple assignment (max 2/couple).
 */
function deriveMassageStaffCountFromSquareDayEvents(events, dateStr, therapistRoster) {
    if (!Array.isArray(events) || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const roster = (therapistRoster || []).filter(rosterNameForStaffingPick);
    const seen = collectMassageTherapistNamesOnLocalDate(events, dateStr, roster);
    const short = countCoupleMassageSlotShortfallOnLocalDate(events, dateStr);
    const total = seen.size + short;
    if (total < 1) return null;
    return Math.min(MOM_MAX_PLANNED_STAFF, Math.max(1, total));
}

/**
 * Unique facial specialists on events for this local calendar date (facial / luxury mini fields).
 * Default "Facial specialists today" when no manual weekday save exists.
 */
function deriveFacialStaffCountFromSquareDayEvents(events, dateStr, therapistRoster) {
    if (!Array.isArray(events) || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const roster = (therapistRoster || []).filter(rosterNameForStaffingPick);
    const dup = buildTherapistFirstNameDuplicates(roster);
    const seen = new Set();
    for (const ev of events) {
        if (!ev || ev.room === 'ADDON') continue;
        const evDate = getLocalDateStringFromISO(ev.start_at);
        if (!evDate || evDate !== dateStr) continue;
        for (const field of [ev.facial_specialist, ev.luxury_mini_facial_therapist, ev.luxury_mini_facial_therapist_2]) {
            const t = String(field || '').trim();
            if (!t || t.toLowerCase() === 'staff') continue;
            let name = t;
            for (const r of roster) {
                if (therapistNamesMatchForCalendar(r, t, dup)) {
                    name = r;
                    break;
                }
            }
            seen.add(name);
        }
    }
    if (seen.size < 1) return null;
    return Math.min(MOM_MAX_PLANNED_STAFF, Math.max(0, seen.size));
}

function migrateLegacyMassageStaffStorage() {
    try {
        const legacy = localStorage.getItem(MOM_STAFF_MASSEUSES_KEY);
        if (legacy == null || legacy === '') return;
        for (let wd = 0; wd <= 6; wd++) {
            if (localStorage.getItem(massageStaffStorageKeyForWeekday(wd)) != null) {
                return;
            }
        }
        for (let wd = 0; wd <= 6; wd++) {
            localStorage.setItem(massageStaffStorageKeyForWeekday(wd), legacy);
        }
        localStorage.removeItem(MOM_STAFF_MASSEUSES_KEY);
    } catch (e) { /* ignore */ }
}

function migrateLegacyFacialStaffStorage() {
    try {
        const legacy = localStorage.getItem(MOM_STAFF_FACIAL_SPECIALISTS_KEY);
        if (legacy == null || legacy === '') return;
        for (let wd = 0; wd <= 6; wd++) {
            if (localStorage.getItem(facialStaffStorageKeyForWeekday(wd)) != null) {
                return;
            }
        }
        for (let wd = 0; wd <= 6; wd++) {
            localStorage.setItem(facialStaffStorageKeyForWeekday(wd), legacy);
        }
        localStorage.removeItem(MOM_STAFF_FACIAL_SPECIALISTS_KEY);
    } catch (e) { /* ignore */ }
}

/**
 * Set massage staff dropdown: saved count for this weekday (manual), else unique masseuses on the loaded Square day,
 * else weekday default map.
 * @param {string} dateStr YYYY-MM-DD
 * @param {{ events?: unknown[], therapists?: string[] }} [opts] optional; defaults to currentData when date matches
 */
function applyMassageStaffSelectForDate(dateStr, opts) {
    const sel = document.getElementById('masseusesTodaySelect');
    if (!sel) return;
    const fromPick = savedStaffPickCountForDate(dateStr, 'massage');
    if (fromPick != null) {
        sel.value = String(fromPick);
        return;
    }
    const wd = weekdayFromDateString(dateStr);
    const key = massageStaffStorageKeyForWeekday(wd);
    let val;
    try {
        val = localStorage.getItem(key);
    } catch (e) { /* ignore */ }
    const n = val != null && val !== '' ? parseInt(val, 10) : NaN;
    if (!isNaN(n) && n >= 1) {
        sel.value = String(Math.min(MOM_MAX_PLANNED_STAFF, n));
        return;
    }
    let events;
    let therapists;
    if (opts && opts.events !== undefined) events = opts.events;
    else if (currentData && currentData.date === dateStr) events = currentData.events;
    else events = null;
    if (opts && opts.therapists !== undefined) therapists = opts.therapists;
    else if (currentData && currentData.date === dateStr) therapists = currentData.therapists;
    else therapists = null;
    const fromSquare = deriveMassageStaffCountFromSquareDayEvents(
        Array.isArray(events) ? events : [],
        dateStr,
        Array.isArray(therapists) ? therapists : [],
    );
    if (fromSquare != null) {
        sel.value = String(fromSquare);
        return;
    }
    const def = defaultMassageStaffForWeekday(wd);
    sel.value = String(Math.max(1, Math.min(MOM_MAX_PLANNED_STAFF, def)));
}

function applyMassageStaffSelectForCurrentDate() {
    const inp = document.getElementById('dateInput');
    const ds = inp && inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value) ? inp.value : null;
    applyMassageStaffSelectForDate(ds || getTodayLocal());
}

/**
 * Facial specialists dropdown: saved count for this weekday (manual), else unique FS on loaded Square day,
 * else weekday default map.
 * @param {string} dateStr YYYY-MM-DD
 * @param {{ events?: unknown[], therapists?: string[] }} [opts]
 */
function applyFacialSpecialistsSelectForDate(dateStr, opts) {
    const sel = document.getElementById('facialSpecialistsTodaySelect');
    if (!sel) return;
    const fromPick = savedStaffPickCountForDate(dateStr, 'facial');
    if (fromPick != null) {
        sel.value = String(fromPick);
        return;
    }
    const wd = weekdayFromDateString(dateStr);
    const key = facialStaffStorageKeyForWeekday(wd);
    let val;
    try {
        val = localStorage.getItem(key);
    } catch (e) { /* ignore */ }
    const n = val != null && val !== '' ? parseInt(val, 10) : NaN;
    if (!isNaN(n) && n >= 0) {
        sel.value = String(Math.min(MOM_MAX_PLANNED_STAFF, n));
        return;
    }
    let events;
    let therapists;
    if (opts && opts.events !== undefined) events = opts.events;
    else if (currentData && currentData.date === dateStr) events = currentData.events;
    else events = null;
    if (opts && opts.therapists !== undefined) therapists = opts.therapists;
    else if (currentData && currentData.date === dateStr) therapists = currentData.therapists;
    else therapists = null;
    const fromSquare = deriveFacialStaffCountFromSquareDayEvents(
        Array.isArray(events) ? events : [],
        dateStr,
        Array.isArray(therapists) ? therapists : [],
    );
    if (fromSquare != null) {
        sel.value = String(fromSquare);
        return;
    }
    const def = defaultFacialSpecialistsForWeekday(wd);
    sel.value = String(Math.max(0, Math.min(MOM_MAX_PLANNED_STAFF, def)));
}

function applyFacialSpecialistsSelectForCurrentDate() {
    const inp = document.getElementById('dateInput');
    const ds = inp && inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value) ? inp.value : null;
    applyFacialSpecialistsSelectForDate(ds || getTodayLocal());
}

function eventMassageStaffIntervals(ev) {
    if (!ev || !ev.start_at || !ev.end_at) return [];
    if (ev.room === 'ADDON') return [];
    const start = new Date(ev.start_at).getTime();
    const end = calendarColumnEventWallEndMs(ev);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const n = String(ev.type || '').toLowerCase() === 'couple' ? 2 : 1;
    return [{ a: start, b: end, n }];
}

/** Max concurrent massage staff slots (single=1, couple=2) at any instant in [rangeStartMs, rangeEndMs). */
function peakMassageStaffSlotsInWindow(events, rangeStartMs, rangeEndMs) {
    const intervals = [];
    for (const ev of events || []) {
        intervals.push(...eventMassageStaffIntervals(ev));
    }
    return peakWeightedIntervalsInRange(intervals, rangeStartMs, rangeEndMs);
}

function durationMinutesFromEventIso(startAt, endAt) {
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.max(0, Math.round((end - start) / 60000));
}

/**
 * (massage_min, facial_min) before the facial portion starts — mirrors app/room_occupancy.facial_massage_minutes,
 * plus relax-style “w N min massage”, and MoM rule: full-service ≥2hr lumps use the final 60 min as facial (one FS).
 */
function facialMassageSplitMinutes(service, durationMin, bookingType) {
    const lower = (service || '').toLowerCase();
    const isCouple = String(bookingType || '').toLowerCase() === 'couple';

    const wm = lower.match(/\b(?:w|with)\s+(\d+)\s*min(?:ute)?s?\s+massage\b/i);
    if (wm && (lower.includes('relax') || lower.includes('package') || isCouple)) {
        const m = Math.min(Math.max(1, parseInt(wm[1], 10)), durationMin);
        return [m, Math.max(0, durationMin - m)];
    }

    const hasMassage = lower.includes('massage');
    const hasFacial = lower.includes('facial');
    /* e.g. 5:30–7:30 (120m): massage first hour, facial last hour — not custom→85m massage + short facial */
    if (hasMassage && hasFacial && durationMin >= 120) {
        return [durationMin - 60, 60];
    }
    if (hasMassage && hasFacial && durationMin > 65) {
        if (lower.includes('custom facial') || lower.includes('facial custom') || lower.includes('facial package')) {
            const m = Math.min(85, durationMin);
            return [m, Math.max(0, durationMin - m)];
        }
        if (lower.includes('basic facial') || lower.includes('facial basic')) {
            const m = Math.min(55, durationMin);
            return [m, Math.max(0, durationMin - m)];
        }
    }

    if (
        (lower.includes('custom facial') || lower.includes('facial custom') || lower.includes('facial package'))
        && lower.includes('massage')
        && (lower.includes('90 min') || lower.includes('90min') || lower.includes(' 90 '))
    ) {
        return [90, Math.max(0, durationMin - 90)];
    }
    if (lower.includes('60 min') && lower.includes('massage')) {
        return [60, Math.max(0, durationMin - 60)];
    }
    if ((lower.includes('basic facial') || lower.includes('facial basic')) && durationMin <= 65) {
        return [30, Math.max(0, durationMin - 30)];
    }
    if ((lower.includes('custom facial') || lower.includes('facial custom')) && durationMin >= 75 && durationMin <= 105) {
        if (durationMin >= 88) return [60, Math.max(0, durationMin - 60)];
        return [60, Math.max(0, durationMin - 60)];
    }
    if (
        (lower.includes('custom facial') || lower.includes('facial custom'))
        && lower.includes('massage')
        && durationMin > 105
        && (lower.includes('couple') || lower.includes('couples'))
    ) {
        return [60, Math.max(0, durationMin - 60)];
    }
    if (
        (lower.includes('basic facial') || lower.includes('facial basic'))
        && lower.includes('massage')
        && durationMin > 65
        && (lower.includes('couple') || lower.includes('couples'))
    ) {
        return [60, Math.max(0, durationMin - 60)];
    }
    const half = Math.floor(durationMin / 2);
    return [half, durationMin - half];
}

/** True when the booking looks like facial work only (no massage segment in the title) — e.g. Pranali 6–7, Christie 7–8. */
function serviceLooksLikeFacialOnly(service) {
    const lower = (service || '').toLowerCase().trim();
    if (!lower.includes('facial')) return false;
    if (lower.includes('massage')) return false;
    return true;
}

/**
 * Intervals where facial work is in progress (counts toward concurrent “facial appointments” vs planned facial staff).
 * Couple = couples massage + one facial block (one FS), usually last part of the service. Luxury: up to 2 FS.
 */
function eventFacialAppointmentIntervals(ev) {
    if (!ev || !ev.start_at || !ev.end_at) return [];
    const start = new Date(ev.start_at).getTime();
    const end = new Date(ev.end_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const out = [];

    if (luxurySeparateMiniFacialChecked(ev)) {
        const luxEndRaw = ev.square_end_at ? new Date(ev.square_end_at).getTime() : end;
        const le = Number.isFinite(luxEndRaw) ? luxEndRaw : end;
        const miniMs = 30 * 60 * 1000;
        const a = Math.max(start, le - miniMs);
        if (a < le) {
            let n = 0;
            const fs1 = (ev.luxury_mini_facial_therapist || '').trim();
            const fs2 = (ev.luxury_mini_facial_therapist_2 || '').trim();
            const t1 = (ev.therapist || '').trim();
            const t2 = (ev.therapist_2 || '').trim();
            if (fs1 && fs1 !== t1) n++;
            if (fs2 && fs2 !== t2) n++;
            out.push({ a, b: le, n: n > 0 ? n : 1 });
        }
        return out;
    }

    if (ev.is_couple_facial_with_massage === true && ev.facial_segment_start_at) {
        const fs = new Date(ev.facial_segment_start_at).getTime();
        if (Number.isFinite(fs) && fs < end) {
            out.push({ a: Math.max(start, fs), b: end, n: 1 });
        }
        return out;
    }

    /* Couple package: one facial specialist for the facial portion (last segment), not two concurrent facials. */
    if (ev.is_couple_facial_with_massage === true && String(ev.type || '').toLowerCase() === 'couple') {
        const durMin = durationMinutesFromEventIso(ev.start_at, ev.end_at);
        const [massageMin, facialMin] = facialMassageSplitMinutes(ev.service, durMin, ev.type);
        if (facialMin <= 0) return out;
        let facialStart = start + massageMin * 60 * 1000;
        facialStart = Math.max(start, facialStart);
        if (facialStart < end) out.push({ a: facialStart, b: end, n: 1 });
        return out;
    }

    if (ev.is_facial_with_massage === true) {
        const durMin = durationMinutesFromEventIso(ev.start_at, ev.end_at);
        const [massageMin, facialMin] = facialMassageSplitMinutes(ev.service, durMin, ev.type);
        if (facialMin <= 0) return out;
        let facialStart = start + massageMin * 60 * 1000;
        if (ev.facial_segment_start_at) {
            const seg = new Date(ev.facial_segment_start_at).getTime();
            if (Number.isFinite(seg)) facialStart = Math.max(start, Math.min(seg, end));
        }
        facialStart = Math.max(start, facialStart);
        if (facialStart < end) out.push({ a: facialStart, b: end, n: 1 });
    }

    if (out.length === 0 && serviceLooksLikeFacialOnly(ev.service)) {
        out.push({ a: start, b: end, n: 1 });
    }

    return out;
}

/** Peak concurrent facial appointments (weighted: luxury may be 2) in [rangeStartMs, rangeEndMs). */
function peakFacialAppointmentSlotsInWindow(events, rangeStartMs, rangeEndMs) {
    const intervals = [];
    for (const ev of events || []) {
        intervals.push(...eventFacialAppointmentIntervals(ev));
    }
    return peakWeightedIntervalsInRange(intervals, rangeStartMs, rangeEndMs);
}

function peakWeightedIntervalsInRange(intervals, rangeStartMs, rangeEndMs) {
    const pts = new Set([rangeStartMs, rangeEndMs]);
    for (const it of intervals) {
        const a = Math.max(it.a, rangeStartMs);
        const b = Math.min(it.b, rangeEndMs);
        if (b <= a) continue;
        pts.add(a);
        pts.add(b);
    }
    const sorted = [...pts].sort((x, y) => x - y);
    let peak = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
        const lo = sorted[i];
        const hi = sorted[i + 1];
        if (hi <= lo) continue;
        const mid = lo + (hi - lo) / 2;
        let sum = 0;
        for (const it of intervals) {
            if (it.a < mid && it.b > mid) sum += it.n;
        }
        if (sum > peak) peak = sum;
    }
    return peak;
}

/** Header dropdown: massage therapists today (1–9; fallback = weekday default). */
function getPlannedMassageStaffTodayCount() {
    try {
        const sel = document.getElementById('masseusesTodaySelect');
        if (sel) {
            const n = parseInt(sel.value, 10);
            if (!isNaN(n)) return Math.max(1, Math.min(MOM_MAX_PLANNED_STAFF, n));
        }
    } catch (e) { /* ignore */ }
    const inp = document.getElementById('dateInput');
    const ds = inp && inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value) ? inp.value : getTodayLocal();
    return Math.max(1, Math.min(MOM_MAX_PLANNED_STAFF, defaultMassageStaffForWeekday(weekdayFromDateString(ds))));
}

/** Planned facial specialists today (0–9; fallback = weekday default). */
function getPlannedFacialSpecialistsTodayCount() {
    try {
        const sel = document.getElementById('facialSpecialistsTodaySelect');
        if (sel) {
            const n = parseInt(sel.value, 10);
            if (!isNaN(n)) return Math.max(0, Math.min(MOM_MAX_PLANNED_STAFF, n));
        }
    } catch (e) { /* ignore */ }
    const inp = document.getElementById('dateInput');
    const ds = inp && inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value) ? inp.value : getTodayLocal();
    return Math.max(0, Math.min(MOM_MAX_PLANNED_STAFF, defaultFacialSpecialistsForWeekday(weekdayFromDateString(ds))));
}

function initStaffingControls() {
    migrateLegacyMassageStaffStorage();
    migrateLegacyFacialStaffStorage();
    initStaffingAvailabilityPopover();

    const refreshCal = () => {
        if (currentData) renderCalendar(currentData);
    };

    const selM = document.getElementById('masseusesTodaySelect');
    if (selM && !selM.dataset.momStaffBound) {
        selM.dataset.momStaffBound = '1';
        applyMassageStaffSelectForCurrentDate();
        selM.addEventListener('change', () => {
            const inp = document.getElementById('dateInput');
            const ds = inp && inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value) ? inp.value : getTodayLocal();
            const wd = weekdayFromDateString(ds);
            clearSavedStaffPickForDate(ds, 'massage');
            try {
                localStorage.setItem(massageStaffStorageKeyForWeekday(wd), selM.value);
            } catch (e) { /* ignore */ }
            refreshCal();
        });
    }

    const selF = document.getElementById('facialSpecialistsTodaySelect');
    if (selF && !selF.dataset.momFacialStaffBound) {
        selF.dataset.momFacialStaffBound = '1';
        applyFacialSpecialistsSelectForCurrentDate();
        selF.addEventListener('change', () => {
            const inp = document.getElementById('dateInput');
            const ds = inp && inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value) ? inp.value : getTodayLocal();
            const wd = weekdayFromDateString(ds);
            clearSavedStaffPickForDate(ds, 'facial');
            try {
                localStorage.setItem(facialStaffStorageKeyForWeekday(wd), selF.value);
            } catch (e) { /* ignore */ }
            refreshCal();
        });
    }
    initStaffingPastUnlockClickOnce();
}

/** Physical rooms blocked when assigning to this calendar column (02D → 0 and 2). */
function physicalRoomIdsForTargetCalendarRoom(targetRoom) {
    if (targetRoom === '02D') return ['0', '2'];
    if (PHYSICAL_ROOM_IDS_CAP.includes(String(targetRoom))) return [String(targetRoom)];
    return [];
}

function otherBookingUsesPhysicalRoomInTimeRange(events, excludeBookingId, physicalRoomId, rangeStartMs, rangeEndMs) {
    for (const o of events || []) {
            if (!o || o.booking_id === excludeBookingId || o.room === 'UNASSIGNED' || o.room === 'ADDON') continue;
        if (eventUsesPhysicalRoomInSlot(o, rangeStartMs, rangeEndMs, physicalRoomId)) return true;
    }
    return false;
}

/** Rm columns that map to exactly one physical room (not 02D). Swaps between these should not trigger OVR. */
const SINGLE_PHYSICAL_ROOM_COLUMNS = new Set(['0', '1', '2', '3', '4', '5', '6']);

/**
 * True if dropping ev onto targetRoom should show the “room unavailable / OVR” confirm.
 * Excludes the common case: one other appointment already in that column (simple 0↔2 swap) — that is not the 02D-striping override case.
 */
function calendarTargetRoomHasAvailabilityConflict(ev, targetRoom, events) {
    if (!ev || !targetRoom || targetRoom === 'UNASSIGNED') return false;
    const start = new Date(ev.start_at).getTime();
    let end = eventPhysicalRoomBusyEndMs(ev);
    if (!Number.isFinite(end)) end = new Date(ev.end_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const rooms = physicalRoomIdsForTargetCalendarRoom(targetRoom);
    const seenIds = new Set();
    const blockers = [];
    for (let i = 0; i < rooms.length; i++) {
        const pid = rooms[i];
        for (const o of events || []) {
            if (!o || o.booking_id === ev.booking_id || o.room === 'UNASSIGNED' || o.room === 'ADDON') continue;
            if (!eventUsesPhysicalRoomInSlot(o, start, end, pid)) continue;
            if (seenIds.has(o.booking_id)) continue;
            seenIds.add(o.booking_id);
            blockers.push(o);
        }
    }
    if (blockers.length === 0) return false;

    // One booking already assigned to this column: treat as normal swap (no OVR). Only for plain single-physical columns.
    if (
        rooms.length === 1
        && blockers.length === 1
        && SINGLE_PHYSICAL_ROOM_COLUMNS.has(String(targetRoom))
        && SINGLE_PHYSICAL_ROOM_COLUMNS.has(String(ev.room || ''))
    ) {
        const o = blockers[0];
        if (o.room === targetRoom && SINGLE_PHYSICAL_ROOM_COLUMNS.has(String(o.room || ''))) {
            return false;
        }
    }
    return true;
}

/**
 * Room view: split couple massage + single facial into two blocks (Rm 5 / 6 / 02D). Facial column = override or Rm 2 (02D) / UNASSIGNED until set.
 */
function roomViewColumnsForEvent(ev) {
    if (!ev) return [];
    if (ev.room === 'UNASSIGNED') return [{ appointment: ev, column: 'UNASSIGNED' }];
    const fsMs = coupleSplitFacialStartMs(ev);
    if (fsMs != null) {
        const coupleRoom = ev.room;
        const massage = Object.assign({}, ev, {
            end_at: ev.facial_segment_start_at,
            _displayRoomForCalendar: coupleRoom,
            _roomViewSlice: 'couple_massage',
        });
        const fr = (ev.facial_portion_room || '').trim();
        let facialColumn = '2';
        if (coupleRoom === '5' || coupleRoom === '6') {
            facialColumn = fr || 'UNASSIGNED';
        } else if (coupleRoom === '02D') {
            facialColumn = fr || '2';
        }
        const facial = Object.assign({}, ev, {
            start_at: ev.facial_segment_start_at,
            _displayRoomForCalendar: facialColumn === 'UNASSIGNED' ? 'UNASSIGNED' : facialColumn,
            _roomViewSlice: 'couple_facial',
        });
        return [
            { appointment: massage, column: coupleRoom },
            { appointment: facial, column: facialColumn },
        ];
    }
    return [{ appointment: ev, column: ev.room }];
}

/** First grid row: "Single rooms" / "Couples" / "Unassigned" spanning room columns only. */
function appendRoomViewSuperheaderRow(grid, columns) {
    let nSingle = 0;
    let nCouple = 0;
    let nUnass = 0;
    for (const c of columns) {
        if (c === 'UNASSIGNED') nUnass += 1;
        else if (CALENDAR_ROOM_GROUP_SINGLE.has(c)) nSingle += 1;
        else if (CALENDAR_ROOM_GROUP_COUPLE.has(c)) nCouple += 1;
    }
    const firstRoomCol = 2; /* after Time only (Staff / Rooms / Capacity sidebars removed) */
    const corner = document.createElement('div');
    corner.className = 'room-superheader-corner';
    corner.setAttribute('aria-hidden', 'true');
    corner.style.gridColumn = '1 / span 1';
    corner.style.gridRow = '1';
    grid.appendChild(corner);

    const singles = document.createElement('div');
    singles.className = 'room-superheader-group room-superheader-singles';
    singles.textContent = uiT('calendar.roomGroupSingles', 'Single rooms');
    singles.style.gridColumn = `${firstRoomCol} / span ${nSingle}`;
    singles.style.gridRow = '1';
    grid.appendChild(singles);

    const coupleStart = firstRoomCol + nSingle;
    const couples = document.createElement('div');
    couples.className = 'room-superheader-group room-superheader-couples';
    couples.textContent = uiT('calendar.roomGroupCouples', 'Couples');
    couples.style.gridColumn = `${coupleStart} / span ${nCouple}`;
    couples.style.gridRow = '1';
    grid.appendChild(couples);

    if (nUnass > 0) {
        const unStart = coupleStart + nCouple;
        const un = document.createElement('div');
        un.className = 'room-superheader-group room-superheader-unassigned';
        un.textContent = uiT('calendar.roomGroupUnassigned', 'Unassigned');
        un.style.gridColumn = `${unStart} / span ${nUnass}`;
        un.style.gridRow = '1';
        grid.appendChild(un);
    }
}
/** CSS class for per-room column tint (room view + left "Rooms" mini-grid). */
function roomKeyToColumnClass(room) {
    if (room === 'UNASSIGNED') return 'room-col-unassigned';
    if (room === '02D') return 'room-col-02d';
    return 'room-col-' + String(room);
}
const RIGHT_SECTION_KEY = 'mom_right_section_collapsed'; // sessionStorage: '1' = collapsed
const LEFT_ROOMS_SIDEBAR_KEY = 'mom_calendar_rooms_sidebar_collapsed'; // '1' = collapsed
const LEFT_CAPACITY_SIDEBAR_KEY = 'mom_calendar_capacity_sidebar_collapsed'; // '1' = collapsed
/** sessionStorage '1' = 15-minute calendar rows; omitted/other = 30-minute (hour + half-hour only). */
const CALENDAR_QUARTER_SLOTS_KEY = 'mom_calendar_show_quarter_slots';
/** Narrow strip width when Rooms / Appointments Available column is collapsed */
const CALENDAR_SIDEBAR_COLLAPSED_COL_PX = 22;
function isRightSectionTherapist(name) {
    const s = (name || '').trim().toLowerCase();
    return s.includes('hongxia') || s.includes('hannah') || s.includes('hanna');
}
function getRightSectionTherapistsOrdered(therapists) {
    const right = (therapists || []).filter(t => isRightSectionTherapist(t));
    return right.sort((a, b) => {
        const aH = (a || '').toLowerCase().includes('hongxia') ? 0 : 1;
        const bH = (b || '').toLowerCase().includes('hongxia') ? 0 : 1;
        return aH - bH;
    });
}

/** Staffing checkbox popover: everyone else first, then right-column staff (Hongxia, then Hannah/Hanna). */
function sortStaffingPickListForPopover(names) {
    const arr = Array.isArray(names) ? names.slice() : [];
    const bottom = arr.filter((n) => isRightSectionTherapist(n));
    const top = arr.filter((n) => !isRightSectionTherapist(n));
    return top.concat(getRightSectionTherapistsOrdered(bottom));
}

const CALENDAR_ZOOM_KEY = 'mom_calendar_zoom';
/** On narrow screens: 'list' (readable cards) or 'grid' (original timetable). */
const PHONE_CALENDAR_LAYOUT_KEY = 'mom_calendar_phone_layout';
/** Desktop floating mirror: 'list' | 'checkout' (separate from phone layout key). */
const MOM_DESKTOP_PHONE_LIST_MODE_KEY = 'mom_desktop_phone_list_mode';
const MOM_DESKTOP_PHONE_LIST_POS_KEY = 'mom_desktop_phone_list_float_pos';
const MOM_APPOINTMENT_DETAIL_POS_KEY = 'mom_appointment_detail_pos';
/** Base px height of one calendar time row at 100% zoom (left timestamp + grid rows). */
const CALENDAR_BASE_SLOT_HEIGHT_PX = 44;
const CALENDAR_ZOOM_OPTIONS = [0.5, 0.67, 0.85, 1, 1.2, 1.5]; // slot height = BASE * zoom
const DEFAULT_CALENDAR_ZOOM = 1;

function getCalendarZoom() {
    try {
        const s = sessionStorage.getItem(CALENDAR_ZOOM_KEY);
        if (s != null) {
            const z = parseFloat(s);
            if (!Number.isNaN(z) && z >= 0.5 && z <= 2) return z;
        }
    } catch (e) {}
    return DEFAULT_CALENDAR_ZOOM;
}
function setCalendarZoom(z) {
    const clamped = Math.min(2, Math.max(0.5, z));
    try { sessionStorage.setItem(CALENDAR_ZOOM_KEY, String(clamped)); } catch (e) {}
    if (currentData) {
        renderCalendar(currentData);
        setTimeout(updateCurrentTimeLine, 50);
    }
    updateCalendarZoomUI();
    setTimeout(() => momCalendarStickyToolbarSync(), 80);
}
function getCalendarSlotHeight() {
    return Math.round(CALENDAR_BASE_SLOT_HEIGHT_PX * getCalendarZoom());
}
function updateCalendarZoomUI() {
    const valEl = document.getElementById('calendarZoomValue');
    if (valEl) valEl.textContent = Math.round(getCalendarZoom() * 100) + '%';
}
function momIsPhoneCalendarBreakpoint() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
}

function momPhoneCalendarLayoutMode() {
    try {
        const v = sessionStorage.getItem(PHONE_CALENDAR_LAYOUT_KEY);
        if (v === 'grid' || v === 'list' || v === 'checkout') return v;
    } catch (e) { /* ignore */ }
    return 'list';
}

function momSetPhoneCalendarLayout(mode) {
    try {
        if (mode === 'list' || mode === 'grid' || mode === 'checkout') {
            sessionStorage.setItem(PHONE_CALENDAR_LAYOUT_KEY, mode);
        }
    } catch (e) { /* ignore */ }
    if (currentData) renderCalendar(currentData);
}

/** Service window ended (same neutral end as checkout service end). */
function momPhoneListServiceEnded(apt) {
    if (!apt || !apt.end_at) return false;
    const endMs = new Date(apt.end_at).getTime();
    if (!Number.isFinite(endMs)) return false;
    const neutral = effectiveAddonTimeNeutralMinutes(apt) || 0;
    return Date.now() >= endMs - neutral * 60000;
}

function momPhoneListCustomerLine(apt) {
    const a = (apt && apt.customer && String(apt.customer).trim()) || '';
    const b = (apt && apt.customer_2 && String(apt.customer_2).trim()) || '';
    const isCouple = String((apt && apt.type) || '').toLowerCase() === 'couple';
    if (isCouple && b) return a && b ? `${a} · ${b}` : (a || b);
    return a || b || '—';
}

function momPhoneListTherapistLine(apt) {
    const t1 = (apt && apt.therapist && String(apt.therapist).trim()) || '';
    const t2 = (apt && apt.therapist_2 && String(apt.therapist_2).trim()) || '';
    const isCouple = String((apt && apt.type) || '').toLowerCase() === 'couple';
    if (isCouple && t2) return `${t1 || '—'} · ${t2}`;
    return t1 || '—';
}

function momPhoneListIsFacialService(apt) {
    const ds = String((apt && apt.display_service) || '').toLowerCase();
    const svc = String((apt && apt.service) || '').toLowerCase();
    return ds.includes('facial') || svc.includes('facial');
}

/** One small colored segment per 30 minutes in assigned room (same palette as Rooms available). */
function momPhoneListRoomTimelineHtml(apt) {
    const rk = String((apt && apt.room) || '').trim();
    if (!rk || rk === 'ADDON' || rk === 'UNASSIGNED') return '';
    const startMs = new Date(apt.start_at).getTime();
    const endWallMs = new Date(apt.end_at).getTime();
    const neutral = effectiveAddonTimeNeutralMinutes(apt) || 0;
    const endMs = endWallMs - neutral * 60000;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return '';
    const durMin = Math.round((endMs - startMs) / 60000);
    const slots = Math.max(1, Math.round(durMin / 30));
    const colCls = roomKeyToColumnClass(rk);
    const lab = escapeHtml(roomKeyDisplayLabel(rk));
    const rmDisp = escapeHtml(formatRoomForPanel(rk));
    const title = escapeHtml(`${rmDisp} · ${durMin} min`);
    let html = `<span class="phone-cal-room-timeline" title="${title}">`;
    for (let i = 0; i < slots; i++) {
        html += `<span class="phone-cal-room-seg rooms-room-slot--avail rooms-room-slot--solo ${colCls}">${lab}</span>`;
    }
    html += '</span>';
    return html;
}

/** Narrow list/checkout: immediately after Length value — Square Mass + first 3 letters of `original_therapist` (bold red italic). */
function momPhoneListSquareMassAfterLengthHtml(apt) {
    const letters = squareOriginalTherapistFirstThreeLetters(apt);
    if (!letters) return '';
    const full = escapeHtml(String((apt && apt.original_therapist) || '').trim());
    const sqLbl = escapeHtml(uiT('phoneCal.squareMassLabel', 'Square Mass:'));
    return (
        ` <span class="phone-cal-sqmas-after-len" title="${full}">` +
        `<span class="phone-cal-sqmas-after-len-label">${sqLbl}</span> ` +
        `<strong class="phone-cal-sqmas-letters phone-cal-sqmas-letters--inline-meta appointment-square-ms-hint-bg">${escapeHtml(letters)}</strong>` +
        `</span>`
    );
}

function momPhoneListDecoRowHtml(apt) {
    const parts = [];
    if (momPhoneListIsFacialService(apt)) {
        const facialApptLabel = escapeHtml(uiT('calendar.facialApptAria', 'Facial appointment'));
        parts.push(
            `<span class="phone-cal-facial-mask-inline" role="img" aria-label="${facialApptLabel}" title="${facialApptLabel}">${CALENDAR_FACIAL_MASK_SVG}</span>`
        );
    }
    const occ = appointmentOccasionIconsHtml(apt);
    if (occ) parts.push(occ);
    const cup = appointmentCuppingIconHtml(apt);
    if (cup) parts.push(cup);
    const bian = appointmentBianStoneIconHtml(apt);
    if (bian) parts.push(bian);
    if (shouldShowDavidGoldenFun(false, '', apt)) {
        parts.push(`<span class="phone-cal-david-golden-inline" aria-hidden="true">${buildDavidGoldenFunHtml()}</span>`);
    }
    if (!parts.length) return '';
    return `<div class="phone-cal-deco-row">${parts.join('')}</div>`;
}

function momPhoneCheckinSrmBlockHtml(apt, sorted, data) {
    const dateStr = document.getElementById('dateInput')?.value || '';
    const therapists = (data && data.therapists) || [];
    const { dup, noteIdx, crItems } = getMomCustomerRequestMatchContext();
    const massageAvailOrdered = getMassageStaffPickOrderedNamesForDate(dateStr);
    const emptyMap = new Map();
    function effDisp(slot) {
        return effectiveCheckinTherapistDisplay(apt, slot, therapists, crItems, dup, emptyMap, sorted, massageAvailOrdered);
    }
    function reqCls(slot) {
        const display = effDisp(slot);
        if (!display || isSlotTherapistUnset(display)) return '';
        if (String(apt.type || '').toLowerCase() === 'couple' && slot === 2) {
            const sec = coupleSlot2CustomerRequestedCanonical(apt, therapists, dup, crItems, massageAvailOrdered);
            return (sec && therapistNamesMatchForCalendar(display, sec, dup)) ? ' checkin-therapist-select--requested' : '';
        }
        return checkinTherapistMatchesCustomerRequestHighlight(display, apt, therapists, dup, noteIdx, crItems)
            ? ' checkin-therapist-select--requested'
            : '';
    }
    const opts1 = therapistOptionsFor(therapists, effDisp(1), massageAvailOrdered, true);
    const opts2 = therapistOptionsFor(therapists, effDisp(2), massageAvailOrdered, true);
    const srm1 = escapeHtml(uiT('label.srm1', 'Masseuse 1'));
    const srm2 = escapeHtml(uiT('label.srm2', 'Masseuse 2'));
    const srm = escapeHtml(uiT('label.srm', 'Masseuse'));
    const bidEsc = escapeHtml(String(apt.booking_id || ''));
    const isCouple = String(apt.type || '').toLowerCase() === 'couple';
    let inner;
    if (isCouple) {
        inner =
            `<div class="checkin-checkout-row-srm"><label>${srm1}</label><select class="checkin-therapist-select${reqCls(1)}" data-booking-id="${bidEsc}" data-slot="1">${opts1}</select></div>` +
            `<div class="checkin-checkout-row-srm"><label>${srm2}</label><select class="checkin-therapist-select${reqCls(2)}" data-booking-id="${bidEsc}" data-slot="2">${opts2}</select></div>`;
    } else {
        inner = `<div class="checkin-checkout-row-srm"><label>${srm}</label><select class="checkin-therapist-select${reqCls(1)}" data-booking-id="${bidEsc}" data-slot="1">${opts1}</select></div>`;
    }
    return `<div class="phone-cal-srm-row">${inner}</div>`;
}

function momPhoneCheckoutSrmBlockHtml(ev, sorted, data) {
    const dateStr = document.getElementById('dateInput')?.value || '';
    const therapists = (data && data.therapists) || [];
    const { dup: dupCk, noteIdx: noteIdxCk, crItems: crItemsCk } = getMomCustomerRequestMatchContext();
    const massageAvailOrderedCk = getMassageStaffPickOrderedNamesForDate(dateStr);
    const emptyMap = new Map();
    const items = sorted;
    const durationMin = getDurationMinutes(ev);
    const couple = String(ev.type || '').toLowerCase() === 'couple';
    const splitTime = !couple && ev.split_minutes_first != null;
    function curCk(slot) {
        return effectiveCheckinTherapistDisplay(ev, slot, therapists, crItemsCk, dupCk, emptyMap, items, massageAvailOrderedCk);
    }
    function checkoutReqCls(slot) {
        const display = curCk(slot);
        if (!display || isSlotTherapistUnset(display)) return '';
        if (couple && slot === 2) {
            const sec = coupleSlot2CustomerRequestedCanonical(ev, therapists, dupCk, crItemsCk, massageAvailOrderedCk);
            return (sec && therapistNamesMatchForCalendar(display, sec, dupCk)) ? ' checkout-therapist-select--requested' : '';
        }
        return checkinTherapistMatchesCustomerRequestHighlight(display, ev, therapists, dupCk, noteIdxCk, crItemsCk)
            ? ' checkout-therapist-select--requested'
            : '';
    }
    const opts1 = therapistOptionsFor(therapists, curCk(1), massageAvailOrderedCk);
    const opts2 = therapistOptionsFor(therapists, curCk(2), massageAvailOrderedCk);
    const srm1 = escapeHtml(uiT('label.srm1', 'Masseuse 1'));
    const srm2 = escapeHtml(uiT('label.srm2', 'Masseuse 2'));
    const srm = escapeHtml(uiT('label.srm', 'Masseuse'));
    const minFirst = ev.split_minutes_first != null ? Number(ev.split_minutes_first) : (durationMin ? Math.floor(durationMin / 2) : 30);
    const min1st = escapeHtml(uiT('checkout.minFirst', 'Min (1st)'));
    const minPh = escapeHtml(uiT('checkout.minPlaceholder', 'min'));
    const clrSplit = escapeHtml(uiT('checkout.clearSplit', 'Clear split'));
    const clrTitle = escapeHtml(uiT('checkout.clearSplitTitle', 'Clear split'));
    const bidEsc = escapeHtml(String(ev.booking_id || ''));
    let inner;
    if (couple) {
        inner =
            `<div class="checkout-srm1-inline"><div class="checkin-checkout-row-srm checkout-srm-narrow"><label>${srm1}</label><select class="checkout-therapist-select${checkoutReqCls(1)}" data-booking-id="${bidEsc}" data-slot="1">${opts1}</select></div></div>` +
            `<div class="checkin-checkout-row-srms checkout-checkout-srm2-only"><div class="checkin-checkout-row-srm checkout-srm-narrow"><label>${srm2}</label><select class="checkout-therapist-select${checkoutReqCls(2)}" data-booking-id="${bidEsc}" data-slot="2">${opts2}</select></div></div>`;
    } else if (splitTime) {
        inner =
            `<div class="checkout-srm1-inline"><div class="checkin-checkout-row-srm checkout-srm-narrow"><label>${srm1}</label><select class="checkout-therapist-select${checkoutReqCls(1)}" data-booking-id="${bidEsc}" data-slot="1">${opts1}</select></div><div class="checkin-checkout-row-split-min checkin-split-min-checkout-inline"><label>${min1st}</label><input type="number" min="0" step="1" class="checkout-split-min-input" data-booking-id="${bidEsc}" value="${minFirst}" placeholder="${minPh}" /></div></div>` +
            `<div class="checkin-checkout-row-srms checkin-checkout-row-split"><div class="checkout-split-line checkout-split-line-second"><div class="checkin-checkout-row-srm checkout-srm-narrow"><label>${srm2}</label><select class="checkout-therapist-select${checkoutReqCls(2)}" data-booking-id="${bidEsc}" data-slot="2">${opts2}</select></div><button type="button" class="checkout-clear-split-btn" data-booking-id="${bidEsc}" title="${clrTitle}">${clrSplit}</button></div></div>`;
    } else {
        inner = `<div class="checkin-checkout-row-srm-wrap"><div class="checkin-checkout-row-srm"><label>${srm}</label><select class="checkout-therapist-select${checkoutReqCls(1)}" data-booking-id="${bidEsc}" data-slot="1">${opts1}</select></div></div>`;
    }
    return `<div class="phone-checkout-srm-wrap" data-duration-min="${durationMin || 60}">${inner}</div>`;
}

function momBuildPhoneCalendarListInnerHtml(data) {
    const events = ((data && data.events) || []).filter((e) => e && e.room !== 'ADDON');
    if (!events.length) {
        return `<p class="phone-cal-empty">${escapeHtml(uiT('phoneCal.empty', 'No appointments for this day.'))}</p>`;
    }
    const { therapists, dup, crItems } = getMomCustomerRequestMatchContext();
    const sorted = events.slice().sort((a, b) => {
        const ta = new Date(a.start_at).getTime();
        const tb = new Date(b.start_at).getTime();
        return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
    });
    const reqAria = escapeHtml(uiT('phoneCal.requestedAria', 'Customer-requested masseuse'));
    const inTitle = escapeHtml(uiT('checkin.inTitle', 'Checked in'));
    const inLbl = escapeHtml(uiT('checkin.in', 'In'));
    const reqTitle = escapeHtml(uiT('staff.availTurnTipRequestedAria', 'Customer requested this therapist'));
    const lenK = escapeHtml(uiT('phoneCal.duration', 'Length'));
    return sorted.map((apt) => {
        const start = new Date(apt.start_at);
        const endWall = new Date(apt.end_at);
        const neutral = effectiveAddonTimeNeutralMinutes(apt);
        const displayEnd = neutral > 0 && !Number.isNaN(endWall.getTime())
            ? new Date(endWall.getTime() - neutral * 60000)
            : endWall;
        const timeStr = (!Number.isNaN(start.getTime()) && !Number.isNaN(displayEnd.getTime()))
            ? formatTimeRangeSmart(start, displayEnd)
            : '—';
        const svcRaw = (apt.display_service && apt.display_service.trim()) ? apt.display_service.trim() : (apt.service || '—');
        const svc = escapeHtml(uiCatalogLine(svcRaw));
        const cust = escapeHtml(momPhoneListCustomerLine(apt));
        const rm = escapeHtml(formatRoomForPanel(apt.room));
        const durMin = getDurationMinutes(apt);
        const durLabel = escapeHtml(formatDurationMinutes(durMin));
        const timeline = momPhoneListRoomTimelineHtml(apt);
        const deco = momPhoneListDecoRowHtml(apt);
        const sqMasAfterLen = momPhoneListSquareMassAfterLengthHtml(apt);
        const srmBlock = momPhoneCheckinSrmBlockHtml(apt, sorted, data);
        const isCouple = String(apt.type || '').toLowerCase() === 'couple';
        const typeMod = isCouple ? 'phone-calendar-row--couple' : 'phone-calendar-row--single';
        const vt = apt.is_voice_test ? ` <span class="phone-cal-badge">${escapeHtml(uiT('phoneCal.voiceTest', 'Test'))}</span>` : '';
        const startIso = apt.start_at ? String(apt.start_at) : '';
        const endIso = !Number.isNaN(displayEnd.getTime()) ? displayEnd.toISOString() : '';
        const rowTitle = escapeHtml(uiT('phoneCal.rowTitle', 'Open full appointment details'));
        const checkedIn = !!(apt.arrived_at_1);
        const ended = momPhoneListServiceEnded(apt);
        let cardCls = 'phone-calendar-card';
        if (checkedIn) cardCls += ' phone-calendar-card--checked-in';
        if (ended) cardCls += ' phone-calendar-card--finished';
        const bidStr = escapeHtml(String(apt.booking_id || ''));
        const reqNames = requestedMasseuseNamesForBooking(apt, crItems, therapists, dup);
        const tagsHtml = reqNames.length
            ? `<div class="phone-cal-request-tags" aria-label="${reqAria}">${
                reqNames.map((n) => `<span class="phone-cal-request-tag" title="${reqTitle}">${escapeHtml(n)}</span>`).join('')
            }</div>`
            : '';
        return (
            `<div class="${cardCls}" data-booking-id="${bidStr}" data-start-at="${escapeHtml(startIso)}" data-end-at="${escapeHtml(endIso)}">` +
            `<div class="phone-calendar-card-head">` +
            `<label class="phone-cal-checkin-label" title="${inTitle}">` +
            `<input type="checkbox" class="phone-cal-checkin-cb" data-booking-id="${bidStr}" ${checkedIn ? 'checked' : ''} />` +
            `<span class="phone-cal-checkin-text">${inLbl}</span></label>` +
            `<button type="button" class="phone-calendar-row phone-calendar-row-main ${typeMod}" title="${rowTitle}" data-booking-id="${bidStr}">` +
            `<span class="phone-cal-time">${escapeHtml(timeStr)}</span>` +
            `${deco}` +
            `${timeline}` +
            `<span class="phone-cal-customers">${cust}${vt}</span>` +
            `<span class="phone-cal-service">${svc}</span>` +
            `<span class="phone-cal-meta">` +
            `<span class="phone-cal-meta-item"><span class="phone-cal-meta-k">${escapeHtml(uiT('phoneCal.room', 'Room'))}</span> ${rm}</span>` +
            `<span class="phone-cal-meta-item phone-cal-meta-len-with-sqmas"><span class="phone-cal-meta-k">${lenK}</span> ${durLabel}${sqMasAfterLen}</span>` +
            `</span></button></div>${srmBlock}${tagsHtml}</div>`
        );
    }).join('');
}

function momBuildPhoneCalendarCheckoutListInnerHtml(data) {
    const dateStr = document.getElementById('dateInput')?.value || '';
    const events = ((data && data.events) || []).filter((e) => e && e.room !== 'ADDON');
    if (!events.length) {
        return `<p class="phone-cal-empty">${escapeHtml(uiT('phoneCal.empty', 'No appointments for this day.'))}</p>`;
    }
    const sorted = events.slice().sort((a, b) => {
        const ma = getCheckoutServiceEndMs(a);
        const mb = getCheckoutServiceEndMs(b);
        const ta = ma != null ? ma : new Date(a.end_at).getTime();
        const tb = mb != null ? mb : new Date(b.end_at).getTime();
        return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    });
    const outTitle = escapeHtml(uiT('checkout.outTitle', 'Checked out'));
    const outLbl = escapeHtml(uiT('checkout.out', 'Out'));
    const svcPaidLbl = escapeHtml(uiT('checkout.servicesPaidLabel', 'Services paid'));
    const svcPaidTitle = escapeHtml(
        uiT(
            'checkout.servicesPaidTitle',
            'Check when service charges are already collected (card/cash/Square) so you can ask about tip only.'
        )
    );
    const tipPh = escapeHtml(uiT('checkout.tipPlaceholder', 'Tip'));
    const cashLbl = escapeHtml(uiT('checkout.cash', 'cash'));
    const detTitle = escapeHtml(uiT('phoneCal.rowTitle', 'Open full appointment details'));
    const detLbl = escapeHtml(uiT('phoneCal.details', 'Details'));
    const lenK = escapeHtml(uiT('phoneCal.duration', 'Length'));
    return sorted.map((ev) => {
        const name = escapeHtml(formatCustomerFirstLastInitial(ev.customer));
        const rawSvc = (ev.display_service && ev.display_service.trim()) ? ev.display_service.trim() : (ev.service || '—');
        let service = calendarStripPainReliefOilFromServiceLine(uiCatalogLine(rawSvc)).trim() || '—';
        service = escapeHtml(service);
        const duration = escapeHtml(formatDurationMinutes(getDurationMinutes(ev)));
        const rm = escapeHtml(formatRoomForPanel(ev.room));
        const checkoutDone = dateStr ? isCheckoutDone(dateStr, ev.booking_id) : false;
        const servicesPaidChecked = dateStr ? isCheckoutServicesPaid(dateStr, ev.booking_id) : false;
        const tipValNum = (ev.tip_amount != null && ev.tip_amount_2 != null)
            ? (Number(ev.tip_amount) + Number(ev.tip_amount_2))
            : (ev.tip_amount != null ? Number(ev.tip_amount) : NaN);
        const tipValStr = Number.isFinite(tipValNum) ? String(tipValNum) : '';
        const tipCash = ev.tip_cash === true;
        const timeStart = ev.start_at && !Number.isNaN(new Date(ev.start_at).getTime())
            ? formatTimeCompactUS(new Date(ev.start_at))
            : '—';
        const rawEndMs = getCheckoutServiceEndMs(ev);
        const endSnapMs = rawEndMs != null ? snapCheckoutServiceEndMsIfNearHalfHour(rawEndMs) : null;
        const timeCheckout =
            endSnapMs != null && !Number.isNaN(new Date(endSnapMs).getTime())
                ? formatTimeCompactUS(new Date(endSnapMs))
                : '—';
        const startedParen = uiTParams(
            'phoneCal.checkoutStartedParen',
            { time: timeStart },
            `(started ${timeStart})`
        );
        const couple = String(ev.type || '').toLowerCase() === 'couple';
        const splitTime = !couple && ev.split_minutes_first != null;
        const timeline = momPhoneListRoomTimelineHtml(ev);
        const deco = momPhoneListDecoRowHtml(ev);
        const sqMasAfterLen = momPhoneListSquareMassAfterLengthHtml(ev);
        const srmWrap = momPhoneCheckoutSrmBlockHtml(ev, sorted, data);
        const rowCls = ['checkin-checkout-row', 'phone-checkout-card', checkoutDone ? 'checkout-row-done' : '', servicesPaidChecked ? 'checkout-row-services-paid' : '', splitTime ? 'checkout-row-split' : ''].filter(Boolean).join(' ');
        const bidEsc = escapeHtml(String(ev.booking_id || ''));
        const startIsoAttr = ev.start_at ? escapeHtml(String(ev.start_at)) : '';
        const svcEndMs = getCheckoutServiceEndMs(ev);
        const svcEndIsoAttr =
            svcEndMs != null && Number.isFinite(svcEndMs) ? escapeHtml(new Date(svcEndMs).toISOString()) : '';
        const dataTimeAttrs =
            startIsoAttr && svcEndIsoAttr
                ? ` data-start-at="${startIsoAttr}" data-service-end-at="${svcEndIsoAttr}"`
                : '';
        return (
            `<div class="${rowCls}" data-booking-id="${bidEsc}"${dataTimeAttrs}>` +
            `<div class="phone-checkout-card-top">` +
            `<div class="phone-checkout-card-info">` +
            `<span class="phone-cal-time phone-cal-time--checkout"><span class="phone-cal-time-checkout">${escapeHtml(timeCheckout)}</span> ` +
            `<span class="phone-cal-time-started">${escapeHtml(startedParen)}</span></span>` +
            `${deco}` +
            `${timeline}` +
            `<span class="phone-cal-customers">${name}</span>` +
            `<span class="phone-cal-service">${service}</span>` +
            `<span class="phone-cal-meta"><span class="phone-cal-meta-item"><span class="phone-cal-meta-k">${escapeHtml(uiT('phoneCal.room', 'Room'))}</span> ${rm}</span>` +
            `<span class="phone-cal-meta-item phone-cal-meta-len-with-sqmas"><span class="phone-cal-meta-k">${lenK}</span> ${duration}${sqMasAfterLen}</span></span>` +
            `</div>` +
            `<button type="button" class="phone-checkout-detail-btn" title="${detTitle}" data-booking-id="${bidEsc}">${detLbl}</button>` +
            `</div>` +
            `<div class="phone-checkout-card-actions-row">` +
            `${srmWrap}` +
            `<div class="phone-checkout-card-controls">` +
            `<div class="phone-checkout-out-row"><label class="checkin-checkout-done-label" title="${outTitle}"><input type="checkbox" class="checkout-done-cb" data-booking-id="${bidEsc}" ${checkoutDone ? 'checked' : ''} /> ${outLbl}</label></div>` +
            `<div class="checkout-services-paid-wrap phone-checkout-paid-wrap"><label class="checkout-services-paid-label" title="${svcPaidTitle}"><input type="checkbox" class="checkout-services-paid-cb" data-booking-id="${bidEsc}" ${servicesPaidChecked ? 'checked' : ''} /><span class="checkout-services-paid-text">${svcPaidLbl}</span></label></div>` +
            `<div class="checkout-tip-line phone-checkout-tip-line"><label class="checkout-tip-dollar" aria-hidden="true">$</label>` +
            `<input type="number" min="0" step="0.01" class="checkout-tip-input" data-booking-id="${bidEsc}" value="${escapeHtml(tipValStr)}" placeholder="${tipPh}" />` +
            `<label class="checkout-tip-cash-label"><input type="checkbox" class="checkout-tip-cash-cb" data-booking-id="${bidEsc}" ${tipCash ? 'checked' : ''} /> ${cashLbl}</label></div>` +
            `</div></div></div>`
        );
    }).join('');
}

function momBindPhoneCalendarListClicks(container) {
    if (!container) return;
    container.querySelectorAll('.phone-calendar-row-main[data-booking-id]').forEach((btn) => {
        if (btn.dataset.phoneListBound === '1') return;
        btn.dataset.phoneListBound = '1';
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-booking-id');
            if (!id || !currentData || !currentData.events) return;
            const ev = currentData.events.find((x) => String(x.booking_id) === id);
            if (ev) void showAppointmentDetailModal(ev);
        });
    });
}

function momBindPhoneCalendarCheckinBoxes(container) {
    if (!container) return;
    container.querySelectorAll('.phone-cal-checkin-cb').forEach((cb) => {
        if (cb.dataset.phoneCheckinBound === '1') return;
        cb.dataset.phoneCheckinBound = '1';
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', async () => {
            if (!cb.checked) return;
            const bid = cb.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            try {
                const res = await fetch('/api/check-in', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bid, date, client_index: 1 }),
                });
                if (res.ok) loadDay({ soft: true });
            } catch (e) { console.error(e); }
        });
    });
}

/** Masseuse dropdowns on phone check-in list (same API + requested shading as check-in panel). */
function momBindPhoneListTherapistSelects(container) {
    if (!container) return;
    const dateStr = document.getElementById('dateInput')?.value;
    const items = (currentData && currentData.events) || [];
    const therapists = (currentData && currentData.therapists) || [];
    const { dup, noteIdx, crItems } = getMomCustomerRequestMatchContext();
    const massageAvailOrdered = getMassageStaffPickOrderedNamesForDate(dateStr);
    const emptyMap = new Map();
    const sliceItems = items.filter((e) => e && e.room !== 'ADDON');
    function effDisp(ev, slot) {
        return effectiveCheckinTherapistDisplay(ev, slot, therapists, crItems, dup, emptyMap, sliceItems, massageAvailOrdered);
    }
    function syncCheckinReqClass(sel, ev) {
        if (!sel || !ev) return;
        const v = String(sel.value || '').trim();
        const slot = parseInt(sel.dataset.slot, 10) || 1;
        const dateStrSync = document.getElementById('dateInput')?.value;
        const massageOrdSync = getMassageStaffPickOrderedNamesForDate(dateStrSync);
        const { therapists: t0, dup: d0, noteIdx: n0, crItems: c0 } = getMomCustomerRequestMatchContext();
        let isReq = false;
        if (v && !isSlotTherapistUnset(v)) {
            if (String(ev.type || '').toLowerCase() === 'couple' && slot === 2) {
                const sec = coupleSlot2CustomerRequestedCanonical(ev, t0, d0, c0, massageOrdSync);
                isReq = !!(sec && therapistNamesMatchForCalendar(v, sec, d0));
            } else {
                isReq = checkinTherapistMatchesCustomerRequestHighlight(v, ev, t0, d0, n0, c0);
            }
        }
        sel.classList.toggle('checkin-therapist-select--requested', isReq);
        if (isReq) sel.setAttribute('title', uiT('staff.availTurnTipRequestedAria', 'Customer requested this therapist'));
        else sel.removeAttribute('title');
    }
    container.querySelectorAll('.checkin-therapist-select').forEach((sel) => {
        const bid = sel.dataset.bookingId;
        const slot = parseInt(sel.dataset.slot, 10) || 1;
        const ev = items.find((e) => String(e.booking_id) === String(bid));
        if (ev) {
            const display = effDisp(ev, slot);
            sel.value = display;
            sel.dataset.initialTherapistDisplay = display;
            syncCheckinReqClass(sel, ev);
        }
    });
    container.querySelectorAll('.checkin-therapist-select').forEach((sel) => {
        if (sel.dataset.phoneListSrmBound === '1') return;
        sel.dataset.phoneListSrmBound = '1';
        sel.addEventListener('change', async () => {
            const bid = sel.dataset.bookingId;
            const slot = parseInt(sel.dataset.slot, 10) || 1;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            const ev = (currentData && currentData.events || []).find((e) => String(e.booking_id) === String(bid));
            const initial = sel.dataset.initialTherapistDisplay || '';
            const newVal = sel.value;
            syncCheckinReqClass(sel, ev);
            const { therapists: tcf, dup: dcf, noteIdx: nicf, crItems: crcf } = getMomCustomerRequestMatchContext();
            const prompt = therapistChangeConfirmPrompt(initial, newVal, ev, tcf, dcf, nicf, crcf, slot);
            if (prompt && !confirm(prompt)) {
                sel.value = initial;
                syncCheckinReqClass(sel, ev);
                return;
            }
            try {
                const res = await fetch('/api/therapist', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bid, date, therapist: newVal, locked: true, slot }),
                });
                if (res.ok) {
                    sel.dataset.initialTherapistDisplay = newVal;
                    loadDay({ soft: true });
                } else syncCheckinReqClass(sel, ev);
            } catch (e) {
                console.error(e);
                syncCheckinReqClass(sel, ev);
            }
        });
    });
}

/** Checkout masseuse / split controls on phone checkout list (same behavior as checkout panel). */
function momBindPhoneCheckoutTherapistExtras(container) {
    if (!container) return;
    const dateStr = document.getElementById('dateInput')?.value;
    const items = (currentData && currentData.events) || [];
    const therapists = (currentData && currentData.therapists) || [];
    const { dup: dupCk, noteIdx: noteIdxCk, crItems: crItemsCk } = getMomCustomerRequestMatchContext();
    const massageAvailOrderedCk = getMassageStaffPickOrderedNamesForDate(dateStr);
    const emptyMap = new Map();
    const sliceItems = items.filter((e) => e && e.room !== 'ADDON');
    function syncCoReq(sel, ev) {
        if (!sel || !ev) return;
        const { therapists: t0, dup: d0, noteIdx: n0, crItems: c0 } = getMomCustomerRequestMatchContext();
        const v = String(sel.value || '').trim();
        const slot = parseInt(sel.dataset.slot, 10) || 1;
        const dateStrCo = document.getElementById('dateInput')?.value;
        const massageOrdCo = getMassageStaffPickOrderedNamesForDate(dateStrCo);
        let isReq = false;
        if (v && !isSlotTherapistUnset(v)) {
            if (String(ev.type || '').toLowerCase() === 'couple' && slot === 2) {
                const sec = coupleSlot2CustomerRequestedCanonical(ev, t0, d0, c0, massageOrdCo);
                isReq = !!(sec && therapistNamesMatchForCalendar(v, sec, d0));
            } else {
                isReq = checkinTherapistMatchesCustomerRequestHighlight(v, ev, t0, d0, n0, c0);
            }
        }
        sel.classList.toggle('checkout-therapist-select--requested', isReq);
        if (isReq) sel.setAttribute('title', uiT('staff.availTurnTipRequestedAria', 'Customer requested this therapist'));
        else sel.removeAttribute('title');
    }
    container.querySelectorAll('.checkout-therapist-select').forEach((sel) => {
        const bid = sel.dataset.bookingId;
        const slot = parseInt(sel.dataset.slot, 10) || 1;
        const ev = items.find((e) => String(e.booking_id) === String(bid));
        if (ev) {
            const display = effectiveCheckinTherapistDisplay(ev, slot, therapists, crItemsCk, dupCk, emptyMap, sliceItems, massageAvailOrderedCk);
            sel.value = display;
            sel.dataset.initialTherapistDisplay = display;
            syncCoReq(sel, ev);
        }
    });
    container.querySelectorAll('.checkout-therapist-select').forEach((sel) => {
        if (sel.dataset.phoneCoSrmBound === '1') return;
        sel.dataset.phoneCoSrmBound = '1';
        sel.addEventListener('change', async () => {
            const bid = sel.dataset.bookingId;
            const slot = parseInt(sel.dataset.slot, 10) || 1;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            const ev = (currentData && currentData.events || []).find((e) => String(e.booking_id) === String(bid));
            const initial = sel.dataset.initialTherapistDisplay || '';
            const newVal = sel.value;
            syncCoReq(sel, ev);
            const row = sel.closest('.checkin-checkout-row, .phone-checkout-card');
            const isSplitRow = row && row.classList.contains('checkout-row-split');
            if (slot === 2 && isSplitRow && !(newVal || '').trim()) {
                try {
                    const res = await fetch('/api/booking/split-time', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ booking_id: bid, date, minutes_first: null }),
                    });
                    if (res.ok) {
                        momCheckoutPanelDraftBookingIds.delete(bid);
                        loadDay({ soft: true });
                        return;
                    }
                } catch (e) { console.error(e); }
            }
            const { therapists: tcf, dup: dcf, noteIdx: nicf, crItems: crcf } = getMomCustomerRequestMatchContext();
            const prompt = therapistChangeConfirmPrompt(initial, newVal, ev, tcf, dcf, nicf, crcf, slot);
            if (prompt && !confirm(prompt)) {
                sel.value = initial;
                syncCoReq(sel, ev);
                return;
            }
            try {
                const res = await fetch('/api/therapist', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bid, date, therapist: newVal, locked: true, slot }),
                });
                if (res.ok) loadDay({ soft: true });
                else syncCoReq(sel, ev);
            } catch (e) {
                console.error(e);
                syncCoReq(sel, ev);
            }
        });
    });
    container.querySelectorAll('.checkout-split-min-input').forEach((input) => {
        if (input.dataset.phoneCoSplitBound === '1') return;
        input.dataset.phoneCoSplitBound = '1';
        input.addEventListener('change', async () => {
            const bid = input.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            const val = input.value.trim() === '' ? null : parseInt(input.value, 10);
            if (val != null && (isNaN(val) || val < 0)) return;
            try {
                const res = await fetch('/api/booking/split-time', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bid, date, minutes_first: val }),
                });
                if (res.ok) {
                    momCheckoutPanelDraftBookingIds.delete(bid);
                    loadDay({ soft: true });
                }
            } catch (e) { console.error(e); }
        });
    });
    container.querySelectorAll('.checkout-clear-split-btn').forEach((btn) => {
        if (btn.dataset.phoneCoClrSplitBound === '1') return;
        btn.dataset.phoneCoClrSplitBound = '1';
        btn.addEventListener('click', async () => {
            const bid = btn.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            try {
                const res = await fetch('/api/booking/split-time', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bid, date, minutes_first: null }),
                });
                if (res.ok) {
                    momCheckoutPanelDraftBookingIds.delete(bid);
                    loadDay({ soft: true });
                }
            } catch (e) { console.error(e); }
        });
    });
}

function momBindPhoneCheckoutDetailClicks(container) {
    if (!container) return;
    container.querySelectorAll('.phone-checkout-detail-btn[data-booking-id]').forEach((btn) => {
        if (btn.dataset.phoneCoDetBound === '1') return;
        btn.dataset.phoneCoDetBound = '1';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-booking-id');
            if (!id || !currentData || !currentData.events) return;
            const ev = currentData.events.find((x) => String(x.booking_id) === id);
            if (ev) void showAppointmentDetailModal(ev);
        });
    });
}

function momMountPhoneCalendarListIntoElement(el, data, mode) {
    if (!el || !data) return;
    const m = mode === 'checkout' ? 'checkout' : 'list';
    el.innerHTML = m === 'checkout'
        ? momBuildPhoneCalendarCheckoutListInnerHtml(data)
        : momBuildPhoneCalendarListInnerHtml(data);
    if (m === 'checkout') {
        momBindCheckoutCoreControls(el);
        momBindPhoneCheckoutTherapistExtras(el);
        momBindPhoneCheckoutDetailClicks(el);
    } else {
        momBindPhoneCalendarListClicks(el);
        momBindPhoneCalendarCheckinBoxes(el);
        momBindPhoneListTherapistSelects(el);
    }
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
}

function momDesktopPhoneListMirrorMode() {
    try {
        const v = sessionStorage.getItem(MOM_DESKTOP_PHONE_LIST_MODE_KEY);
        if (v === 'list' || v === 'checkout') return v;
    } catch (e) { /* ignore */ }
    return 'list';
}

function momSetDesktopPhoneListMirrorMode(mode) {
    try {
        if (mode === 'list' || mode === 'checkout') {
            sessionStorage.setItem(MOM_DESKTOP_PHONE_LIST_MODE_KEY, mode);
        }
    } catch (e) { /* ignore */ }
    momRefreshDesktopPhoneListMirror();
}

function momDesktopPhoneListFloatingIsShown() {
    const p = document.getElementById('desktopPhoneListFloating');
    return !!(p && p.style.display === 'flex');
}

function momSyncDesktopMirrorSegButtons() {
    const listBtn = document.getElementById('desktopPhoneMirrorListBtn');
    const checkoutBtn = document.getElementById('desktopPhoneMirrorCheckoutBtn');
    const mode = momDesktopPhoneListMirrorMode();
    if (listBtn) listBtn.classList.toggle('phone-calendar-view-seg--active', mode === 'list');
    if (checkoutBtn) checkoutBtn.classList.toggle('phone-calendar-view-seg--active', mode === 'checkout');
}

function momRefreshDesktopPhoneListMirror(dataOpt) {
    const panel = document.getElementById('desktopPhoneListFloating');
    const wrap = document.getElementById('desktopPhoneListMirrorWrap');
    const data = dataOpt || currentData;
    if (!panel || !wrap || panel.style.display !== 'flex' || !data) return;
    momMountPhoneCalendarListIntoElement(wrap, data, momDesktopPhoneListMirrorMode());
    momSyncDesktopMirrorSegButtons();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => momScrollDesktopPhoneListMirrorToCurrentTime(momDesktopPhoneListMirrorMode()));
    });
}

function momCloseDesktopPhonePeekDetails() {
    const d = document.getElementById('desktopPhonePeekDetails');
    if (d) d.open = false;
}

function momApplyDesktopPhoneListSavedPosition() {
    const panel = document.getElementById('desktopPhoneListFloating');
    if (!panel) return;
    try {
        const raw = localStorage.getItem(MOM_DESKTOP_PHONE_LIST_POS_KEY);
        if (raw) {
            const j = JSON.parse(raw);
            if (typeof j.left === 'number' && typeof j.top === 'number' && Number.isFinite(j.left) && Number.isFinite(j.top)) {
                panel.style.left = `${j.left}px`;
                panel.style.top = `${j.top}px`;
                panel.style.right = 'auto';
                return;
            }
        }
    } catch (e) { /* ignore */ }
    panel.style.left = 'auto';
    panel.style.top = '92px';
    panel.style.right = '16px';
}

function momSaveDesktopPhoneListPosition(panel) {
    if (!panel || panel.style.display !== 'flex') return;
    try {
        const r = panel.getBoundingClientRect();
        const left = Math.round(r.left);
        const top = Math.round(r.top);
        localStorage.setItem(MOM_DESKTOP_PHONE_LIST_POS_KEY, JSON.stringify({ left, top }));
    } catch (e) { /* ignore */ }
}

function initDesktopPhoneListMirrorPanel() {
    const panel = document.getElementById('desktopPhoneListFloating');
    const handle = document.getElementById('desktopPhoneListDragHandle');
    const minBtn = document.getElementById('desktopPhoneListMinBtn');
    const closeBtn = document.getElementById('desktopPhoneListCloseBtn');
    const listBtn = document.getElementById('desktopPhoneMirrorListBtn');
    const checkoutBtn = document.getElementById('desktopPhoneMirrorCheckoutBtn');
    const peekList = document.getElementById('desktopPhonePeekOpenList');
    const peekCk = document.getElementById('desktopPhonePeekOpenCheckout');
    if (!panel || panel.dataset.desktopPhoneMirrorBound === '1') return;
    panel.dataset.desktopPhoneMirrorBound = '1';

    function openFloating(mode) {
        if (mode === 'checkout' || mode === 'list') {
            try {
                sessionStorage.setItem(MOM_DESKTOP_PHONE_LIST_MODE_KEY, mode);
            } catch (e) { /* ignore */ }
        }
        panel.style.display = 'flex';
        panel.setAttribute('aria-hidden', 'false');
        momApplyDesktopPhoneListSavedPosition();
        momRefreshDesktopPhoneListMirror();
        momCloseDesktopPhonePeekDetails();
    }

    peekList?.addEventListener('click', (e) => {
        e.preventDefault();
        openFloating('list');
    });
    peekCk?.addEventListener('click', (e) => {
        e.preventDefault();
        openFloating('checkout');
    });
    listBtn?.addEventListener('click', () => { momSetDesktopPhoneListMirrorMode('list'); });
    checkoutBtn?.addEventListener('click', () => { momSetDesktopPhoneListMirrorMode('checkout'); });

    [minBtn, closeBtn, listBtn, checkoutBtn].forEach((b) => {
        b?.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    });

    closeBtn?.addEventListener('click', () => {
        panel.style.display = 'none';
        panel.setAttribute('aria-hidden', 'true');
        panel.dataset.minimized = '';
        panel.classList.remove('desktop-phone-list-floating--minimized');
    });

    minBtn?.addEventListener('click', () => {
        const on = panel.dataset.minimized === '1';
        panel.dataset.minimized = on ? '' : '1';
        panel.classList.toggle('desktop-phone-list-floating--minimized', !on);
    });

    let drag = null;
    handle?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.desktop-phone-list-floating-icon-btn')) return;
        const r = panel.getBoundingClientRect();
        drag = {
            sx: e.clientX,
            sy: e.clientY,
            left: r.left,
            top: r.top,
        };
        panel.classList.add('desktop-phone-list-floating--dragging');
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        let left = drag.left + dx;
        let top = drag.top + dy;
        const w = panel.offsetWidth || 360;
        const h = panel.offsetHeight || 400;
        const maxL = Math.max(8, window.innerWidth - w - 8);
        const maxT = Math.max(8, window.innerHeight - h - 8);
        left = Math.min(maxL, Math.max(8, left));
        top = Math.min(maxT, Math.max(8, top));
        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
        panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
        if (!drag) return;
        drag = null;
        panel.classList.remove('desktop-phone-list-floating--dragging');
        momSaveDesktopPhoneListPosition(panel);
    });

    if (typeof window.matchMedia === 'function') {
        window.matchMedia('(max-width: 768px)').addEventListener('change', (ev) => {
            if (ev.matches && momDesktopPhoneListFloatingIsShown()) {
                panel.style.display = 'none';
                panel.setAttribute('aria-hidden', 'true');
                momCloseDesktopPhonePeekDetails();
            }
        });
    }
}

/** Narrow screens: scroll phone list / checkout so in-progress or next-upcoming row is visible (selected day must be today). */
function momScrollPhoneCalendarListCore(wrap, scrollRoot, mode) {
    const dateStr = document.getElementById('dateInput')?.value;
    if (!wrap || !scrollRoot) return;
    if (wrap.querySelector('.phone-cal-empty')) {
        scrollRoot.scrollTop = 0;
        return;
    }
    if (!dateStr || dateStr !== getTodayLocal()) {
        scrollRoot.scrollTop = 0;
        return;
    }
    const nowMs = Date.now();
    let target = null;
    if (mode === 'list') {
        const cards = [...wrap.querySelectorAll('.phone-calendar-card[data-start-at][data-end-at]')];
        if (!cards.length) return;
        target =
            cards.find((el) => {
                const a = new Date(el.getAttribute('data-start-at')).getTime();
                const b = new Date(el.getAttribute('data-end-at')).getTime();
                return Number.isFinite(a) && Number.isFinite(b) && a <= nowMs && nowMs < b;
            })
            || cards.find((el) => {
                const a = new Date(el.getAttribute('data-start-at')).getTime();
                return Number.isFinite(a) && a > nowMs;
            })
            || cards[cards.length - 1];
    } else if (mode === 'checkout') {
        const cards = [...wrap.querySelectorAll('.phone-checkout-card[data-start-at][data-service-end-at]')];
        if (!cards.length) return;
        target =
            cards.find((el) => {
                const a = new Date(el.getAttribute('data-start-at')).getTime();
                const b = new Date(el.getAttribute('data-service-end-at')).getTime();
                return Number.isFinite(a) && Number.isFinite(b) && a <= nowMs && nowMs < b;
            })
            || cards.find((el) => {
                const a = new Date(el.getAttribute('data-start-at')).getTime();
                return Number.isFinite(a) && a > nowMs;
            })
            || cards[cards.length - 1];
    }
    if (target && typeof target.scrollIntoView === 'function') {
        try {
            target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        } catch (_) {
            target.scrollIntoView(true);
        }
    }
}

function momScrollPhoneCalendarListToCurrentTime(mode) {
    const viewport = document.getElementById('calendarScrollViewport');
    const wrap = document.getElementById('phoneCalendarListWrap');
    if (!viewport || !wrap || wrap.hidden) return;
    momScrollPhoneCalendarListCore(wrap, viewport, mode);
}

function momScrollDesktopPhoneListMirrorToCurrentTime(mode) {
    const wrap = document.getElementById('desktopPhoneListMirrorWrap');
    const scroll = document.getElementById('desktopPhoneListMirrorScroll');
    if (!wrap || !scroll) return;
    momScrollPhoneCalendarListCore(wrap, scroll, mode);
}

function momSyncPhoneCalendarListAfterRender(data) {
    const bar = document.getElementById('phoneCalendarViewBar');
    const wrap = document.getElementById('phoneCalendarListWrap');
    const region = document.getElementById('calendarGridScrollRegion');
    const viewport = document.getElementById('calendarScrollViewport');
    const listBtn = document.getElementById('phoneCalendarListBtn');
    const checkoutBtn = document.getElementById('phoneCalendarCheckoutBtn');
    const gridBtn = document.getElementById('phoneCalendarGridBtn');
    if (!bar || !wrap || !region) return;
    if (!momIsPhoneCalendarBreakpoint()) {
        bar.hidden = true;
        wrap.hidden = true;
        wrap.innerHTML = '';
        region.style.display = '';
        if (viewport) viewport.classList.remove('mom-phone-cal-toolbar-slim');
        if (listBtn) listBtn.classList.remove('phone-calendar-view-seg--active');
        if (checkoutBtn) checkoutBtn.classList.remove('phone-calendar-view-seg--active');
        if (gridBtn) gridBtn.classList.remove('phone-calendar-view-seg--active');
        const dateWide = document.getElementById('dateInput')?.value;
        if (dateWide) void updateUndoRoomButton(dateWide);
        syncAppointmentInProgressClasses();
        if (momDesktopPhoneListFloatingIsShown()) momRefreshDesktopPhoneListMirror(data);
        return;
    }
    bar.hidden = false;
    const mode = momPhoneCalendarLayoutMode();
    if (listBtn) listBtn.classList.toggle('phone-calendar-view-seg--active', mode === 'list');
    if (checkoutBtn) checkoutBtn.classList.toggle('phone-calendar-view-seg--active', mode === 'checkout');
    if (gridBtn) gridBtn.classList.toggle('phone-calendar-view-seg--active', mode === 'grid');
    if (mode === 'grid') {
        wrap.hidden = true;
        wrap.innerHTML = '';
        region.style.display = '';
        if (viewport) viewport.classList.remove('mom-phone-cal-toolbar-slim');
    } else {
        if (viewport) viewport.classList.add('mom-phone-cal-toolbar-slim');
        region.style.display = 'none';
        wrap.hidden = false;
        momMountPhoneCalendarListIntoElement(wrap, data, mode);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => momScrollPhoneCalendarListToCurrentTime(mode));
        });
    }
    const dateStr = document.getElementById('dateInput')?.value;
    if (dateStr) void updateUndoRoomButton(dateStr);
    syncAppointmentInProgressClasses();
    if (momDesktopPhoneListFloatingIsShown()) momRefreshDesktopPhoneListMirror(data);
}

function initPhoneCalendarLayoutToggle() {
    const bar = document.getElementById('phoneCalendarViewBar');
    if (!bar || bar.dataset.phoneLayoutToggleBound === '1') return;
    bar.dataset.phoneLayoutToggleBound = '1';
    document.getElementById('phoneCalendarListBtn')?.addEventListener('click', () => momSetPhoneCalendarLayout('list'));
    document.getElementById('phoneCalendarCheckoutBtn')?.addEventListener('click', () => momSetPhoneCalendarLayout('checkout'));
    document.getElementById('phoneCalendarGridBtn')?.addEventListener('click', () => momSetPhoneCalendarLayout('grid'));
    if (typeof window.matchMedia === 'function') {
        window.matchMedia('(max-width: 768px)').addEventListener('change', () => {
            if (currentData) renderCalendar(currentData);
        });
    }
}

function initCalendarZoom() {
    const outBtn = document.getElementById('calendarZoomOut');
    const inBtn = document.getElementById('calendarZoomIn');
    if (outBtn) {
        outBtn.addEventListener('click', () => {
            const z = getCalendarZoom();
            const opts = CALENDAR_ZOOM_OPTIONS;
            const i = opts.findIndex(o => o <= z + 0.01);
            const prev = i > 0 ? opts[i - 1] : opts[0];
            setCalendarZoom(prev);
        });
    }
    if (inBtn) {
        inBtn.addEventListener('click', () => {
            const z = getCalendarZoom();
            const opts = CALENDAR_ZOOM_OPTIONS;
            const i = opts.findIndex(o => o >= z - 0.01);
            const next = i >= 0 && i < opts.length - 1 ? opts[i + 1] : opts[opts.length - 1];
            setCalendarZoom(next);
        });
    }
    updateCalendarZoomUI();
}

function getCalendarScreenshotCalendarDate() {
    const v = document.getElementById('dateInput')?.value?.trim();
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

function formatCalendarScreenshotCaptureTime(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function momCloseCalendarScreenshotsModal() {
    const modal = document.getElementById('calendarScreenshotsModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', momCalendarScreenshotsModalOnDocKeyEscape);
}

function momCalendarScreenshotsModalOnDocKeyEscape(e) {
    if (e.key === 'Escape') momCloseCalendarScreenshotsModal();
}

async function momCaptureCalendarDayScreenshot() {
    const calDate = getCalendarScreenshotCalendarDate();
    const container = document.getElementById('calendarContainer');
    if (typeof window.html2canvas !== 'function') {
        showError(uiT('calendarScreenshot.errNoHtml2canvas', 'Screenshot library not loaded. Refresh the page and try again.'));
        return;
    }
    if (!container || container.style.display === 'none') {
        showError(uiT('calendarScreenshot.errNoCalendar', 'Load the calendar first (pick a date and load).'));
        return;
    }
    if (!calDate) {
        showError(uiT('calendarScreenshot.errNoDate', 'Pick a date in the date picker first.'));
        return;
    }
    const btn = document.getElementById('calendarScreenshotBtn');
    if (btn) btn.disabled = true;
    hideError();
    try {
        const canvas = await window.html2canvas(container, {
            scale: 1.25,
            useCORS: true,
            logging: false,
            onclone: (clonedDoc) => {
                const c = clonedDoc.getElementById('calendarContainer');
                if (c) {
                    c.style.overflow = 'visible';
                    c.style.maxHeight = 'none';
                }
                const vp = clonedDoc.getElementById('calendarScrollViewport');
                if (vp) {
                    vp.style.overflow = 'visible';
                    vp.style.maxHeight = 'none';
                }
                const gs = clonedDoc.getElementById('calendarGridScrollRegion');
                if (gs) {
                    gs.style.overflow = 'visible';
                    gs.style.maxHeight = 'none';
                }
            },
        });
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
        });
        const fd = new FormData();
        fd.append('calendar_date', calDate);
        fd.append('captured_at_iso', new Date().toISOString());
        fd.append('file', blob, 'calendar-day.png');
        const res = await fetch('/api/calendar-screenshots', { method: 'POST', body: fd });
        await parseFetchResponseAsJson(res);
        const dayLabel = formatLocalDateLoadingLabel(calDate);
        showNotice(uiTParams('calendarScreenshot.saved', { date: dayLabel }, `Saved calendar screenshot for ${dayLabel}.`));
    } catch (err) {
        console.error(err);
        const extra = err && err.message ? ` ${err.message}` : '';
        showError(uiT('calendarScreenshot.errUpload', 'Could not save screenshot.') + extra);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function momRefreshCalendarScreenshotsList() {
    const listEl = document.getElementById('calendarScreenshotsList');
    const loadingEl = document.getElementById('calendarScreenshotsLoading');
    const emptyEl = document.getElementById('calendarScreenshotsEmpty');
    if (!listEl) return;
    if (loadingEl) {
        loadingEl.hidden = false;
        loadingEl.style.display = 'block';
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = '';
    try {
        const res = await fetch('/api/calendar-screenshots?limit=300');
        const rows = await parseFetchResponseAsJson(res);
        if (!Array.isArray(rows)) throw new Error('Unexpected response');
        if (loadingEl) {
            loadingEl.hidden = true;
            loadingEl.style.display = 'none';
        }
        if (emptyEl) {
            const showEmpty = rows.length === 0;
            emptyEl.hidden = !showEmpty;
            emptyEl.style.display = showEmpty ? 'block' : 'none';
        }
        const openLabel = uiT('calendarScreenshot.openFull', 'Open full size');
        const delLabel = uiT('calendarScreenshot.delete', 'Delete');
        const delConfirm = uiT('calendarScreenshot.deleteConfirm', 'Delete this screenshot from the server?');
        for (const row of rows) {
            const id = row.id;
            const calDate = row.calendar_date || '';
            const dayLabel = formatLocalDateLoadingLabel(calDate) || calDate;
            const whenLabel = formatCalendarScreenshotCaptureTime(row.captured_at);
            const imgUrl = row.image_url || `/api/calendar-screenshots/${id}/image`;
            const wrap = document.createElement('div');
            wrap.className = 'calendar-screenshot-row';
            wrap.setAttribute('role', 'listitem');
            const calLine = uiTParams('calendarScreenshot.rowCalendarDay', { day: dayLabel }, `Calendar day shown: ${dayLabel}`);
            const capLine = uiTParams('calendarScreenshot.rowCapturedAt', { when: whenLabel }, `Screenshot taken: ${whenLabel}`);
            wrap.innerHTML = `
                <img class="calendar-screenshot-thumb" src="${escapeHtml(imgUrl)}" alt="" loading="lazy" />
                <div class="calendar-screenshot-meta">
                    <strong>${escapeHtml(calLine)}</strong>
                    <span>${escapeHtml(capLine)}</span>
                </div>
                <div class="calendar-screenshot-actions">
                    <button type="button" class="calendar-screenshot-open" data-id="${id}">${escapeHtml(openLabel)}</button>
                    <button type="button" class="calendar-screenshot-delete" data-id="${id}">${escapeHtml(delLabel)}</button>
                </div>
            `;
            const thumb = wrap.querySelector('.calendar-screenshot-thumb');
            if (thumb) {
                thumb.addEventListener('click', () => {
                    window.open(imgUrl, '_blank', 'noopener,noreferrer');
                });
            }
            const openBtn = wrap.querySelector('.calendar-screenshot-open');
            if (openBtn) {
                openBtn.addEventListener('click', () => {
                    window.open(imgUrl, '_blank', 'noopener,noreferrer');
                });
            }
            const delBtn = wrap.querySelector('.calendar-screenshot-delete');
            if (delBtn) {
                delBtn.addEventListener('click', async () => {
                    if (!window.confirm(delConfirm)) return;
                    delBtn.disabled = true;
                    try {
                        const dres = await fetch(`/api/calendar-screenshots/${id}`, { method: 'DELETE' });
                        await parseFetchResponseAsJson(dres);
                        await momRefreshCalendarScreenshotsList();
                    } catch (delErr) {
                        console.error(delErr);
                        const x = delErr && delErr.message ? ` ${delErr.message}` : '';
                        showError(uiT('calendarScreenshot.errDelete', 'Could not delete screenshot.') + x);
                        delBtn.disabled = false;
                    }
                });
            }
            listEl.appendChild(wrap);
        }
    } catch (err) {
        console.error(err);
        if (loadingEl) {
            loadingEl.hidden = true;
            loadingEl.style.display = 'none';
        }
        const extra = err && err.message ? ` ${err.message}` : '';
        showError(uiT('calendarScreenshot.errLoadList', 'Could not load screenshots.') + extra);
    }
}

function momOpenCalendarScreenshotsModal() {
    const modal = document.getElementById('calendarScreenshotsModal');
    if (!modal) return;
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.removeEventListener('keydown', momCalendarScreenshotsModalOnDocKeyEscape);
    document.addEventListener('keydown', momCalendarScreenshotsModalOnDocKeyEscape);
    void momRefreshCalendarScreenshotsList();
}

function initCalendarScreenshots() {
    const backdrop = document.getElementById('calendarScreenshotsBackdrop');
    const closeBtn = document.getElementById('calendarScreenshotsCloseBtn');
    const capBtn = document.getElementById('calendarScreenshotBtn');
    const galBtn = document.getElementById('calendarScreenshotsGalleryBtn');
    if (backdrop) backdrop.addEventListener('click', momCloseCalendarScreenshotsModal);
    if (closeBtn) closeBtn.addEventListener('click', momCloseCalendarScreenshotsModal);
    if (galBtn) galBtn.addEventListener('click', momOpenCalendarScreenshotsModal);
    if (capBtn) capBtn.addEventListener('click', () => { void momCaptureCalendarDayScreenshot(); });
}

const VOICE_TEST_KEY = 'voice_test_events_v1';

// Stable colors per masseuse (by index in therapist list so same order = same color every day)
const MASSEUSE_PALETTE = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4',
    '#f032e6', '#bfef45', '#469990', '#dcbeff', '#9a6324', '#800000', '#aaffc3',
    '#808000', '#ffd8b1', '#000075', '#a9a9a9'
];
function getMasseuseColor(therapistName, therapistList) {
    if (!therapistList || !therapistName) return '#6c757d';
    const idx = therapistList.indexOf(therapistName);
    return MASSEUSE_PALETTE[idx % MASSEUSE_PALETTE.length];
}
function getMasseuseInitials(therapistName) {
    if (!therapistName) return '—';
    const first = therapistName.trim().split(/\s+/)[0] || '';
    return first.length >= 3 ? first.slice(0, 3) : (first.slice(0, 2) || first);
}

/** Masseuse / staff name is David Golden (therapist column match). */
function isDavidGoldenScheduleColumn(therapistName) {
    if (!therapistName || typeof therapistName !== 'string') return false;
    const n = therapistName.trim().toLowerCase();
    return n.includes('david') && n.includes('golden');
}

/**
 * Client/guest is David Golden. Calendar often shows "David G."; Square may have full name.
 */
function customerLooksLikeDavidGolden(customerName) {
    if (!customerName || typeof customerName !== 'string') return false;
    const n = customerName.trim().toLowerCase();
    if (n.includes('david') && n.includes('golden')) return true;
    /* Shortened display name for David Golden */
    if (/^david\s+g\.?$/.test(n)) return true;
    return false;
}

/** Gold spotlight: client is David Golden, OR any therapist slot is staff named David Golden. */
function appointmentInvolvesDavidGolden(appointment) {
    if (!appointment) return false;
    if (customerLooksLikeDavidGolden(appointment.customer)) return true;
    const parts = [
        appointment.therapist,
        appointment.therapist_2,
        appointment.facial_specialist,
        appointment.luxury_mini_facial_therapist,
        appointment.luxury_mini_facial_therapist_2,
    ];
    return parts.some((p) => isDavidGoldenScheduleColumn(p));
}

function shouldShowDavidGoldenFun(byRoom, columnTherapist, appointment) {
    if (appointmentInvolvesDavidGolden(appointment)) return true;
    /* Therapist column is David even if API name on event differs slightly */
    if (!byRoom && columnTherapist && isDavidGoldenScheduleColumn(columnTherapist)) return true;
    return false;
}

/** Inline SVG data-URIs (gold-themed, no external fetch) + emoji — random each render. */
function _davidGoldenSvgDataUris() {
    const enc = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/\s+/g, ' ').trim());
    return [
        enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="0.5" stop-color="#ffd700"/><stop offset="1" stop-color="#daa520"/></linearGradient></defs><rect x="6" y="22" width="14" height="28" rx="2" fill="url(#g)" stroke="#b8860b" stroke-width="1.5"/><rect x="24" y="16" width="14" height="34" rx="2" fill="url(#g)" stroke="#b8860b" stroke-width="1.5"/><rect x="42" y="26" width="14" height="24" rx="2" fill="url(#g)" stroke="#b8860b" stroke-width="1.5"/></svg>`),
        enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8dc"/><stop offset="0.4" stop-color="#ffd700"/><stop offset="1" stop-color="#b8860b"/></linearGradient></defs><path fill="url(#c)" stroke="#8b6914" stroke-width="1.5" d="M32 8 L44 22 L56 18 L50 34 L58 46 L44 44 L32 56 L20 44 L6 46 L14 34 L8 18 L20 22 Z"/></svg>`),
        enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><ellipse cx="32" cy="36" rx="22" ry="10" fill="none" stroke="#daa520" stroke-width="5"/><ellipse cx="32" cy="32" rx="10" ry="8" fill="#ffd700" stroke="#b8860b" stroke-width="2"/><circle cx="32" cy="28" r="6" fill="#fff8dc" stroke="#daa520" stroke-width="1.5"/></svg>`),
        enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="#ffd700" stroke="#b8860b" stroke-width="2"/><text x="32" y="40" text-anchor="middle" font-size="22" fill="#8b6914" font-family="Georgia,serif">$</text></svg>`),
        enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#ffd700" stroke="#b8860b" stroke-width="1.5" d="M12 40 Q32 8 52 40 Q32 52 12 40"/><path fill="#fff8dc" opacity="0.5" d="M18 38 Q32 18 46 38"/></svg>`),
        enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="r" cx="40%" cy="35%"><stop offset="0" stop-color="#fffacd"/><stop offset="0.6" stop-color="#ffd700"/><stop offset="1" stop-color="#b8860b"/></radialGradient></defs><circle cx="32" cy="32" r="18" fill="url(#r)" stroke="#8b6914" stroke-width="2"/><path fill="none" stroke="#fff" stroke-width="2" opacity="0.6" d="M22 28 Q32 22 42 28"/></svg>`),
    ];
}

/**
 * Random gold fun: inline SVG “photos” + emoji (crown, coin, ring, teeth, butter, etc.).
 * Picks one item per call so blocks can differ each calendar refresh.
 */
function buildDavidGoldenFunHtml() {
    const svgs = _davidGoldenSvgDataUris();
    const pool = [
        ...svgs.map((src) => ({ k: 'img', src })),
        { k: 'emoji', e: '🪙' },
        { k: 'emoji', e: '👑' },
        { k: 'emoji', e: '💍' },
        { k: 'emoji', e: '🏆' },
        { k: 'emoji', e: '✨' },
        { k: 'emoji', e: '🥇' },
        { k: 'emoji', e: '🌟' },
        { k: 'emoji', e: '🦷' },
        { k: 'emoji', e: '💛' },
        { k: 'emoji', e: '🧈' },
        { k: 'emoji', e: '💇' },
    ];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const inner = pick.k === 'img'
        ? `<div class="david-golden-fun-wrap david-golden-fun-wrap--img"><img class="david-golden-fun-img" src="${escapeHtml(pick.src)}" alt="" /></div>`
        : `<div class="david-golden-fun-wrap david-golden-fun-wrap--emoji"><span class="david-golden-fun-emoji-inner">${pick.e}</span></div>`;
    return `<div class="david-golden-fun-panel" aria-hidden="true">${inner}</div>`;
}

const START_HOUR = 9;  // Start from 9am
const END_HOUR = 23;   // End at 11pm (23:00)

/** Regular business hours (local) — full-width bold row on calendar at slot start. */
const CALENDAR_OFFICIAL_OPEN_HOUR = 10;
const CALENDAR_OFFICIAL_OPEN_MINUTE = 0;
const CALENDAR_OFFICIAL_CLOSE_HOUR = 21; // 9pm
const CALENDAR_OFFICIAL_CLOSE_MINUTE = 0;

/** Extra CSS class on each cell in the row that begins at official open or close time. */
function calendarOfficialHoursBoundaryClass(timeSlot) {
    if (!timeSlot || !(timeSlot instanceof Date) || Number.isNaN(timeSlot.getTime())) return '';
    const h = timeSlot.getHours();
    const m = timeSlot.getMinutes();
    if (h === CALENDAR_OFFICIAL_OPEN_HOUR && m === CALENDAR_OFFICIAL_OPEN_MINUTE) return ' calendar-official-hours-open';
    if (h === CALENDAR_OFFICIAL_CLOSE_HOUR && m === CALENDAR_OFFICIAL_CLOSE_MINUTE) return ' calendar-official-hours-close';
    return '';
}

/** Return today's date as YYYY-MM-DD in local time (not UTC). */
function getTodayLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function addDaysToDate(dateStr, delta) {
    if (!dateStr) return getTodayLocal();
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Set header date, refresh staffing pick UI for that day, and load Square + calendar. */
function momNavigateCalendarToDateString(nextIsoDate) {
    const dateInput = document.getElementById('dateInput');
    if (!dateInput || !nextIsoDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(nextIsoDate))) return;
    momSuppressAfterNineAutoAdvance = true;
    dateInput.value = nextIsoDate;
    const t = getTodayLocal();
    if (nextIsoDate === t) {
        try {
            sessionStorage.setItem(preferTodaySessionKey(), '1');
        } catch (e) { /* ignore */ }
    } else {
        try {
            sessionStorage.removeItem(`momPreferToday_${t}`);
        } catch (e) { /* ignore */ }
    }
    updateDateDayOfWeek();
    updateCurrentTimeLine();
    applyMassageStaffSelectForCurrentDate();
    applyFacialSpecialistsSelectForCurrentDate();
    loadDay();
}

function momCalendarIsoToLocalDate(y, m, d) {
    return new Date(y, m - 1, d);
}

function momCalendarLongDateLabelFromIso(iso) {
    const parts = String(iso || '').split('-').map(Number);
    if (parts.length !== 3) return String(iso || '');
    const [y, m, d] = parts;
    const dateObj = momCalendarIsoToLocalDate(y, m, d);
    if (Number.isNaN(dateObj.getTime())) return String(iso || '');
    const mode = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.getMode) ? window.MOM_I18N.getMode() : 'en';
    const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    if (mode === 'zh') return dateObj.toLocaleDateString('zh-CN', opts);
    if (mode === 'both') {
        const en = dateObj.toLocaleDateString('en-US', opts);
        const zh = dateObj.toLocaleDateString('zh-CN', opts);
        return `${en} · ${zh}`;
    }
    return dateObj.toLocaleDateString('en-US', opts);
}

function momCalendarShortTabLabelFromIso(iso) {
    const parts = String(iso || '').split('-').map(Number);
    if (parts.length !== 3) return String(iso || '');
    const [y, m, d] = parts;
    const dateObj = momCalendarIsoToLocalDate(y, m, d);
    if (Number.isNaN(dateObj.getTime())) return String(iso || '');
    const mode = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.getMode) ? window.MOM_I18N.getMode() : 'en';
    if (mode === 'zh') return dateObj.toLocaleDateString('zh-CN', { weekday: 'short', month: 'numeric', day: 'numeric' });
    if (mode === 'both') {
        return dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    return dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function momUpdateCalendarFullscreenDateLabel() {
    const el = document.getElementById('calendarFullscreenDateLabel');
    const inp = document.getElementById('dateInput');
    if (!el || !inp) return;
    const v = inp.value;
    el.textContent = v ? momCalendarLongDateLabelFromIso(v) : '';
}

function momRefreshDateQuickPickUi() {
    const inp = document.getElementById('dateInput');
    const tabs = document.querySelectorAll('.date-quick-tab[data-day-offset]');
    if (!inp) return;
    const selected = inp.value;
    const today = getTodayLocal();
    const todayLabel = uiT('date.jumpToday', 'Today');
    tabs.forEach((tab) => {
        const off = parseInt(tab.getAttribute('data-day-offset'), 10);
        if (Number.isNaN(off)) return;
        const ds = addDaysToDate(today, off);
        if (off === 0) {
            tab.textContent = todayLabel;
            tab.title = uiT('date.quickTabTodayTitle', 'Go to today');
        } else {
            tab.textContent = momCalendarShortTabLabelFromIso(ds);
            tab.title = momCalendarLongDateLabelFromIso(ds);
        }
        tab.setAttribute('aria-selected', selected === ds ? 'true' : 'false');
        tab.classList.toggle('date-quick-tab--active', selected === ds);
    });
    momUpdateCalendarFullscreenDateLabel();
}

function momCalendarStickyToolbarSync() {
    const zb = document.getElementById('calendarZoomBar');
    const vp = document.getElementById('calendarScrollViewport');
    if (!zb || !vp) return;
    const h = zb.offsetHeight || 38;
    vp.style.setProperty('--calendar-sticky-toolbar-h', `${h}px`);
}

function initCalendarStickyToolbarResize() {
    const zb = document.getElementById('calendarZoomBar');
    const vp = document.getElementById('calendarScrollViewport');
    if (!zb || !vp || zb.dataset.momStickyBound === '1') return;
    zb.dataset.momStickyBound = '1';
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => momCalendarStickyToolbarSync());
        ro.observe(zb);
    }
    window.addEventListener('resize', () => momCalendarStickyToolbarSync());
    document.addEventListener('fullscreenchange', () => {
        momCalendarStickyToolbarSync();
        momSyncCalendarFullscreenChrome();
        setTimeout(updateCurrentTimeLine, 0);
    });
    document.addEventListener('webkitfullscreenchange', () => {
        momCalendarStickyToolbarSync();
        momSyncCalendarFullscreenChrome();
        setTimeout(updateCurrentTimeLine, 0);
    });
    momCalendarStickyToolbarSync();
}

function momGetCalendarFullscreenElement() {
    return document.getElementById('calendarContainer');
}

function momIsCalendarElementFullscreen() {
    const el = momGetCalendarFullscreenElement();
    if (!el) return false;
    return document.fullscreenElement === el || document.webkitFullscreenElement === el;
}

/** Scroll container that holds the time grid (for current-time line + scrollTop). */
function momCalendarTimeLineScrollParent() {
    return document.getElementById('calendarScrollViewport') || document.getElementById('calendarContainer');
}

function momSyncCalendarFullscreenChrome() {
    const bar = document.getElementById('calendarFullscreenBar');
    const on = momIsCalendarElementFullscreen();
    if (bar) {
        bar.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    momUpdateCalendarFullscreenDateLabel();
}

async function momEnterCalendarFullscreen() {
    const el = momGetCalendarFullscreenElement();
    if (!el || el.style.display === 'none') {
        showError(uiT('calendar.fullscreenNeedCalendar', 'Load the calendar first.'));
        return;
    }
    try {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else {
            showError(uiT('calendar.fullscreenUnsupported', 'Full screen is not supported in this browser.'));
        }
    } catch (err) {
        console.error(err);
        showError(uiT('calendar.fullscreenError', 'Could not enter full screen.'));
    }
}

function momExitCalendarFullscreen() {
    if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen();
    else if (document.webkitFullscreenElement && document.webkitExitFullscreen) void document.webkitExitFullscreen();
}

function momCalendarFullscreenOnDocKeydown(e) {
    if (e.key !== 'Escape') return;
    if (!momIsCalendarElementFullscreen()) return;
    e.preventDefault();
    momExitCalendarFullscreen();
}

function initCalendarFullscreenControls() {
    const enterBtn = document.getElementById('calendarEnterFullscreenBtn');
    const exitBtn = document.getElementById('calendarExitFullscreenBtn');
    const el = momGetCalendarFullscreenElement();
    if (!el || el.dataset.momFsBound === '1') return;
    el.dataset.momFsBound = '1';
    if (enterBtn) {
        enterBtn.addEventListener('click', () => { void momEnterCalendarFullscreen(); });
    }
    if (exitBtn) {
        exitBtn.addEventListener('click', () => momExitCalendarFullscreen());
    }
    document.addEventListener('keydown', momCalendarFullscreenOnDocKeydown);
}

function initDateQuickPickCluster() {
    const tabs = document.querySelectorAll('.date-quick-tab[data-day-offset]');
    const openPicker = document.getElementById('dateOpenPickerBtn');
    const dateInput = document.getElementById('dateInput');
    if (!dateInput || dateInput.dataset.momQuickPickBound === '1') return;
    dateInput.dataset.momQuickPickBound = '1';
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const off = parseInt(tab.getAttribute('data-day-offset'), 10);
            if (Number.isNaN(off)) return;
            momNavigateCalendarToDateString(addDaysToDate(getTodayLocal(), off));
        });
    });
    if (openPicker) {
        openPicker.addEventListener('click', () => {
            if (typeof dateInput.showPicker === 'function') {
                try {
                    dateInput.showPicker();
                    return;
                } catch (e) { /* fall through */ }
            }
            dateInput.focus();
            dateInput.click();
        });
    }
}

/** Local wall clock is 9pm or later (21:00+). */
function isLocalTimeAtOrAfterNinePM() {
    const h = new Date().getHours();
    return h >= 21;
}

/**
 * True when every event on the loaded day has ended (square_end_at/end_at <= now), or there are no events.
 */
function allDayAppointmentsFinished(events) {
    const list = events || [];
    if (list.length === 0) return true;
    const now = Date.now();
    for (const ev of list) {
        const endStr = ev.square_end_at || ev.end_at;
        if (!endStr) return false;
        const t = new Date(endStr).getTime();
        if (Number.isNaN(t) || t > now) return false;
    }
    return true;
}

function preferTodaySessionKey() {
    return `momPreferToday_${getTodayLocal()}`;
}

function formatDateHoverSummaryHtml(customerCount, totalStr) {
    const nStr = String(customerCount);
    const tEsc = escapeHtml(totalStr);
    const mode = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.getMode) ? window.MOM_I18N.getMode() : 'en';
    if (mode === 'zh') {
        return `客人数：<strong>${nStr}</strong> · 总时长：<strong>${tEsc}</strong>`;
    }
    if (mode === 'both') {
        const en = `Customers: <strong>${nStr}</strong> · Total: <strong>${tEsc}</strong>`;
        const zh = `客人数：<strong>${nStr}</strong> · 总时长：<strong>${tEsc}</strong>`;
        return `${en}<span class="date-hover-summary-both-gap">\u00A0</span>${zh}`;
    }
    return `Customers: <strong>${nStr}</strong> · Total: <strong>${tEsc}</strong>`;
}

function initDateHoverSummaryTooltip() {
    const box = document.querySelector('.header-date-inline .date-input-box');
    if (!box || box.dataset.dateHoverBound === '1') return;
    box.dataset.dateHoverBound = '1';
    let tooltipEl = null;
    box.addEventListener('mouseenter', () => {
        if (!momDateHoverSummaryHtml) return;
        if (tooltipEl && tooltipEl.parentNode) tooltipEl.remove();
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'date-hover-summary-tooltip';
        tooltipEl.innerHTML = momDateHoverSummaryHtml;
        tooltipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipEl);
        const rect = box.getBoundingClientRect();
        const pad = 10;
        let left = rect.right + pad;
        let top = rect.top;
        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${top}px`;
        const tr = tooltipEl.getBoundingClientRect();
        top = rect.top + (rect.height - tr.height) / 2;
        if (left + tr.width > window.innerWidth - pad) {
            left = Math.max(pad, rect.left - tr.width - pad);
        }
        if (top < pad) top = pad;
        if (top + tr.height > window.innerHeight - pad) {
            top = Math.max(pad, window.innerHeight - tr.height - pad);
        }
        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${top}px`;
    });
    box.addEventListener('mouseleave', () => {
        if (tooltipEl && tooltipEl.parentNode) tooltipEl.remove();
        tooltipEl = null;
    });
}

function updateDateDayOfWeek() {
    const dateInput = document.getElementById('dateInput');
    if (!dateInput) return;
    updateHistorySquareResyncControl();
    momRefreshDateQuickPickUi();
}

/** Shown only for “history” days (before local yesterday): deliberate Square re-sync, not the main Refresh button. */
function updateHistorySquareResyncControl() {
    const wrap = document.getElementById('historySquareResyncWrap');
    const btn = document.getElementById('historySquareResyncBtn');
    const dateInput = document.getElementById('dateInput');
    if (!wrap || !btn || !dateInput) return;
    const v = dateInput.value;
    if (v && isCalendarHistoryDay(v)) {
        wrap.hidden = false;
        btn.textContent = uiT('history.resyncFromSquare', 'Re-fetch this day from Square…');
        btn.title = uiT(
            'history.resyncTitle',
            'Slow: reloads bookings from Square and replaces the saved copy for this date. Use only for rare corrections.'
        );
    } else {
        wrap.hidden = true;
    }
}

function historySquareResyncFromSquare() {
    const inp = document.getElementById('dateInput');
    const v = inp && inp.value;
    if (!v || !isCalendarHistoryDay(v)) return;
    if (
        !confirm(
            uiT(
                'history.resyncConfirm',
                'Reload this entire day from Square? This can take a moment and will replace the saved offline copy for this date.'
            )
        )
    ) {
        return;
    }
    loadDay({ force: true, useCache: false });
}

function updateHeaderDateHoverSummary(data) {
    const dateInput = document.getElementById('dateInput');
    if (!dateInput) return;
    const dateBox = dateInput.closest('.date-input-box');
    const events = data && Array.isArray(data.events) ? data.events : [];

    const seen = new Set();
    for (const ev of events) {
        const cid = (ev && ev.customer_id != null) ? String(ev.customer_id).trim() : '';
        const cname = (ev && ev.customer != null) ? String(ev.customer).trim() : '';
        const key = (cid || cname) ? (cid || cname).toLowerCase() : '';
        if (key) seen.add(key);
    }
    const customerCount = seen.size;

    let totalMin = 0;
    for (const ev of events) totalMin += (getDurationMinutes(ev) || 0);
    const totalStr = formatDurationMinutes(totalMin);

    momDateHoverSummaryHtml = formatDateHoverSummaryHtml(customerCount, totalStr);
    [dateInput, dateBox].forEach((el) => {
        if (el) {
            el.removeAttribute('title');
        }
    });
}

/** Same rule as app.room_assigner: ignore sub-2s “crumbs” so back-to-back hour blocks are not treated as overlapping. */
const CALENDAR_COLUMN_OVERLAP_MIN_MS = 2000;

/**
 * End instant for overlap side-by-side layout only. If addon-neutral wall clock collapses to ~zero
 * length, fall back to raw end_at so two simultaneous bookings still get an overlap edge (otherwise
 * both use 100% width and stack invisibly).
 */
function calendarColumnEventOverlapLayoutEndMs(apt) {
    const start = apt && apt.start_at ? new Date(apt.start_at).getTime() : NaN;
    const wall = apt ? calendarColumnEventWallEndMs(apt) : NaN;
    let end = Number.isFinite(wall) ? wall : NaN;
    if (!Number.isFinite(start)) return end;
    if (!Number.isFinite(end) || end <= start + CALENDAR_COLUMN_OVERLAP_MIN_MS) {
        const raw = apt.end_at ? new Date(apt.end_at).getTime() : NaN;
        if (Number.isFinite(raw) && raw > start + CALENDAR_COLUMN_OVERLAP_MIN_MS) return raw;
        return start + 60 * 1000;
    }
    return end;
}

function calendarColumnIntervalsOverlapWallMs(a0, a1, b0, b1) {
    if (a1 <= a0 || b1 <= b0) return false;
    return (Math.min(a1, b1) - Math.max(a0, b0)) > CALENDAR_COLUMN_OVERLAP_MIN_MS;
}

/** Notes: couples#2 / couple#3 = 2nd/3rd couple appointment same guest & start (forces side-by-side calendar layout). */
const MOM_COUPLES_SLOT_NOTE_RE = /\bcouples?\s*#\s*(\d+)\b/i;

function parseCouplesSlotNoteFromAppointment(apt) {
    if (!apt) return null;
    const fromApi = apt.couples_slot_note;
    if (fromApi != null && fromApi !== '') {
        const n = parseInt(String(fromApi), 10);
        if (Number.isFinite(n) && n >= 1) return n;
    }
    const blob = [apt.customer_note, apt.seller_note, apt.addon_note].filter(Boolean).join(' ');
    const m = blob.match(MOM_COUPLES_SLOT_NOTE_RE);
    if (!m) return null;
    const n2 = parseInt(m[1], 10);
    return Number.isFinite(n2) && n2 >= 1 ? n2 : null;
}

function calendarSameCustomerKeyForCouplesSlots(a, b) {
    if (!a || !b) return false;
    const ida = String(a.customer_id || '').trim();
    const idb = String(b.customer_id || '').trim();
    if (ida && idb && ida === idb) return true;
    const na = String(a.customer || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const nb = String(b.customer || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return na.length > 0 && na === nb;
}

/** Same guest + same start + couple + notes couples#N → always share overlap column (split cards). */
function calendarCouplesNotesForceOverlapEdge(a, b) {
    if (String(a.type || '').toLowerCase() !== 'couple' || String(b.type || '').toLowerCase() !== 'couple') return false;
    const sa = a.start_at ? new Date(a.start_at).getTime() : NaN;
    const sb = b.start_at ? new Date(b.start_at).getTime() : NaN;
    if (!Number.isFinite(sa) || sa !== sb) return false;
    if (!calendarSameCustomerKeyForCouplesSlots(a, b)) return false;
    const na = parseCouplesSlotNoteFromAppointment(a);
    const nb = parseCouplesSlotNoteFromAppointment(b);
    if (na != null && na >= 2) return true;
    if (nb != null && nb >= 2) return true;
    if (na != null && nb != null && na !== nb) return true;
    return false;
}

/** Unique per calendar row (couple massage + facial slices share booking_id but differ in start/end). */
function calendarAppointmentOverlapLayoutKey(apt) {
    if (!apt || !apt.booking_id) return '';
    const s = apt.start_at ? new Date(apt.start_at).getTime() : 0;
    const e = calendarColumnEventWallEndMs(apt);
    return `${apt.booking_id}|${s}|${e}`;
}

/**
 * Calculate positions for overlapping appointments to display them side by side.
 * Returns a map keyed by calendarAppointmentOverlapLayoutKey(apt) -> { left, width } (and booking_id -> full width fallback).
 */
function calculateOverlapPositions(appointments) {
    if (appointments.length === 0) {
        return {};
    }

    const positions = {};

    const ranges = appointments.map((apt) => ({
        key: calendarAppointmentOverlapLayoutKey(apt),
        booking_id: apt.booking_id,
        start: new Date(apt.start_at).getTime(),
        end: calendarColumnEventOverlapLayoutEndMs(apt),
        appointment: apt,
    }));

    ranges.sort((a, b) => (a.start !== b.start ? a.start - b.start : a.key.localeCompare(b.key)));

    const overlapGraph = {};
    ranges.forEach((r) => {
        overlapGraph[r.key] = [];
    });
    ranges.forEach((apt, i) => {
        ranges.forEach((other, j) => {
            if (i === j) return;
            if (apt.booking_id === other.booking_id) return;
            const wallOverlap = calendarColumnIntervalsOverlapWallMs(apt.start, apt.end, other.start, other.end);
            const forcedCouplesSlot =
                !wallOverlap && calendarCouplesNotesForceOverlapEdge(apt.appointment, other.appointment);
            if (!wallOverlap && !forcedCouplesSlot) return;
            const edges = overlapGraph[apt.key];
            if (!edges.includes(other.key)) edges.push(other.key);
        });
    });

    const visited = new Set();
    const groups = [];

    ranges.forEach((apt) => {
        if (visited.has(apt.key)) return;

        const group = [];
        const queue = [apt.key];
        visited.add(apt.key);

        while (queue.length > 0) {
            const currentKey = queue.shift();
            const currentApt = ranges.find((a) => a.key === currentKey);
            if (currentApt) {
                group.push(currentApt);
            }
            (overlapGraph[currentKey] || []).forEach((neighborKey) => {
                if (!visited.has(neighborKey)) {
                    visited.add(neighborKey);
                    queue.push(neighborKey);
                }
            });
        }

        if (group.length > 0) {
            groups.push(group);
        }
    });

    groups.forEach((group) => {
        if (group.length === 1) {
            positions[group[0].key] = { left: 0, width: 100 };
            positions[group[0].booking_id] = { left: 0, width: 100 };
        } else {
            const widthPercent = 100 / group.length;
            group.sort((a, b) => (a.start !== b.start ? a.start - b.start : a.key.localeCompare(b.key)));
            group.forEach((node, index) => {
                positions[node.key] = { left: index * widthPercent, width: widthPercent };
            });
        }
    });

    return positions;
}

function getVoiceTestEventsForDate(date) {
    try {
        const raw = localStorage.getItem(VOICE_TEST_KEY);
        if (!raw) return [];
        const all = JSON.parse(raw);
        if (!Array.isArray(all)) return [];
        return all
            .filter(ev => ev && ev.date === date)
            .map(ev => ({
                booking_id: ev.id,
                therapist: ev.therapist || '(voice test)',
                start_at: ev.start_at,
                end_at: ev.end_at,
                customer: ev.customer || ev.service || 'Voice booking test',
                service: ev.service || 'Voice test appointment',
                type: 'single',
                room: 'UNASSIGNED',
                reason: 'Voice test appointment',
                room_locked: false,
                therapist_locked: false,
                tip_amount: null,
                appointment_locked: false,
                is_past: false,
                is_voice_test: true,
            }));
    } catch (e) {
        console.error('Error reading voice test events', e);
        return [];
    }
}

/** Day list: front-desk PIN — unlocks past appointments when opening detail (same as “Unlock to edit”). */
const MOM_DAYLIST_EDIT_PIN = '123';
const MOM_DAYLIST_EDIT_PIN_TS_KEY = 'mom_daylist_edit_pin_ok_at';
const MOM_DAYLIST_EDIT_PIN_TTL_MS = 8 * 60 * 60 * 1000;

function momDayListEditPinActive() {
    try {
        const raw = sessionStorage.getItem(MOM_DAYLIST_EDIT_PIN_TS_KEY);
        if (!raw) return false;
        const t = parseInt(raw, 10);
        if (Number.isNaN(t) || t <= 0) return false;
        return Date.now() - t < MOM_DAYLIST_EDIT_PIN_TTL_MS;
    } catch (e) {
        return false;
    }
}

function momDayListEditPinRecord() {
    try {
        sessionStorage.setItem(MOM_DAYLIST_EDIT_PIN_TS_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
}

/** True after opening appointment detail from the day list — closing detail reopens the day list. */
let momReturnToDayListAfterDetailClose = false;

function dayListModalOnDocKeyEscape(e) {
    if (e.key === 'Escape') momCloseTodayAppointmentsModal();
}

function momCloseTodayAppointmentsModal() {
    const modal = document.getElementById('todayAppointmentsModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', dayListModalOnDocKeyEscape);
}

/**
 * @param {{ preservePinMessage?: boolean }} [opts] — when returning from detail, keep PIN status text.
 */
function momOpenTodayAppointmentsModal(opts) {
    const modal = document.getElementById('todayAppointmentsModal');
    if (!modal) return;
    const preservePin = !!(opts && opts.preservePinMessage);
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
    const pinStatus = document.getElementById('todayAppointmentsPinStatus');
    if (pinStatus && !preservePin) {
        pinStatus.textContent = '';
        pinStatus.classList.remove('today-appointments-pin-status--ok');
    }
    refreshTodayAppointmentsModalTable();
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.removeEventListener('keydown', dayListModalOnDocKeyEscape);
    document.addEventListener('keydown', dayListModalOnDocKeyEscape);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollTodayAppointmentsModalToCurrentTime());
    });
}

/** Display end time for list/export: same rules as calendar (add-on-neutral), except split couple blocks use raw slice end. */
function todayAppointmentsDisplayEndAt(apt) {
    if (!apt) return '';
    if (apt._roomViewSlice) return apt.end_at;
    return displayEndAtForCustomerRequestEvent(apt);
}

function todayAppointmentsServiceCalendarLine(appointment) {
    if (!appointment) return '';
    const rawService = appointment.service;
    const serviceStr = (rawService != null && typeof rawService === 'string') ? rawService : (rawService != null ? String(rawService) : '');
    const displayService = appointment.display_service || '';
    const isCouple = appointment.type === 'couple';
    const sliceServicePrefix = appointment._roomViewSlice === 'couple_massage'
        ? uiT('calendar.sliceCoupleMassage', 'Couples massage · ')
        : appointment._roomViewSlice === 'couple_facial'
            ? uiT('calendar.sliceFacialOne', 'Facial (1 client) · ')
            : '';
    const rawCatalogService = ((displayService && displayService.trim()) ? displayService.trim() : serviceStr);
    let serviceDisplayStr = calendarStripPainReliefOilFromServiceLine(sliceServicePrefix + uiCatalogLine(rawCatalogService));
    const startMs = new Date(appointment.start_at).getTime();
    const endMs = new Date(appointment.end_at).getTime();
    const durRound = (!Number.isFinite(startMs) || !Number.isFinite(endMs)) ? 0 : Math.max(0, Math.round((endMs - startMs) / 60000));
    if (isCouple && !appointment._roomViewSlice) {
        serviceDisplayStr = calendarReorderCoupleServiceHeadline(serviceDisplayStr, durRound);
    }
    return serviceDisplayStr;
}

function todayAppointmentsRequestedMasseusePlain(appointment, therapists) {
    if (!appointment) return '';
    const anyAvail = customerAnyAvailEffective(appointment);
    const dup = buildTherapistFirstNameDuplicates(therapists);
    const noteIdx = buildTherapistFirstNameIndexForNotes(therapists, [appointment]);
    const seenFull = [];
    function alreadyHave(fullName) {
        const raw = (fullName || '').trim();
        if (!raw) return true;
        for (const s of seenFull) {
            if (therapistNamesMatchForCalendar(raw, s, dup)) return true;
        }
        return false;
    }
    const parts = [];
    const bookedBy = appointment.booked_by;
    const oriFull = (appointment.original_therapist || '').trim();
    /* Same as calendar chips: no “any staff” label; omit Square request name when any-available / Staff slot. */
    if (bookedBy === 'customer' && !anyAvail && oriFull && oriFull !== '—' && !alreadyHave(oriFull)) {
        seenFull.push(oriFull);
        const fn = therapistFirstNameOnly(oriFull);
        parts.push(fn);
    }
    const sellerText = (appointment.seller_note || '').trim();
    const custAddonText = [appointment.customer_note, appointment.addon_note].filter(Boolean).join('\n');
    const fromSeller = matchTherapistFirstNamesInNoteText(sellerText, noteIdx);
    const fromCustAddon = matchTherapistFirstNamesInNoteText(custAddonText, noteIdx);
    for (const full of [...fromSeller, ...fromCustAddon]) {
        const fk = (full || '').trim();
        if (!fk || alreadyHave(fk)) continue;
        seenFull.push(fk);
        const fn = therapistFirstNameOnly(fk);
        parts.push(fn);
    }
    return parts.length ? parts.join(', ') : '';
}

function todayAppointmentsNotesPlain(appointment) {
    if (!appointment) return '';
    const bits = [];
    const s = (appointment.seller_note || '').trim();
    const c = (appointment.customer_note || '').trim();
    const a = (appointment.addon_note || '').trim();
    if (s) bits.push(`${uiT('todayAppts.noteSeller', 'Seller')}: ${s}`);
    if (c) bits.push(`${uiT('todayAppts.noteCustomer', 'Customer')}: ${c}`);
    if (a) bits.push(`${uiT('todayAppts.noteAddon', 'Add-on')}: ${a}`);
    return bits.join('\n\n');
}

function todayAppointmentsAssignedPlain(appointment, therapists) {
    if (!appointment) return '—';
    const allNames = [...(therapists || [])];
    const dup = buildTherapistFirstNameDuplicates(allNames);
    const t1 = (appointment.therapist || '').trim();
    const t2 = (appointment.therapist_2 || '').trim();
    const bits = [];
    if (t1) bits.push(therapistSelectOptionLabel(t1, dup) || t1);
    if (t2) bits.push(therapistSelectOptionLabel(t2, dup) || t2);
    return bits.length ? bits.join(' / ') : '—';
}

function collectTodayAppointmentsDisplayRows() {
    const dateStr = document.getElementById('dateInput') && document.getElementById('dateInput').value;
    const out = [];
    if (!dateStr || !currentData || String(currentData.date) !== String(dateStr) || !Array.isArray(currentData.events)) {
        return out;
    }
    const events = (currentData.events || []).filter(ev => ev && ev.room !== 'ADDON');
    for (const ev of events) {
        const cols = roomViewColumnsForEvent(ev);
        for (const { appointment, column } of cols) {
            const displayEnd = todayAppointmentsDisplayEndAt(appointment);
            const startMs = new Date(appointment.start_at).getTime();
            const endMs = new Date(displayEnd).getTime();
            const lengthMin = (!Number.isFinite(startMs) || !Number.isFinite(endMs))
                ? 0
                : Math.max(0, Math.round((endMs - startMs) / 60000));
            const roomDisp = formatRoomForPanel(appointment._displayRoomForCalendar || column || appointment.room);
            out.push({ appointment, column, roomDisp, displayEnd, lengthMin, sortKey: startMs });
        }
    }
    out.sort((a, b) => {
        const d = a.sortKey - b.sortKey;
        if (d !== 0) return d;
        const ida = String(a.appointment.booking_id || '');
        const idb = String(b.appointment.booking_id || '');
        if (ida !== idb) return ida.localeCompare(idb);
        const sa = String(a.appointment._roomViewSlice || '');
        const sb = String(b.appointment._roomViewSlice || '');
        return sa.localeCompare(sb);
    });
    return out;
}

/** Room label for day list table + CSV (segment column; for couple split, add booking room when it differs). */
function todayAppointmentsRoomPlain(r) {
    if (!r) return '—';
    const apt = r.appointment;
    const disp = (r.roomDisp || '').trim() || '—';
    const br = (apt.room || '').trim();
    if (apt._roomViewSlice && br && br !== 'ADDON') {
        const prim = formatRoomForPanel(br);
        if (prim && prim !== disp) {
            const tag = uiT('todayAppts.roomBookingShort', 'booking');
            return `${disp} (${tag} ${prim})`;
        }
    }
    return disp;
}

function todayAppointmentsRoomCellHtml(r) {
    const apt = r && r.appointment;
    const disp = (r.roomDisp || '').trim() || '—';
    const br = apt ? (apt.room || '').trim() : '';
    if (apt && apt._roomViewSlice && br && br !== 'ADDON') {
        const prim = formatRoomForPanel(br);
        if (prim && prim !== disp) {
            const sub = escapeHtml(uiT('todayAppts.roomBookingLine', 'Couple booking room'));
            return `${escapeHtml(disp)}<br><span class="today-appts-room-sub">${sub}: ${escapeHtml(prim)}</span>`;
        }
    }
    return escapeHtml(todayAppointmentsRoomPlain(r));
}

function escapeCsvField(val) {
    const s = val == null ? '' : String(val);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function todayAppointmentsCsvHeaders() {
    return [
        uiT('todayAppts.colStart', 'Start'),
        uiT('todayAppts.colEnd', 'End'),
        uiT('todayAppts.colLength', 'Length (min)'),
        uiT('todayAppts.colRoom', 'Room'),
        uiT('todayAppts.colCustomer', 'Customer'),
        uiT('todayAppts.colRequested', 'Requested masseuse'),
        uiT('todayAppts.colService', 'Service (calendar)'),
        uiT('todayAppts.colNotes', 'Notes'),
        uiT('todayAppts.colAssigned', 'Assigned therapists'),
    ];
}

function buildTodayAppointmentsCsv() {
    const therapists = (currentData && currentData.therapists) || [];
    const rows = collectTodayAppointmentsDisplayRows();
    const lines = [todayAppointmentsCsvHeaders().map(escapeCsvField).join(',')];
    for (const r of rows) {
        const apt = r.appointment;
        const displayEnd = r.displayEnd;
        const cust = calendarCustomerHeadlineShort(apt);
        const cells = [
            formatTimeCompactUS(apt.start_at),
            formatTimeCompactUS(displayEnd),
            String(r.lengthMin),
            todayAppointmentsRoomPlain(r),
            cust,
            todayAppointmentsRequestedMasseusePlain(apt, therapists),
            todayAppointmentsServiceCalendarLine(apt),
            todayAppointmentsNotesPlain(apt),
            todayAppointmentsAssignedPlain(apt, therapists),
        ];
        lines.push(cells.map(escapeCsvField).join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
}

/** When the day list is for today, scroll so an in-progress or upcoming row is in view. */
function scrollTodayAppointmentsModalToCurrentTime() {
    const modal = document.getElementById('todayAppointmentsModal');
    if (!modal || modal.style.display === 'none' || modal.getAttribute('aria-hidden') === 'true') return;
    const wrap = document.getElementById('todayAppointmentsTableWrap');
    const tbody = document.getElementById('todayAppointmentsTbody');
    const dateStr = document.getElementById('dateInput') && document.getElementById('dateInput').value;
    if (!wrap || !tbody || wrap.hidden || tbody.querySelector('td[colspan]')) return;
    if (!dateStr || dateStr !== getTodayLocal()) {
        wrap.scrollTop = 0;
        return;
    }
    const rows = [...tbody.querySelectorAll('tr[data-appt-start-ms]')];
    if (!rows.length) return;
    const nowMs = Date.now();
    let target =
        rows.find((tr) => {
            const a = parseInt(tr.getAttribute('data-appt-start-ms'), 10);
            const b = parseInt(tr.getAttribute('data-appt-end-ms'), 10);
            return Number.isFinite(a) && Number.isFinite(b) && a <= nowMs && nowMs < b;
        })
        || rows.find((tr) => {
            const a = parseInt(tr.getAttribute('data-appt-start-ms'), 10);
            return Number.isFinite(a) && a > nowMs;
        })
        || rows[rows.length - 1];
    if (target && typeof target.scrollIntoView === 'function') {
        try {
            target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        } catch (_) {
            target.scrollIntoView(true);
        }
    }
}

function refreshTodayAppointmentsModalTable() {
    const tbody = document.getElementById('todayAppointmentsTbody');
    const emptyEl = document.getElementById('todayAppointmentsEmpty');
    const wrap = document.getElementById('todayAppointmentsTableWrap');
    const exportBtn = document.getElementById('todayAppointmentsExportBtn');
    const titleEl = document.getElementById('todayAppointmentsModalTitle');
    const dateStr = document.getElementById('dateInput') && document.getElementById('dateInput').value;
    if (titleEl && dateStr) {
        const label = formatLocalDateLoadingLabel(dateStr);
        titleEl.textContent = uiTParams('todayAppts.titleDate', { date: label }, uiT('todayAppts.title', 'Appointments for this date'));
    }
    if (!tbody || !emptyEl || !wrap) return;

    const therapists = (currentData && currentData.therapists) || [];
    const rows = collectTodayAppointmentsDisplayRows();

    if (!rows.length) {
        emptyEl.hidden = false;
        wrap.hidden = true;
        tbody.innerHTML = '';
        if (exportBtn) exportBtn.disabled = true;
        return;
    }
    if (exportBtn) exportBtn.disabled = false;
    emptyEl.hidden = true;
    wrap.hidden = false;
    tbody.innerHTML = rows.map((r) => {
        const apt = r.appointment;
        const displayEnd = r.displayEnd;
        const cust = escapeHtml(calendarCustomerHeadlineShort(apt));
        const svc = escapeHtml(todayAppointmentsServiceCalendarLine(apt));
        const req = escapeHtml(todayAppointmentsRequestedMasseusePlain(apt, therapists));
        const asg = escapeHtml(todayAppointmentsAssignedPlain(apt, therapists));
        const notes = escapeHtml(todayAppointmentsNotesPlain(apt));
        const bidRaw = apt.booking_id || '';
        const bidEsc = escapeHtml(bidRaw);
        const editLabel = escapeHtml(uiT('todayAppts.edit', 'Edit'));
        const startMs = Number.isFinite(r.sortKey) ? r.sortKey : new Date(apt.start_at).getTime();
        let endMs = new Date(displayEnd).getTime();
        if (!Number.isFinite(endMs) && Number.isFinite(startMs)) endMs = startMs + 60000;
        const ds = Number.isFinite(startMs) ? String(Math.round(startMs)) : '';
        const de = Number.isFinite(endMs) ? String(Math.round(endMs)) : '';
        const dAttr = ds ? ` data-appt-start-ms="${escapeHtml(ds)}" data-appt-end-ms="${escapeHtml(de)}"` : '';
        return `<tr${dAttr}>
            <td class="today-appts-col-edit"><button type="button" class="today-appts-open-detail-btn" data-booking-id="${bidEsc}">${editLabel}</button></td>
            <td>${escapeHtml(formatTimeCompactUS(apt.start_at))}</td>
            <td>${escapeHtml(formatTimeCompactUS(displayEnd))}</td>
            <td>${escapeHtml(String(r.lengthMin))}</td>
            <td class="today-appts-col-room">${todayAppointmentsRoomCellHtml(r)}</td>
            <td>${cust}</td>
            <td>${req}</td>
            <td>${svc.replace(/\n/g, '<br>')}</td>
            <td class="today-appts-notes-cell">${notes.replace(/\n/g, '<br>')}</td>
            <td class="today-appts-col-assigned">${asg}</td>
        </tr>`;
    }).join('');
}

function downloadTodayAppointmentsCsv() {
    const dateStr = document.getElementById('dateInput') && document.getElementById('dateInput').value;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    const csv = buildTodayAppointmentsCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `appointments_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function initTodayAppointmentsExport() {
    const openBtn = document.getElementById('todayAppointmentsListBtn');
    const menuBtn = document.getElementById('todayAppointmentsMenuBtn');
    const modal = document.getElementById('todayAppointmentsModal');
    const backdrop = document.getElementById('todayAppointmentsBackdrop');
    const closeBtn = document.getElementById('todayAppointmentsCloseBtn');
    const exportBtn = document.getElementById('todayAppointmentsExportBtn');
    const tbody = document.getElementById('todayAppointmentsTbody');
    const pinInput = document.getElementById('todayAppointmentsPinInput');
    const pinBtn = document.getElementById('todayAppointmentsPinSubmitBtn');
    const pinStatus = document.getElementById('todayAppointmentsPinStatus');
    const openers = [openBtn, menuBtn].filter(Boolean);
    if (!openers.length || !modal) return;

    function applyDaylistPin() {
        if (!pinInput || !pinStatus) return;
        const v = String(pinInput.value || '').trim();
        if (v === MOM_DAYLIST_EDIT_PIN) {
            momDayListEditPinRecord();
            pinInput.value = '';
            pinStatus.textContent = uiT('todayAppts.pinOk', 'PIN accepted. Use Edit on a row, then adjust therapist / tip / prepayment in the detail window.');
            pinStatus.classList.add('today-appointments-pin-status--ok');
        } else {
            pinStatus.textContent = uiT('todayAppts.pinBad', 'Incorrect PIN.');
            pinStatus.classList.remove('today-appointments-pin-status--ok');
        }
    }

    if (pinBtn) pinBtn.addEventListener('click', applyDaylistPin);
    if (pinInput) {
        pinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyDaylistPin();
            }
        });
    }

    if (tbody) {
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('.today-appts-open-detail-btn');
            if (!btn) return;
            const bid = btn.getAttribute('data-booking-id');
            if (!bid || !currentData || !Array.isArray(currentData.events)) return;
            const ev = currentData.events.find((x) => x.booking_id === bid);
            if (!ev) return;
            momReturnToDayListAfterDetailClose = true;
            momCloseTodayAppointmentsModal();
            void showAppointmentDetailModal(ev);
        });
    }

    for (const b of openers) b.addEventListener('click', () => momOpenTodayAppointmentsModal());
    if (backdrop) backdrop.addEventListener('click', () => momCloseTodayAppointmentsModal());
    if (closeBtn) closeBtn.addEventListener('click', () => momCloseTodayAppointmentsModal());
    if (exportBtn) exportBtn.addEventListener('click', () => downloadTodayAppointmentsCsv());
}

/** Open daily grid sheet in new tab with current calendar date (called from onclick on Daily grid link). */
function openDailyGrid(ev) {
    if (ev) ev.preventDefault();
    const dateEl = document.getElementById('dateInput');
    const date = dateEl && dateEl.value && /^\d{4}-\d{2}-\d{2}$/.test(dateEl.value) ? dateEl.value : (new Date().toISOString().slice(0, 10));
    window.open('/static/grid.html?date=' + encodeURIComponent(date), '_blank', 'noopener');
}

/** Open masseuse scheduling sheet (NM/RM/Price/Tip/Note) for the calendar date. */
function openMasseuseSchedulingSheet(ev) {
    if (ev) ev.preventDefault();
    const dateEl = document.getElementById('dateInput');
    const date = dateEl && dateEl.value && /^\d{4}-\d{2}-\d{2}$/.test(dateEl.value) ? dateEl.value : (new Date().toISOString().slice(0, 10));
    window.open('/static/masseuse_scheduling_sheet.html?date=' + encodeURIComponent(date), '_blank', 'noopener');
}

function initMasseuseSchedulingSheetLink() {
    const link = document.getElementById('masseuseSchedulingSheetLink');
    if (!link || link.dataset.mssBound === '1') return;
    link.dataset.mssBound = '1';
    link.addEventListener('click', openMasseuseSchedulingSheet);
}

function auditFormatLocalFromIso(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch (e) {
        return String(iso);
    }
}

function momAvailabilityAuditOnDocKeyEscape(e) {
    if (e.key === 'Escape') momCloseAvailabilityAuditModal();
}

function momCloseAvailabilityAuditModal() {
    const modal = document.getElementById('availabilityAuditModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', momAvailabilityAuditOnDocKeyEscape);
}

function momRenderAvailabilityAuditSection(block, titleKey, titleFallback) {
    const title = escapeHtml(uiT(titleKey, titleFallback));
    const vid = block.service_variation_id ? escapeHtml(String(block.service_variation_id)) : '—';
    const res = escapeHtml(String(block.resolution || ''));
    const lab = block.catalog_label ? escapeHtml(String(block.catalog_label)) : '';
    let meta = `<p class="availability-audit-meta"><strong>${escapeHtml(uiT('audit.variationId', 'Variation ID'))}</strong>: ${vid} — <strong>${escapeHtml(uiT('audit.resolved', 'Resolved'))}</strong>: ${res}`;
    if (lab) meta += ` — ${lab}`;
    meta += ` — <strong>${escapeHtml(uiT('audit.squareStarts', 'Square starts this day'))}</strong>: ${Number(block.square_slot_count || 0)}</p>`;

    if (block.square_fetch_error) {
        const w = escapeHtml(String(block.square_fetch_error));
        return `<section class="availability-audit-section"><h3>${title}</h3><p class="availability-audit-warning">${w}</p>${meta}</section>`;
    }

    const next = block.next_room_available;
    let nextLine;
    if (next && next.time) {
        const tLocal = auditFormatLocalFromIso(next.time);
        const rm = roomKeyDisplayLabel(next.room);
        nextLine = uiTParams(
            'audit.nextRoomLine',
            { time: tLocal, room: rm },
            `Next free room (app rules): ${tLocal} (Rm ${rm})`,
        );
    } else {
        nextLine = uiT('audit.nextRoomNone', 'No next room slot in range (by app rules for this duration).');
    }

    const issues = Array.isArray(block.square_open_no_room) ? block.square_open_no_room : [];
    if (!issues.length) {
        return `<section class="availability-audit-section"><h3>${title}</h3>${meta}<p class="availability-audit-ok">${escapeHtml(uiT('audit.noDiscrepancies', 'No discrepancies: every Square start time has a matching room.'))}</p><p class="availability-audit-next">${escapeHtml(nextLine)}</p></section>`;
    }

    const colLocal = escapeHtml(uiT('audit.colLocal', 'Start (local)'));
    const colUtc = escapeHtml(uiT('audit.colUtc', 'Start (ISO)'));
    let rows = '';
    for (const row of issues) {
        const localCell = escapeHtml(String(row.start_at_local || row.start_at || ''));
        const utcCell = escapeHtml(String(row.start_at || ''));
        rows += `<tr><td>${localCell}</td><td>${utcCell}</td></tr>`;
    }
    const hint = escapeHtml(uiT(
        'audit.blockHint',
        'Block these times in Square Appointments (or reduce staff availability) so customers cannot book without a room.',
    ));
    return `<section class="availability-audit-section"><h3>${title}</h3>${meta}<p class="availability-audit-next">${escapeHtml(nextLine)}</p><p class="availability-audit-block-hint">${hint}</p><div class="availability-audit-table-wrap"><table class="availability-audit-table"><thead><tr><th>${colLocal}</th><th>${colUtc}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function momRenderAvailabilityAuditPayload(data) {
    const summary = escapeHtml(String((data && data.summary) || ''));
    const sl = momRenderAvailabilityAuditSection(data.single, 'audit.headingSingle', 'Single (configured service)');
    const cp = momRenderAvailabilityAuditSection(data.couple, 'audit.headingCouple', 'Couple (configured service)');
    const lab = escapeHtml(uiT('audit.summaryLabel', 'Summary'));
    return `<p class="availability-audit-summary"><strong>${lab}</strong> ${summary}</p>${sl}${cp}`;
}

async function momRunAvailabilityAuditFetch() {
    const body = document.getElementById('availabilityAuditBody');
    const loading = document.getElementById('availabilityAuditLoading');
    const errEl = document.getElementById('availabilityAuditError');
    const dateInput = document.getElementById('availabilityAuditDateInput');
    const durInput = document.getElementById('availabilityAuditDurationInput');
    if (!body || !dateInput || !durInput) return;

    const date = String(dateInput.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        if (errEl) {
            errEl.hidden = false;
            errEl.textContent = uiT('error.selectDate', 'Please select a date');
        }
        return;
    }
    let dur = parseInt(String(durInput.value || '60'), 10);
    if (!Number.isFinite(dur) || dur < 15) dur = 60;

    if (loading) loading.hidden = false;
    if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
    }
    body.hidden = true;

    let data;
    try {
        const url = `/api/availability-audit?date=${encodeURIComponent(date)}&duration_minutes=${encodeURIComponent(String(dur))}`;
        const res = await fetch(url);
        if (!res.ok) {
            const t = await res.text();
            throw new Error(t || res.statusText);
        }
        data = await res.json();
    } catch (e) {
        if (errEl) {
            errEl.hidden = false;
            errEl.textContent = `${uiT('audit.fetchFailed', 'Could not load audit.')}${e && e.message ? ' ' + e.message : ''}`;
        }
    } finally {
        if (loading) loading.hidden = true;
    }
    if (!data) return;
    body.innerHTML = momRenderAvailabilityAuditPayload(data);
    body.hidden = false;
}

function momOpenAvailabilityAuditModal() {
    const modal = document.getElementById('availabilityAuditModal');
    if (!modal) return;
    const errEl = document.getElementById('availabilityAuditError');
    if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
    }
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
    const mainDate = document.getElementById('dateInput');
    const auditDate = document.getElementById('availabilityAuditDateInput');
    if (mainDate && auditDate && mainDate.value && /^\d{4}-\d{2}-\d{2}$/.test(mainDate.value)) {
        auditDate.value = mainDate.value;
    }
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.removeEventListener('keydown', momAvailabilityAuditOnDocKeyEscape);
    document.addEventListener('keydown', momAvailabilityAuditOnDocKeyEscape);
    void momRunAvailabilityAuditFetch();
}

function initAvailabilityAuditModal() {
    const openBtn = document.getElementById('availabilityAuditBtn');
    const modal = document.getElementById('availabilityAuditModal');
    const backdrop = document.getElementById('availabilityAuditBackdrop');
    const closeBtn = document.getElementById('availabilityAuditCloseBtn');
    const runBtn = document.getElementById('availabilityAuditRunBtn');
    if (!modal) return;

    if (openBtn) openBtn.addEventListener('click', () => momOpenAvailabilityAuditModal());
    if (backdrop) backdrop.addEventListener('click', () => momCloseAvailabilityAuditModal());
    if (closeBtn) closeBtn.addEventListener('click', () => momCloseAvailabilityAuditModal());
    if (runBtn) runBtn.addEventListener('click', () => void momRunAvailabilityAuditFetch());
}

// Set today's date as default (local date so 7pm doesn't flip to next day)
document.addEventListener('DOMContentLoaded', () => {
    const today = getTodayLocal();
    const dateInput = document.getElementById('dateInput');
    dateInput.value = today;
    updateDateDayOfWeek();

    const detailModal = document.getElementById('appointmentDetailModal');
    if (detailModal) {
        detailModal.querySelector('.appointment-detail-close').addEventListener('click', closeAppointmentDetailModal);
        detailModal.querySelector('.appointment-detail-backdrop').addEventListener('click', closeAppointmentDetailModal);
        initAppointmentDetailModalDrag();
    }

    const focusAreaModal = document.getElementById('focusAreaModal');
    if (focusAreaModal) {
        focusAreaModal.querySelector('.focus-area-close').addEventListener('click', closeFocusAreaModal);
        focusAreaModal.querySelector('.focus-area-backdrop').addEventListener('click', closeFocusAreaModal);
        focusAreaModal.querySelector('.focus-area-cancel-btn').addEventListener('click', closeFocusAreaModal);
        focusAreaModal.querySelector('.focus-area-save-btn').addEventListener('click', saveFocusAreaModal);
        focusAreaModal.addEventListener('change', (e) => {
            if (e.target.matches('.focus-area-cb')) updateFocusAreaBodyDiagram();
        });
        focusAreaModal.addEventListener('input', (e) => {
            if (e.target.id === 'focusAreaOther') updateFocusAreaBodyDiagram();
        });
        const bodyDiagramImg = focusAreaModal.querySelector('.focus-area-body-img');
        if (bodyDiagramImg) bodyDiagramImg.addEventListener('load', () => updateFocusAreaBodyDiagram());
        let focusDiagramResizeT;
        window.addEventListener('resize', () => {
            const m = document.getElementById('focusAreaModal');
            if (!m || m.style.display === 'none') return;
            clearTimeout(focusDiagramResizeT);
            focusDiagramResizeT = setTimeout(() => updateFocusAreaBodyDiagram(), 120);
        });
    }
    const nextAvailableModal = document.getElementById('nextAvailableModal');
    if (nextAvailableModal) {
        nextAvailableModal.querySelector('.focus-area-close').addEventListener('click', closeNextAvailableModal);
        nextAvailableModal.querySelector('.focus-area-backdrop').addEventListener('click', closeNextAvailableModal);
    }

    const viewToggleBtn = document.getElementById('viewToggleBtn');
    if (viewToggleBtn) {
        function updateViewToggleUI() {
            viewToggleBtn.classList.remove('mode-room', 'mode-masseuse');
            viewToggleBtn.classList.add(calendarViewMode === 'room' ? 'mode-room' : 'mode-masseuse');
        }
        updateViewToggleUI();
        viewToggleBtn.addEventListener('click', () => {
            calendarViewMode = calendarViewMode === 'room' ? 'therapist' : 'room';
            updateViewToggleUI();
            if (currentData) renderCalendar(currentData);
            setTimeout(() => updateCurrentTimeLine(), 100);
        });
    }

    const squareOriHintToggle = document.getElementById('squareOriHintToggle');
    if (squareOriHintToggle && !squareOriHintToggle.dataset.momBound) {
        squareOriHintToggle.dataset.momBound = '1';
        function syncSquareOriHintToggleUi() {
            const on = isSquareOriCalendarHintOn();
            squareOriHintToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        syncSquareOriHintToggleUi();
        squareOriHintToggle.addEventListener('click', () => {
            setSquareOriCalendarHintOn(!isSquareOriCalendarHintOn());
            syncSquareOriHintToggleUi();
            if (currentData) renderCalendar(currentData);
        });
    }

    syncMomPhoneSummariesDetailsLayout();
    let momSummariesLayoutResizeT;
    window.addEventListener('resize', () => {
        clearTimeout(momSummariesLayoutResizeT);
        momSummariesLayoutResizeT = setTimeout(syncMomPhoneSummariesDetailsLayout, 120);
    });

    dateInput.addEventListener('change', () => {
        const v = dateInput.value;
        if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
            updateDateDayOfWeek();
            return;
        }
        momNavigateCalendarToDateString(v);
    });

    const dayLayoutFreezeCb = document.getElementById('dayLayoutFreezeCb');
    const dayLayoutFreezeLab = document.getElementById('dayLayoutFreezeWrap');
    if (dayLayoutFreezeCb && !dayLayoutFreezeCb.dataset.momBound) {
        dayLayoutFreezeCb.dataset.momBound = '1';
        if (dayLayoutFreezeLab) {
            updateDayLayoutFreezeTooltip(null);
        }
        dayLayoutFreezeCb.addEventListener('change', () => void momDayLayoutFreezeCheckboxChange());
        if (!dayLayoutFreezeCb.dataset.momShiftLockBound) {
            dayLayoutFreezeCb.dataset.momShiftLockBound = '1';
            dayLayoutFreezeCb.addEventListener('click', (e) => {
                if (!e.shiftKey) return;
                const dateInputEl = document.getElementById('dateInput');
                const d = dateInputEl && dateInputEl.value;
                if (!d) {
                    showError(uiT('error.selectDate', 'Please select a date'));
                    e.preventDefault();
                    return;
                }
                e.preventDefault();
                void momOpenDayLayoutLockModal(d);
            });
        }
    }

    const lockFromBtn = document.getElementById('dayLayoutLockFromTimeBtn');
    if (lockFromBtn && !lockFromBtn.dataset.momBound) {
        lockFromBtn.dataset.momBound = '1';
        lockFromBtn.addEventListener('click', () => {
            const dateInputEl = document.getElementById('dateInput');
            const d = dateInputEl && dateInputEl.value;
            if (!d) {
                showError(uiT('error.selectDate', 'Please select a date'));
                return;
            }
            void momOpenDayLayoutLockModal(d);
        });
    }

    checkApiStatus();
    initHeaderToolbarLinksToggle();
    initLanShareModal();
    initMasseuseSchedulingSheetLink();
    initCalendarZoom();
    initPhoneCalendarLayoutToggle();
    initDesktopPhoneListMirrorPanel();
    initDateQuickPickCluster();
    initCalendarStickyToolbarResize();
    initCalendarFullscreenControls();
    momSyncCalendarFullscreenChrome();
    initCalendarScreenshots();
    initCheckinCheckoutPanels();
    initDateHoverSummaryTooltip();
    initStaffingControls();
    initTodayAppointmentsExport();
    initAvailabilityAuditModal();
    initDayLayoutUnlockModal();
    initDayLayoutLockModal();
    initNewAppointmentsReport();
    loadDay();
    renderCancelledAlerts();
    renderRescheduleAlerts();

    // Auto-refresh calendar only when viewing today (prior days don't change)
    const AUTO_REFRESH_MS = 60 * 1000; // 60 seconds
    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        const dateInput = document.getElementById('dateInput');
        const selectedDate = dateInput?.value;
        if (!selectedDate) return;
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (selectedDate === todayStr) {
            loadDay();
            scheduleCheckoutPopupWhenDue();
        }
    }, AUTO_REFRESH_MS);
});

const HEADER_TOOLBAR_LINKS_KEY = 'mom_header_toolbar_links_open';

function refreshHeaderToolbarLinksToggleTitles() {
    const btn = document.getElementById('headerToolbarLinksToggle');
    const panel = document.getElementById('headerToolbarLinksPanel');
    if (!btn || !panel) return;
    const collapsed = panel.classList.contains('header-toolbar-links-panel--collapsed');
    const showTitle = uiT('header.toolbarLinksShowTitle', 'Show report links and API status');
    const hideTitle = uiT('header.toolbarLinksHideTitle', 'Hide report links and API status');
    btn.title = collapsed ? showTitle : hideTitle;
    btn.setAttribute('aria-label', collapsed ? showTitle : hideTitle);
}

function initHeaderToolbarLinksToggle() {
    const btn = document.getElementById('headerToolbarLinksToggle');
    const panel = document.getElementById('headerToolbarLinksPanel');
    const icon = btn && btn.querySelector('.header-toolbar-links-toggle-icon');
    if (!btn || !panel || !icon) return;
    if (btn.dataset.toolbarLinksBound) return;
    btn.dataset.toolbarLinksBound = '1';

    function setToolbarLinksCollapsed(collapsed) {
        panel.classList.toggle('header-toolbar-links-panel--collapsed', collapsed);
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        icon.textContent = collapsed ? '▼' : '▲';
        try {
            sessionStorage.setItem(HEADER_TOOLBAR_LINKS_KEY, collapsed ? '0' : '1');
        } catch (e) {}
        refreshHeaderToolbarLinksToggleTitles();
    }

    /* Toggle button removed from UI — keep report links panel always open */
    if (btn.hidden || btn.getAttribute('aria-hidden') === 'true') {
        setToolbarLinksCollapsed(false);
        return;
    }
    let startCollapsed = false;
    try {
        startCollapsed = sessionStorage.getItem(HEADER_TOOLBAR_LINKS_KEY) === '0';
    } catch (e) {}
    setToolbarLinksCollapsed(startCollapsed);

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const collapsed = panel.classList.contains('header-toolbar-links-panel--collapsed');
        setToolbarLinksCollapsed(!collapsed);
    });

    document.addEventListener('click', (e) => {
        if (panel.classList.contains('header-toolbar-links-panel--collapsed')) return;
        const wrap = btn.closest('.header-toolbar-links');
        if (!wrap || wrap.contains(e.target)) return;
        setToolbarLinksCollapsed(true);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (panel.classList.contains('header-toolbar-links-panel--collapsed')) return;
        setToolbarLinksCollapsed(true);
    });
}

/** True when a QR library is loaded (node-qrcode `toDataURL` or davidshim `makeCode`). */
function momLanShareQrEngineReady() {
    const Q = typeof QRCode !== 'undefined' ? QRCode : null;
    if (!Q) return false;
    if (typeof Q.toDataURL === 'function') return true;
    return typeof Q === 'function' && Q.prototype && typeof Q.prototype.makeCode === 'function';
}

function momLanShareLoadQrScript() {
    return new Promise((resolve) => {
        if (momLanShareQrEngineReady()) {
            resolve();
            return;
        }
        const existing = document.getElementById('momQrCodeScript');
        if (existing && !momLanShareQrEngineReady()) {
            existing.remove();
        }
        if (momLanShareQrEngineReady()) {
            resolve();
            return;
        }
        const urls = [
            'https://cdn.jsdelivr.net/npm/davidshimjs-qrcodejs@0.0.2/qrcode.min.js',
            'https://unpkg.com/davidshimjs-qrcodejs@0.0.2/qrcode.min.js',
        ];
        let i = 0;
        function appendNext() {
            if (momLanShareQrEngineReady()) {
                resolve();
                return;
            }
            if (i >= urls.length) {
                resolve();
                return;
            }
            const prev = document.getElementById('momQrCodeScript');
            if (prev) prev.remove();
            const s = document.createElement('script');
            s.id = 'momQrCodeScript';
            s.async = true;
            s.src = urls[i];
            i += 1;
            s.onload = () => {
                if (momLanShareQrEngineReady()) resolve();
                else appendNext();
            };
            s.onerror = () => {
                s.remove();
                appendNext();
            };
            document.head.appendChild(s);
        }
        appendNext();
    });
}

/** davidshimjs-qrcode: draw into a temp element, read canvas → data URL for <img>. */
function momLanShareQrDataUrlFromDom(text) {
    const t = String(text || '').trim();
    if (!t || typeof QRCode !== 'function' || !QRCode.prototype || typeof QRCode.prototype.makeCode !== 'function') {
        return '';
    }
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:220px;height:220px;overflow:hidden;visibility:hidden';
    document.body.appendChild(host);
    try {
        const level = QRCode.CorrectLevel && QRCode.CorrectLevel.M !== undefined
            ? QRCode.CorrectLevel.M
            : undefined;
        // eslint-disable-next-line no-new
        new QRCode(host, { text: t, width: 220, height: 220, correctLevel: level });
        const canvas = host.querySelector('canvas');
        if (canvas && canvas.width > 0 && typeof canvas.toDataURL === 'function') {
            return canvas.toDataURL('image/png');
        }
    } catch (e) {
        console.warn('momLanShareQrDataUrlFromDom', e);
    } finally {
        host.remove();
    }
    return '';
}

function momLanShareSetImgSrcWithFallbacks(img, urls, alt) {
    const list = (urls || []).filter(Boolean);
    if (!list.length) return;
    let idx = 0;
    function tryNext() {
        if (idx >= list.length) {
            img.removeAttribute('src');
            img.alt = alt;
            return;
        }
        const u = list[idx];
        idx += 1;
        img.onload = () => { img.onload = null; img.onerror = null; };
        img.onerror = () => { tryNext(); };
        img.alt = alt;
        img.src = u;
    }
    tryNext();
}

async function momLanShareSetQrImg(img, text) {
    const t = String(text || '').trim() || `${window.location.origin}/`;
    await momLanShareLoadQrScript();
    const alt = uiT('lanShare.qrAlt', 'QR code to open this dashboard on this network');
    img.alt = alt;
    if (typeof QRCode !== 'undefined' && typeof QRCode.toDataURL === 'function') {
        try {
            const maybe = QRCode.toDataURL(t, { width: 220, margin: 2, errorCorrectionLevel: 'M' });
            if (maybe && typeof maybe.then === 'function') {
                img.src = await maybe;
                return;
            }
        } catch (e1) { /* fall through */ }
        try {
            await new Promise((res, rej) => {
                QRCode.toDataURL(t, { width: 220, margin: 2 }, (err, u) => {
                    if (err || !u) rej(err);
                    else {
                        img.src = u;
                        res();
                    }
                });
            });
            return;
        } catch (e2) { /* fall through */ }
    }
    const fromDom = momLanShareQrDataUrlFromDom(t);
    if (fromDom) {
        img.onload = null;
        img.onerror = null;
        img.src = fromDom;
        return;
    }
    const enc = encodeURIComponent(t);
    momLanShareSetImgSrcWithFallbacks(img, [
        `https://api.qrserver.com/v1/create-qr-code/?size=220x220&ecc=M&data=${enc}`,
        `https://quickchart.io/qr?size=220&text=${enc}`,
    ], alt);
}

function momCloseLanShareModal() {
    const modal = document.getElementById('lanShareModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

async function momOpenLanShareModal() {
    const modal = document.getElementById('lanShareModal');
    const img = document.getElementById('lanShareQrImg');
    const list = document.getElementById('lanShareUrlList');
    const feedback = document.getElementById('lanShareFeedback');
    if (!modal || !img || !list) return;
    if (feedback) {
        feedback.textContent = '';
        feedback.hidden = true;
    }
    list.innerHTML = '';
    img.removeAttribute('src');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    let primary = `${window.location.origin}/`;
    try {
        const res = await fetch('/api/lan-share');
        if (!res.ok) throw new Error('bad status');
        const j = await res.json();
        const urls = Array.isArray(j.urls) ? j.urls.filter(Boolean) : [];
        primary = (j.primary_url && String(j.primary_url).trim()) || urls[0] || primary;
        const show = urls.length ? urls : [primary];
        for (const u of show) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = u;
            a.textContent = u;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            li.appendChild(a);
            list.appendChild(li);
        }
    } catch (e) {
        console.warn(e);
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = primary;
        a.textContent = primary;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
        list.appendChild(li);
        showError(uiT('lanShare.loadError', 'Could not detect this computer’s Wi‑Fi address. Using this browser’s address instead.'));
    }
    modal.dataset.lanPrimaryUrl = primary;
    await momLanShareSetQrImg(img, primary);
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
}

function initLanShareModal() {
    const openBtn = document.getElementById('lanShareOpenBtn');
    const modal = document.getElementById('lanShareModal');
    const backdrop = document.getElementById('lanShareBackdrop');
    const closeBtn = document.getElementById('lanShareCloseBtn');
    const copyBtn = document.getElementById('lanShareCopyBtn');
    const shareBtn = document.getElementById('lanShareNativeShareBtn');
    const feedback = document.getElementById('lanShareFeedback');
    if (!modal || modal.dataset.lanShareBound === '1') return;
    if (!openBtn) return;
    modal.dataset.lanShareBound = '1';
    if (shareBtn && typeof navigator !== 'undefined' && navigator.share) {
        shareBtn.hidden = false;
    }
    openBtn.addEventListener('click', () => { void momOpenLanShareModal(); });
    const close = () => momCloseLanShareModal();
    closeBtn?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (modal.style.display !== 'flex') return;
        close();
    });
    copyBtn?.addEventListener('click', async () => {
        const url = modal.dataset.lanPrimaryUrl || `${window.location.origin}/`;
        try {
            await navigator.clipboard.writeText(url);
            if (feedback) {
                feedback.textContent = uiT('lanShare.copyDone', 'Link copied to clipboard.');
                feedback.hidden = false;
            }
        } catch (err) {
            try {
                window.prompt(uiT('lanShare.copyFallback', 'Copy this link:'), url);
            } catch (e2) { /* ignore */ }
        }
    });
    shareBtn?.addEventListener('click', async () => {
        const url = modal.dataset.lanPrimaryUrl || `${window.location.origin}/`;
        if (!navigator.share) return;
        try {
            await navigator.share({
                title: document.title || 'Spa Room Management',
                text: uiT('lanShare.shareText', 'Open the room dashboard'),
                url,
            });
        } catch (e) {
            if (e && e.name !== 'AbortError') console.warn(e);
        }
    });
}

async function checkApiStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();
        const statusEl = document.getElementById('apiStatus');
        if (!statusEl) return;
        
        if (status.using_real_api) {
            statusEl.textContent = uiT('api.real', '✓ Connected to Real Square API');
            statusEl.className = 'api-status real-api';
        } else {
            statusEl.textContent = uiT('api.mock', '⚠ Using Mock Data (Square API not configured)');
            statusEl.className = 'api-status mock-data';
        }
    } catch (error) {
        console.error('Error checking API status:', error);
    }
}

/** Human-readable label for loading banners (local calendar date). */
function formatLocalDateLoadingLabel(yyyyMmDd) {
    if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(String(yyyyMmDd))) return String(yyyyMmDd || '');
    const p = String(yyyyMmDd).split('-');
    const y = parseInt(p[0], 10);
    const m = parseInt(p[1], 10) - 1;
    const d = parseInt(p[2], 10);
    const dt = new Date(y, m, d);
    if (Number.isNaN(dt.getTime())) return yyyyMmDd;
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function setDateNavBusy(busy) {
    const nav = document.querySelector('.header-date-inline .date-nav');
    if (nav) nav.setAttribute('aria-busy', busy ? 'true' : 'false');
    ['dateInput', 'dateOpenPickerBtn', 'squareOriHintToggle', 'loadBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !!busy;
    });
    document.querySelectorAll('.date-quick-tab[data-day-offset]').forEach((tab) => {
        tab.disabled = !!busy;
    });
}

function setDayLoadingHeaderVisible(show, requestedDate) {
    const wrap = document.getElementById('dayLoadStatus');
    const main = document.getElementById('dayLoadStatusMain');
    const sub = document.getElementById('dayLoadStatusSub');
    if (!wrap || !main || !sub) return;
    if (!show || !requestedDate) {
        main.textContent = '';
        sub.textContent = '';
        wrap.hidden = true;
        return;
    }
    const label = formatLocalDateLoadingLabel(requestedDate);
    main.textContent = uiTParams('day.loadingStatus', { date: label }, `Loading ${label}…`);
    sub.textContent = uiT('day.loadingPriorGridHint', 'The calendar below still shows the previous day until loading finishes.');
    wrap.hidden = false;
}

function setFullPageLoadingDateDetail(requestedDate) {
    const d = document.getElementById('loadingDateDetail');
    if (!d) return;
    const label = formatLocalDateLoadingLabel(requestedDate);
    d.textContent = uiTParams('loading.detailForDate', { date: label }, `Fetching schedule for ${label}.`);
    d.hidden = false;
}

function hideFullPageLoadingDateDetail() {
    const d = document.getElementById('loadingDateDetail');
    if (!d) return;
    d.textContent = '';
    d.hidden = true;
}

/** Clears network-load UI (calendar overlay, full-page loading, header hint, date controls). */
function finishDayLoadUi(addedCalendarLoading, calendarContainer) {
    const cal = calendarContainer || document.getElementById('calendarContainer');
    if (addedCalendarLoading && cal) {
        cal.classList.remove('calendar-loading');
        delete cal.dataset.loadingDate;
    }
    showLoading(false);
    hideFullPageLoadingDateDetail();
    const wrap = document.getElementById('dayLoadStatus');
    const main = document.getElementById('dayLoadStatusMain');
    const sub = document.getElementById('dayLoadStatusSub');
    if (main) main.textContent = '';
    if (sub) sub.textContent = '';
    if (wrap) wrap.hidden = true;
    setDateNavBusy(false);
}

/** Tooltip on the day layout lock label: when locked, show local date/time it was applied. */
function updateDayLayoutFreezeTooltip(data) {
    const lab = document.getElementById('dayLayoutFreezeWrap');
    if (!lab) return;
    const frozen = !!(data && data.room_day_layout_frozen);
    const iso = data && data.room_day_layout_locked_at;
    if (frozen && iso) {
        try {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) throw new Error('bad');
            const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
            const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
            lab.title = uiTParams(
                'dayLayout.freezeTitleLocked',
                { date: dateStr, time: timeStr },
                `Locked on ${dateStr} at ${timeStr}. New Square bookings still slot into gaps. Uncheck to clear layout pins and re-run auto-assign (manual per-appointment locks stay).`
            );
        } catch (_e) {
            lab.title = uiT(
                'dayLayout.freezeTitleLockedFallback',
                "This day's auto-assigned rooms are pinned (lock time unavailable). New Square bookings still slot into gaps. Uncheck to clear layout pins and re-run auto-assign (manual per-appointment locks stay)."
            );
        }
    } else if (frozen) {
        lab.title = uiT(
            'dayLayout.freezeTitleLockedFallback',
            "This day's auto-assigned rooms are pinned (lock time unavailable). New Square bookings still slot into gaps. Uncheck to clear layout pins and re-run auto-assign (manual per-appointment locks stay)."
        );
    } else {
        lab.title = uiT(
            'dayLayout.freezeTitleUnchecked',
            'Check to pin every auto-assigned room for this calendar day. New Square bookings can still fill gaps; existing pinned placements will not move. Manual per-appointment locks are unchanged.'
        );
    }
}

function syncDayLayoutFreezeCheckbox(data) {
    const cb = document.getElementById('dayLayoutFreezeCb');
    if (cb) {
        const want = !!(data && data.room_day_layout_frozen);
        if (cb.checked !== want) {
            cb.dataset.programmatic = '1';
            cb.checked = want;
            delete cb.dataset.programmatic;
        }
    }
    updateDayLayoutFreezeTooltip(data);
}

function momDayLayoutUnlockEscapeKey(ev) {
    if (ev.key === 'Escape') momDayLayoutUnlockModalClose();
}

function momDayLayoutUnlockModalClose() {
    const modal = document.getElementById('dayLayoutUnlockModal');
    if (!modal || modal.style.display === 'none') return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    if (momDayLayoutUnlockOnEscape) {
        document.removeEventListener('keydown', momDayLayoutUnlockOnEscape);
        momDayLayoutUnlockOnEscape = null;
    }
    momDayLayoutUnlockPendingDate = '';
}

function momFormatDayLayoutUnlockEventLine(ev) {
    const raw = ev && ev.at_iso;
    let timeStr = raw || '';
    try {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
            timeStr = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        }
    } catch (_e) { /* keep raw */ }
    const act = String(ev && ev.action || '').toLowerCase();
    if (act === 'unlock') {
        return uiTParams('dayLayout.unlockTimelineUnlock', { time: timeStr }, `Unlocked — ${timeStr}`);
    }
    return uiTParams('dayLayout.unlockTimelineLock', { time: timeStr }, `Locked — ${timeStr}`);
}

function momDayLayoutUnlockPopulateWavesSelect(selectEl, waves) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    (waves || []).forEach((w) => {
        const opt = document.createElement('option');
        opt.value = w.at_iso || '';
        let label = w.at_iso || '';
        try {
            const d = new Date(w.at_iso);
            if (!Number.isNaN(d.getTime())) {
                const tStr = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
                label = uiTParams(
                    'dayLayout.unlockWaveOption',
                    { time: tStr, count: String(w.count || 0) },
                    `${tStr} (${w.count || 0} appointments)`
                );
            }
        } catch (_e) { /* keep at_iso */ }
        opt.textContent = label;
        selectEl.appendChild(opt);
    });
    if (selectEl.options.length > 0) {
        selectEl.selectedIndex = selectEl.options.length - 1;
    }
}

async function momDayLayoutFreezeCommit(dateStr, freeze, unlockPromotedAtOrAfterIso, lockAppointmentsStartingAtOrAfterIso) {
    const body = { date: dateStr, freeze };
    if (!freeze && unlockPromotedAtOrAfterIso) {
        body.unlock_promoted_at_or_after_iso = unlockPromotedAtOrAfterIso;
    }
    if (freeze && lockAppointmentsStartingAtOrAfterIso) {
        body.lock_appointments_starting_at_or_after_iso = lockAppointmentsStartingAtOrAfterIso;
    }
    const res = await fetch('/api/room/day-layout-freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await parseFetchResponseAsJson(res);
    if (!res.ok) {
        const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const cal = document.getElementById('calendarContainer');
    if (data && data.day) {
        applyDayPayloadToUI(data.day, dateStr, dateStr, false, cal);
        try {
            momDayCache.set(dateStr, { at: Date.now(), data: data.day });
        } catch (e) { /* ignore */ }
    } else {
        await loadDay({ force: true });
    }
}

async function momDayLayoutFreezeCheckboxChange() {
    const cb = document.getElementById('dayLayoutFreezeCb');
    const dateInputEl = document.getElementById('dateInput');
    if (!cb || cb.dataset.programmatic === '1' || !dateInputEl) return;
    const date = dateInputEl.value;
    if (!date) {
        showError(uiT('error.selectDate', 'Please select a date'));
        return;
    }
    if (!cb.checked) {
        cb.dataset.programmatic = '1';
        cb.checked = true;
        delete cb.dataset.programmatic;
        await momOpenDayLayoutUnlockModal(date);
        return;
    }
    try {
        await momDayLayoutFreezeCommit(date, true, null, null);
    } catch (e) {
        console.error(e);
        showError(String(e.message || e));
        cb.dataset.programmatic = '1';
        cb.checked = false;
        delete cb.dataset.programmatic;
    }
}

function momDayLayoutLockEscapeKey(ev) {
    if (ev.key === 'Escape') momDayLayoutLockModalClose();
}

function momDayLayoutLockModalClose() {
    const modal = document.getElementById('dayLayoutLockModal');
    if (!modal || modal.style.display === 'none') return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    if (momDayLayoutLockOnEscape) {
        document.removeEventListener('keydown', momDayLayoutLockOnEscape);
        momDayLayoutLockOnEscape = null;
    }
    momDayLayoutLockPendingDate = '';
}

function momPad2ForLock(n) {
    return String(n).padStart(2, '0');
}

function momYmdLocalForLock(d) {
    return `${d.getFullYear()}-${momPad2ForLock(d.getMonth() + 1)}-${momPad2ForLock(d.getDate())}`;
}

function momToDatetimeLocalValueForLock(d) {
    return `${momYmdLocalForLock(d)}T${momPad2ForLock(d.getHours())}:${momPad2ForLock(d.getMinutes())}`;
}

function momDefaultLockStartInputValue(dateStr) {
    const now = new Date();
    if (dateStr && dateStr === momYmdLocalForLock(now)) {
        return momToDatetimeLocalValueForLock(now);
    }
    return dateStr ? `${dateStr}T12:00` : '';
}

async function momOpenDayLayoutLockModal(dateStr) {
    const modal = document.getElementById('dayLayoutLockModal');
    if (!modal) return;
    momDayLayoutLockPendingDate = dateStr;
    const errEl = document.getElementById('dayLayoutLockError');
    const inp = document.getElementById('dayLayoutLockStartInput');
    if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
    }
    if (inp) {
        inp.min = `${dateStr}T00:00`;
        inp.max = `${dateStr}T23:59`;
        inp.value = momDefaultLockStartInputValue(dateStr);
    }
    modal.style.display = 'flex';
    modal.removeAttribute('aria-hidden');
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
    momDayLayoutLockOnEscape = momDayLayoutLockEscapeKey;
    document.addEventListener('keydown', momDayLayoutLockOnEscape);
}

function initDayLayoutLockModal() {
    const modal = document.getElementById('dayLayoutLockModal');
    if (!modal || modal.dataset.momDayLockInit) return;
    modal.dataset.momDayLockInit = '1';
    const backdrop = document.getElementById('dayLayoutLockBackdrop');
    const closeBtn = document.getElementById('dayLayoutLockCloseBtn');
    const cancelBtn = document.getElementById('dayLayoutLockCancelBtn');
    const confirmBtn = document.getElementById('dayLayoutLockConfirmBtn');
    function close() {
        momDayLayoutLockModalClose();
    }
    if (backdrop) backdrop.addEventListener('click', close);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const dateStr = momDayLayoutLockPendingDate;
            if (!dateStr) return;
            const inp = document.getElementById('dayLayoutLockStartInput');
            const errEl = document.getElementById('dayLayoutLockError');
            const raw = inp && inp.value ? String(inp.value).trim() : '';
            if (!raw) {
                if (errEl) {
                    errEl.textContent = uiT('dayLayout.lockModalNeedTime', 'Choose a date and time on this calendar day.');
                    errEl.hidden = false;
                }
                return;
            }
            let iso;
            try {
                const d = new Date(raw);
                if (Number.isNaN(d.getTime())) throw new Error('bad');
                iso = d.toISOString();
            } catch (_e) {
                if (errEl) {
                    errEl.textContent = uiT('dayLayout.lockModalBadTime', 'Could not read that date and time.');
                    errEl.hidden = false;
                }
                return;
            }
            void (async () => {
                if (errEl) {
                    errEl.hidden = true;
                    errEl.textContent = '';
                }
                confirmBtn.disabled = true;
                try {
                    await momDayLayoutFreezeCommit(dateStr, true, null, iso);
                    momDayLayoutLockModalClose();
                } catch (err) {
                    console.error(err);
                    if (errEl) {
                        errEl.textContent = String(err.message || err);
                        errEl.hidden = false;
                    }
                } finally {
                    confirmBtn.disabled = false;
                }
            })();
        });
    }
}

async function momOpenDayLayoutUnlockModal(dateStr) {
    const modal = document.getElementById('dayLayoutUnlockModal');
    if (!modal) return;
    momDayLayoutUnlockPendingDate = dateStr;
    const loadingEl = document.getElementById('dayLayoutUnlockLoading');
    const introEl = document.getElementById('dayLayoutUnlockIntro');
    const fieldset = document.getElementById('dayLayoutUnlockFieldset');
    const eventsLabel = document.getElementById('dayLayoutUnlockEventsLabel');
    const eventsUl = document.getElementById('dayLayoutUnlockEvents');
    const emptyEl = document.getElementById('dayLayoutUnlockEmpty');
    const errEl = document.getElementById('dayLayoutUnlockError');
    const confirmBtn = document.getElementById('dayLayoutUnlockConfirmBtn');
    const refreshBtn = document.getElementById('dayLayoutUnlockRefreshBtn');
    if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
    }
    if (loadingEl) loadingEl.hidden = false;
    if (introEl) introEl.hidden = true;
    if (fieldset) fieldset.hidden = true;
    if (eventsLabel) eventsLabel.hidden = true;
    if (eventsUl) {
        eventsUl.hidden = true;
        eventsUl.innerHTML = '';
    }
    if (emptyEl) emptyEl.hidden = true;
    if (refreshBtn) {
        refreshBtn.hidden = true;
        refreshBtn.disabled = false;
    }
    if (confirmBtn) {
        confirmBtn.hidden = false;
        confirmBtn.disabled = true;
    }

    modal.style.display = 'flex';
    modal.removeAttribute('aria-hidden');
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
    momDayLayoutUnlockOnEscape = momDayLayoutUnlockEscapeKey;
    document.addEventListener('keydown', momDayLayoutUnlockOnEscape);

    let waves = [];
    let events = [];
    try {
        const res = await fetch(`/api/room/day-layout-freeze-context?date=${encodeURIComponent(dateStr)}`);
        const ctx = await parseFetchResponseAsJson(res);
        if (!res.ok) {
            const msg = (ctx && (ctx.detail || ctx.message)) || `HTTP ${res.status}`;
            throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
        waves = Array.isArray(ctx.waves) ? ctx.waves : [];
        events = Array.isArray(ctx.events) ? ctx.events : [];
    } catch (e) {
        console.error(e);
        if (errEl) {
            errEl.textContent = String(e.message || e);
            errEl.hidden = false;
        }
        if (loadingEl) loadingEl.hidden = true;
        if (introEl) introEl.hidden = false;
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.hidden = true;
        }
        return;
    }

    if (loadingEl) loadingEl.hidden = true;
    if (introEl) introEl.hidden = false;

    const sel = document.getElementById('dayLayoutUnlockWaveSelect');
    const partialRadio = modal.querySelector('input[name="momDayUnlockScope"][value="partial"]');
    const allRadio = modal.querySelector('input[name="momDayUnlockScope"][value="all"]');
    const waveWrap = document.getElementById('dayLayoutUnlockWaveWrap');
    const partialLabel = document.getElementById('dayLayoutUnlockPartialLabel');

    if (allRadio) allRadio.checked = true;
    if (partialRadio) partialRadio.checked = false;
    if (waveWrap) waveWrap.hidden = true;

    if (events.length && eventsUl && eventsLabel) {
        events.forEach((ev) => {
            const li = document.createElement('li');
            li.textContent = momFormatDayLayoutUnlockEventLine(ev);
            eventsUl.appendChild(li);
        });
        eventsUl.hidden = false;
        eventsLabel.hidden = false;
    }

    if (!waves.length) {
        if (fieldset) fieldset.hidden = true;
        if (emptyEl) emptyEl.hidden = false;
        if (confirmBtn) confirmBtn.hidden = true;
        if (refreshBtn) refreshBtn.hidden = false;
    } else {
        if (fieldset) fieldset.hidden = false;
        momDayLayoutUnlockPopulateWavesSelect(sel, waves);
        const canPartial = waves.length >= 2;
        if (partialRadio) partialRadio.disabled = !canPartial;
        if (partialLabel) partialLabel.classList.toggle('day-layout-unlock-radio--disabled', !canPartial);
    }

    if (confirmBtn) confirmBtn.disabled = false;
}

function initDayLayoutUnlockModal() {
    const modal = document.getElementById('dayLayoutUnlockModal');
    if (!modal || modal.dataset.momDayUnlockInit) return;
    modal.dataset.momDayUnlockInit = '1';
    const backdrop = document.getElementById('dayLayoutUnlockBackdrop');
    const closeBtn = document.getElementById('dayLayoutUnlockCloseBtn');
    const cancelBtn = document.getElementById('dayLayoutUnlockCancelBtn');
    const confirmBtn = document.getElementById('dayLayoutUnlockConfirmBtn');
    const refreshBtn = document.getElementById('dayLayoutUnlockRefreshBtn');
    function close() {
        momDayLayoutUnlockModalClose();
    }
    if (backdrop) backdrop.addEventListener('click', close);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            momDayLayoutUnlockModalClose();
            void loadDay({ force: true });
        });
    }
    modal.addEventListener('change', (ev) => {
        const t = ev.target;
        if (!t || t.name !== 'momDayUnlockScope') return;
        const waveWrap = document.getElementById('dayLayoutUnlockWaveWrap');
        const partial = modal.querySelector('input[name="momDayUnlockScope"][value="partial"]');
        if (waveWrap) {
            waveWrap.hidden = !(partial && partial.checked && !partial.disabled);
        }
    });
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const dateStr = momDayLayoutUnlockPendingDate;
            if (!dateStr) return;
            const sel = document.getElementById('dayLayoutUnlockWaveSelect');
            const errEl = document.getElementById('dayLayoutUnlockError');
            const partial = modal.querySelector('input[name="momDayUnlockScope"][value="partial"]');
            if (partial && partial.disabled && partial.checked) {
                const allR = modal.querySelector('input[name="momDayUnlockScope"][value="all"]');
                if (allR) allR.checked = true;
            }
            const scopeEl = modal.querySelector('input[name="momDayUnlockScope"]:checked');
            const scope = (scopeEl && scopeEl.value) || 'all';
            let unlockIso = null;
            if (scope === 'partial') {
                unlockIso = sel && sel.value ? String(sel.value) : '';
                if (!unlockIso) {
                    if (errEl) {
                        errEl.textContent = uiT('dayLayout.unlockPickWave', 'Pick a time from the list.');
                        errEl.hidden = false;
                    }
                    return;
                }
            }
            void (async () => {
                if (errEl) {
                    errEl.hidden = true;
                    errEl.textContent = '';
                }
                confirmBtn.disabled = true;
                if (refreshBtn) refreshBtn.disabled = true;
                try {
                    await momDayLayoutFreezeCommit(dateStr, false, unlockIso, null);
                    momDayLayoutUnlockModalClose();
                } catch (err) {
                    console.error(err);
                    if (errEl) {
                        errEl.textContent = String(err.message || err);
                        errEl.hidden = false;
                    }
                } finally {
                    confirmBtn.disabled = false;
                    if (refreshBtn) refreshBtn.disabled = false;
                }
            })();
        });
    }
}

/** Apply a day JSON payload to the dashboard (memory, network, or persisted history). */
function applyDayPayloadToUI(data, requestedDate, dateForMessages, addedCalendarLoading, calendarContainer) {
    currentData = data;
    syncDayLayoutFreezeCheckbox(data);
    invalidateMomFacialStaffingSimCache();
    invalidateMomMassageAnyStaffSimCache();
    rememberTherapistsForStaffingPick(data.therapists);
    updateHeaderDateHoverSummary(data);
    renderNewMasseuseBanner(data);

    if (!data.events || data.events.length === 0) {
        showNoBookingsMessage(dateForMessages);
        hideCalendar();
        const noRoomsEl = document.getElementById('noRoomsAlertContainer');
        if (noRoomsEl) noRoomsEl.style.display = 'none';
        const noRoomBookingEl = document.getElementById('noRoomBookingAlertContainer');
        if (noRoomBookingEl) noRoomBookingEl.style.display = 'none';
        const therapistOverlapEl = document.getElementById('therapistRequestOverlapAlertContainer');
        if (therapistOverlapEl) therapistOverlapEl.style.display = 'none';
        const facialBar = document.getElementById('facialSummaryBar');
        if (facialBar) facialBar.style.display = 'none';
        const customerReqPanel = document.getElementById('customerRequestsPanel');
        if (customerReqPanel) customerReqPanel.style.display = 'none';
        const customerReqBar = document.getElementById('customerRequestsBar');
        if (customerReqBar) customerReqBar.style.display = 'none';
        renderCancelledAlerts();
        renderRescheduleAlerts();
        updateUndoRoomButton(dateForMessages);
    } else {
        hideNoBookingsMessage();
    }

    renderNextAvailable(data.next_couple_available, data.next_single_available);
    renderCustomerRequestsSummary(data.events, data.therapists);
    renderFacialSummary(data.facial_summary);
    renderTherapistOrderBar(data.therapists, data.therapist_order, data.date);
    renderCalendar(data);
    showUnassigned(data.events);
    updateNoRoomsAlert(data);
    updateNoRoomBookingAlert(data);
    renderCancelledAlerts();
    renderRescheduleAlerts();
    updateCheckinCheckoutPanels();
    finishDayLoadUi(addedCalendarLoading, calendarContainer);
    showCalendar();
    updateUndoRoomButton(dateForMessages);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => updateCurrentTimeLine());
    });
    scheduleCheckoutPopupWhenDue();
}

/** Rebuild calendar from in-memory day data (no network). Used for sidebar / slot-step toggles. */
function refreshCalendarFromCachedDayData() {
    const dateInputEl = document.getElementById('dateInput');
    const date = dateInputEl && dateInputEl.value;
    if (!date || !currentData || currentData.date !== date) {
        loadDay({ soft: true });
        return;
    }
    try {
        renderCalendar(currentData);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => updateCurrentTimeLine());
        });
    } catch (e) {
        console.warn('Cached calendar redraw failed; reloading day', e);
        loadDay({ soft: true });
    }
}

async function loadDay(opts) {
    opts = opts || {};
    const soft = opts.soft === true;
    const useCache = opts.useCache !== false;
    const force = opts.force === true;
    const dateInputEl = document.getElementById('dateInput');
    const date = dateInputEl && dateInputEl.value;
    if (!date) {
        showError(uiT('error.selectDate', 'Please select a date'));
        return;
    }
    const requestedDate = date;
    if (momLoadDayLastRequestedDate !== requestedDate) {
        clearCheckinCheckoutDraftGuards();
        momLoadDayLastRequestedDate = requestedDate;
    }

    const isHist = isCalendarHistoryDay(requestedDate);
    const mem = momDayCache.get(requestedDate);
    const memOk =
        useCache &&
        !force &&
        !soft &&
        mem &&
        (Date.now() - mem.at) < MOM_DAY_CACHE_TTL_MS &&
        mem.data &&
        mem.data.date === requestedDate;
    const diskRaw = isHist && !force && !soft ? readDayHistoryFromLocal(requestedDate) : null;
    const skipNetwork = isHist && !force && !soft && (memOk || !!diskRaw);

    let servedData = null;
    if (memOk) {
        servedData = mem.data;
    } else if (diskRaw) {
        try {
            servedData = JSON.parse(JSON.stringify(diskRaw));
            const testEvents = getVoiceTestEventsForDate(servedData.date);
            if (testEvents.length) {
                servedData.events = (servedData.events || []).concat(testEvents);
            }
        } catch (e) {
            console.error('Error hydrating history day from localStorage', e);
            servedData = null;
        }
    }

    const calendarContainer = document.getElementById('calendarContainer');
    const calendarAlreadyVisible = calendarContainer && calendarContainer.style.display === 'block';

    // Today / yesterday: paint from short-lived memory cache first, then hit the network (unless only history skip below).
    if (memOk && useCache && !force && !skipNetwork) {
        try {
            applyDayPayloadToUI(mem.data, requestedDate, date, false, null);
        } catch (e) {
            console.warn('Cached render failed; falling back to network', e);
        }
    }

    if (skipNetwork && servedData) {
        hideError();
        try {
            applyDayPayloadToUI(servedData, requestedDate, date, false, null);
            try {
                momDayCache.set(requestedDate, { at: Date.now(), data: servedData });
            } catch (e) { /* ignore */ }
            setTimeout(() => {
                try {
                    const prev = addDaysToDate(servedData.date, -1);
                    const next = addDaysToDate(servedData.date, 1);
                    prefetchDayIntoCache(prev);
                    prefetchDayIntoCache(next);
                } catch (e) { /* ignore */ }
            }, 0);
        } catch (e) {
            console.warn('History day render failed; loading from network', e);
            return loadDay({ force: true });
        }
        return;
    }

    let addedCalendarLoading = false;
    if (!soft) {
        setDateNavBusy(true);
        setDayLoadingHeaderVisible(true, requestedDate);
    }
    if (calendarAlreadyVisible && !soft) {
        calendarContainer.dataset.loadingDate = formatLocalDateLoadingLabel(requestedDate);
        calendarContainer.classList.add('calendar-loading');
        addedCalendarLoading = true;
    } else if (!calendarAlreadyVisible && !soft) {
        setFullPageLoadingDateDetail(requestedDate);
        showLoading(true);
        hideCalendar();
    }
    hideError();

    try {
        const response = await fetch(`/api/day?date=${requestedDate}`);
        const data = await parseFetchResponseAsJson(response);
        // If user changed dates while we were loading, don't overwrite the UI.
        if (dateInputEl && dateInputEl.value && dateInputEl.value !== requestedDate) {
            finishDayLoadUi(addedCalendarLoading, calendarContainer);
            return;
        }
        if (typeof window !== 'undefined' && window.__MOM_DEBUG_DAY__) {
            console.log('[MOM debug day]', {
            date: data.date,
            therapistsCount: data.therapists?.length || 0,
            eventsCount: data.events?.length || 0,
            });
        }

        let rawForHistory = null;
        if (isCalendarHistoryDay(data.date)) {
            try {
                rawForHistory = JSON.parse(JSON.stringify(data));
            } catch (e) { /* ignore */ }
        }

        // Merge in local voice-test appointments (client-side only, not in Square)
        try {
            const testEvents = getVoiceTestEventsForDate(data.date);
            if (testEvents.length) {
                data.events = (data.events || []).concat(testEvents);
            }
        } catch (e) {
            console.error('Error merging voice test events', e);
        }

        // After 9pm local, when today's last appointment has ended (or there were none), default to tomorrow
        const todayStr = getTodayLocal();
        let preferToday = false;
        try {
            preferToday = sessionStorage.getItem(preferTodaySessionKey()) === '1';
        } catch (e) { /* ignore */ }
        if (
            date === todayStr &&
            !preferToday &&
            !momSuppressAfterNineAutoAdvance &&
            isLocalTimeAtOrAfterNinePM() &&
            allDayAppointmentsFinished(data.events || [])
        ) {
            const nextStr = addDaysToDate(todayStr, 1);
            dateInputEl.value = nextStr;
            updateDateDayOfWeek();
            finishDayLoadUi(addedCalendarLoading, calendarContainer);
            await loadDay();
            return;
        }

        if (rawForHistory && rawForHistory.date) {
            writeDayHistoryToLocal(rawForHistory.date, rawForHistory);
        }

        // Cache the fresh response for quick back/forward switching.
        try {
            momDayCache.set(data.date, { at: Date.now(), data });
        } catch (e) { /* ignore */ }

        // Detect cancelled and rescheduled appointments (same date, compare previous vs new)
        // Only run when new data looks complete: avoid treating a transient empty/partial API response as "everyone cancelled"
        if (currentData && currentData.date === data.date && (currentData.events || []).length > 0) {
            const newEvents = data.events || [];
            if (newEvents.length > 0) {
                const prevByid = new Map((currentData.events || []).map(e => [e.booking_id, e]));
                const newIds = new Set(newEvents.map(e => e.booking_id));
                const cancelled = (currentData.events || []).filter(e => !newIds.has(e.booking_id));
                // Only add cancelled alerts if a plausible number (1–2 per refresh); avoid mass false alerts from bad/partial data
                if (cancelled.length > 0 && cancelled.length <= 10) {
                    addCancelledAlerts(cancelled);
                }
                const rescheduled = [];
                newEvents.forEach(ev => {
                    const prev = prevByid.get(ev.booking_id);
                    if (prev && (prev.start_at !== ev.start_at || prev.end_at !== ev.end_at)) {
                        rescheduled.push({
                            booking_id: ev.booking_id,
                            customer: ev.customer,
                            service: ev.service,
                            from_start_at: prev.start_at,
                            from_end_at: prev.end_at,
                            to_start_at: ev.start_at,
                            to_end_at: ev.end_at
                        });
                    }
                });
                if (rescheduled.length) addRescheduleAlerts(rescheduled);
            }
        }

        applyDayPayloadToUI(data, requestedDate, date, addedCalendarLoading, calendarContainer);

        // Prefetch adjacent days so switching is instant.
        setTimeout(() => {
            try {
                const prev = addDaysToDate(data.date, -1);
                const next = addDaysToDate(data.date, 1);
                prefetchDayIntoCache(prev);
                prefetchDayIntoCache(next);
            } catch (e) { /* ignore */ }
        }, 0);
    } catch (error) {
        finishDayLoadUi(addedCalendarLoading, calendarContainer);
        showError(error.message);
    }
}

function refreshDay() {
    const inp = document.getElementById('dateInput');
    const v = inp && inp.value;
    if (v && isCalendarHistoryDay(v)) {
        loadDay({ force: false, useCache: true });
        return;
    }
    loadDay({ force: true, useCache: false });
}

function prefetchDayIntoCache(dateStr) {
    if (!dateStr) return;
    const cached = momDayCache.get(dateStr);
    if (cached && (Date.now() - cached.at) < MOM_DAY_CACHE_TTL_MS) return;
    if (isCalendarHistoryDay(dateStr)) {
        const raw = readDayHistoryFromLocal(dateStr);
        if (!raw) return;
        try {
            const data = JSON.parse(JSON.stringify(raw));
            const testEvents = getVoiceTestEventsForDate(data.date);
            if (testEvents.length) data.events = (data.events || []).concat(testEvents);
            momDayCache.set(data.date, { at: Date.now(), data });
        } catch (e) { /* ignore */ }
        return;
    }
    fetch(`/api/day?date=${encodeURIComponent(dateStr)}`)
        .then(r => r.ok ? r.json() : null)
        .then((data) => {
            if (!data || !data.date) return;
            // Merge in local voice-test appointments (same as loadDay)
            try {
                const testEvents = getVoiceTestEventsForDate(data.date);
                if (testEvents.length) data.events = (data.events || []).concat(testEvents);
            } catch (e) { /* ignore */ }
            momDayCache.set(data.date, { at: Date.now(), data });
        })
        .catch(() => {});
}

async function updateUndoRoomButton(date) {
    const btn = document.getElementById('undoRoomBtn');
    const menuBtn = document.getElementById('undoRoomMenuBtn');
    const slimToolbar =
        momIsPhoneCalendarBreakpoint() && ['list', 'checkout'].includes(momPhoneCalendarLayoutMode());
    if (!btn && !menuBtn) return;
    try {
        const res = await fetch(`/api/room/undo-available?date=${encodeURIComponent(date)}`);
        const text = await res.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch (e) { /* ignore */ }
        const show = !!data.available;
        if (btn) btn.style.display = show && !slimToolbar ? 'inline-block' : 'none';
        if (menuBtn) menuBtn.style.display = show && slimToolbar ? 'block' : 'none';
    } catch (e) {
        if (btn) btn.style.display = 'none';
        if (menuBtn) menuBtn.style.display = 'none';
    }
}

async function undoRoomChange() {
    const date = document.getElementById('dateInput') && document.getElementById('dateInput').value;
    if (!date) return;
    const btn = document.getElementById('undoRoomBtn');
    const menuBtn = document.getElementById('undoRoomMenuBtn');
    if (btn) btn.disabled = true;
    if (menuBtn) menuBtn.disabled = true;
    try {
        const res = await fetch(`/api/room/undo?date=${encodeURIComponent(date)}`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Could not undo.');
            return;
        }
        if (await tryApplyDayFromRoomMutationResponse(res)) return;
        await loadDay();
    } finally {
        if (btn) btn.disabled = false;
        if (menuBtn) menuBtn.disabled = false;
    }
}

/** PUT /api/room — set confirmed:true after user verifies (see putRoomAssignmentWithConfirm). */
async function putRoomAssignment(bookingId, date, room, options = {}) {
    const body = { booking_id: bookingId, date, room };
    if (options.confirmed) body.confirmed = true;
    if (options.placement_override === true) body.placement_override = true;
    if (options.placement_override === false) body.placement_override = false;
    if (options.unlock_room_for_auto) body.unlock_room_for_auto = true;
    if (options.room_view_slice) body.room_view_slice = options.room_view_slice;
    return fetch('/api/room', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/**
 * Room move: (1) optional prompt if calendar shows target room unavailable → placement_override.
 * (2) 409 retry for in-progress / checked-in / finished (confirmed).
 */
async function putRoomAssignmentWithConfirm(bookingId, date, room, extra = {}) {
    const events = (currentData && currentData.events) || [];
    const ev = events.find(e => e.booking_id === bookingId);
    let placementOverride = extra.placement_override;
    if (placementOverride === undefined && !extra.skipAvailabilityConflictPrompt) {
        if (ev && calendarTargetRoomHasAvailabilityConflict(ev, room, events)) {
            const msg = uiT(
                'room.overrideUnavailableBody',
                'The calendar shows this room as in use for this appointment’s time (for example, Rm 0 while a couple is still in 02C). Place here anyway? An OVR badge will mark this booking so you remember it was a manual override.'
            );
            if (!window.confirm(msg)) {
                return new Response('', { status: 499, statusText: 'Aborted' });
            }
            placementOverride = true;
        } else if (ev && ev.room_placement_override === true) {
            placementOverride = false;
        }
    }
    const fetchOpts = {};
    if (extra.confirmed) fetchOpts.confirmed = true;
    if (placementOverride === true) fetchOpts.placement_override = true;
    if (placementOverride === false) fetchOpts.placement_override = false;
    if (extra.unlock_room_for_auto) fetchOpts.unlock_room_for_auto = true;
    if (extra.room_view_slice) fetchOpts.room_view_slice = extra.room_view_slice;

    let res = await putRoomAssignment(bookingId, date, room, fetchOpts);
    if (res.status === 409) {
        let detail = '';
        try {
            const data = await res.json();
            detail = typeof data.detail === 'string' ? data.detail : '';
        } catch (_) {}
        const ok = window.confirm(
            (detail ? detail + '\n\n' : '') +
            uiT('room.moveConfirm', 'Move this booking to the new room? Only confirm if the client should be moved.')
        );
        if (!ok) return res;
        fetchOpts.confirmed = true;
        res = await putRoomAssignment(bookingId, date, room, fetchOpts);
    }
    return res;
}

/** Apply a GET-/api/day-shaped object after room mutation (voice-test merge + cache + full UI). */
function applyDayPayloadFromRoomMutationBody(dayRaw) {
    let data;
    try {
        data = JSON.parse(JSON.stringify(dayRaw));
    } catch (e) {
        loadDay({ soft: true });
        return;
    }
    try {
        const testEvents = getVoiceTestEventsForDate(data.date);
        if (testEvents.length) data.events = (data.events || []).concat(testEvents);
    } catch (e) { /* ignore */ }
    const dateInputEl = document.getElementById('dateInput');
    const dateForMessages = (dateInputEl && dateInputEl.value) || data.date;
    try {
        momDayCache.set(data.date, { at: Date.now(), data });
    } catch (e) { /* ignore */ }
    applyDayPayloadToUI(data, data.date, dateForMessages, false, null);
    try {
        updateUndoRoomButton(dateForMessages);
    } catch (e) { /* ignore */ }
}

/** If JSON includes `day`, apply it and return true (consumes response body). */
async function tryApplyDayFromRoomMutationResponse(res) {
    if (!res || !res.ok) return false;
    let body;
    try {
        body = await res.json();
    } catch (e) {
        return false;
    }
    if (!body || !body.day || !body.day.date) return false;
    applyDayPayloadFromRoomMutationBody(body.day);
    return true;
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    errorEl.classList.remove('error-message--info');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

function hideError() {
    const errorEl = document.getElementById('errorMessage');
    errorEl.classList.remove('error-message--info');
    errorEl.style.display = 'none';
}

/** Brief non-error banner (reuses #errorMessage with info styling). */
function showNotice(message) {
    const errorEl = document.getElementById('errorMessage');
    errorEl.classList.add('error-message--info');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    setTimeout(() => {
        if (errorEl.textContent === message) hideError();
    }, 4500);
}

function showNoBookingsMessage(date) {
    const messageEl = document.getElementById('noBookingsMessage');
    const title = uiTParams('noBookings.title', { date }, 'No bookings found for ' + date);
    const hint = uiT('noBookings.hint', 'This date has no appointments in Square. Try selecting a different date.');
    messageEl.innerHTML = `
        <strong>${escapeHtml(title)}</strong>
        <div>${escapeHtml(hint)}</div>
    `;
    messageEl.style.display = 'block';
}

function hideNoBookingsMessage() {
    document.getElementById('noBookingsMessage').style.display = 'none';
}

function showCalendar() {
    document.getElementById('calendarContainer').style.display = 'block';
    updateCalendarZoomUI();
    setTimeout(() => momCalendarStickyToolbarSync(), 0);
}

function hideCalendar() {
    document.getElementById('calendarContainer').style.display = 'none';
}

function renderNextAvailable(nextCouple, nextSingle) {
    const el = document.getElementById('nextAvailable');
    if (!el) return;
    // Format time on 15-min boundary only (:00, :15, :30, :45) — never :35 etc.
    function formatTime15(d) {
        const date = new Date(d);
        const m = date.getMinutes();
        const q = Math.floor(m / 15) * 15;
        date.setMinutes(q, 0, 0);
        return formatTimeCompactUS(date);
    }
    const chunks = [];
    if (nextCouple && nextCouple.time) {
        const line = uiTParams('next.coupleLine', { time: formatTime15(nextCouple.time), room: roomKeyDisplayLabel(nextCouple.room) },
            'Next couple room: ' + formatTime15(nextCouple.time) + ' (Rm ' + roomKeyDisplayLabel(nextCouple.room) + ')');
        chunks.push('<span class="next-available-couple">' + escapeHtml(line) + '</span>');
    }
    if (nextSingle && nextSingle.time) {
        const line = uiTParams('next.singleLine', { time: formatTime15(nextSingle.time), room: roomKeyDisplayLabel(nextSingle.room) },
            'Next Single Room: ' + formatTime15(nextSingle.time) + ' (Rm ' + roomKeyDisplayLabel(nextSingle.room) + ')');
        chunks.push('<span class="next-available-single">' + escapeHtml(line) + '</span>');
    }
    if (chunks.length) {
        el.innerHTML = chunks.join('<span class="next-available-sep" aria-hidden="true"> | </span>');
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

const MOM_CR_COLLAPSED_KEY = 'mom_customer_requests_collapsed';

function isCustomerRequestsCollapsedPreferred() {
    try {
        return localStorage.getItem(MOM_CR_COLLAPSED_KEY) === '1';
    } catch (e) {
        return false;
    }
}

function setCustomerRequestsCollapsedPreferred(collapsed) {
    try {
        localStorage.setItem(MOM_CR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (e) {}
}

function updateCustomerRequestsToggleUI() {
    const panel = document.getElementById('customerRequestsPanel');
    const btn = document.getElementById('customerRequestsToggle');
    if (!panel || !btn) return;
    const collapsed = panel.classList.contains('collapsed');
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    const icon = btn.querySelector('.customer-requests-toggle-icon');
    if (icon) icon.textContent = collapsed ? '▶' : '▼';
    const expandT = uiT('customerRequests.expandTitle', 'Show requested therapist list');
    const collapseT = uiT('customerRequests.collapseTitle', 'Hide requested therapist list');
    btn.title = collapsed ? expandT : collapseT;
}

function applyCustomerRequestsCollapsedFromStorage() {
    const panel = document.getElementById('customerRequestsPanel');
    if (!panel || panel.style.display === 'none') return;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
        panel.classList.remove('collapsed');
    } else if (isCustomerRequestsCollapsedPreferred()) {
        panel.classList.add('collapsed');
    } else {
        panel.classList.remove('collapsed');
    }
    updateCustomerRequestsToggleUI();
}

function initCustomerRequestsPanelToggle() {
    const btn = document.getElementById('customerRequestsToggle');
    if (!btn || btn.dataset.momBound) return;
    btn.dataset.momBound = '1';
    btn.addEventListener('click', () => {
        const panel = document.getElementById('customerRequestsPanel');
        if (!panel) return;
        panel.classList.toggle('collapsed');
        setCustomerRequestsCollapsedPreferred(panel.classList.contains('collapsed'));
        updateCustomerRequestsToggleUI();
    });
}

/** Desktop: keep summary strip expanded. Phone: fold closed by default (widen → open; narrow → remove open). */
function syncMomPhoneSummariesDetailsLayout() {
    const d = document.getElementById('momPhoneSummariesDetails');
    if (!d) return;
    try {
        if (window.matchMedia('(max-width: 768px)').matches) {
            d.removeAttribute('open');
        } else {
            d.setAttribute('open', '');
        }
    } catch (_) {
        d.setAttribute('open', '');
    }
}

/** First word of therapist name for display (e.g. "May L" → "May"). */
function therapistFirstNameOnly(fullName) {
    if (!fullName || typeof fullName !== 'string') return fullName || '';
    const first = fullName.trim().split(/\s+/)[0] || '';
    return first.replace(/\.$/, '');
}

/** First letter of last token (e.g. "May L" → "L", "Hongxia Shaw" → "S"). */
function therapistLastNameInitial(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return '';
    const last = parts[parts.length - 1];
    const ch = last.charAt(0);
    return ch ? ch.toUpperCase() : '';
}

/** Staffing turn-order column: first name only; add last initial when duplicate first names within peer list. */
function therapistTurnOrderShortLabel(fullName, peerNames) {
    if (!fullName || typeof fullName !== 'string') return '';
    const fn = therapistFirstNameOnly(fullName);
    const dup = buildTherapistFirstNameDuplicates(peerNames || []);
    const firstKey = fn.toLowerCase();
    if ((dup[firstKey] || 0) <= 1) return fn;
    const li = therapistLastNameInitial(fullName);
    return li ? `${fn} ${li}` : fn;
}

/** When on, calendar cards show up to 3 letters of Square `original_therapist` first name as a light watermark. */
const MOM_SQUARE_ORI_CALENDAR_HINT_KEY = 'mom_square_ori_calendar_hint';

function isSquareOriCalendarHintOn() {
    try {
        return sessionStorage.getItem(MOM_SQUARE_ORI_CALENDAR_HINT_KEY) === '1';
    } catch (e) {
        return false;
    }
}

function setSquareOriCalendarHintOn(on) {
    try {
        if (on) sessionStorage.setItem(MOM_SQUARE_ORI_CALENDAR_HINT_KEY, '1');
        else sessionStorage.removeItem(MOM_SQUARE_ORI_CALENDAR_HINT_KEY);
    } catch (e) { /* ignore */ }
}

/** Up to 3 letters from Square original therapist first name (lowercase; empty if none). */
function squareOriginalTherapistFirstThreeLetters(appointment) {
    const raw = appointment && appointment.original_therapist != null
        ? String(appointment.original_therapist).trim()
        : '';
    if (!raw || raw === '—') return '';
    const fn = therapistFirstNameOnly(raw);
    const letters = fn.replace(/[^A-Za-z\u00C0-\u024f]/g, '');
    if (!letters) return '';
    return letters.slice(0, 3).toLowerCase();
}

/** Couple: partner full name from Square profile → check-in → note hint → last saved partner (day payload). */
function couplePartnerFullNameForDisplay(appointment) {
    const fromProfile = (appointment.customer_massage_together_with || '').trim();
    if (fromProfile) return fromProfile;
    const fromCheckin = (appointment.checkin_partner_name || '').trim();
    if (fromCheckin) return fromCheckin;
    const fromNotes = (appointment.suggested_partner_name || '').trim();
    if (fromNotes) return fromNotes;
    const cid = appointment.customer_id;
    if (cid && currentData && currentData.customer_last_partner && typeof currentData.customer_last_partner === 'object') {
        const lp = currentData.customer_last_partner[cid];
        if (lp != null && String(lp).trim()) return String(lp).trim();
    }
    return '';
}

/** Calendar card booker line: couple shows "Booker S. (& Partner)" using partner first name only. */
function calendarCustomerHeadlineShort(appointment) {
    const base = customerShortName(appointment.customer || '');
    if (String(appointment.type || '').toLowerCase() !== 'couple') return base;
    const partnerFull = couplePartnerFullNameForDisplay(appointment);
    if (!partnerFull) return base;
    const pFirst = therapistFirstNameOnly(partnerFull).toLowerCase();
    const cFirst = therapistFirstNameOnly(appointment.customer || '').toLowerCase();
    if (pFirst && cFirst && pFirst === cFirst) return base;
    const partnerShort = therapistFirstNameOnly(partnerFull);
    return `${base} (& ${partnerShort})`;
}

/**
 * Calendar column key vs event therapist string (Square may return "May", roster column is "May L").
 * Exact match, or same first name when one side is first-name-only — unless duplicate first names on roster.
 * @param {Record<string, number>} [dupFirstCounts] from buildTherapistFirstNameDuplicates(data.therapists)
 */
function therapistNamesMatchForCalendar(a, b, dupFirstCounts) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    const sa = String(a).trim().toLowerCase();
    const sb = String(b).trim().toLowerCase();
    if (sa === sb) return true;
    const pa = sa.split(/\s+/).filter(Boolean);
    const pb = sb.split(/\s+/).filter(Boolean);
    if (!pa.length || !pb.length) return false;
    if (pa[0] !== pb[0]) return false;
    if (pa.length === 1 || pb.length === 1) {
        const first = pa[0];
        if (dupFirstCounts && (dupFirstCounts[first] || 0) > 1) return false;
        return true;
    }
    return false;
}

/** Count how many names share each first name (for SRM dropdown labels). */
function buildTherapistFirstNameDuplicates(therapistNames) {
    const counts = {};
    for (const t of therapistNames || []) {
        if (!t || typeof t !== 'string' || !t.trim()) continue;
        const fn = therapistFirstNameOnly(t).toLowerCase();
        counts[fn] = (counts[fn] || 0) + 1;
    }
    return counts;
}

/** First name only in dropdown unless two therapists share that first name — then show full name. */
function therapistSelectOptionLabel(fullName, duplicateCounts) {
    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) return '';
    const fn = therapistFirstNameOnly(fullName);
    const key = fn.toLowerCase();
    if ((duplicateCounts[key] || 0) <= 1) return fn;
    return fullName.trim();
}

/** Options for check-in / checkout SRM selects: value = full name (API), label = disambiguated display. */
function therapistOptionsFor(therapists, current, massageAvailableOrdered, includeLeadingBlank = false) {
    const set = new Set((therapists || []).map((t) => String(t).trim()).filter(Boolean));
    if (current && String(current).trim() && !set.has(String(current).trim())) set.add(String(current).trim());
    let allNames = [...set];
    const dup = buildTherapistFirstNameDuplicates(allNames);
    if (massageAvailableOrdered && massageAvailableOrdered.length) {
        const filtered = allNames.filter((t) => {
            const tl = String(t).toLowerCase();
            if (tl === 'staff') return true;
            return rosterInMassageAvailabilityOrdered(t, massageAvailableOrdered, dup);
        });
        if (filtered.length) allNames = filtered;
    }
    const blankOpt = includeLeadingBlank
        ? `<option value="">${escapeHtml(uiT('checkin.therapistPlaceholder', '—'))}</option>`
        : '';
    return blankOpt + allNames.map(t =>
        `<option value="${escapeHtml(t)}">${escapeHtml(therapistSelectOptionLabel(t, dup))}</option>`
    ).join('');
}

/** True when name matches someone checked as massage staff today (saved pick / popover order). */
function rosterInMassageAvailabilityOrdered(name, availableOrdered, dup) {
    if (!name || isSlotTherapistUnset(name)) return false;
    if (!availableOrdered || !availableOrdered.length) return true;
    return availableOrdered.some((a) => therapistNamesMatchForCalendar(a, name, dup));
}

/** Intersect calendar therapist-order pool with “available today” list, preserving turn order. */
function massageStaffPoolInTurnOrder(therapistOrderPool, availableOrdered, dup) {
    if (!therapistOrderPool || !therapistOrderPool.length) return [];
    if (!availableOrdered || !availableOrdered.length) return therapistOrderPool.slice();
    const out = [];
    const seen = new Set();
    for (const a of availableOrdered) {
        const hit = therapistOrderPool.find((p) => therapistNamesMatchForCalendar(p, a, dup));
        if (hit && !seen.has(hit.toLowerCase())) {
            seen.add(hit.toLowerCase());
            out.push(hit);
        }
    }
    return out.length ? out : therapistOrderPool.slice();
}

/** True when assigned masseuse (SRM 1) is Staff — treat like "any available" for display and requested-therapist bar. */
function isAssignedTherapistStaff(e) {
    if (!e) return false;
    const t = String(e.therapist || '').trim().toLowerCase();
    return t === 'staff';
}

/** True when slot has no real masseuse (empty or Staff placeholder). */
function isSlotTherapistUnset(val) {
    const t = String(val || '').trim().toLowerCase();
    return !t || t === 'staff';
}

function isBookedByCustomerOrUs(ev) {
    const b = (ev && ev.booked_by || '').toLowerCase();
    return b === 'customer' || b === 'us';
}

/** Square booking created by the customer (online / buyer) — same gate as the requested-masseuse summary bar. */
function customerBookedOnline(ev) {
    return (ev && String(ev.booked_by || '').trim().toLowerCase()) === 'customer';
}

function findTherapistByFirstName(therapists, firstName) {
    if (!therapists || !firstName) return '';
    const want = String(firstName).trim().toLowerCase();
    for (const t of therapists) {
        if (therapistFirstNameOnly(String(t)).toLowerCase() === want) return String(t).trim();
    }
    return '';
}

/** Default masseuse when slot is unset and booking is by customer/us (Cassey = our convention). */
function checkinDefaultCasseyFullName(therapists) {
    return findTherapistByFirstName(therapists || [], 'Cassey');
}

/**
 * Display value for SRM selects: prefer {@link buildCheckinSliceSlotDisplayMap} (shared “used” set per time slice).
 * Otherwise canonical roster string for the raw field.
 * @param {{ noteIdx?: object, checkinBlankNonRequested?: boolean }} [extra] When checkinBlankNonRequested, customer/us
 *   bookings show a masseuse only if that name matches a customer-requested highlight (same as calendar intent chips / bar).
 */
function effectiveCheckinTherapistDisplay(ev, slot, therapists, crItems, dup, slotDisplayMap, sliceItems, massageAvailableOrdered, extra) {
    const key = `${ev.booking_id || ''}:${slot}`;
    let display = '';
    if (slotDisplayMap && slotDisplayMap.has(key)) {
        const v = slotDisplayMap.get(key);
        display = v != null ? String(v) : '';
    } else {
        const raw = slot === 2 ? (ev.therapist_2 || '') : (ev.therapist || '');
        const dupAvail = dup || buildTherapistFirstNameDuplicates(therapists);
        display = canonicalTherapistOnSlice(raw, therapists, dupAvail) || String(raw || '').trim();
    }
    const checkinBlank = !!(extra && extra.checkinBlankNonRequested);
    if (!checkinBlank) return display;
    if (!display || isSlotTherapistUnset(display)) return '';
    const locked = (slot === 2) ? (ev.therapist_locked_2 === true) : (ev.therapist_locked === true);
    if (locked) return display;
    const noteIdxSafe = (extra && extra.noteIdx != null) ? extra.noteIdx : getMomCustomerRequestMatchContext().noteIdx;
    const massageOrd = massageAvailableOrdered;
    if (String(ev.type || '').toLowerCase() === 'couple' && slot === 2) {
        const sec = coupleSlot2CustomerRequestedCanonical(ev, therapists, dup, crItems, massageOrd);
        if (sec && therapistNamesMatchForCalendar(display, sec, dup)) return display;
        return '';
    }
    if (!checkinTherapistMatchesCustomerRequestHighlight(display, ev, therapists, dup, noteIdxSafe, crItems)) return '';
    return display;
}

/** Massage assignments for this roster on dayStr strictly before the check-in time column (excludes this :00 / :30 row). */
function massageAssignmentCountBeforeCheckinSlot(rosterName, events, dateStr, timeStr, therapists, dup) {
    if (!rosterName || !events || !dateStr || !timeStr) return 0;
    const slotMs = new Date(`${dateStr}T${timeStr}:00`).getTime();
    if (!Number.isFinite(slotMs)) return 0;
    let n = 0;
    for (const ev of events) {
        if (!ev || !eventIsOnStaffingCalendarDay(ev, dateStr)) continue;
        if ((ev.room || '').trim() === 'ADDON') continue;
        const st = new Date(ev.start_at).getTime();
        if (!Number.isFinite(st) || st >= slotMs) continue;
        const slot1 = canonicalTherapistOnSlice(ev.therapist, therapists, dup);
        const slot2 = canonicalTherapistOnSlice(ev.therapist_2, therapists, dup);
        const m1 = slot1 && therapistNamesMatchForCalendar(rosterName, slot1, dup);
        const m2 = slot2 && therapistNamesMatchForCalendar(rosterName, slot2, dup);
        if (m1) n++;
        if (m2) n++;
    }
    return n;
}

/** Earliest start (ms) strictly after slotMs where this roster is on the customer-request summary for the booking. */
function nextRequestedMassageStartMsForRosterAfter(rosterName, events, dateStr, slotMs, dup, crItems) {
    if (!rosterName || !events || !Number.isFinite(slotMs)) return null;
    let best = null;
    for (const ev of events) {
        if (!ev || !eventIsOnStaffingCalendarDay(ev, dateStr)) continue;
        if ((ev.room || '').trim() === 'ADDON') continue;
        const st = new Date(ev.start_at).getTime();
        if (!Number.isFinite(st) || st <= slotMs) continue;
        if (!eventHasCustomerRequestLineForRoster(rosterName, ev, dup, crItems || [])) continue;
        if (best == null || st < best) best = st;
    }
    return best;
}

/**
 * @returns {{ neededSlots: number, latestPoolNeedEndMs: number, poolSlotEndMsList: number[], assignOrder: { fullName: string, assignable: boolean, conflictLabel: string }[], displayNames: { html: string, assignable: boolean }[] }}
 */
function buildCheckinStaffPoolStripPayload(dateStr, timeStr, items, events, therapists, therapistOrder, massageAvailOrdered, dup, crItems, noteIdx, slotDisplayMapNoPool) {
    const empty = () => ({
        neededSlots: 0,
        latestPoolNeedEndMs: 0,
        poolSlotEndMsList: [],
        assignOrder: [],
        displayNames: [],
    });
    if (!dateStr || !timeStr || !items || !items.length) return empty();
    const slotMs = new Date(`${dateStr}T${timeStr}:00`).getTime();
    if (!Number.isFinite(slotMs)) return empty();
    const extra = { noteIdx, checkinBlankNonRequested: true };
    let neededSlots = 0;
    let latestPoolNeedEndMs = 0;
    const poolSlotEndMsList = [];
    function slotRaw(ev, slot) {
        return slot === 2 ? (ev.therapist_2 || '') : (ev.therapist || '');
    }
    function slotLocked(ev, slot) {
        return slot === 2 ? (ev.therapist_locked_2 === true) : (ev.therapist_locked === true);
    }
    function slotIsRequested(ev, slot) {
        const raw = String(slotRaw(ev, slot) || '').trim();
        if (!raw || isSlotTherapistUnset(raw)) return false;
        const canon = canonicalTherapistOnSlice(raw, therapists, dup) || raw;
        if (!canon || isSlotTherapistUnset(canon)) return false;
        if (String(ev.type || '').toLowerCase() === 'couple' && slot === 2) {
            const sec = coupleSlot2CustomerRequestedCanonical(ev, therapists, dup, crItems, massageAvailOrdered);
            return !!(sec && therapistNamesMatchForCalendar(canon, sec, dup));
        }
        return checkinTherapistMatchesCustomerRequestHighlight(canon, ev, therapists, dup, noteIdx, crItems);
    }
    function slotServiceEndMs(ev) {
        const sm = new Date(ev.start_at).getTime();
        const durMin = getDurationMinutes(ev);
        if (!Number.isFinite(sm) || durMin <= 0) return null;
        return sm + durMin * 60000;
    }
    const countSlot = (ev, slot) => {
        // "Open slots" means not customer-requested (blue/shaded-blue), even if a desk-picked masseuse is already selected.
        if (slotIsRequested(ev, slot)) return;
        neededSlots += 1;
        const endMs = slotServiceEndMs(ev);
        if (endMs != null) {
            latestPoolNeedEndMs = Math.max(latestPoolNeedEndMs, endMs);
            poolSlotEndMsList.push(endMs);
        }
    };
    for (const ev of items) {
        if (!ev) continue;
        if ((ev.room || '').trim() === 'ADDON') continue;
        const couple = String(ev.type || '').toLowerCase() === 'couple';
        const split = ev.split_minutes_first != null;
        if (couple) {
            countSlot(ev, 1);
            countSlot(ev, 2);
        } else {
            countSlot(ev, 1);
            if (split) countSlot(ev, 2);
        }
    }
    if (!neededSlots) {
        return { neededSlots: 0, latestPoolNeedEndMs: 0, poolSlotEndMsList: [], assignOrder: [], displayNames: [] };
    }
    const poolFull = buildTherapistPoolByStaffOrder(therapists, therapistOrder);
    const pool = massageStaffPoolInTurnOrder(poolFull, massageAvailOrdered, dup);
    if (!pool.length) {
        return { neededSlots, latestPoolNeedEndMs, poolSlotEndMsList, assignOrder: [], displayNames: [] };
    }
    const poolIdx = new Map();
    pool.forEach((p, i) => poolIdx.set(String(p).trim().toLowerCase(), i));
    const sorted = pool.slice().sort((a, b) => {
        const ca = massageAssignmentCountBeforeCheckinSlot(a, events, dateStr, timeStr, therapists, dup);
        const cb = massageAssignmentCountBeforeCheckinSlot(b, events, dateStr, timeStr, therapists, dup);
        if (ca !== cb) return ca - cb;
        const ia = poolIdx.get(String(a).trim().toLowerCase()) ?? 9999;
        const ib = poolIdx.get(String(b).trim().toLowerCase()) ?? 9999;
        return ia - ib;
    });
    /** Already on a customer-requested slot this slice (e.g. Cassey for Andre) — not open pool capacity. */
    const reservedByRequestedThisSlice = new Set();
    for (const ev of items) {
        if (!ev || (ev.room || '').trim() === 'ADDON') continue;
        const couple = String(ev.type || '').toLowerCase() === 'couple';
        const split = ev.split_minutes_first != null;
        const pushIfRequested = (slot) => {
            if (!slotIsRequested(ev, slot)) return;
            const raw = String(slotRaw(ev, slot) || '').trim();
            if (!raw || isSlotTherapistUnset(raw)) return;
            const canon = canonicalTherapistOnSlice(raw, therapists, dup) || raw;
            if (canon && !isSlotTherapistUnset(canon)) reservedByRequestedThisSlice.add(canon.trim().toLowerCase());
        };
        pushIfRequested(1);
        if (couple || split) pushIfRequested(2);
    }
    const sortedForOpen = sorted.filter((name) => !reservedByRequestedThisSlice.has(String(name).trim().toLowerCase()));
    const rosterFitsSomeOpenPoolSlot = (nextMs) => {
        if (nextMs == null) return true;
        if (!poolSlotEndMsList.length) return true;
        return poolSlotEndMsList.some((endMs) => endMs <= nextMs);
    };
    const assignOrder = sortedForOpen.map((fullName) => {
        const nextMs = nextRequestedMassageStartMsForRosterAfter(fullName, events, dateStr, slotMs, dup, crItems);
        const assignable = rosterFitsSomeOpenPoolSlot(nextMs);
        let conflictLabel = '';
        if (!assignable) {
            const tlab = nextMs != null ? formatTimeCompactUS(new Date(nextMs)) : '';
            if (tlab) conflictLabel = ` (${tlab})`;
        }
        return { fullName, assignable, conflictLabel };
    });
    /** Strip: prefer masseuses who can cover at least one open slot (service end ≤ next requested); then grey fill. */
    const stripChosen = [];
    const stripSeen = new Set();
    function pushStrip(fullName, assignable) {
        const k = String(fullName || '').trim().toLowerCase();
        if (!k || stripSeen.has(k)) return;
        stripSeen.add(k);
        stripChosen.push({ fullName, assignable });
    }
    for (const fullName of sortedForOpen) {
        if (stripChosen.length >= neededSlots) break;
        const nextMs = nextRequestedMassageStartMsForRosterAfter(fullName, events, dateStr, slotMs, dup, crItems);
        if (rosterFitsSomeOpenPoolSlot(nextMs)) pushStrip(fullName, true);
    }
    for (const fullName of sortedForOpen) {
        if (stripChosen.length >= neededSlots) break;
        const nextMs = nextRequestedMassageStartMsForRosterAfter(fullName, events, dateStr, slotMs, dup, crItems);
        if (rosterFitsSomeOpenPoolSlot(nextMs)) continue;
        pushStrip(fullName, false);
    }
    const peerNames = stripChosen.map((x) => x.fullName);
    const displayNames = stripChosen.map(({ fullName, assignable }) => {
        const nextMs = nextRequestedMassageStartMsForRosterAfter(fullName, events, dateStr, slotMs, dup, crItems);
        const short = escapeHtml(therapistTurnOrderShortLabel(fullName, peerNames));
        const tlab = nextMs != null ? formatTimeCompactUS(new Date(nextMs)) : '';
        const suffix = tlab ? ` <span class="checkin-staff-pool-conflict">(${escapeHtml(tlab)})</span>` : '';
        const cls = assignable ? '' : ' checkin-staff-pool-name--conflict';
        return { html: `<span class="checkin-staff-pool-name${cls}">${short}${suffix}</span>`, assignable };
    });
    return { neededSlots, latestPoolNeedEndMs, poolSlotEndMsList, assignOrder, displayNames };
}

function collectUsedTherapistsInCheckinList(listEl, therapists, dup) {
    const used = new Set();
    if (!listEl) return used;
    listEl.querySelectorAll('.checkin-therapist-select').forEach((sel) => {
        const v = String(sel.value || '').trim();
        if (!v || isSlotTherapistUnset(v)) return;
        const c = canonicalTherapistOnSlice(v, therapists, dup);
        if (c) used.add(c.toLowerCase());
    });
    return used;
}

function pickNextAssignableFromCheckinStrip(assignOrder, usedLower) {
    if (!assignOrder || !assignOrder.length) return '';
    for (const row of assignOrder) {
        if (!row.assignable) continue;
        const k = String(row.fullName || '').trim().toLowerCase();
        if (!k || usedLower.has(k)) continue;
        return row.fullName;
    }
    return '';
}

function mountCheckinStaffPoolStrip(payload) {
    const strip = document.getElementById('checkinStaffPoolStrip');
    if (!strip) return;
    const inner = strip.querySelector('.checkin-staff-pool-strip-inner');
    if (!inner) return;
    if (!payload || !payload.displayNames || !payload.displayNames.length) {
        strip.style.display = 'none';
        inner.innerHTML = '';
        return;
    }
    strip.style.display = '';
    const label = escapeHtml(uiT('checkin.staffPoolLabel', 'Masseuse Pool:'));
    inner.innerHTML =
        '<span class="checkin-staff-pool-label">' + label + '</span> ' +
        payload.displayNames.map((d) => d.html).join('<span class="checkin-staff-pool-sep"> · </span>');
}

/** True after client checked in or appointment start time has passed (massage may be in progress). */
function checkinMassageInProgress(ev) {
    if (!ev) return false;
    if (ev.arrived_at_1) return true;
    if (ev.start_at) {
        const startMs = new Date(ev.start_at).getTime();
        if (!Number.isNaN(startMs) && Date.now() >= startMs) return true;
    }
    return false;
}

/** Square "any available" OR user chose Staff in the masseuse dropdown (same UX as any available). */
function customerAnyAvailEffective(apt) {
    return !!(apt && apt.original_any_available) || isAssignedTherapistStaff(apt);
}

/**
 * Massage "Later" with calendar assignment: requested-therapist summary lists this roster for the booking and they
 * appear on therapist / therapist_2. Used for check-in paths; staffing "Booked later" counts use the broader
 * staffingFutureMassageRequestedSlotCount so they stay aligned with the customer-request bar.
 */
function staffingLaterMassageRequestedThisRoster(rosterName, ev, dup, crItems) {
    if (!ev || !rosterName) return false;
    if (!eventHasCustomerRequestLineForRoster(rosterName, ev, dup, crItems)) return false;
    return therapistNamesMatchForCalendar(rosterName, ev.therapist, dup)
        || therapistNamesMatchForCalendar(rosterName, ev.therapist_2, dup);
}

/**
 * Massage future slots for this roster for staffing counts / tooltips: matches the requested-therapist bar.
 * Counts assigned therapist / therapist_2 slots that match; if none match, uses the same cap as
 * massagePastExtraSlotCountForRoster (summary lists this roster but masseuse slots are Staff/other).
 */
function staffingFutureMassageRequestedSlotCount(rosterName, ev, dup, crItems) {
    if (!ev || !rosterName || !crItems || !crItems.length) return 0;
    if (!eventHasCustomerRequestLineForRoster(rosterName, ev, dup, crItems)) return 0;
    let n = 0;
    if (therapistNamesMatchForCalendar(rosterName, ev.therapist, dup)) n++;
    if (therapistNamesMatchForCalendar(rosterName, ev.therapist_2, dup)) n++;
    if (n > 0) return n;
    const bid = String(ev.booking_id || '');
    let reqN = 0;
    for (let i = 0; i < crItems.length; i++) {
        const it = crItems[i];
        if (String(it.booking_id || '') !== bid) continue;
        if (therapistNamesMatchForCalendar(rosterName, it.requested_masseuse, dup)) reqN++;
    }
    const maxSlots = String(ev.type || '').toLowerCase() === 'couple' ? 2 : 1;
    return Math.min(maxSlots, reqN);
}

/** Same person as Square original request (suppress note matches when Staff is assigned). */
function therapistsNameMatchesOriginalRequest(fullName, originalTherapist) {
    if (!fullName || !originalTherapist) return false;
    if (String(fullName).trim().toLowerCase() === String(originalTherapist).trim().toLowerCase()) return true;
    return therapistFirstNameOnly(fullName).toLowerCase() === therapistFirstNameOnly(String(originalTherapist)).toLowerCase();
}

/** US locale time without space before AM/PM, e.g. 4:30PM. On the hour: 4PM not 4:00PM. Accepts Date or ISO string. */
function formatTimeCompactUS(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return '';
    const s = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return s.replace(/\s+(AM|PM)/i, '$1').replace(/:00(?=[AP]M)/i, '');
}

/** 12-hour clock fragment without AM/PM (:00 omitted on the hour). */
function formatClock12NoMeridiem(h24, min) {
    let h = h24 % 12;
    if (h === 0) h = 12;
    if (min === 0) return String(h);
    return h + ':' + String(min).padStart(2, '0');
}

/**
 * Compact time range: if both times are AM or both PM → "4:30-7PM" (meridiem once; :00 omitted on the hour).
 * If span crosses noon/midnight → "11:30AM-1PM".
 */
function formatTimeRangeSmart(startIsoOrDate, endIsoOrDate) {
    const s = startIsoOrDate instanceof Date ? startIsoOrDate : new Date(startIsoOrDate);
    const e = endIsoOrDate instanceof Date ? endIsoOrDate : new Date(endIsoOrDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
    const sh = s.getHours();
    const eh = e.getHours();
    const sm = s.getMinutes();
    const em = e.getMinutes();
    const sIsAm = sh < 12;
    const eIsAm = eh < 12;
    if (sIsAm === eIsAm) {
        const mer = sh >= 12 ? 'PM' : 'AM';
        return formatClock12NoMeridiem(sh, sm) + '-' + formatClock12NoMeridiem(eh, em) + mer;
    }
    const merS = sh >= 12 ? 'PM' : 'AM';
    const merE = eh >= 12 ? 'PM' : 'AM';
    return formatClock12NoMeridiem(sh, sm) + merS + '-' + formatClock12NoMeridiem(eh, em) + merE;
}

/** Calendar sandwich card: start–end without AM/PM, e.g. "2:30-3:30". */
function formatTimeRangeNoAmPm(startIsoOrDate, endIsoOrDate) {
    const s = startIsoOrDate instanceof Date ? startIsoOrDate : new Date(startIsoOrDate);
    const e = endIsoOrDate instanceof Date ? endIsoOrDate : new Date(endIsoOrDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
    return formatClock12NoMeridiem(s.getHours(), s.getMinutes()) + '-' + formatClock12NoMeridiem(e.getHours(), e.getMinutes());
}

/**
 * Shorten service labels for sandwich cards:
 * Deep Tissue Massage → Deep Tissue; Swedish Massage → Swedish; Trigger Point Therapy → Trigger Point.
 */
function calendarShortenServiceNameForSandwich(name) {
    let s = String(name || '').trim();
    if (!s) return '';
    s = s.replace(/\bdeep\s+tissue\s+massage\b/gi, 'Deep Tissue');
    s = s.replace(/\bswedish\s+massage\b/gi, 'Swedish');
    s = s.replace(/\btrigger\s+point\s+therapy\b/gi, 'Trigger Point');
    return s.replace(/\s{2,}/g, ' ').trim();
}

/** Minutes advertised in a Square segment title, e.g. "60 Minute Deep Tissue" → 60. */
function calendarParseServiceSegmentDurationMinutes(segment) {
    const s = String(segment || '').trim();
    if (!s) return null;
    const patterns = [
        /\b(\d{1,3})\s*(?:minutes?|mins?|min\.?)\b/i,
        /\b(\d{1,3})\s*分钟\b/,
    ];
    for (const pat of patterns) {
        const m = s.match(pat);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n >= 15 && n <= 240) return n;
        }
    }
    const sl = s.toLowerCase();
    if (/\b1\.5\s*[-\u2013]?\s*(?:h|hr|hour|hours)\b/.test(sl)) return 90;
    if (/\b2\s*[-\u2013]?\s*(?:h|hr|hour|hours)\b/.test(sl)) return 120;
    return null;
}

function calendarStripDurationWordsFromServiceName(name) {
    return String(name || '')
        .replace(/\b\d{1,3}\s*(?:minutes?|mins?|min\.?)\b/gi, ' ')
        .replace(/\b\d{1,3}\s*分钟\b/g, ' ')
        .replace(/\b1\.5\s*[-\u2013]?\s*(?:h|hr|hour|hours)\b/gi, ' ')
        .replace(/\b2\s*[-\u2013]?\s*(?:h|hr|hour|hours)\b/gi, ' ')
        .replace(/\s*[·•]\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Split Square multi-service strings into raw segments (keep original titles for duration parse).
 * "60 Minute Deep Tissue Massage, 30 Minute Trigger Point Therapy" → two segments.
 */
function calendarRawServiceSegmentsForSandwich(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const out = [];
    for (const line of raw.split(/\n+/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^couples?\s*·/i.test(trimmed) || /情侣/.test(trimmed)) {
            out.push(trimmed);
            continue;
        }
        const protectedLine = trimmed
            .replace(/\bdeep\s+tissue\s+massage\b/gi, '<<<DEEP_TISSUE_MASSAGE>>>')
            .replace(/\bdeep\s+tissue\b/gi, '<<<DEEP_TISSUE>>>')
            .replace(/\bswedish\s+massage\b/gi, '<<<SWEDISH_MASSAGE>>>')
            .replace(/\btrigger\s+point\s+therapy\b/gi, '<<<TRIGGER_POINT_THERAPY>>>')
            .replace(/\btrigger\s+point\b/gi, '<<<TRIGGER_POINT>>>');
        const parts = protectedLine.split(/\s*[,;]\s*|\s*[·•]\s*/).map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
            out.push(
                p
                    .replace(/<<<DEEP_TISSUE_MASSAGE>>>/g, 'Deep Tissue Massage')
                    .replace(/<<<DEEP_TISSUE>>>/g, 'Deep Tissue')
                    .replace(/<<<SWEDISH_MASSAGE>>>/g, 'Swedish Massage')
                    .replace(/<<<TRIGGER_POINT_THERAPY>>>/g, 'Trigger Point Therapy')
                    .replace(/<<<TRIGGER_POINT>>>/g, 'Trigger Point')
            );
        }
    }
    return out;
}

/** Add-ons that must not get a duration prefix (cupping, oils, etc.). */
function calendarServiceIsAddonOnlyLine(name) {
    const t = String(name || '').toLowerCase();
    if (!t) return false;
    if (/\b(?:air|fire)?\s*cupping\b/.test(t) || /\bcupping\b/.test(t)) return true;
    if (/\bpain\s+relief\s+oil\b/.test(t) || /舒缓精油/.test(t)) return true;
    if (/\baromatherapy\b/.test(t) || /\blavender\b/.test(t) || /\bcream\b/.test(t)) return true;
    if (/\bcollagen\b/.test(t) || /\bsocks?\b/.test(t) || /\bgloves?\b/.test(t)) return true;
    return false;
}

/** True if this catalog line is a 3 Senses package (keep on couple cards). */
function calendarServiceIs3SensesLine(name) {
    const t = String(name || '').toLowerCase();
    if (!t) return false;
    return /\b3\s*senses\b/.test(t) || /\bthree\s*senses\b/.test(t) || /三感/.test(t);
}

/**
 * Couple sandwich: keep price + "3 Senses" wording when present (e.g. "$99 3 Senses").
 */
function calendarFormat3SensesSandwichLabel(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const priceM = s.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
    const price = priceM ? `$${priceM[1]}` : '';
    const label = /三感/.test(s) && !/\b3\s*senses\b/i.test(s) && !/\bthree\s*senses\b/i.test(s)
        ? '三感'
        : '3 Senses';
    return price ? `${price} ${label}` : label;
}

/** Extra couple-card lines: only 3 Senses (from segments or joined service text). */
function calendarCoupleSandwichExtraLines(serviceDisplayStr, serviceSegments) {
    const seen = new Set();
    const out = [];
    const pushRaw = (raw) => {
        if (!calendarServiceIs3SensesLine(raw)) return;
        const line = calendarFormat3SensesSandwichLabel(raw);
        if (!line) return;
        const key = line.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(line);
    };
    const segs = Array.isArray(serviceSegments) ? serviceSegments : [];
    for (const seg of segs) {
        pushRaw((seg && seg.name) || '');
    }
    if (!out.length) {
        for (const part of calendarRawServiceSegmentsForSandwich(serviceDisplayStr)) {
            pushRaw(part);
        }
    }
    if (!out.length && calendarServiceIs3SensesLine(serviceDisplayStr)) {
        pushRaw(serviceDisplayStr);
    }
    return out;
}

/**
 * Prefer API service_segments (Square segment duration_minutes).
 * Fallback: parse durations embedded in joined catalog titles.
 */
function calendarParsedSandwichServices(serviceDisplayStr, serviceSegments) {
    const isDurOnly = (l) =>
        /^(?:\d+)\s*(?:min(?:ute)?s?|分钟|分)\s*$/i.test(l) ||
        /^\d+h(?:\s+\d+m)?\s*$/i.test(l);
    const isCoupleLabel = (l) =>
        /^couples?\b/i.test(l) ||
        /^couples?\s*·/i.test(l) ||
        /情侣/.test(l);

    const fromApi = Array.isArray(serviceSegments) ? serviceSegments : [];
    if (fromApi.length) {
        const parsed = [];
        for (const seg of fromApi) {
            const rawName = String((seg && seg.name) || '').trim();
            if (!rawName) continue;
            const titleDur = calendarParseServiceSegmentDurationMinutes(rawName);
            let segDur = null;
            const apiDur = seg && seg.duration_minutes != null ? parseInt(seg.duration_minutes, 10) : NaN;
            if (Number.isFinite(apiDur) && apiDur >= 5 && apiDur <= 240) segDur = apiDur;
            else if (titleDur != null) segDur = titleDur;
            let label = calendarStripDurationWordsFromServiceName(rawName);
            label = label.replace(/^couples?\s*/i, '').replace(/情侣\s*/g, '').trim();
            label = calendarShortenServiceNameForSandwich(uiCatalogLine(label));
            if (!label) continue;
            const isAddon = !!(seg && seg.is_addon) ||
                calendarServiceIsAddonOnlyLine(label) ||
                calendarServiceIsAddonOnlyLine(rawName);
            parsed.push({ label, segDur, isAddon });
        }
        if (parsed.length) return parsed;
    }

    const segments = calendarRawServiceSegmentsForSandwich(serviceDisplayStr);
    const parsed = [];
    for (const seg of segments) {
        if (isDurOnly(seg) || isCoupleLabel(seg)) continue;
        const segDur = calendarParseServiceSegmentDurationMinutes(seg);
        let label = calendarStripDurationWordsFromServiceName(seg);
        label = label.replace(/^couples?\s*/i, '').replace(/情侣\s*/g, '').trim();
        label = calendarShortenServiceNameForSandwich(label);
        if (!label) continue;
        parsed.push({
            label,
            segDur,
            isAddon: calendarServiceIsAddonOnlyLine(label) || calendarServiceIsAddonOnlyLine(seg),
        });
    }
    return parsed;
}

/**
 * Sandwich lines with per-segment Square durations
 * (e.g. Julie: "60 min Deep Tissue" + "30 min Trigger Point"), not the full block length on every line.
 */
function calendarSandwichServiceLinesWithDurationHtml(serviceDisplayStr, durStr, isCouple, serviceSegments) {
    const couplesHead = uiT('calendar.couplesShort', 'Couples');
    const parsed = calendarParsedSandwichServices(serviceDisplayStr, serviceSegments);

    let lines;
    if (isCouple) {
        /* Couples card: only "{dur} Couples" + optional "$99 3 Senses" — drop massage/addon lines */
        lines = [`${durStr} ${couplesHead}`];
        for (const extra of calendarCoupleSandwichExtraLines(serviceDisplayStr, serviceSegments)) {
            lines.push(extra);
        }
    } else if (parsed.length) {
        const mainWithDur = parsed.filter((p) => !p.isAddon && p.segDur != null);
        const mainWithoutDur = parsed.filter((p) => !p.isAddon && p.segDur == null);
        /* If Square gave segment minutes for every main service, never fall back to full block length */
        const useApiDurations = mainWithDur.length > 0 && mainWithoutDur.length === 0;
        let fallbackPrimaryUsed = false;
        lines = parsed.map((p) => {
            if (p.isAddon) return p.label;
            if (p.segDur != null) return `${p.segDur} min ${p.label}`;
            if (useApiDurations) return p.label;
            /* No minutes from Square: use appointment duration only once for first main service */
            if (!fallbackPrimaryUsed) {
                fallbackPrimaryUsed = true;
                return `${durStr} ${p.label}`;
            }
            return p.label;
        });
    } else {
        const fallback = calendarShortenServiceNameForSandwich(
            calendarStripDurationWordsFromServiceName(String(serviceDisplayStr || '').replace(/\n+/g, ' '))
        ) || '—';
        lines = [`${durStr} ${fallback}`];
    }

    return lines
        .map((line) => {
            const safe = escapeHtml(line)
                .replace(/Deep Tissue/g, 'Deep&nbsp;Tissue')
                .replace(/Trigger Point/g, 'Trigger&nbsp;Point');
            return `<span class="appointment-service-line">${safe}</span>`;
        })
        .join('');
}

/** Fixed chip style matching Jenny (requested-masseuse chips on calendar cards). */
function masseuseRequestedChipStyleJenny() {
    return masseuseChipInlineStyleCalendarName('Jenny');
}

/** FNV-1a 32-bit — stable hash for per-masseuse chip styling. */
function fnv1a32(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/**
 * HSL chip from hash so every name gets a clearly different hue (fixed palette had many near-duplicate blues).
 * Same full name → same colors every day.
 */
function masseuseChipInlineStyle(fullName) {
    const key = (fullName || '').trim().toLowerCase();
    if (!key) {
        return 'background:linear-gradient(180deg,#f5f5f5 0%,#ececec 100%);border:1px solid #bdbdbd;box-shadow:0 1px 2px rgba(0,0,0,0.05);';
    }
    const h = fnv1a32(key);
    const h2 = fnv1a32(key + '\0chip');
    const mixed = (h ^ (h >>> 16) ^ (h2 >>> 8)) >>> 0;
    const hue = mixed % 360;
    const sat = 40 + (h2 % 16);
    const satBorder = Math.min(82, sat + 22);
    const lightTop = 91 + (h2 >>> 8) % 5;
    const lightBot = lightTop - 2;
    const borderL = 38 + (h2 >>> 16) % 14;
    return `background:linear-gradient(180deg,hsl(${hue},${sat}%,${lightTop}%) 0%,hsl(${hue},${sat}%,${lightBot}%) 100%);border:2px solid hsl(${hue},${satBorder}%,${borderL}%);box-shadow:0 1px 2px rgba(0,0,0,0.06);`;
}

/**
 * Same HSL identity as masseuseChipInlineStyle; minimal padding/border for calendar headline
 * (customer-requested name chip, “By us” 📞 + name chips) so blocks stay compact.
 */
function masseuseChipInlineStyleCalendarName(fullName) {
    const key = (fullName || '').trim().toLowerCase();
    if (!key) {
        return 'background:linear-gradient(180deg,#f5f5f5 0%,#ececec 100%);border:1px solid #bdbdbd;box-shadow:none;';
    }
    const h = fnv1a32(key);
    const h2 = fnv1a32(key + '\0chip');
    const mixed = (h ^ (h >>> 16) ^ (h2 >>> 8)) >>> 0;
    const hue = mixed % 360;
    const sat = 40 + (h2 % 16);
    const satBorder = Math.min(82, sat + 22);
    const lightTop = 91 + (h2 >>> 8) % 5;
    const lightBot = lightTop - 2;
    const borderL = 38 + (h2 >>> 16) % 14;
    return `background:linear-gradient(180deg,hsl(${hue},${sat}%,${lightTop}%) 0%,hsl(${hue},${sat}%,${lightBot}%) 100%);border:1px solid hsl(${hue},${satBorder}%,${borderL}%);box-shadow:none;`;
}

/** Inline “By us” name pills — same as calendar name chip (tight). */
function masseuseChipInlineStyleCompact(fullName) {
    return masseuseChipInlineStyleCalendarName(fullName);
}

/** Customer-request suffix on intent chips removed (avoid registered-mark symbol). Chip text and titles still show names. */
function calendarMasseuseRequestedMarkHtml(_fullName, _appointment, _therapists, _dup, _noteIdx) {
    return '';
}

/**
 * True when this full roster name matches a Square / note–driven customer request for that therapist
 * (Square named request, customer/add-on notes if booked by customer, or seller notes when booked by customer).
 */
function calendarMasseuseChipCustomerRequested(fullName, appointment, therapists, dup, noteIdx) {
    if (!appointment || !fullName) return false;
    const bookedBy = appointment.booked_by;
    const anyAvail = customerAnyAvailEffective(appointment);
    const oriFull = (appointment.original_therapist || '').trim();
    if (bookedBy === 'customer' && !anyAvail && oriFull && oriFull !== '—') {
        if (therapistNamesMatchForCalendar(fullName, oriFull, dup)) return true;
    }
    const sellerText = (appointment.seller_note || '').trim();
    const custAddonText = [appointment.customer_note, appointment.addon_note].filter(Boolean).join('\n');
    const fromCustAddon = matchTherapistFirstNamesInNoteText(custAddonText, noteIdx);
    for (const f of fromCustAddon) {
        if (therapistNamesMatchForCalendar(fullName, f, dup)) return bookedBy === 'customer';
    }
    if (bookedBy === 'customer') {
        const fromSeller = matchTherapistFirstNamesInNoteText(sellerText, noteIdx);
        for (const f of fromSeller) {
            if (therapistNamesMatchForCalendar(fullName, f, dup)) return true;
        }
    }
    return false;
}

/**
 * Minimal calendar cards: masseuse chips under time/Rm only for booking intent — not the assigned SRM dropdown.
 * Shows: (1) customer booking with a specific requested masseuse (not “any available”), (2) names found in seller / customer / add-on notes.
 */
function calendarIntentMasseuseStackHtml(appointment, therapists) {
    if (!appointment) return '';
    const dup = buildTherapistFirstNameDuplicates(therapists);
    const noteIdx = buildTherapistFirstNameIndexForNotes(therapists, [appointment]);
    const chipHtmls = [];
    const seenKey = new Set();
    function addDeduped(key, html) {
        const k = (key || '').trim().toLowerCase();
        if (!k || seenKey.has(k)) return;
        seenKey.add(k);
        chipHtmls.push(html);
    }

    const bookedBy = appointment.booked_by;
    const anyAvail = customerAnyAvailEffective(appointment);
    const oriFull = (appointment.original_therapist || '').trim();
    if (bookedBy === 'customer' && !anyAvail && oriFull && oriFull !== '—') {
        const lab = therapistFirstNameOnly(oriFull);
        const reqM = calendarMasseuseRequestedMarkHtml(oriFull, appointment, therapists, dup, noteIdx);
        const html = `<span class="appointment-calendar-masseuse-chip appointment-calendar-masseuse-intent" style="${masseuseChipInlineStyleCalendarName(oriFull)}" title="${escapeHtml(appointment.original_therapist)}">${escapeHtml(lab)}${reqM}</span>`;
        addDeduped(oriFull, html);
    }

    const sellerText = (appointment.seller_note || '').trim();
    const custAddonText = [appointment.customer_note, appointment.addon_note].filter(Boolean).join('\n');
    const fromSeller = matchTherapistFirstNamesInNoteText(sellerText, noteIdx);
    const fromCustAddon = matchTherapistFirstNamesInNoteText(custAddonText, noteIdx);
    const noteFullNames = [];
    const seenFull = new Set();
    for (const full of [...fromSeller, ...fromCustAddon]) {
        const fk = (full || '').trim().toLowerCase();
        if (!fk || seenFull.has(fk)) continue;
        seenFull.add(fk);
        noteFullNames.push(full.trim());
    }
    for (const full of noteFullNames) {
        const fn = therapistFirstNameOnly(full);
        const reqM = calendarMasseuseRequestedMarkHtml(full, appointment, therapists, dup, noteIdx);
        const html = `<span class="appointment-calendar-masseuse-chip appointment-calendar-masseuse-intent" style="${masseuseChipInlineStyleCompact(full)}" title="${escapeHtml(full)}">${escapeHtml(fn)}${reqM}</span>`;
        addDeduped(full, html);
    }

    if (!chipHtmls.length) return '';

    let usPrefix = '';
    if (bookedBy === 'us' && noteFullNames.length) {
        const usTitle = `Booked by us — ${noteFullNames.join(', ')}`;
        usPrefix = `<span class="appointment-booked-by appointment-booked-by-us appointment-booked-by-us-meta" aria-label="Booked by us" title="${escapeHtml(usTitle)}">📞</span>`;
    }

    return `<div class="appointment-calendar-masseuse-stack">${usPrefix}${chipHtmls.join('')}</div>`;
}

/**
 * Minimal cards: masseuse row under time/Rm — same rules as calendarIntentMasseuseStackHtml (requested therapist
 * or note names only), not the assigned SRM from the schedule. No 📞 here (phone is rendered below this stack).
 */
function calendarMinimalMasseuseStackHtml(appointment, therapists) {
    if (!appointment) return '';
    const dup = buildTherapistFirstNameDuplicates(therapists);
    const noteIdx = buildTherapistFirstNameIndexForNotes(therapists, [appointment]);
    const chipHtmls = [];
    const seenFull = [];
    function alreadyHave(fullName) {
        const raw = (fullName || '').trim();
        if (!raw) return true;
        for (const s of seenFull) {
            if (therapistNamesMatchForCalendar(raw, s, dup)) return true;
        }
        return false;
    }
    function pushChip(fullName, html) {
        const raw = (fullName || '').trim();
        if (!raw || alreadyHave(raw)) return;
        seenFull.push(raw);
        chipHtmls.push(html);
    }

    const bookedBy = appointment.booked_by;
    const anyAvail = customerAnyAvailEffective(appointment);
    const oriFull = (appointment.original_therapist || '').trim();
    const jennyChipStyle = masseuseRequestedChipStyleJenny();
    if (bookedBy === 'customer' && !anyAvail && oriFull && oriFull !== '—' && !alreadyHave(oriFull)) {
        const lab = therapistFirstNameOnly(oriFull);
        const reqM = calendarMasseuseRequestedMarkHtml(oriFull, appointment, therapists, dup, noteIdx);
        const html = `<span class="appointment-calendar-masseuse-chip appointment-calendar-masseuse-intent" style="${jennyChipStyle}" title="${escapeHtml(appointment.original_therapist)}">${escapeHtml(lab)}${reqM}</span>`;
        pushChip(oriFull, html);
    }

    const sellerText = (appointment.seller_note || '').trim();
    const custAddonText = [appointment.customer_note, appointment.addon_note].filter(Boolean).join('\n');
    const fromSeller = matchTherapistFirstNamesInNoteText(sellerText, noteIdx);
    const fromCustAddon = matchTherapistFirstNamesInNoteText(custAddonText, noteIdx);
    for (const full of [...fromSeller, ...fromCustAddon]) {
        const fk = (full || '').trim();
        if (!fk || alreadyHave(fk)) continue;
        const fn = therapistFirstNameOnly(fk);
        const reqM = calendarMasseuseRequestedMarkHtml(fk, appointment, therapists, dup, noteIdx);
        const html = `<span class="appointment-calendar-masseuse-chip appointment-calendar-masseuse-intent" style="${jennyChipStyle}" title="${escapeHtml(fk)}">${escapeHtml(fn)}${reqM}</span>`;
        pushChip(fk, html);
    }

    if (!chipHtmls.length) return '';
    return `<div class="appointment-calendar-masseuse-stack">${chipHtmls.join('')}</div>`;
}

/** Min first-name length for matching names inside notes (avoids false positives). */
const CUSTOMER_REQ_NOTE_NAME_MIN_LEN = 3;

/**
 * Roster first name (lowercase) ↔ alternate spellings in notes (bidirectional keys).
 * e.g. roster "Vicki" / notes "Vicky" — no "Victoria" required on staff list.
 */
const FIRST_NAME_NOTE_SPELLING_VARIANTS = {
    vicky: ['vicki'],
    vicki: ['vicky'],
};

/**
 * Formal roster first name (lowercase) → nicknames customers may write in notes.
 * Index still matches the formal name; aliases add extra tokens for the same full name.
 */
const FORMAL_FIRST_NAME_NOTE_NICKNAMES = {
    elizabeth: ['liz', 'beth', 'betty'],
    jennifer: ['jen', 'jenny'],
    christopher: ['chris'],
    katherine: ['kate', 'kathy', 'katie'],
    catherine: ['kate', 'kathy', 'katie'],
    margaret: ['meg', 'peggy', 'maggie'],
    robert: ['bob', 'rob'],
    william: ['bill', 'will', 'billy'],
    michael: ['mike', 'mick'],
    richard: ['rick', 'dick', 'rich'],
    daniel: ['dan', 'danny'],
    edward: ['ed', 'eddie'],
    jessica: ['jess'],
    stephanie: ['steph'],
    rebecca: ['becky'],
    deborah: ['deb', 'debbie'],
    pamela: ['pam'],
    nicole: ['nikki', 'nicki'],
    susan: ['sue', 'susie'],
    patricia: ['pat', 'trish'],
    alexandra: ['alex', 'lexi'],
    alexander: ['alex'],
    benjamin: ['ben'],
    nicholas: ['nick', 'nicky'],
    samantha: ['sam'],
    jonathan: ['jon', 'johnny'],
};

/** Build therapist first-name index (full names) from day list + event assignments. */
function buildTherapistFirstNameIndexForNotes(therapistsList, events) {
    const entries = [];
    const seen = new Set();
    const seenFullNick = new Set();
    function addFull(full) {
        if (!full || typeof full !== 'string') return;
        const t = full.trim();
        if (!t) return;
        const fn = therapistFirstNameOnly(t);
        const fnLower = fn.toLowerCase();
        if (fnLower.length < CUSTOMER_REQ_NOTE_NAME_MIN_LEN) return;
        const key = t.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({ full: t, fnLower });
        const spellAlts = FIRST_NAME_NOTE_SPELLING_VARIANTS[fnLower];
        if (spellAlts && spellAlts.length) {
            for (const alt of spellAlts) {
                const al = String(alt).toLowerCase();
                if (al === fnLower || al.length < CUSTOMER_REQ_NOTE_NAME_MIN_LEN) continue;
                const fk = key + '|s|' + al;
                if (seenFullNick.has(fk)) continue;
                seenFullNick.add(fk);
                entries.push({ full: t, fnLower: al });
            }
        }
        const nicks = FORMAL_FIRST_NAME_NOTE_NICKNAMES[fnLower];
        if (nicks && nicks.length) {
            for (const nick of nicks) {
                const nl = String(nick).toLowerCase();
                if (nl.length < CUSTOMER_REQ_NOTE_NAME_MIN_LEN) continue;
                const fk = key + '|' + nl;
                if (seenFullNick.has(fk)) continue;
                seenFullNick.add(fk);
                entries.push({ full: t, fnLower: nl });
            }
        }
    }
    for (const t of therapistsList || []) addFull(t);
    for (const e of events || []) {
        addFull(e.therapist);
        addFull(e.therapist_2);
        addFull(e.original_therapist);
    }
    return entries;
}

/** Common misspellings in notes for masseuse Cassey — normalize so first-name matching works. */
function normalizeCasseyNoteTypos(text) {
    if (!text || typeof text !== 'string') return text;
    return text
        .replace(/\bcasry\b/gi, 'cassey')
        .replace(/\bcasery\b/gi, 'cassey')
        .replace(/\bcassery\b/gi, 'cassey');
}

/** Strip invisible chars and collapse whitespace so note matching isn’t broken by NBSP / ZWSP / double spaces. */
function normalizeNoteTextForTherapistMatch(text) {
    if (!text || typeof text !== 'string') return '';
    let t = normalizeCasseyNoteTypos(text);
    t = t.replace(/[\u200B-\u200D\uFEFF]/g, '');
    t = t.replace(/\u00a0/g, ' ');
    t = t.replace(/[\s\u3000]+/g, ' ').trim();
    return t;
}

/** Return full therapist names whose first name appears as a whole word in text. */
function matchTherapistFirstNamesInNoteText(text, firstNameIndex) {
    if (!text || typeof text !== 'string' || !firstNameIndex.length) return [];
    const normalizedText = normalizeNoteTextForTherapistMatch(text);
    const out = [];
    const seenFull = new Set();
    for (const { full, fnLower } of firstNameIndex) {
        if (fnLower.length < CUSTOMER_REQ_NOTE_NAME_MIN_LEN) continue;
        const esc = fnLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('\\b' + esc + '\\b', 'i');
        if (re.test(normalizedText)) {
            const k = full.toLowerCase();
            if (!seenFull.has(k)) {
                seenFull.add(k);
                out.push(full);
            }
        }
    }
    return out;
}

function displayEndAtForCustomerRequestEvent(e) {
    const neutral = effectiveAddonTimeNeutralMinutes(e);
    let displayEndAt = e.end_at;
    try {
        const end = new Date(e.end_at);
        if (!isNaN(end.getTime()) && neutral > 0) {
            displayEndAt = new Date(end.getTime() - neutral * 60000).toISOString();
        }
    } catch (err) { /* keep end_at */ }
    return displayEndAt;
}

/** True when the appointment’s displayed end time has passed (local clock). */
function isAppointmentEndedByDisplayEnd(displayEndAtStr, endAtStr) {
    const raw = (displayEndAtStr && String(displayEndAtStr).trim()) ? displayEndAtStr : endAtStr;
    if (!raw) return false;
    try {
        const end = new Date(raw);
        if (Number.isNaN(end.getTime())) return false;
        return end.getTime() <= Date.now();
    } catch (err) {
        return false;
    }
}

/** True when local time is within [start, display end) for a requested-therapist line. */
function isCustomerRequestInProgressNow(it) {
    if (!it || !it.start_at) return false;
    try {
        const startMs = new Date(it.start_at).getTime();
        const endRaw = (it.display_end_at && String(it.display_end_at).trim()) ? it.display_end_at : it.end_at;
        const endMs = new Date(endRaw).getTime();
        const now = Date.now();
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
        return now >= startMs && now < endMs;
    } catch (err) {
        return false;
    }
}

/**
 * Square "By Customer — name" + note matches: customer/seller/addon notes mentioning a masseuse first name.
 * Tags: in_cust_notes (customer_note / addon_note), by_us (seller_note + booked_by us).
 */
function buildCustomerRequestsSummaryFromEvents(events, therapistsList) {
    const firstNameIndex = buildTherapistFirstNameIndexForNotes(therapistsList, events);
    const itemKey = (bookingId, therapistFull) => String(bookingId || '') + '|' + String(therapistFull || '').toLowerCase();
    const merged = new Map();

    function mergeItem(entry) {
        const k = itemKey(entry.booking_id, entry.requested_masseuse);
        const ex = merged.get(k);
        if (!ex) {
            const tags = entry.tags instanceof Set ? new Set(entry.tags) : new Set(entry.tags || []);
            merged.set(k, { ...entry, tags });
            return;
        }
        if (!ex.tags) ex.tags = new Set();
        for (const t of entry.tags || []) ex.tags.add(t);
        if (entry.ended) ex.ended = true;
    }

    for (const e of events || []) {
        const displayEndAt = displayEndAtForCustomerRequestEvent(e);
        const ended = isAppointmentEndedByDisplayEnd(displayEndAt, e.end_at);
        const svc = (e.display_service || e.service || '').trim();
        const base = {
            booking_id: e.booking_id,
            customer: e.customer || '',
            service: svc,
            start_at: e.start_at,
            end_at: e.end_at,
            display_end_at: displayEndAt,
            ended,
        };

        /* Staff 「正常轮」「不着人」 = turn, not a named request (even if Square attached a therapist) */
        const noteBlobTurn = [e.seller_note, e.customer_note, e.addon_note].filter(Boolean).join(' ');
        const staffSaysTurn =
            /正常轮|不着人|不找人/.test(noteBlobTurn) ||
            /\bnormal\s*turn\b/i.test(noteBlobTurn) ||
            /\bany\s*available\b/i.test(noteBlobTurn);

        if (
            (e.booked_by || '').toLowerCase() === 'customer' &&
            !e.original_any_available &&
            !staffSaysTurn &&
            !isAssignedTherapistStaff(e)
        ) {
            const req = (e.original_therapist || '').trim();
            if (req) {
                mergeItem({
                    ...base,
                    requested_masseuse: req,
                    tags: new Set(['square']),
                });
            }
        }

        const custNoteText = [e.customer_note, e.addon_note].filter(Boolean).join('\n');
        const fromCust = matchTherapistFirstNamesInNoteText(custNoteText, firstNameIndex);
        const isBookedByCustomer = (e.booked_by || '').toLowerCase() === 'customer';
        for (const fullName of fromCust) {
            if (isAssignedTherapistStaff(e) && therapistsNameMatchesOriginalRequest(fullName, e.original_therapist)) continue;
            const tags = new Set();
            if (isBookedByCustomer) tags.add('in_cust_notes');
            mergeItem({
                ...base,
                requested_masseuse: fullName,
                tags,
            });
        }

        const sellerText = (e.seller_note || '').trim();
        const fromSeller = matchTherapistFirstNamesInNoteText(sellerText, firstNameIndex);
        if ((e.booked_by || '').toLowerCase() === 'us') {
            for (const fullName of fromSeller) {
                mergeItem({
                    ...base,
                    requested_masseuse: fullName,
                    tags: new Set(['by_us']),
                });
            }
        } else if (isBookedByCustomer) {
            for (const fullName of fromSeller) {
                if (isAssignedTherapistStaff(e) && therapistsNameMatchesOriginalRequest(fullName, e.original_therapist)) continue;
                mergeItem({
                    ...base,
                    requested_masseuse: fullName,
                    tags: new Set(['seller_notes']),
                });
            }
        }
    }

    const items = [...merged.values()].map(it => {
        const tags = it.tags instanceof Set ? it.tags : new Set(it.tags || []);
        return { ...it, tags };
    });
    items.sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''));
    return items.length ? { items } : null;
}

/** Canonical roster key for one requested-masseuse string (customer-request bar). */
function canonicalRequestedMasseuseName(reqName, therapists, dup) {
    const hit = (therapists || []).find((t) => therapistNamesMatchForCalendar(t, reqName, dup));
    return ((hit || String(reqName || '')).trim()).toLowerCase();
}

function customerRequestSummaryItemTimeRangeMs(it) {
    if (!it || !it.start_at) return null;
    const startMs = new Date(it.start_at).getTime();
    const endRaw = (it.display_end_at && String(it.display_end_at).trim()) ? it.display_end_at : it.end_at;
    const endMs = new Date(endRaw).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
    return { startMs, endMs };
}

function timeRangesOverlapMs(a, b) {
    return a.startMs < b.endMs && b.startMs < a.endMs;
}

/**
 * Same therapist requested on two+ different bookings whose service windows overlap.
 * @returns {{ conflictPairKeys: Set<string>, hasConflict: boolean }} keys `${booking_id}|${canonLower}`
 */
function computeRequestedTherapistOverlapConflictKeys(summaryItems, therapists, dup) {
    const conflictPairKeys = new Set();
    const dupLocal = dup || buildTherapistFirstNameDuplicates(therapists || []);
    const items = summaryItems || [];
    const byCanon = new Map();
    for (const it of items) {
        const canon = canonicalRequestedMasseuseName(it.requested_masseuse, therapists, dupLocal);
        if (!canon) continue;
        if (!byCanon.has(canon)) byCanon.set(canon, []);
        byCanon.get(canon).push(it);
    }
    let hasConflict = false;
    for (const [canon, list] of byCanon) {
        if (list.length < 2) continue;
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const A = list[i];
                const B = list[j];
                if (String(A.booking_id || '') === String(B.booking_id || '')) continue;
                const ra = customerRequestSummaryItemTimeRangeMs(A);
                const rb = customerRequestSummaryItemTimeRangeMs(B);
                if (!ra || !rb || !timeRangesOverlapMs(ra, rb)) continue;
                hasConflict = true;
                conflictPairKeys.add(`${String(A.booking_id || '')}|${canon}`);
                conflictPairKeys.add(`${String(B.booking_id || '')}|${canon}`);
            }
        }
    }
    return { conflictPairKeys, hasConflict };
}

/** True if the requested-therapist summary (same rules as the bar above the calendar) lists this roster for this booking. */
function eventHasCustomerRequestLineForRoster(rosterName, ev, dup, items) {
    if (!ev || !rosterName || !items || !items.length) return false;
    const bid = String(ev.booking_id || '');
    if (!bid) return false;
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (String(it.booking_id || '') !== bid) continue;
        if (therapistNamesMatchForCalendar(rosterName, it.requested_masseuse, dup)) return true;
    }
    return false;
}

/**
 * Check-in masseuse highlight: same as calendar intent-chip request rules, OR any row on the “Requested therapist” bar for this booking
 * (merged Square + note lines — keeps Jenny/Katy etc. aligned with the bar when note paths differ slightly).
 */
function checkinTherapistMatchesCustomerRequestHighlight(display, ev, therapists, dup, noteIdx, crItems) {
    if (!display || !ev || isSlotTherapistUnset(display)) return false;
    if (calendarMasseuseChipCustomerRequested(display, ev, therapists, dup, noteIdx)) return true;
    if (crItems && crItems.length && eventHasCustomerRequestLineForRoster(display, ev, dup, crItems)) return true;
    return false;
}

/** Dup + note index + customer-request bar lines from current day payload (for check-in / checkout UI). */
function getMomCustomerRequestMatchContext() {
    const data = typeof currentData !== 'undefined' ? currentData : null;
    const therapists = data?.therapists || [];
    const events = data?.events || [];
    const dup = buildTherapistFirstNameDuplicates(therapists);
    const noteIdx = buildTherapistFirstNameIndexForNotes(therapists, events);
    const crSummary = buildCustomerRequestsSummaryFromEvents(events, therapists);
    const crItems = (crSummary && crSummary.items) ? crSummary.items : [];
    return { therapists, events, dup, noteIdx, crItems };
}

/** Distinct requested roster names for one booking, in bar merge order (Square then note-derived lines). */
function requestedMasseuseNamesForBooking(ev, crItems, therapists, dup) {
    const bid = String(ev.booking_id || '');
    if (!bid || !crItems || !crItems.length || !dup) return [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < crItems.length; i++) {
        const it = crItems[i];
        if (String(it.booking_id || '') !== bid) continue;
        const req = String(it.requested_masseuse || '').trim();
        if (!req) continue;
        const rosterHit = (therapists || []).find((t) => therapistNamesMatchForCalendar(t, req, dup));
        const canon = (rosterHit || req).trim();
        const key = canon.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(canon);
    }
    return out;
}

function canonicalTherapistOnSlice(raw, therapists, dup) {
    const t = String(raw || '').trim();
    if (!t || isSlotTherapistUnset(t)) return '';
    const hit = (therapists || []).find((x) => therapistNamesMatchForCalendar(x, t, dup));
    return (hit || t).trim();
}

function buildTherapistPoolByStaffOrder(therapists, therapistOrder) {
    const list = (therapists || []).map((t) => String(t).trim()).filter(Boolean);
    if (!list.length) return [];
    const pos = {};
    if (therapistOrder && therapistOrder.length) {
        therapistOrder.forEach((o) => {
            const t = String(o.therapist || '').trim();
            if (t) pos[t] = o.order;
        });
    }
    return list.slice().sort((a, b) => {
        const oa = pos[a] != null ? pos[a] : 9999;
        const ob = pos[b] != null ? pos[b] : 9999;
        if (oa !== ob) return oa - ob;
        return a.localeCompare(b);
    });
}

function sortCheckinItemsForDefaultAllocation(items) {
    return (items || []).slice().sort((a, b) => {
        const ra = String(a.room || '');
        const rb = String(b.room || '');
        if (ra !== rb) return ra.localeCompare(rb);
        const ca = String(a.customer || '').localeCompare(String(b.customer || ''));
        if (ca !== 0) return ca;
        return String(a.booking_id || '').localeCompare(String(b.booking_id || ''));
    });
}

function seedUsedTherapistsFromSliceAssignments(items, therapists, dup) {
    const used = new Set();
    for (const ev of items || []) {
        const c1 = canonicalTherapistOnSlice(ev.therapist, therapists, dup);
        if (c1) used.add(c1.toLowerCase());
        const c2 = canonicalTherapistOnSlice(ev.therapist_2, therapists, dup);
        if (c2) used.add(c2.toLowerCase());
    }
    return used;
}

/** Couples with two distinct customer-request lines process first so M2 request picks (e.g. Katy) win over pool fill. */
function sortCheckinSliceItemsForTherapistDefaults(items, therapists, crItems, dup) {
    const base = sortCheckinItemsForDefaultAllocation(items || []);
    const baseIdx = new Map(base.map((ev, i) => [ev, i]));
    const startMs = (ev) => {
        if (!ev || !ev.start_at) return 0;
        const t = new Date(ev.start_at).getTime();
        return Number.isNaN(t) ? 0 : t;
    };
    return base.slice().sort((a, b) => {
        const ac = requestedMasseuseNamesForBooking(a, crItems, therapists, dup).length >= 2 ? 0 : 1;
        const bc = requestedMasseuseNamesForBooking(b, crItems, therapists, dup).length >= 2 ? 0 : 1;
        if (ac !== bc) return ac - bc;
        const ta = startMs(a);
        const tb = startMs(b);
        if (ta !== tb) return ta - tb;
        const ida = String(a.booking_id || '');
        const idb = String(b.booking_id || '');
        if (ida !== idb) return ida.localeCompare(idb);
        return (baseIdx.get(a) || 0) - (baseIdx.get(b) || 0);
    });
}

function pickCheckinPoolDefaultForSlot(used, pool, dup, otherCanon) {
    let chosen = '';
    for (const p of pool) {
        const pl = p.toLowerCase();
        if (used.has(pl)) continue;
        if (otherCanon && therapistNamesMatchForCalendar(p, otherCanon, dup)) continue;
        chosen = p;
        break;
    }
    if (!chosen) {
        for (const p of pool) {
            if (otherCanon && therapistNamesMatchForCalendar(p, otherCanon, dup)) continue;
            chosen = p;
            break;
        }
    }
    if (!chosen && pool.length) chosen = pool[0];
    return chosen || '';
}

/**
 * Second requested masseuse for a couple (from bar merge), respecting anchor + “available today”,
 * and skipping names already taken in this slice (API or earlier rows in this pass).
 */
function pickCoupleSlot2FromRequestsRespectingUsed(ev, therapists, dup, crItems, massageAvailableOrdered, used) {
    if (String(ev.type || '').toLowerCase() !== 'couple') return '';
    const names = requestedMasseuseNamesForBooking(ev, crItems, therapists, dup);
    if (names.length < 2) return '';
    let anchor = names[0];
    const ori = String(ev.original_therapist || '').trim();
    if (ori) {
        const hit = names.find((n) => therapistNamesMatchForCalendar(n, ori, dup));
        if (hit) anchor = hit;
    } else {
        const raw1 = String(ev.therapist || '').trim();
        if (!isSlotTherapistUnset(raw1)) {
            const hit = names.find((n) => therapistNamesMatchForCalendar(n, raw1, dup));
            if (hit) anchor = hit;
        }
    }
    const candidates = names.filter((n) => !therapistNamesMatchForCalendar(n, anchor, dup));
    const tryPick = (hit) => {
        if (!hit) return '';
        const hk = hit.toLowerCase();
        if (used.has(hk)) return '';
        if (massageAvailableOrdered && massageAvailableOrdered.length
            && !rosterInMassageAvailabilityOrdered(hit, massageAvailableOrdered, dup)) return '';
        return hit;
    };
    if (massageAvailableOrdered && massageAvailableOrdered.length) {
        for (const ordName of massageAvailableOrdered) {
            const hit = candidates.find((c) => therapistNamesMatchForCalendar(c, ordName, dup));
            const got = tryPick(hit);
            if (got) return got;
        }
    }
    for (const c of candidates) {
        const got = tryPick(c);
        if (got) return got;
    }
    return '';
}

/**
 * Roster name intended for couple masseuse 2 from the customer-request bar (two+ distinct lines).
 * Same selection rules as {@link pickCoupleSlot2FromRequestsRespectingUsed} with an empty used set.
 * Empty when there is not a distinct second request — M2 should stay blank like M1 until desk pick / check-in.
 */
function coupleSlot2CustomerRequestedCanonical(ev, therapists, dup, crItems, massageAvailableOrdered) {
    if (String(ev.type || '').toLowerCase() !== 'couple') return '';
    const names = requestedMasseuseNamesForBooking(ev, crItems, therapists, dup);
    if (names.length < 2) return '';
    return pickCoupleSlot2FromRequestsRespectingUsed(ev, therapists, dup, crItems, massageAvailableOrdered, new Set());
}

/**
 * One pass over the check-in/checkout time slice: request-based couple M2, then pool defaults,
 * all sharing the same “used” set so Katy cannot appear on two rows at once.
 * @param {boolean} [includePoolDefaults=true] When false (check-in panel): omit pool and request-merge
 *   auto-fill for empty couple M2 — second masseuse stays blank until the desk assigns or checks “In”.
 *   Checkout keeps request + pool fill.
 */
function buildCheckinSliceSlotDisplayMap(items, therapists, crItems, dup, therapistOrder, massageAvailableOrdered, includePoolDefaults = true) {
    const sliceItems = items || [];
    const map = new Map();
    if (!sliceItems.length) return map;
    const poolFull = buildTherapistPoolByStaffOrder(therapists, therapistOrder);
    const pool = massageStaffPoolInTurnOrder(poolFull, massageAvailableOrdered, dup);
    const used = seedUsedTherapistsFromSliceAssignments(sliceItems, therapists, dup);
    const sorted = sortCheckinSliceItemsForTherapistDefaults(sliceItems, therapists, crItems, dup);

    function slotRawTrim(ev, slot) {
        return String(slot === 2 ? (ev.therapist_2 || '') : (ev.therapist || '')).trim();
    }
    function slotUnavailable(trimmed) {
        return !!(massageAvailableOrdered && massageAvailableOrdered.length
            && !isSlotTherapistUnset(trimmed)
            && !rosterInMassageAvailabilityOrdered(trimmed, massageAvailableOrdered, dup));
    }
    /**
     * Couples need two people: if Square/assigner set therapist_2 to the same as therapist_1, pick another
     * from customer-request bar or pool (checkout / pool mode), unless slot 2 is locked.
     * Check-in panel (!includePoolDefaults): clear M2 instead of auto-substituting — desk assigns second person.
     */
    function coupleM2IfDuplicatePickOther(d1, d2, ev) {
        if (String(ev.type || '').toLowerCase() !== 'couple' || !d1 || !d2) return d2;
        if (!therapistNamesMatchForCalendar(d1, d2, dup)) return d2;
        if (ev.therapist_locked_2 === true) return d2;
        if (!includePoolDefaults) return '';
        const pick2b = pickCoupleSlot2FromRequestsRespectingUsed(ev, therapists, dup, crItems, massageAvailableOrdered, used);
        if (pick2b && !therapistNamesMatchForCalendar(pick2b, d1, dup)) {
            used.add(pick2b.toLowerCase());
            return pick2b;
        }
        const alt = pickCheckinPoolDefaultForSlot(used, pool, dup, d1);
        if (alt && !therapistNamesMatchForCalendar(alt, d1, dup)) {
            used.add(alt.toLowerCase());
            return alt;
        }
        return '';
    }

    for (const ev of sorted) {
        const bid = String(ev.booking_id || '');
        const isCouple = String(ev.type || '').toLowerCase() === 'couple';
        if (!isBookedByCustomerOrUs(ev)) {
            const z1 = canonicalTherapistOnSlice(ev.therapist, therapists, dup) || '';
            const z2raw = isCouple ? (canonicalTherapistOnSlice(ev.therapist_2, therapists, dup) || '') : '';
            const z2 = isCouple ? coupleM2IfDuplicatePickOther(z1, z2raw, ev) : z2raw;
            map.set(`${bid}:1`, z1);
            if (isCouple) map.set(`${bid}:2`, z2);
            continue;
        }

        const raw1 = slotRawTrim(ev, 1);
        const un1 = slotUnavailable(raw1);
        let d1;
        if (!isSlotTherapistUnset(raw1) && !un1) {
            d1 = canonicalTherapistOnSlice(ev.therapist, therapists, dup);
        } else if (includePoolDefaults) {
            d1 = pickCheckinPoolDefaultForSlot(used, pool, dup, '');
            if (d1) used.add(d1.toLowerCase());
        } else {
            d1 = '';
        }
        map.set(`${bid}:1`, d1 || '');

        if (!isCouple) continue;

        const raw2 = slotRawTrim(ev, 2);
        const un2 = slotUnavailable(raw2);
        let d2;
        if (!isSlotTherapistUnset(raw2) && !un2) {
            d2 = canonicalTherapistOnSlice(ev.therapist_2, therapists, dup);
        } else if (includePoolDefaults) {
            const pick2 = pickCoupleSlot2FromRequestsRespectingUsed(ev, therapists, dup, crItems, massageAvailableOrdered, used);
            if (pick2) {
                d2 = pick2;
                used.add(pick2.toLowerCase());
            } else {
                d2 = pickCheckinPoolDefaultForSlot(used, pool, dup, d1);
                if (d2) used.add(d2.toLowerCase());
            }
        } else {
            /* Check-in: do not pre-fill M2 from request merge or pool — desk picks after “In” or explicit assign */
            d2 = '';
        }
        d2 = coupleM2IfDuplicatePickOther(d1, d2, ev);
        map.set(`${bid}:2`, d2 || '');
    }
    return map;
}

function therapistChangeLeavesCustomerRequest(initial, newVal, ev, therapists, dup, noteIdx, crItems, slot = 1) {
    if (!ev || !initial || !newVal || initial === newVal) return false;
    const dateStrLc = typeof document !== 'undefined' ? document.getElementById('dateInput')?.value : '';
    const massageOrdLc = dateStrLc ? getMassageStaffPickOrderedNamesForDate(dateStrLc) : [];
    function isRequestedTherapistVal(val) {
        if (!val || isSlotTherapistUnset(val)) return false;
        if (String(ev.type || '').toLowerCase() === 'couple' && slot === 2) {
            const sec = coupleSlot2CustomerRequestedCanonical(ev, therapists, dup, crItems, massageOrdLc);
            return !!(sec && therapistNamesMatchForCalendar(val, sec, dup));
        }
        return checkinTherapistMatchesCustomerRequestHighlight(val, ev, therapists, dup, noteIdx, crItems);
    }
    return isRequestedTherapistVal(initial) && !isRequestedTherapistVal(newVal);
}

/** Confirm string if changing therapist needs OK; null if no confirm. */
function therapistChangeConfirmPrompt(initial, newVal, ev, therapists, dup, noteIdx, crItems, slot = 1) {
    if (newVal === initial) return null;
    const inProg = !!(ev && checkinMassageInProgress(ev) && newVal !== initial);
    const leavingRequested = therapistChangeLeavesCustomerRequest(initial, newVal, ev, therapists, dup, noteIdx, crItems, slot);
    if (!inProg && !leavingRequested) return null;
    if (inProg && leavingRequested) {
        return uiT(
            'checkin.confirmTherapistChangeAfterStartOrOverrideRequest',
            'This appointment has already started or the client has checked in, and you are changing away from a customer-requested masseuse. Continue anyway?'
        );
    }
    if (inProg) {
        return uiT('checkin.confirmTherapistChangeAfterStart', 'This appointment has already started or the client has checked in. Change therapist anyway?');
    }
    return uiT('checkin.confirmOverrideRequestedMasseuse', 'Change away from a customer-requested masseuse?');
}

/**
 * Staffing tooltip “requested” column: Square named therapist, customer/add-on notes, or seller notes on a customer Square booking.
 */
function staffingTooltipCustomerRequestedThisRoster(rosterName, ev, dup, crItems) {
    if (!ev || !rosterName || !crItems || !crItems.length) return false;
    const bid = String(ev.booking_id || '');
    if (!bid) return false;
    const custBooked = customerBookedOnline(ev);
    for (let i = 0; i < crItems.length; i++) {
        const it = crItems[i];
        if (String(it.booking_id || '') !== bid) continue;
        if (!therapistNamesMatchForCalendar(rosterName, it.requested_masseuse, dup)) continue;
        const tags = it.tags instanceof Set ? it.tags : new Set(it.tags || []);
        if (tags.has('square') || tags.has('in_cust_notes')) return true;
        if (custBooked && tags.has('seller_notes')) return true;
    }
    return false;
}

/** Columns for requested-masseuse bar (must match CSS breakpoints). */
function getCustomerRequestCols() {
    if (typeof window === 'undefined') return 3;
    const w = window.innerWidth;
    if (w <= 420) return 1;
    if (w <= 720) return 2;
    return 3;
}

/**
 * Row-major sort order is Amy, Cassey, Jenny, May, Sophia, Tina.
 * For CSS grid with grid-auto-flow: column, DOM must be column-major so each
 * column stacks top-to-bottom — avoids huge gaps under short cards when one
 * masseuse in the same row is much taller (e.g. Cassey vs Amy).
 */
function orderTherapistKeysColumnMajor(keys, cols) {
    if (cols <= 1) return keys.slice();
    const n = keys.length;
    const numRows = Math.ceil(n / cols);
    const out = [];
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < numRows; r++) {
            const i = r * cols + c;
            if (i < n) out.push(keys[i]);
        }
    }
    return out;
}

function renderCustomerRequestsSummary(events, therapistsList) {
    const el = document.getElementById('customerRequestsBar');
    const panel = document.getElementById('customerRequestsPanel');
    if (!el) return;
    const summary = buildCustomerRequestsSummaryFromEvents(events, therapistsList);
    const dateStr =
        (typeof currentData !== 'undefined' && currentData && currentData.date)
        || (document.getElementById('dateInput') && document.getElementById('dateInput').value)
        || '';
    if (!summary || !summary.items || summary.items.length === 0) {
        el.style.display = 'none';
        if (panel) panel.style.display = 'none';
        updateTherapistRequestOverlapAlert(false, dateStr);
        return;
    }
    const label = uiT('customerRequests.label', 'Requested therapist (by customer):');
    const inCust = uiT('customerRequests.inCustNotes', '(in cust notes)');
    const inSeller = uiT('customerRequests.inSellerNotes', '(staff notes)');
    const byUs = uiT('customerRequests.byUs', '📞');
    const dupCr = buildTherapistFirstNameDuplicates(therapistsList || []);
    const { conflictPairKeys, hasConflict } = computeRequestedTherapistOverlapConflictKeys(summary.items, therapistsList, dupCr);

    const byTherapist = new Map();
    for (const it of summary.items) {
        const key = it.requested_masseuse;
        if (!byTherapist.has(key)) byTherapist.set(key, []);
        byTherapist.get(key).push(it);
    }
    const therapistKeys = [...byTherapist.keys()].sort((a, b) => {
        const fa = therapistFirstNameOnly(a).toLowerCase();
        const fb = therapistFirstNameOnly(b).toLowerCase();
        if (fa !== fb) return fa.localeCompare(fb);
        return a.localeCompare(b);
    });
    const cols = getCustomerRequestCols();
    const keysOrdered = orderTherapistKeysColumnMajor(therapistKeys, cols);
    const numRows = cols <= 1 ? 1 : Math.ceil(therapistKeys.length / cols);
    const groupsStyle = cols > 1 ? ' style="--cr-rows: ' + String(numRows) + '"' : '';
    const groupParts = keysOrdered.map((tKey) => {
        const groupItems = byTherapist.get(tKey);
        const firstName = escapeHtml(therapistFirstNameOnly(tKey));
        const chipStyle = masseuseChipInlineStyle(tKey);
        const canonGroup = canonicalRequestedMasseuseName(tKey, therapistsList, dupCr);
        const groupHasTimeConflict = groupItems.some((git) => conflictPairKeys.has(`${String(git.booking_id || '')}|${canonGroup}`));
        const finishedT = uiT('customerRequests.finishedTitle', 'Finished — service time ended');
        const currentT = uiT('customerRequests.currentTitle', 'In progress now');
        const apptParts = groupItems.map(it => {
            const range = formatTimeRangeSmart(it.start_at, it.display_end_at || it.end_at);
            const custHtml = it.customer
                ? '<span class="customer-request-customer">' + escapeHtml(customerShortName(it.customer)) + '</span>'
                : '';
            const svc = escapeHtml(uiCatalogLine(it.service || ''));
            const tags = it.tags instanceof Set ? it.tags : new Set();
            const suffixBits = [];
            if (tags.has('in_cust_notes')) suffixBits.push(inCust);
            if (tags.has('seller_notes')) suffixBits.push(inSeller);
            if (tags.has('by_us')) suffixBits.push(byUs);
            const suffix = suffixBits.length ? ' ' + suffixBits.map(s => escapeHtml(s)).join(' ') : '';
            const ended = it.ended === true || isAppointmentEndedByDisplayEnd(it.display_end_at, it.end_at);
            const inProgress = !ended && isCustomerRequestInProgressNow(it);
            const lineConflict = conflictPairKeys.has(`${String(it.booking_id || '')}|${canonGroup}`);
            const lineClass = 'customer-request-line'
                + (ended ? ' customer-request-line--ended' : '')
                + (inProgress ? ' customer-request-line--current' : '')
                + (lineConflict ? ' customer-request-line--time-conflict' : '');
            const titleAttr = ended ? ' title="' + escapeHtml(finishedT) + '"' : (inProgress ? ' title="' + escapeHtml(currentT) + '"' : '');
            const starHtml = inProgress
                ? '<span class="customer-request-current-star" role="img" aria-label="' + escapeHtml(currentT) + '">★</span>'
                : '';
            const inner = '<span class="customer-request-time">' + range + '</span>-' + svc + '-' + custHtml + suffix;
            return '<span class="' + lineClass + '"' + titleAttr + '>' + starHtml + '<span class="customer-request-line-text">' + inner + '</span></span>';
        });
        const groupConflictClass = groupHasTimeConflict ? ' customer-request-group--time-conflict' : '';
        return '<span class="customer-request-group customer-request-group--masseuse' + groupConflictClass + '" style="' + chipStyle + '">'
            + '<span class="customer-request-headline"><strong class="customer-request-therapist">' + firstName + '</strong>:</span>'
            + '<span class="customer-request-body">' + apptParts.join('') + '</span>'
            + '</span>';
    });
    const groupsHtml = '<span class="customer-requests-groups"' + groupsStyle + '>' + groupParts.join(' ') + '</span>';
    el.innerHTML = '<strong class="customer-requests-title">' + escapeHtml(label) + '</strong> ' + groupsHtml;
    el.style.display = 'block';
    updateTherapistRequestOverlapAlert(hasConflict, dateStr);
    if (panel) {
        panel.style.display = '';
        initCustomerRequestsPanelToggle();
        applyCustomerRequestsCollapsedFromStorage();
        updateCustomerRequestsToggleUI();
    }
    if (!renderCustomerRequestsSummary._resizeBound && typeof window !== 'undefined') {
        renderCustomerRequestsSummary._resizeBound = true;
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (currentData && currentData.events && currentData.therapists) {
                    renderCustomerRequestsSummary(currentData.events, currentData.therapists);
                }
            }, 200);
        });
    }
    if (!renderCustomerRequestsSummary._endedTick && typeof window !== 'undefined') {
        renderCustomerRequestsSummary._endedTick = true;
        setInterval(() => {
            const bar = document.getElementById('customerRequestsBar');
            if (!bar || bar.style.display === 'none') return;
            if (currentData && currentData.events && currentData.therapists) {
                renderCustomerRequestsSummary(currentData.events, currentData.therapists);
            }
        }, 60000);
    }
}

function renderFacialSummary(facialSummary) {
    const el = document.getElementById('facialSummaryBar');
    if (!el) return;
    if (!facialSummary || !facialSummary.time_frames || facialSummary.time_frames.length === 0) {
        el.style.display = 'none';
        return;
    }
    const count = facialSummary.count || facialSummary.time_frames.length;
    function formatRangeCompact(startAt, endAt) {
        return formatTimeRangeSmart(startAt, endAt);
    }
    /** Localize service text for the facial bar, then highlight basic/custom (EN or 中文). */
    function facialSummaryLabelDisplayHtml(rawLabel) {
        if (!rawLabel) return '';
        const localized = uiCatalogLine(String(rawLabel).trim());
        const escaped = escapeHtml(localized);
        return escaped
            .replace(/(基础面部护理|Basic Facial|Facial\s+Basic)/gi, '<span class="facial-type-basic">$1</span>')
            .replace(/(定制面部护理|Custom Facial|Facial\s+Custom)/gi, '<span class="facial-type-custom">$1</span>');
    }
    function facialSummaryCustomerHtml(customer) {
        if (!customer) return '';
        return '<em class="facial-summary-customer">' + escapeHtml(customerShortName(customer)) + '</em>';
    }
    const finishedFacialT = uiT('facial.finishedTitle', 'Finished — facial time ended');
    function buildTfSegment(tf) {
        const range = formatRangeCompact(tf.start_at, tf.end_at);
        const timePart = '<span class="facial-time">' + range + '</span>';
        const insideParens = [tf.label ? facialSummaryLabelDisplayHtml(tf.label) : '', tf.customer ? facialSummaryCustomerHtml(tf.customer) : ''].filter(Boolean).join('-');
        const labelPart = insideParens ? ' (' + insideParens + ')' : '';
        const inner = timePart + labelPart;
        const ended = isAppointmentEndedByDisplayEnd(tf.end_at, tf.end_at);
        const endedClass = ended ? ' facial-summary-segment--ended' : '';
        const titleAttr = ended ? ' title="' + escapeHtml(finishedFacialT) + '"' : '';
        return '<span class="facial-summary-segment' + endedClass + '"' + titleAttr + '>' + inner + '</span>';
    }
    const parts = facialSummary.time_frames.map(buildTfSegment);
    const facialsTodayLabel = uiT('facial.today', 'Facials today:');
    const oneLineLead = uiT('facial.oneLine', '1 facial');
    const facialEmoji = '<span class="facial-summary-emoji" aria-hidden="true">😊</span> ';
    let html;
    if (count === 1 && facialSummary.time_frames[0]) {
        const tf = facialSummary.time_frames[0];
        const range = formatRangeCompact(tf.start_at, tf.end_at);
        const insideParens = [tf.label ? facialSummaryLabelDisplayHtml(tf.label) : '', tf.customer ? facialSummaryCustomerHtml(tf.customer) : ''].filter(Boolean).join('-');
        const labelPart = insideParens ? ' (' + insideParens + ')' : '';
        const ended = isAppointmentEndedByDisplayEnd(tf.end_at, tf.end_at);
        const endedClass = ended ? ' facial-summary-segment--ended' : '';
        const titleAttr = ended ? ' title="' + escapeHtml(finishedFacialT) + '"' : '';
        html = '<span class="facial-summary-segment' + endedClass + '"' + titleAttr + '>' + facialEmoji + '<strong>' + escapeHtml(oneLineLead) + ' ' + range + '</strong>' + labelPart + '</span>';
    } else {
        html = facialEmoji + '<strong>' + escapeHtml(facialsTodayLabel) + ' ' + count + '</strong> ' + parts.join('; ');
    }
    el.innerHTML = html;
    el.style.display = 'block';
    if (!renderFacialSummary._endedTick && typeof window !== 'undefined') {
        renderFacialSummary._endedTick = true;
        setInterval(() => {
            const bar = document.getElementById('facialSummaryBar');
            if (!bar || bar.style.display === 'none') return;
            if (currentData && currentData.facial_summary) {
                renderFacialSummary(currentData.facial_summary);
            }
        }, 60000);
    }
}

function renderTherapistOrderBar(therapists, order, date) {
    const el = document.getElementById('therapistOrderBar');
    if (!el) return;
    if (calendarViewMode === 'room') {
        el.style.display = 'none';
        return;
    }
    if (!therapists || !therapists.length) {
        el.style.display = 'none';
        return;
    }
    const numSlots = therapists.length;
    const positionToTherapist = {};
    if (order && order.length) {
        order.forEach(o => { positionToTherapist[o.order] = o.therapist; });
    }
    const options = therapists.map(t => `<option value="${t}">${t}</option>`).join('');
    el.innerHTML = '';
    for (let pos = 1; pos <= numSlots; pos++) {
        const selected = positionToTherapist[pos] || '';
        const item = document.createElement('span');
        item.className = 'order-item';
        item.dataset.position = String(pos);
        const dragTitle = uiT('order.dragTitle', 'Drag to reorder');
        const pickTitle = uiTParams('order.pickTitle', { n: pos }, 'Pick therapist for order ' + pos);
        item.innerHTML = `
            <span class="order-item-drag-handle" draggable="true" data-position="${pos}" title="${escapeHtml(dragTitle)}" aria-label="${escapeHtml(dragTitle)}">⋮⋮</span>
            <label>${escapeHtml(uiT('order.masseuse', 'Masseuse'))} ${pos}</label>
            <select class="order-select" data-position="${pos}" title="${escapeHtml(pickTitle)}">
                <option value="">--</option>
                ${options}
            </select>
        `;
        const sel = item.querySelector('.order-select');
        if (selected) sel.value = selected;
        el.appendChild(item);
    }
    el.style.display = 'block';

    function getOrderFromBar() {
        const orderList = [];
        el.querySelectorAll('.order-item').forEach(item => {
            const sel = item.querySelector('.order-select');
            const pos = parseInt(sel.dataset.position, 10);
            if (sel.value) orderList.push({ therapist: sel.value, order: pos });
        });
        return orderList;
    }

    /** If therapist already occupies another position, swap; never leave duplicates. */
    function applyTherapistOrderSelectChange(select) {
        const newVal = String(select.value || '').trim();
        const oldVal = String(select.dataset.prevValue || '').trim();
        if (newVal && newVal === oldVal) return;
        if (newVal) {
            el.querySelectorAll('.order-select').forEach((other) => {
                if (other === select) return;
                if (String(other.value || '').trim() !== newVal) return;
                other.value = oldVal;
                other.dataset.prevValue = oldVal;
            });
        }
        select.dataset.prevValue = newVal;
    }

    async function saveOrder() {
        if (!date) return;
        const orderList = getOrderFromBar();
        const res = await fetch('/api/therapist-order', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, order: orderList })
        });
        if (res.ok) loadDay({ soft: true });
    }

    el.querySelectorAll('.order-select').forEach(select => {
        select.dataset.prevValue = select.value || '';
        /* Edit opens empty — user picks the therapist (no auto-filled current name). */
        select.addEventListener('focus', () => {
            select.dataset.prevValue = select.value || '';
            select.value = '';
        });
        select.addEventListener('blur', () => {
            if (!select.value && select.dataset.prevValue) {
                select.value = select.dataset.prevValue;
            }
        });
        select.addEventListener('change', async () => {
            applyTherapistOrderSelectChange(select);
            await saveOrder();
        });
    });

    el.querySelectorAll('.order-item-drag-handle').forEach(handle => {
        handle.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', handle.dataset.position);
            e.dataTransfer.effectAllowed = 'move';
            handle.closest('.order-item').classList.add('order-item-dragging');
        });
        handle.addEventListener('dragend', (e) => {
            el.querySelectorAll('.order-item').forEach(i => i.classList.remove('order-item-dragging', 'order-item-drag-over'));
        });
    });
    el.querySelectorAll('.order-item').forEach(item => {
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!item.classList.contains('order-item-dragging')) item.classList.add('order-item-drag-over');
        });
        item.addEventListener('dragleave', () => item.classList.remove('order-item-drag-over'));
        item.addEventListener('drop', async (e) => {
            e.preventDefault();
            item.classList.remove('order-item-drag-over');
            const fromPos = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const toPos = parseInt(item.dataset.position, 10);
            if (fromPos === toPos || isNaN(fromPos) || isNaN(toPos)) return;
            const selFrom = el.querySelector(`.order-select[data-position="${fromPos}"]`);
            const selTo = el.querySelector(`.order-select[data-position="${toPos}"]`);
            if (!selFrom || !selTo) return;
            const fromVal = selFrom.value;
            const toVal = selTo.value;
            selFrom.value = toVal;
            selTo.value = fromVal;
            await saveOrder();
        });
    });
}

// --- Check-in / Checkout panels ---
/** Booking IDs with unsaved edits in tip/split fields — skip auto-refresh panel re-render until saved or panel closed. */
const momCheckinPanelDraftBookingIds = new Set();
const momCheckoutPanelDraftBookingIds = new Set();
let momCheckinCheckoutDraftGuardsBound = false;

function bindCheckinCheckoutDraftGuards() {
    if (momCheckinCheckoutDraftGuardsBound) return;
    momCheckinCheckoutDraftGuardsBound = true;
    const checkoutPanel = document.getElementById('checkoutPanel');
    const checkinPanel = document.getElementById('checkinPanel');
    checkoutPanel?.addEventListener('input', (e) => {
        const t = e.target;
        if (!t || !t.classList || !t.dataset) return;
        const bid = t.dataset.bookingId;
        if (!bid) return;
        if (t.classList.contains('checkout-tip-input') || t.classList.contains('checkout-split-min-input')) {
            momCheckoutPanelDraftBookingIds.add(bid);
        }
    }, true);
    checkinPanel?.addEventListener('input', (e) => {
        const t = e.target;
        if (!t || !t.classList || !t.dataset) return;
        const bid = t.dataset.bookingId;
        if (!bid) return;
        if (t.classList.contains('checkin-split-min-input')) {
            momCheckinPanelDraftBookingIds.add(bid);
        }
    }, true);
}

function clearCheckinCheckoutDraftGuards() {
    momCheckinPanelDraftBookingIds.clear();
    momCheckoutPanelDraftBookingIds.clear();
}

let momLoadDayLastRequestedDate = null;

const CHECKIN_CHECKOUT_ARROW_MINUTES = 30;
function getCheckinCheckoutTimeOptions(mode, dateStr) {
    const base = [];
    for (let h = START_HOUR; h < END_HOUR; h++) {
        for (let m = 0; m < 60; m += CHECKIN_CHECKOUT_ARROW_MINUTES) {
            const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            const d = new Date(2000, 0, 1, h, m);
            const label = formatTimeCompactUS(d);
            base.push({ value, label });
        }
    }
    const valueToLabel = new Map(base.map(o => [o.value, o.label]));
    const valueSet = new Set(base.map(o => o.value));
    if ((mode === 'checkin' || mode === 'checkout') && dateStr && currentData && currentData.events) {
        (currentData.events || []).forEach(ev => {
            if (mode === 'checkin') {
                const d = getLocalDateStringFromISO(ev.start_at);
                if (d !== dateStr) return;
                const t = getLocalTimeStringFromISO(ev.start_at);
                if (!t || valueSet.has(t)) return;
                const [hh, mm] = t.split(':').map(Number);
                if (mm % CHECKIN_CHECKOUT_ARROW_MINUTES === 0) return;
                valueSet.add(t);
                const dateObj = new Date(2000, 0, 1, hh, mm);
                valueToLabel.set(t, formatTimeCompactUS(dateObj));
            } else {
                // Checkout: service end (Square end minus add-on-neutral minutes)
                const d = getCheckoutDisplayEndDateString(ev);
                if (d !== dateStr) return;
                const t = getCheckoutDisplayEndTimeString(ev);
                if (!t || valueSet.has(t)) return;
                const [hh, mm] = t.split(':').map(Number);
                if (mm % CHECKIN_CHECKOUT_ARROW_MINUTES === 0) return;
                valueSet.add(t);
                const dateObj = new Date(2000, 0, 1, hh, mm);
                valueToLabel.set(t, formatTimeCompactUS(dateObj));
            }
        });
    }
    const all = [...valueSet].sort((a, b) => {
        const [ah, am] = a.split(':').map(Number);
        const [bh, bm] = b.split(':').map(Number);
        return (ah * 60 + am) - (bh * 60 + bm);
    });
    return all.map(value => ({ value, label: valueToLabel.get(value) || value }));
}

/** Local wall clock rounded down to 30 min, clamped to check-in/checkout grid (START_HOUR .. last slot before END_HOUR). */
function getLocalNowCheckinCheckoutSlotValue() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const flooredMin = m < 30 ? 0 : 30;
    let slotMin = h * 60 + flooredMin;
    const firstSlotMin = START_HOUR * 60;
    const lastSlotMin = (END_HOUR - 1) * 60 + 30;
    if (slotMin < firstSlotMin) slotMin = firstSlotMin;
    if (slotMin > lastSlotMin) slotMin = lastSlotMin;
    const hh = Math.floor(slotMin / 60);
    const mm = slotMin % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function isCheckinCheckoutTimeSyncOn() {
    const el = document.getElementById('checkinCheckoutTimeSync');
    return !!(el && el.checked);
}

let momCheckinCheckoutTimeSyncGuard = false;

function applyCheckinCheckoutSyncedTime(timeStr) {
    if (!timeStr || momCheckinCheckoutTimeSyncGuard) return;
    momCheckinCheckoutTimeSyncGuard = true;
    try {
        fillTimeSelect('checkinTimeSelect', timeStr, 'checkin');
        fillTimeSelect('checkoutTimeSelect', timeStr, 'checkout', { preservePick: true });
        const ci = document.getElementById('checkinTimeSelect');
        const co = document.getElementById('checkoutTimeSelect');
        if (ci) ci.value = timeStr;
        if (co) co.value = timeStr;
        renderCheckinPanelList(timeStr);
        renderCheckoutPanelList(timeStr);
    } finally {
        momCheckinCheckoutTimeSyncGuard = false;
    }
}

function loadCheckinCheckoutTimeSyncPreference() {
    const el = document.getElementById('checkinCheckoutTimeSync');
    if (!el) return;
    try {
        if (sessionStorage.getItem(MOM_CHECKIN_CHECKOUT_TIME_SYNC_KEY) === '1') el.checked = true;
    } catch (e) { /* ignore */ }
}

function saveCheckinCheckoutTimeSyncPreference() {
    const el = document.getElementById('checkinCheckoutTimeSync');
    if (!el) return;
    try {
        sessionStorage.setItem(MOM_CHECKIN_CHECKOUT_TIME_SYNC_KEY, el.checked ? '1' : '0');
    } catch (e) { /* ignore */ }
}

function snapCheckinCheckoutTimeToNow(panelMode) {
    const target = getLocalNowCheckinCheckoutSlotValue();
    if (isCheckinCheckoutTimeSyncOn()) {
        applyCheckinCheckoutSyncedTime(target);
        return;
    }
    if (panelMode === 'checkin') {
        fillTimeSelect('checkinTimeSelect', target, 'checkin');
        const sel = document.getElementById('checkinTimeSelect');
        renderCheckinPanelList(sel ? sel.value : target);
    } else {
        fillTimeSelect('checkoutTimeSelect', target, 'checkout');
        const sel = document.getElementById('checkoutTimeSelect');
        renderCheckoutPanelList(sel ? sel.value : target);
    }
}

function formatCustomerFirstLastInitial(customer) {
    if (!customer || typeof customer !== 'string') return '—';
    const parts = customer.trim().split(/\s+/);
    if (parts.length === 0) return '—';
    if (parts.length === 1) return parts[0];
    const first = parts[0];
    const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
    return `${first} ${lastInitial}.`;
}

function formatDurationMinutes(minutes) {
    if (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.formatDurationMinutes) {
        return window.MOM_I18N.formatDurationMinutes(minutes);
    }
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    return `${m} min`;
}

/** Couple massage card duration label — always total minutes (e.g. 90 min). */
function coupleMassageDurationHeadline(minutes) {
    return formatDurationMinutes(minutes);
}

/**
 * Calendar couple cards: keep "Couples" + duration on one line when possible.
 * Square often sends duration on the first line and "Couples" on the second.
 */
function calendarReorderCoupleServiceHeadline(text, durationMinutes) {
    const raw = (text || '').trim();
    if (!raw) return raw;
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const isDurLine = (l) =>
        /^(?:\d+)\s*(?:min(?:ute)?s?|分钟|分)/i.test(l) ||
        /^\d+h(?:\s+\d+m)?$/i.test(l);
    const isCoupleLine = (l) => /\bcouples?\b/i.test(l) || /情侣/.test(l);
    const durIdx = lines.findIndex(isDurLine);
    const coupleIdx = lines.findIndex(isCoupleLine);
    const couplesHead = uiT('calendar.couplesShort', 'Couples');
    const durLabel = coupleMassageDurationHeadline(durationMinutes);
    const couplesDurSameLine = `${couplesHead} · ${durLabel}`;
    if (lines.length >= 2 && durIdx >= 0 && coupleIdx >= 0) {
        const extra = lines.filter((_, i) => i !== durIdx && i !== coupleIdx);
        const tail = extra.join('\n');
        return tail ? `${couplesDurSameLine}\n${tail}` : couplesDurSameLine;
    }
    if (lines.length === 1) {
        const one = lines[0];
        const m = one.match(/^(\d+)\s*(Minutes?|mins?|min\.?)\b/i);
        if (m && /\bcouples?\b/i.test(one)) {
            const tail = one
                .replace(m[0], ' ')
                .replace(/\bcouples?\b/ig, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return tail ? `${couplesDurSameLine}\n${tail}` : couplesDurSameLine;
        }
        if (isCoupleLine(one) && !isDurLine(one) && durationMinutes > 0) {
            const tail = one
                .replace(/\bcouples?\b/ig, ' ')
                .replace(/情侣/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return tail ? `${couplesDurSameLine}\n${tail}` : couplesDurSameLine;
        }
    }
    return raw;
}

/**
 * Calendar time/duration box: background + left accent by session length (quick scan).
 * Buckets: under 50m, ~1h, ~1h30, ~2h, 2.5h+. Does not change duration text size.
 */
function calendarDurationTierClass(totalMinutes) {
    const m = Math.max(0, Math.round(Number(totalMinutes) || 0));
    if (m < 50) return 'appointment-dur-tier appointment-dur-tier--short';
    if (m < 75) return 'appointment-dur-tier appointment-dur-tier--1h';
    if (m < 105) return 'appointment-dur-tier appointment-dur-tier--90';
    if (m < 150) return 'appointment-dur-tier appointment-dur-tier--2h';
    return 'appointment-dur-tier appointment-dur-tier--long';
}

/** Stored/API key stays "02D" (rooms 0+2 merged); UI shows "02C" (C = couples). */
function roomKeyDisplayLabel(roomKey) {
    if (roomKey === '02D') return '02C';
    return String(roomKey);
}

function formatRoomForPanel(room) {
    if (!room || room === 'UNASSIGNED' || room === 'ADDON') return '—';
    const lbl = roomKeyDisplayLabel(room);
    const mode = (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.getMode) ? window.MOM_I18N.getMode() : 'en';
    const enP = 'Rm ' + lbl;
    const zhRoom = lbl + '\u53F7\u623F';
    if (mode === 'zh') return zhRoom;
    if (mode === 'both') return enP + '\u00A0' + zhRoom;
    return enP;
}

function getLocalTimeStringFromISO(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getLocalDateStringFromISO(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Massage/service end instant for checkout (Square end minus time-neutral add-on minutes). */
function getCheckoutServiceEndMs(ev) {
    if (!ev || !ev.end_at) return null;
    const raw = new Date(ev.end_at).getTime();
    if (Number.isNaN(raw)) return null;
    const neutral = effectiveAddonTimeNeutralMinutes(ev);
    return raw - neutral * 60000;
}

/**
 * If service end is within 5 minutes of the next :00 or :30 (local), snap up to that boundary.
 * Keeps checkout on the half-hour grid (e.g. 5:25 → 5:30) so sync with check-in time does not hide rows.
 */
function snapCheckoutServiceEndMsIfNearHalfHour(ms) {
    if (ms == null || !Number.isFinite(ms)) return ms;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return ms;
    const boundaryDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0);
    const m = d.getMinutes();
    if (m < 30) boundaryDate.setMinutes(30);
    else {
        boundaryDate.setHours(boundaryDate.getHours() + 1);
        boundaryDate.setMinutes(0);
    }
    const boundary = boundaryDate.getTime();
    const diffMin = (boundary - ms) / 60000;
    if (diffMin > 0 && diffMin <= 5) return boundary;
    return ms;
}

/** Local time string for checkout dropdown + row bucketing — uses service end, not Square padding after massage. */
function getCheckoutDisplayEndTimeString(ev) {
    const raw = getCheckoutServiceEndMs(ev);
    if (raw == null) return null;
    const ms = snapCheckoutServiceEndMsIfNearHalfHour(raw);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getCheckoutDisplayEndDateString(ev) {
    const raw = getCheckoutServiceEndMs(ev);
    if (raw == null) return null;
    const ms = snapCheckoutServiceEndMsIfNearHalfHour(raw);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Checkout panel slot (local date + HH:MM) used to bucket events into the time dropdown.
 * Uses service end (Square end minus add-on-neutral minutes) so 5 min Square padding does not push to :05.
 * Ends within 5 minutes of the next :00 or :30 snap to that boundary (aligned with half-hour check-in grid).
 */
function getCheckoutPanelSlotDateAndTime(ev) {
    const raw = getCheckoutServiceEndMs(ev);
    if (raw == null) return { dateStr: null, timeStr: null };
    const endMs = snapCheckoutServiceEndMsIfNearHalfHour(raw);
    const d = new Date(endMs);
    if (Number.isNaN(d.getTime())) return { dateStr: null, timeStr: null };
    const y = d.getFullYear();
    const mo = d.getMonth();
    const day = d.getDate();
    const h = d.getHours();
    const m = d.getMinutes();
    const dateStr = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return { dateStr, timeStr };
}

/**
 * For Square add-on rows (room ADDON), find overlapping same-customer booking that holds the real room.
 */
function resolveMainRoomForAddonBooking(ev, allEvents) {
    if (!ev || (ev.room || '').trim() !== 'ADDON' || !Array.isArray(allEvents)) return null;
    const cid = (ev.customer_id || '').trim();
    const nameKey = formatCustomerFirstLastInitial(ev.customer || '').toLowerCase();
    const s = new Date(ev.start_at).getTime();
    const e = new Date(ev.end_at).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) return null;
    for (const o of allEvents) {
        if (!o || o.booking_id === ev.booking_id) continue;
        const r = (o.room || '').trim();
        if (!r || r === 'UNASSIGNED' || r === 'ADDON') continue;
        const oid = (o.customer_id || '').trim();
        const matchById = cid && oid === cid;
        const matchByName = !cid && nameKey && formatCustomerFirstLastInitial(o.customer || '').toLowerCase() === nameKey;
        if (!matchById && !matchByName) continue;
        const os = new Date(o.start_at).getTime();
        const oe = new Date(o.end_at).getTime();
        if (Number.isNaN(os) || Number.isNaN(oe)) continue;
        if (os < e && oe > s) return r;
    }
    return null;
}

function getEventsAtStartTime(events, dateStr, timeStr) {
    if (!events || !dateStr || !timeStr) return [];
    return events.filter(ev => {
        const d = getLocalDateStringFromISO(ev.start_at);
        const t = getLocalTimeStringFromISO(ev.start_at);
        return d === dateStr && t === timeStr;
    });
}

function getEventsAtEndTime(events, dateStr, timeStr) {
    if (!events || !dateStr || !timeStr) return [];
    return events.filter(ev => {
        const slot = getCheckoutPanelSlotDateAndTime(ev);
        return slot.dateStr === dateStr && slot.timeStr === timeStr;
    });
}

/** True if the given time (dateStr + timeStr, local) falls inside [ev.start_at, ev.end_at). */
function isEventInProgressAt(ev, dateStr, timeStr) {
    if (!ev.start_at || !ev.end_at || !dateStr || !timeStr) return false;
    const slotMs = new Date(dateStr + 'T' + timeStr + ':00').getTime();
    const startMs = new Date(ev.start_at).getTime();
    const endMs = new Date(ev.end_at).getTime();
    return startMs <= slotMs && slotMs < endMs;
}

/** Roster names with at least one massage assignment (therapist / therapist_2) on dateStr. */
function massageTherapistsWorkingOnDay(events, therapists, dateStr) {
    if (!events || !therapists || !dateStr) return [];
    const names = therapists.filter(t => (t || '').trim());
    const workingToday = new Set();
    for (const ev of events) {
        if (!ev.start_at) continue;
        const evDate = ev.start_at.slice(0, 10);
        if (evDate !== dateStr) continue;
        if ((ev.therapist || '').trim()) workingToday.add((ev.therapist || '').trim());
        if ((ev.therapist_2 || '').trim()) workingToday.add((ev.therapist_2 || '').trim());
    }
    return names.filter(n => workingToday.has((n || '').trim()));
}

/**
 * True if this roster name still has at least one non-ADDON booking on dateStr whose local start is at or after
 * the check-in slot and staffing "Later" massage rules apply — same as staffingLaterMassageRequestedThisRoster.
 */
function therapistHasRequestedMassageFromSlotOnDay(rosterName, events, dateStr, timeStr, dup, crItems) {
    if (!rosterName || !events || !dateStr || !timeStr) return false;
    const crList = Array.isArray(crItems) ? crItems : [];
    const slotMs = new Date(dateStr + 'T' + timeStr + ':00').getTime();
    if (!Number.isFinite(slotMs)) return false;
    for (const ev of events) {
        if (!ev || ev.room === 'ADDON') continue;
        if (!eventIsOnStaffingCalendarDay(ev, dateStr)) continue;
        const startMs = new Date(ev.start_at).getTime();
        if (!Number.isFinite(startMs) || startMs < slotMs) continue;
        if (!staffingLaterMassageRequestedThisRoster(rosterName, ev, dup, crList)) continue;
        return true;
    }
    return false;
}

/** For check-in panel: list of { name, freeAt } where freeAt is ISO end_at or null (free now).
 *  Only includes therapists working today who still have at least one customer-requested massage from the selected time onward.
 *  Sorts by end time ascending, with "Appointment ends now" (free now) at the bottom. */
function getNextAvailablePerTherapist(events, therapists, dateStr, timeStr) {
    if (!events || !therapists || !dateStr || !timeStr) return [];
    const names = therapists.filter(t => (t || '').trim());
    const dup = buildTherapistFirstNameDuplicates(names);
    const crPayload = buildCustomerRequestsSummaryFromEvents(events, therapists);
    const crItems = crPayload && crPayload.items ? crPayload.items : [];
    const namesWorkingToday = massageTherapistsWorkingOnDay(events, therapists, dateStr);
    const namesWithRequestedRemaining = namesWorkingToday.filter(n =>
        therapistHasRequestedMassageFromSlotOnDay((n || '').trim(), events, dateStr, timeStr, dup, crItems)
    );
    const results = namesWithRequestedRemaining.map(name => {
        const n = (name || '').trim();
        const inProgress = events.find(ev => {
            if (ev.room === 'ADDON') return false;
            const matches = ((ev.therapist || '').trim() === n) || ((ev.therapist_2 || '').trim() === n);
            return matches && isEventInProgressAt(ev, dateStr, timeStr);
        });
        if (!inProgress) return { name: n, freeAt: null };
        return { name: n, freeAt: inProgress.end_at };
    }).filter(r => r.name);
    // Sort: soonest end time first; "Appointment ends now" (freeAt null) at bottom
    return results.sort((a, b) => {
        if (!a.freeAt && !b.freeAt) return 0;
        if (!a.freeAt) return 1;
        if (!b.freeAt) return -1;
        return new Date(a.freeAt).getTime() - new Date(b.freeAt).getTime();
    });
}

/** Duration for checkout/check-in labels: massage/service window (subtracts Square add-on padding minutes). */
function getDurationMinutes(ev) {
    if (!ev || !ev.start_at || !ev.end_at) return 0;
    const start = new Date(ev.start_at).getTime();
    const end = new Date(ev.end_at).getTime();
    const neutral = effectiveAddonTimeNeutralMinutes(ev);
    const netEnd = end - neutral * 60000;
    return Math.max(0, Math.round((netEnd - start) / 60000));
}

let checkinCheckoutAutoTimer = null;
function scheduleCheckoutPopupWhenDue() {
    if (checkinCheckoutAutoTimer) clearTimeout(checkinCheckoutAutoTimer);
    const dateInput = document.getElementById('dateInput');
    const selectedDate = dateInput?.value;
    const today = getTodayLocal();
    if (selectedDate !== today) return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const options = getCheckinCheckoutTimeOptions('checkout', selectedDate);
    let triggerMs = null;
    let targetTimeStr = null;
    for (const o of options) {
        const [h, m] = o.value.split(':').map(Number);
        const slotMin = h * 60 + m;
        const showAtMin = slotMin - 8;
        if (showAtMin > nowMin) {
            const showAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(showAtMin / 60), showAtMin % 60, 0, 0);
            triggerMs = Math.max(0, showAt.getTime() - now.getTime());
            targetTimeStr = o.value;
            break;
        }
    }
    if (triggerMs == null || !targetTimeStr) {
        checkinCheckoutAutoTimer = setTimeout(scheduleCheckoutPopupWhenDue, 60 * 1000);
        return;
    }
    checkinCheckoutAutoTimer = setTimeout(() => {
        showCheckoutPanel(targetTimeStr);
        const checkinPanel = document.getElementById('checkinPanel');
        if (checkinPanel && checkinPanel.style.display === 'none') {
            showCheckinPanel(targetTimeStr);
        }
        if (isCheckinCheckoutTimeSyncOn()) {
            applyCheckinCheckoutSyncedTime(targetTimeStr);
        }
        syncCheckinCheckoutToggleButton();
        scheduleCheckoutPopupWhenDue();
    }, triggerMs);
}

function fillTimeSelect(selectId, currentValue, mode, opts) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const dateStr = document.getElementById('dateInput')?.value;
    let options = getCheckinCheckoutTimeOptions(mode || null, dateStr);
    let pick = currentValue;
    const preservePick = !!(opts && opts.preservePick);

    if (!preservePick && mode === 'checkout' && dateStr && currentData && currentData.events) {
        const hasItems = (t) => t && getEventsAtEndTime(currentData.events, dateStr, t).length > 0;
        if (!hasItems(pick)) {
            pick = null;
            for (const o of options) {
                if (hasItems(o.value)) {
                    pick = o.value;
                    break;
                }
            }
            if (!pick && options.length) pick = options[0].value;
        }
    }

    const exact = options.some(o => o.value === pick);
    if (!exact && pick && (mode !== 'checkout' || preservePick)) {
        const [h, m] = pick.split(':').map(Number);
        const d = new Date(2000, 0, 1, h, m);
        options.push({ value: pick, label: formatTimeCompactUS(d) });
        options.sort((a, b) => {
            const [ah, am] = a.value.split(':').map(Number);
            const [bh, bm] = b.value.split(':').map(Number);
            return (ah * 60 + am) - (bh * 60 + bm);
        });
    }
    sel.innerHTML = options.map(o => `<option value="${o.value}" ${o.value === pick ? 'selected' : ''}>${o.label}</option>`).join('');
}

function showCheckinPanel(timeStr) {
    const panel = document.getElementById('checkinPanel');
    if (!panel) return;
    panel.style.display = 'flex';
    panel.classList.remove('minimized');
    fillTimeSelect('checkinTimeSelect', timeStr, 'checkin');
    updateCheckinPanelTitle();
    renderCheckinPanelList(timeStr);
    syncDeskNoteLangToggleButtons();
}

function showCheckoutPanel(timeStr) {
    const panel = document.getElementById('checkoutPanel');
    if (!panel) return;
    panel.style.display = 'flex';
    panel.classList.remove('minimized');
    fillTimeSelect('checkoutTimeSelect', timeStr, 'checkout');
    updateCheckoutPanelTitle();
    renderCheckoutPanelList(timeStr);
    syncDeskNoteLangToggleButtons();
}

function openNextAvailableModal() {
    const dateStr = document.getElementById('dateInput')?.value;
    const timeStr = document.getElementById('checkinTimeSelect')?.value;
    const listEl = document.getElementById('nextAvailableList');
    const modal = document.getElementById('nextAvailableModal');
    if (!listEl || !modal) return;
    if (!dateStr || !timeStr) {
        listEl.innerHTML = '<li class="next-available-empty">' + escapeHtml(uiT('next.modal.selectFirst', 'Select a date and time first.')) + '</li>';
        modal.style.display = '';
        return;
    }
    const data = currentData;
    const events = data?.events || [];
    const therapists = data?.therapists || [];
    const workingTodayNames = massageTherapistsWorkingOnDay(events, therapists, dateStr);
    const list = getNextAvailablePerTherapist(events, therapists, dateStr, timeStr);
    if (!list.length) {
        const emptyMsg = workingTodayNames.length
            ? uiT('next.modal.noRequestedRemaining', 'No masseuses with customer-requested massages remaining from this time.')
            : uiT('next.modal.noMasseuses', 'No masseuses configured for this day.');
        listEl.innerHTML = '<li class="next-available-empty">' + escapeHtml(emptyMsg) + '</li>';
            } else {
        listEl.innerHTML = list.map(({ name, freeAt }) => {
            const timeLabel = freeAt ? formatTimeFromISO(freeAt) : uiT('next.endsNow', 'Appointment ends now');
            return `<li><span class="next-available-name">${escapeHtml(name)}</span> <span class="next-available-time">${escapeHtml(timeLabel)}</span></li>`;
        }).join('');
    }
    modal.style.display = '';
}

function formatTimeFromISO(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    const prefix = uiT('next.endsAt', 'Appointment ends at');
    return `${prefix} ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function closeNextAvailableModal() {
    const modal = document.getElementById('nextAvailableModal');
    if (modal) modal.style.display = 'none';
}

let focusAreaModalState = { bookingId: null, date: null, slot: 1 };

function openFocusAreaModal(bookingId, date, focusAreaStr, slot = 1) {
    focusAreaModalState = { bookingId, date, slot };
    const container = document.getElementById('focusAreaCheckboxes');
    const otherInput = document.getElementById('focusAreaOther');
    if (!container || !otherInput) return;
    const rawTok = (focusAreaStr || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
    let sideChoice = '';
    if (rawTok.length && FOCUS_AREA_SIDE_TOKENS.has(rawTok[rawTok.length - 1])) {
        sideChoice = rawTok.pop();
    }
    const parsed = rawTok;
    const otherParts = parsed.filter((p) => !FOCUS_AREA_OPTIONS.includes(p));
    const preset = new Set(parsed.filter((p) => FOCUS_AREA_OPTIONS.includes(p)));
    if (preset.has('Lower back') && preset.has('Upper back')) preset.add('Back');
    if (FOCUS_LEG_SUBKEYS.every((k) => preset.has(k))) preset.add('Legs');
    const labelFor = (area) => (typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.focusAreaLabel)
        ? window.MOM_I18N.focusAreaLabel(area)
        : area;
    container.innerHTML = FOCUS_AREA_OPTIONS.map(area =>
        `<label class="focus-area-option"><input type="checkbox" class="focus-area-cb" value="${escapeHtml(area)}" ${preset.has(area) ? 'checked' : ''} /> ${escapeHtml(labelFor(area))}</label>`
    ).join('');
    otherInput.value = otherParts.join(', ');
    document.querySelectorAll('input[name="focusAreaSide"]').forEach((inp) => {
        inp.checked = (inp.value || '') === sideChoice;
    });
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
    updateFocusAreaBodyDiagram();
    const modal = document.getElementById('focusAreaModal');
    if (modal) modal.style.display = '';
}

function pushFocusDiagramEntries(positions, label) {
    const arr = FOCUS_AREA_DIAGRAM_MAP[label];
    if (!arr || !arr.length) return;
    const seen = new Set(positions.map((p) => `${p.v}|${p.x}|${p.y}|${p.r}`));
    for (const p of arr) {
        const k = `${p.v}|${p.x}|${p.y}|${p.r}`;
        if (seen.has(k)) continue;
        seen.add(k);
        positions.push(p);
    }
}

function getFocusAreaDiagramPositions() {
    const checked = Array.from(document.querySelectorAll('#focusAreaCheckboxes .focus-area-cb:checked')).map(cb => (cb.value || '').trim()).filter(Boolean);
    const otherText = (document.getElementById('focusAreaOther')?.value || '').trim();
    const otherTokens = otherText.split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const positions = [];
    checked.forEach((label) => pushFocusDiagramEntries(positions, label));
    otherTokens.forEach((word) => {
        const mapped = FOCUS_OTHER_TO_DIAGRAM[word];
        if (mapped) pushFocusDiagramEntries(positions, mapped);
    });
    return positions;
}

/** Inset/size of the visible bitmap when the <img> uses object-fit: contain (letterboxing). */
function getObjectFitContainInnerRect(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const rw = img.clientWidth;
    const rh = img.clientHeight;
    if (!rw || !rh) return null;
    const ir = img.naturalWidth / img.naturalHeight;
    const er = rw / rh;
    let drawW;
    let drawH;
    let offX;
    let offY;
    if (er > ir) {
        drawH = rh;
        drawW = rh * ir;
        offX = (rw - drawW) / 2;
        offY = 0;
    } else {
        drawW = rw;
        drawH = rw / ir;
        offX = 0;
        offY = (rh - drawH) / 2;
    }
    return { offX, offY, drawW, drawH };
}

function layoutFocusDiagramOverlay() {
    const frame = document.querySelector('#focusAreaBodyDiagram .focus-area-diagram-frame');
    const img = frame?.querySelector('.focus-area-body-img');
    const overlay = document.getElementById('focusAreaDiagramOverlays');
    if (!frame || !img || !overlay) return;
    const inner = getObjectFitContainInnerRect(img);
    if (!inner) {
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        return;
    }
    const { offX, offY, drawW, drawH } = inner;
    overlay.style.left = `${offX}px`;
    overlay.style.top = `${offY}px`;
    overlay.style.width = `${drawW}px`;
    overlay.style.height = `${drawH}px`;
}

function updateFocusAreaBodyDiagram() {
    const overlayEl = document.getElementById('focusAreaDiagramOverlays');
    const diagramEl = document.getElementById('focusAreaBodyDiagram');
    const imgEl = diagramEl?.querySelector('.focus-area-body-img');
    if (!overlayEl) return;
    layoutFocusDiagramOverlay();
    const positions = getFocusAreaDiagramPositions();
    overlayEl.innerHTML = '';
    for (let view = 0; view < 4; view++) {
        const viewPositions = positions.filter((p) => p.v === view);
        if (viewPositions.length === 0) continue;
        const panel = document.createElement('div');
        panel.className = 'focus-area-diagram-panel';
        panel.dataset.view = String(view);
        viewPositions.forEach(({ x, y, r }) => {
            const circle = document.createElement('div');
            circle.className = 'focus-area-diagram-circle';
            circle.style.left = `${x - r}%`;
            circle.style.top = `${y - r}%`;
            circle.style.width = `${r * 2}%`;
            circle.style.height = `${r * 2}%`;
            panel.appendChild(circle);
        });
        overlayEl.appendChild(panel);
    }
}

function closeFocusAreaModal() {
    const modal = document.getElementById('focusAreaModal');
    if (modal) modal.style.display = 'none';
}

async function saveFocusAreaModal() {
    const { bookingId, date, slot } = focusAreaModalState;
    if (!bookingId || !date) return;
    const checked = Array.from(document.querySelectorAll('#focusAreaCheckboxes .focus-area-cb:checked')).map(cb => cb.value.trim()).filter(Boolean);
    const other = (document.getElementById('focusAreaOther')?.value || '').trim().split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const sideInp = document.querySelector('input[name="focusAreaSide"]:checked');
    const side = sideInp && sideInp.value && FOCUS_AREA_SIDE_TOKENS.has(sideInp.value) ? sideInp.value : '';
    const parts = [...checked, ...other];
    if (side) parts.push(side);
    const focus_area = parts.join(', ');
    try {
        const res = await fetch('/api/focus-area', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: bookingId, date, focus_area: focus_area || null, slot: slot || 1 }) });
        if (res.ok) {
            closeFocusAreaModal();
            loadDay({ soft: true });
        }
    } catch (e) { console.error(e); }
}

function updateCheckinPanelTitle() {
    const title = document.querySelector('#checkinPanel .checkin-checkout-title');
    if (title) title.textContent = uiT('panel.checkins', 'Check-In');
}

function updateCheckoutPanelTitle() {
    const title = document.querySelector('#checkoutPanel .checkin-checkout-title');
    if (title) title.textContent = uiT('panel.checkouts', 'Check-Out');
}

function getDeskNotesForCustomerToday(customerId) {
    const cid = (customerId || '').trim();
    if (!cid || !currentData || !currentData.customer_desk_notes_today) return { checkin: null, checkout: null };
    const e = currentData.customer_desk_notes_today[cid];
    if (!e) return { checkin: null, checkout: null };
    return { checkin: e.checkin || null, checkout: e.checkout || null };
}

function mergeDeskNoteIntoCurrentData(customerId, date, kind, body) {
    if (!currentData || currentData.date !== date || !customerId) return;
    if (!currentData.customer_desk_notes_today) currentData.customer_desk_notes_today = {};
    const cur = currentData.customer_desk_notes_today[customerId] || { checkin: null, checkout: null };
    const t = (body && String(body).trim()) ? String(body).trim() : null;
    cur[kind] = t;
    currentData.customer_desk_notes_today[customerId] = cur;
}

let momCustomerDeskNoteState = { customerId: null, bookingId: null, date: null, kind: null, onSaved: null };
let momCustomerDeskNoteModalBound = false;

function closeCustomerDeskNoteModal() {
    const modal = document.getElementById('customerDeskNoteModal');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    momCustomerDeskNoteState = { customerId: null, bookingId: null, date: null, kind: null, onSaved: null };
}

function initCustomerDeskNoteModal() {
    if (momCustomerDeskNoteModalBound) return;
    momCustomerDeskNoteModalBound = true;
    const modal = document.getElementById('customerDeskNoteModal');
    const ta = document.getElementById('customerDeskNoteTextarea');
    const saveBtn = modal?.querySelector('.customer-desk-note-save-btn');
    const cancelBtn = modal?.querySelector('.customer-desk-note-cancel-btn');
    const closeBtn = modal?.querySelector('.customer-desk-note-close');
    const backdrop = modal?.querySelector('.customer-desk-note-backdrop');
    function doSave() {
        const st = momCustomerDeskNoteState;
        if (!st.customerId || !st.date || !st.kind) return;
        const body = (ta && ta.value) ? ta.value.trim() : '';
        fetch('/api/customer-desk-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_id: st.customerId,
                date: st.date,
                booking_id: st.bookingId || null,
                note_kind: st.kind,
                body,
            }),
        })
            .then((r) => {
                if (!r.ok) return r.json().then((j) => Promise.reject(new Error(j.detail || 'Save failed')));
                mergeDeskNoteIntoCurrentData(st.customerId, st.date, st.kind, body);
                const cb = st.onSaved;
                closeCustomerDeskNoteModal();
                if (typeof cb === 'function') cb();
            })
            .catch((err) => {
                console.error(err);
                alert(err.message || uiT('deskNote.saveFailed', 'Could not save note.'));
            });
    }
    saveBtn?.addEventListener('click', doSave);
    cancelBtn?.addEventListener('click', closeCustomerDeskNoteModal);
    closeBtn?.addEventListener('click', closeCustomerDeskNoteModal);
    backdrop?.addEventListener('click', closeCustomerDeskNoteModal);
}

function openCustomerDeskNoteModal(opts) {
    hideMomDeskNoteTooltipNow();
    initCustomerDeskNoteModal();
    const modal = document.getElementById('customerDeskNoteModal');
    const ta = document.getElementById('customerDeskNoteTextarea');
    const titleEl = document.getElementById('customerDeskNoteModalTitle');
    if (!modal || !ta || !titleEl) return;
    const { customerId, bookingId, date, kind, onSaved } = opts;
    if (!customerId || !date || !kind) return;
    momCustomerDeskNoteState = { customerId, bookingId: bookingId || null, date, kind, onSaved };
    const prev = getDeskNotesForCustomerToday(customerId);
    ta.value = (kind === 'checkout' ? (prev.checkout || '') : (prev.checkin || '')) || '';
    ta.placeholder = uiT('deskNote.placeholder', 'Short note for staff on future visits…');
    const title =
        kind === 'checkout'
            ? uiT('deskNote.modalTitleCheckout', 'Checkout — desk note')
            : uiT('deskNote.modalTitleCheckin', 'Check-in — desk note');
    titleEl.textContent = title;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
        try {
            ta.focus();
            ta.select();
        } catch (e) { /* ignore */ }
    }, 50);
}

function deskNoteQuickButtonHtml(ev, kind) {
    const cid = (ev.customer_id || '').trim();
    if (!cid) return '';
    const prev = getDeskNotesForCustomerToday(cid);
    const saved = (kind === 'checkout' ? (prev.checkout || '') : (prev.checkin || '')).trim();
    const baseTitle =
        kind === 'checkout'
            ? uiT('deskNote.quickCheckoutTitle', 'Checkout desk note (saved for this customer)')
            : uiT('deskNote.quickCheckinTitle', 'Check-in desk note (saved for this customer)');
    const hasCls = saved ? ' desk-note-quick-btn--has-note' : '';
    const dataAttr = saved ? ` data-desk-note-body="${encodeURIComponent(saved)}"` : '';
    return (
        `<button type="button" class="desk-note-quick-btn${hasCls}" data-desk-kind="${escapeHtml(kind)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-customer-id="${escapeHtml(cid)}" title="${escapeHtml(baseTitle)}"${dataAttr}>📝</button>`
    );
}

function checkoutCheckinHoverIndicatorHtml(ev) {
    const cid = (ev.customer_id || '').trim();
    if (!cid) return '';
    const cin = (getDeskNotesForCustomerToday(cid).checkin || '').trim();
    if (!cin) return '';
    return `<span class="checkout-checkin-note-indicator" data-desk-note-body="${encodeURIComponent(cin)}" title="${escapeHtml(uiT('deskNote.checkinHoverShort', 'Check-in note (hover for text)'))}">📋</span>`;
}

let momDeskNoteTooltipHideT = null;
function ensureMomDeskNoteTooltipEl() {
    let el = document.getElementById('momDeskNoteTooltip');
    if (!el) {
        el = document.createElement('div');
        el.id = 'momDeskNoteTooltip';
        el.className = 'mom-desk-note-tooltip';
        el.setAttribute('role', 'tooltip');
        el.style.display = 'none';
        document.body.appendChild(el);
    }
    return el;
}
function showMomDeskNoteTooltip(targetEl) {
    const tip = ensureMomDeskNoteTooltipEl();
    if (!targetEl) return;
    let display = '';
    const bodyEnc = targetEl.getAttribute('data-desk-note-body');
    const legacyEnc = targetEl.getAttribute('data-desk-tooltip');
    if (targetEl.classList && targetEl.classList.contains('checkout-checkin-note-indicator')) {
        let raw = '';
        try {
            raw = bodyEnc ? decodeURIComponent(bodyEnc) : '';
        } catch (e) {
            return;
        }
        const title = uiT('deskNote.checkinHoverTitle', "Today's check-in desk note");
        display = title + ': ' + formatDeskNotePreviewBody(raw);
    } else {
        const enc = bodyEnc || legacyEnc;
        if (!enc) return;
        let raw = '';
        try {
            raw = decodeURIComponent(enc);
        } catch (e) {
            return;
        }
        if (!raw) return;
        display = formatDeskNotePreviewBody(raw);
    }
    if (!display) return;
    if (momDeskNoteTooltipHideT) {
        clearTimeout(momDeskNoteTooltipHideT);
        momDeskNoteTooltipHideT = null;
    }
    tip.textContent = display;
    tip.style.display = 'block';
}
function hideMomDeskNoteTooltipSoon() {
    if (momDeskNoteTooltipHideT) clearTimeout(momDeskNoteTooltipHideT);
    momDeskNoteTooltipHideT = setTimeout(() => {
        const tip = document.getElementById('momDeskNoteTooltip');
        if (tip) tip.style.display = 'none';
        momDeskNoteTooltipHideT = null;
    }, 180);
}
function hideMomDeskNoteTooltipNow() {
    if (momDeskNoteTooltipHideT) clearTimeout(momDeskNoteTooltipHideT);
    momDeskNoteTooltipHideT = null;
    const tip = document.getElementById('momDeskNoteTooltip');
    if (tip) tip.style.display = 'none';
}

function bindDeskNoteHoverPreviews(listEl) {
    if (!listEl) return;
    ensureMomDeskNoteTooltipEl();
    listEl.querySelectorAll('[data-desk-note-body], [data-desk-tooltip]').forEach((el) => {
        if (el._momDeskTooltipBound) return;
        el._momDeskTooltipBound = true;
        el.addEventListener('mouseenter', () => {
            showMomDeskNoteTooltip(el);
        });
        el.addEventListener('mouseleave', () => hideMomDeskNoteTooltipSoon());
    });
}

function bindDeskNoteQuickButtons(listEl, dateStr, panelKind) {
    listEl.querySelectorAll('.desk-note-quick-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const kind = btn.dataset.deskKind;
            const customerId = btn.dataset.customerId;
            const bookingId = btn.dataset.bookingId;
            if (!dateStr || !customerId || !kind) return;
            openCustomerDeskNoteModal({
                customerId,
                bookingId,
                date: dateStr,
                kind,
                onSaved: () => {
                    const selId = panelKind === 'checkout' ? 'checkoutTimeSelect' : 'checkinTimeSelect';
                    const sel = document.getElementById(selId);
                    const v = sel && sel.value;
                    if (panelKind === 'checkout' && v) renderCheckoutPanelList(v);
                    else if (v) renderCheckinPanelList(v);
                },
            });
        });
    });
    bindDeskNoteHoverPreviews(listEl);
}

function dedupeCustomerDeskNoteItems(items) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
        const nk = (it.note_kind || '').toLowerCase();
        const body = (it.body || '').trim();
        const key = `${it.date || ''}|${nk}|${body}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
    }
    return out;
}

/** New Appointments (Square): modal listing reservations by created_at (newest first). */
let momNewAppointmentsLastRows = [];
let momNewAppointmentsEscapeHandler = null;

function formatNewApptsBookedAtLabel(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '—';
        return `${formatTimeCompactUS(d)} ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } catch (_) {
        return '—';
    }
}

function newApptsBookedByLabel(v) {
    const s = String(v || '').toLowerCase();
    if (s === 'customer') return uiT('newAppts.bookedByCustomer', 'Customer');
    if (s === 'us') return uiT('newAppts.bookedByUs', 'Us');
    return (v && String(v).trim()) || '—';
}

function newApptsCustomerHasRisk(row) {
    if (!row) return false;
    if (row.had_square_no_show) return true;
    return !!(row.online_only_note && String(row.online_only_note).trim());
}

function newApptsRiskSummaryText(row) {
    const parts = [];
    if (row.had_square_no_show) {
        parts.push(uiT('newAppts.riskNoShow', 'No-show on file (in loaded Square history)'));
    }
    const note = (row.online_only_note || '').trim();
    if (note) {
        parts.push(`${uiT('newAppts.riskProfilePrefix', 'Square profile:')} ${note}`);
    }
    return parts.join(' · ') || '—';
}

function newApptsAppointmentSlotLabel(row) {
    if (!row || !row.start_at || !row.end_at) return '—';
    try {
        const s = new Date(row.start_at);
        const e = new Date(row.end_at);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '—';
        const datePart = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        return `${datePart} · ${formatTimeRangeSmart(s, e)}`;
    } catch (_) {
        return '—';
    }
}

function refreshNewAppointmentsModalTable() {
    const tbody = document.getElementById('newAppointmentsTbody');
    const emptyEl = document.getElementById('newAppointmentsEmpty');
    const wrap = document.getElementById('newAppointmentsTableWrap');
    const exportBtn = document.getElementById('newAppointmentsExportBtn');
    const mockBanner = document.getElementById('newAppointmentsMockBanner');
    const sel = document.getElementById('newAppointmentsLimitSelect');
    if (!tbody || !emptyEl || !wrap) return;
    const limit = sel ? parseInt(String(sel.value || '10'), 10) : 10;
    const lim = Number.isFinite(limit) && limit >= 1 && limit <= 30 ? limit : 10;
    tbody.innerHTML = `<tr><td colspan="8" class="desk-notes-history-loading">${escapeHtml(uiT('newAppts.loading', 'Loading…'))}</td></tr>`;
    emptyEl.hidden = true;
    wrap.hidden = false;
    if (exportBtn) exportBtn.disabled = true;
    fetch(`/api/recent-booked-appointments?limit=${lim}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
            momNewAppointmentsLastRows = Array.isArray(data.items) ? data.items : [];
            if (mockBanner) {
                mockBanner.hidden = !!data.using_real_api;
            }
            if (!momNewAppointmentsLastRows.length) {
                tbody.innerHTML = '';
                emptyEl.textContent = uiT('newAppts.empty', 'No bookings returned.');
                emptyEl.hidden = false;
                wrap.hidden = true;
                if (exportBtn) exportBtn.disabled = true;
                return;
            }
            emptyEl.hidden = true;
            wrap.hidden = false;
            if (exportBtn) exportBtn.disabled = false;
            tbody.innerHTML = momNewAppointmentsLastRows
                .map((row) => {
                    const risk = newApptsCustomerHasRisk(row);
                    const custCell = risk
                        ? `<span class="new-appts-customer--risk">${escapeHtml(row.customer || '—')}</span>`
                        : escapeHtml(row.customer || '—');
                    const st = (row.square_status || '').trim();
                    const stSpan =
                        st === 'NO_SHOW'
                            ? `<span class="new-appts-status-noshow">${escapeHtml(uiT('newAppts.statusNoshow', 'NO_SHOW'))}</span>`
                            : escapeHtml(st || '—');
                    return `<tr>
                        <td>${escapeHtml(formatNewApptsBookedAtLabel(row.created_at))}</td>
                        <td>${escapeHtml(newApptsAppointmentSlotLabel(row))}</td>
                        <td>${custCell}</td>
                        <td>${escapeHtml(row.service || '—')}</td>
                        <td>${escapeHtml((row.therapist || '').trim() || '—')}</td>
                        <td>${stSpan}</td>
                        <td>${escapeHtml(newApptsBookedByLabel(row.booked_by))}</td>
                        <td class="new-appts-col-risk">${escapeHtml(newApptsRiskSummaryText(row))}</td>
                    </tr>`;
                })
                .join('');
        })
        .catch(() => {
            momNewAppointmentsLastRows = [];
            tbody.innerHTML = '';
            emptyEl.textContent = uiT('newAppts.error', 'Could not load data.');
            emptyEl.hidden = false;
            wrap.hidden = true;
            if (exportBtn) exportBtn.disabled = true;
            if (mockBanner) mockBanner.hidden = true;
        });
}

function momCloseNewAppointmentsModal() {
    const modal = document.getElementById('newAppointmentsModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    if (momNewAppointmentsEscapeHandler) {
        document.removeEventListener('keydown', momNewAppointmentsEscapeHandler);
        momNewAppointmentsEscapeHandler = null;
    }
}

function momOpenNewAppointmentsModal() {
    const modal = document.getElementById('newAppointmentsModal');
    if (!modal) return;
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    if (momNewAppointmentsEscapeHandler) {
        document.removeEventListener('keydown', momNewAppointmentsEscapeHandler);
    }
    momNewAppointmentsEscapeHandler = (e) => {
        if (e.key === 'Escape') momCloseNewAppointmentsModal();
    };
    document.addEventListener('keydown', momNewAppointmentsEscapeHandler);
    refreshNewAppointmentsModalTable();
}

function buildNewAppointmentsCsv() {
    const headers = [
        'Booked at',
        'Appointment',
        'Customer',
        'Service',
        'Masseuse',
        'Square status',
        'Booked by',
        'Prepay/risk',
    ];
    const lines = [headers.map(escapeCsvField).join(',')];
    for (const row of momNewAppointmentsLastRows || []) {
        const cells = [
            formatNewApptsBookedAtLabel(row.created_at),
            newApptsAppointmentSlotLabel(row),
            row.customer || '—',
            row.service || '—',
            (row.therapist || '').trim() || '—',
            (row.square_status || '').trim() || '—',
            newApptsBookedByLabel(row.booked_by),
            newApptsRiskSummaryText(row),
        ];
        lines.push(cells.map(escapeCsvField).join(','));
    }
    return lines.join('\n');
}

function downloadNewAppointmentsCsv() {
    if (!momNewAppointmentsLastRows || !momNewAppointmentsLastRows.length) return;
    const csv = buildNewAppointmentsCsv();
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = URL.createObjectURL(blob);
    a.download = `new_appointments_square_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function initNewAppointmentsReport() {
    const openBtn = document.getElementById('newAppointmentsListBtn');
    const modal = document.getElementById('newAppointmentsModal');
    const backdrop = document.getElementById('newAppointmentsBackdrop');
    const closeBtn = document.getElementById('newAppointmentsCloseBtn');
    const exportBtn = document.getElementById('newAppointmentsExportBtn');
    const refreshBtn = document.getElementById('newAppointmentsRefreshBtn');
    const limitSel = document.getElementById('newAppointmentsLimitSelect');
    if (!openBtn || !modal) return;
    openBtn.addEventListener('click', () => momOpenNewAppointmentsModal());
    if (backdrop) backdrop.addEventListener('click', () => momCloseNewAppointmentsModal());
    if (closeBtn) closeBtn.addEventListener('click', () => momCloseNewAppointmentsModal());
    if (exportBtn) exportBtn.addEventListener('click', () => downloadNewAppointmentsCsv());
    if (refreshBtn) refreshBtn.addEventListener('click', () => refreshNewAppointmentsModalTable());
    if (limitSel) limitSel.addEventListener('change', () => refreshNewAppointmentsModalTable());
}

function loadCustomerDeskNotesHistoryInto(container, customerId) {
    if (!container || !customerId) return;
    fetch(`/api/customer-desk-notes?customer_id=${encodeURIComponent(customerId)}&limit=40`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
            const items = dedupeCustomerDeskNoteItems(data.items || []);
            if (!items.length) {
                container.innerHTML =
                    '<span class="desk-notes-history-empty">' +
                    escapeHtml(uiT('deskNote.historyEmpty', 'No saved desk notes yet.')) +
                    '</span>';
                return;
            }
            const linesHtml = items
                .map((it) => {
                    const nk = (it.note_kind || '').toLowerCase();
                    const kindLabel =
                        nk === 'checkout'
                            ? uiT('deskNote.kindCheckout', 'Checkout')
                            : uiT('deskNote.kindCheckin', 'Check-in');
                    return (
                        '<div class="desk-notes-history-line"><span class="desk-notes-history-meta">' +
                        escapeHtml(it.date) +
                        ' · ' +
                        escapeHtml(kindLabel) +
                        '</span><div class="desk-notes-history-body">' +
                        escapeHtml(it.body || '') +
                        '</div></div>'
                    );
                })
                .join('');
            container.innerHTML = '<div class="desk-notes-history-postit">' + linesHtml + '</div>';
        })
        .catch(() => {
            container.innerHTML =
                '<span class="desk-notes-history-empty">' +
                escapeHtml(uiT('deskNote.historyError', 'Could not load notes.')) +
                '</span>';
        });
}

function renderCheckinPanelList(timeStr) {
    const listEl = document.getElementById('checkinPanelList');
    if (!listEl) return;
    const dateStr = document.getElementById('dateInput')?.value;
    const data = currentData;
    const events = data?.events || [];
    const therapists = data?.therapists || [];
    const items = getEventsAtStartTime(events, dateStr, timeStr);
    if (!items.length) {
        listEl.innerHTML = '<p class="checkin-checkout-empty">' + escapeHtml(uiT('checkin.empty', 'No appointments at this time.')) + '</p>';
        listEl._momCheckinAssignOrder = [];
        mountCheckinStaffPoolStrip({ displayNames: [] });
        return;
    }
    const isCouple = (ev) => (ev.type || '').toLowerCase() === 'couple';
    const lastPressure = (data && data.customer_last_pressure) ? data.customer_last_pressure : {};
    const pressureOptsHtml = uiPressureOptionsHtml();
    const { dup, noteIdx, crItems } = getMomCustomerRequestMatchContext();
    const massageAvailOrdered = getMassageStaffPickOrderedNamesForDate(dateStr);
    const slotDisplayMap = buildCheckinSliceSlotDisplayMap(items, therapists, crItems, dup, data?.therapist_order, massageAvailOrdered, false);
    const effExtra = { noteIdx, checkinBlankNonRequested: true };
    function effDisp(ev, slot) {
        return effectiveCheckinTherapistDisplay(ev, slot, therapists, crItems, dup, slotDisplayMap, items, massageAvailOrdered, effExtra);
    }
    const poolStripPayload = buildCheckinStaffPoolStripPayload(
        dateStr, timeStr, items, events, therapists, data?.therapist_order, massageAvailOrdered, dup, crItems, noteIdx, slotDisplayMap
    );
    listEl._momCheckinAssignOrder = poolStripPayload.assignOrder || [];
    mountCheckinStaffPoolStrip(poolStripPayload);
    function checkinTherapistSelectRequestedClass(ev, slot) {
        const display = effDisp(ev, slot);
        if (!display || isSlotTherapistUnset(display)) return '';
        if (String(ev.type || '').toLowerCase() === 'couple' && slot === 2) {
            const sec = coupleSlot2CustomerRequestedCanonical(ev, therapists, dup, crItems, massageAvailOrdered);
            return (sec && therapistNamesMatchForCalendar(display, sec, dup)) ? ' checkin-therapist-select--requested' : '';
        }
        return checkinTherapistMatchesCustomerRequestHighlight(display, ev, therapists, dup, noteIdx, crItems) ? ' checkin-therapist-select--requested' : '';
    }
    function syncCheckinTherapistSelectRequestedClass(sel, ev) {
        if (!sel || !ev) return;
        const { therapists: t0, dup: d0, noteIdx: n0, crItems: c0 } = getMomCustomerRequestMatchContext();
        const v = String(sel.value || '').trim();
        const slot = parseInt(sel.dataset.slot, 10) || 1;
        const dateStrSync = document.getElementById('dateInput')?.value;
        const massageOrdSync = getMassageStaffPickOrderedNamesForDate(dateStrSync);
        let isReq = false;
        if (v && !isSlotTherapistUnset(v)) {
            if (String(ev.type || '').toLowerCase() === 'couple' && slot === 2) {
                const sec = coupleSlot2CustomerRequestedCanonical(ev, t0, d0, c0, massageOrdSync);
                isReq = !!(sec && therapistNamesMatchForCalendar(v, sec, d0));
            } else {
                isReq = checkinTherapistMatchesCustomerRequestHighlight(v, ev, t0, d0, n0, c0);
            }
        }
        sel.classList.toggle('checkin-therapist-select--requested', isReq);
        if (isReq) sel.setAttribute('title', uiT('staff.availTurnTipRequestedAria', 'Customer requested this therapist'));
        else sel.removeAttribute('title');
    }
    listEl.innerHTML = items.map(ev => {
        const name = formatCustomerFirstLastInitial(ev.customer);
        const rawCheckinSvc = uiCatalogLine(
            (ev.display_service && ev.display_service.trim()) ? ev.display_service.trim() : (ev.service || '—')
        );
        const service = calendarStripPainReliefOilFromServiceLine(rawCheckinSvc).trim() || '—';
        const bianStoneCheckinHtml = appointmentBianStoneIconHtml(ev);
        const duration = formatDurationMinutes(getDurationMinutes(ev));
        const isAddonBillOnly = (ev.room || '').trim() === 'ADDON';
        if (isAddonBillOnly) {
            const mainRm = resolveMainRoomForAddonBooking(ev, events);
            const billTitle = escapeHtml(uiT('checkin.addonBillTitle', 'Retail / add-on: charge at checkout with the main massage. No separate check-in, checkout, or room.'));
            const roomHtml = mainRm
                ? `${escapeHtml(formatRoomForPanel(mainRm))} <span class="checkin-addon-main-room-hint">${escapeHtml(uiT('checkin.addonMainRoomHint', '(main massage)'))}</span>`
                : escapeHtml(formatRoomForPanel(ev.room));
            return `<div class="checkin-checkout-row checkin-checkout-row--addon-bill" data-booking-id="${escapeHtml(ev.booking_id)}" data-customer-id="${escapeHtml(ev.customer_id || '')}">
            <div class="checkin-checkout-row-info">
                <span class="checkin-checkout-row-name-wrap">
                    <span class="checkin-checkout-row-name">${escapeHtml(name)}</span>
                    ${deskNoteQuickButtonHtml(ev, 'checkin')}
                </span>
                <span class="checkin-checkout-row-room">${roomHtml}</span>
                <span class="checkin-checkout-row-service">${escapeHtml(service)}${bianStoneCheckinHtml}</span>
                <span class="checkin-checkout-row-length">${duration}</span>
            </div>
            <div class="checkin-checkout-row-addon-bill" title="${billTitle}"><span class="checkin-addon-bill-marker" aria-label="${billTitle}">$</span></div>
        </div>`;
        }
        const cur1 = effDisp(ev, 1);
        const cur2 = effDisp(ev, 2);
        const opts1 = therapistOptionsFor(therapists, cur1, massageAvailOrdered, true);
        const opts2 = therapistOptionsFor(therapists, cur2, massageAvailOrdered, true);
        const checkedIn = !!(ev.arrived_at_1);
        const couple = isCouple(ev);
        let srmExtrasBlock;
        if (couple) {
            const pressure1 = (ev.pressure && ev.pressure.trim()) ? ev.pressure.trim() : (lastPressure[ev.customer_id] || '');
            const pressure2 = (ev.pressure_2 && ev.pressure_2.trim()) ? ev.pressure_2.trim() : '';
            const focusCount1 = ev.focus_area ? (ev.focus_area.split(/[,;]/).map(s => s.trim()).filter(Boolean).length) : 0;
            const focusCount2 = ev.focus_area_2 ? (ev.focus_area_2.split(/[,;]/).map(s => s.trim()).filter(Boolean).length) : 0;
            const focusLabel1 = uiFocusLabel(focusCount1);
            const focusLabel2 = uiFocusLabel(focusCount2);
            const focusList1 = (ev.focus_area || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
            const focusList2 = (ev.focus_area_2 || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
            const m1l = uiT('label.m1', 'M1:');
            const m2l = uiT('label.m2', 'M2:');
            const focusListHtml = (focusList1.length || focusList2.length) ? `<div class="checkin-focus-areas-list">${focusList1.length ? `<div class="checkin-focus-areas-line"><span class="checkin-focus-areas-label">${escapeHtml(m1l)}</span> ${escapeHtml(uiFocusAreasDisplay(focusList1.join(', ')))}</div>` : ''}${focusList2.length ? `<div class="checkin-focus-areas-line"><span class="checkin-focus-areas-label">${escapeHtml(m2l)}</span> ${escapeHtml(uiFocusAreasDisplay(focusList2.join(', ')))}</div>` : ''}</div>` : '';
            const srm1 = escapeHtml(uiT('label.srm1', 'Masseuse 1'));
            const srm2 = escapeHtml(uiT('label.srm2', 'Masseuse 2'));
            const pressL = escapeHtml(uiT('label.pressure', 'Pressure'));
            const openFocusT = escapeHtml(uiT('focus.openTitle', 'Open focus popup'));
            const openFocusA = escapeHtml(uiT('focus.openAria', 'Open focus'));
            const srmBlock1 = `<div class="checkin-checkout-row-srm"><label>${srm1}</label><select class="checkin-therapist-select${checkinTherapistSelectRequestedClass(ev, 1)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="1">${opts1}</select></div><span class="checkin-pressure-wrap"><label>${pressL}</label><select class="checkin-pressure-select" data-booking-id="${escapeHtml(ev.booking_id)}" data-customer-id="${escapeHtml(ev.customer_id || '')}" data-slot="1">${pressureOptsHtml}</select></span><label class="checkin-focus-wrap" title="${openFocusT}"><input type="checkbox" class="checkin-focus-cb" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="1" ${focusCount1 ? 'checked' : ''} aria-label="${openFocusA}" /><span class="checkin-focus-label">${escapeHtml(focusLabel1)}</span></label>`;
            const srmBlock2 = `<div class="checkin-checkout-row-srm"><label>${srm2}</label><select class="checkin-therapist-select${checkinTherapistSelectRequestedClass(ev, 2)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="2">${opts2}</select></div><span class="checkin-pressure-wrap"><label>${pressL}</label><select class="checkin-pressure-select" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="2">${pressureOptsHtml}</select></span><label class="checkin-focus-wrap" title="${openFocusT}"><input type="checkbox" class="checkin-focus-cb" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="2" ${focusCount2 ? 'checked' : ''} aria-label="${openFocusA}" /><span class="checkin-focus-label">${escapeHtml(focusLabel2)}</span></label>`;
            srmExtrasBlock = `<div class="checkin-checkout-row-srm-extras-wrap"><div class="checkin-checkout-row-srm-extras checkin-couple-row-extras">${srmBlock1}${srmBlock2}</div>${focusListHtml}</div>`;
        } else {
            const pressureVal = (ev.pressure && ev.pressure.trim()) ? ev.pressure.trim() : (lastPressure[ev.customer_id] || '');
            const focusCount = ev.focus_area ? (ev.focus_area.split(/[,;]/).map(s => s.trim()).filter(Boolean).length) : 0;
            const focusLabel = uiFocusLabel(focusCount);
            const focusList = (ev.focus_area || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
            const focusListHtml = focusList.length ? `<div class="checkin-focus-areas-list"><div class="checkin-focus-areas-line">${escapeHtml(uiFocusAreasDisplay(focusList.join(', ')))}</div></div>` : '';
            const srmL = escapeHtml(uiT('label.srm', 'Masseuse'));
            const pressL2 = escapeHtml(uiT('label.pressure', 'Pressure'));
            const openFocusT2 = escapeHtml(uiT('focus.openTitle', 'Open focus popup'));
            const openFocusA2 = escapeHtml(uiT('focus.openAria', 'Open focus area'));
            const durationMinSingle = getDurationMinutes(ev);
            const splitActive = ev.split_minutes_first != null;
            const defaultHalf = durationMinSingle ? Math.floor(durationMinSingle / 2) : 30;
            const minFirstDisplay = splitActive ? Number(ev.split_minutes_first) : defaultHalf;
            const srmBlock = `<div class="checkin-checkout-row-srm"><label>${srmL}</label><select class="checkin-therapist-select${checkinTherapistSelectRequestedClass(ev, 1)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="1">${opts1}</select></div>`;
            const splitLbl = escapeHtml(uiT('checkin.split', 'Split'));
            const min1st = escapeHtml(uiT('checkout.minFirst', 'Min (1st)'));
            const minPh = escapeHtml(uiT('checkout.minPlaceholder', 'min'));
            const srm2L = escapeHtml(uiT('label.srm2', 'Masseuse 2'));
            const minTitle = escapeHtml(uiT('checkin.splitMinutesTitle', 'Minutes for first masseuse (Masseuse 1 row); remainder for second; pay & tips prorate by time'));
            const minBlock = splitActive
                ? `<div class="checkin-checkout-row-split-min checkin-split-min-with-srm1"><label>${min1st}</label><input type="number" min="0" max="${durationMinSingle || 999}" step="1" class="checkin-split-min-input" data-booking-id="${escapeHtml(ev.booking_id)}" data-duration-max="${durationMinSingle || ''}" value="${minFirstDisplay}" placeholder="${minPh}" title="${minTitle}" /></div>`
                : '';
            const splitChk = `<label class="checkin-split-wrap"><input type="checkbox" class="checkin-split-cb" data-booking-id="${escapeHtml(ev.booking_id)}" data-duration-min="${durationMinSingle || ''}" ${splitActive ? 'checked' : ''} /> ${splitLbl}</label>`;
            const secondRow = splitActive
                ? `<div class="checkin-split-follow-row"><div class="checkin-checkout-row-srm"><label>${srm2L}</label><select class="checkin-therapist-select${checkinTherapistSelectRequestedClass(ev, 2)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="2">${opts2}</select></div></div>`
                : '';
            srmExtrasBlock = `<div class="checkin-checkout-row-srm-extras-wrap"><div class="checkin-checkout-row-srm-extras checkin-single-row-extras">${srmBlock}<span class="checkin-pressure-wrap"><label>${pressL2}</label><select class="checkin-pressure-select" data-booking-id="${escapeHtml(ev.booking_id)}" data-customer-id="${escapeHtml(ev.customer_id || '')}">${pressureOptsHtml}</select></span><label class="checkin-focus-wrap" title="${openFocusT2}"><input type="checkbox" class="checkin-focus-cb" data-booking-id="${escapeHtml(ev.booking_id)}" ${focusCount ? 'checked' : ''} aria-label="${openFocusA2}" /><span class="checkin-focus-label">${escapeHtml(focusLabel)}</span></label>${minBlock}${splitChk}</div>${secondRow}${focusListHtml}</div>`;
        }
        const inTitle = escapeHtml(uiT('checkin.inTitle', 'Checked in'));
        const inLbl = escapeHtml(uiT('checkin.in', 'In'));
        return `<div class="checkin-checkout-row" data-booking-id="${escapeHtml(ev.booking_id)}" data-customer-id="${escapeHtml(ev.customer_id || '')}">
            <div class="checkin-checkout-row-done">
                <label class="checkin-checkout-done-label" title="${inTitle}"><input type="checkbox" class="checkin-done-cb" data-booking-id="${escapeHtml(ev.booking_id)}" ${checkedIn ? 'checked' : ''} /> ${inLbl}</label>
            </div>
            <div class="checkin-checkout-row-info">
                <span class="checkin-checkout-row-name-wrap">
                    <span class="checkin-checkout-row-name">${escapeHtml(name)}</span>
                    ${deskNoteQuickButtonHtml(ev, 'checkin')}
                </span>
                <span class="checkin-checkout-row-room">${escapeHtml(formatRoomForPanel(ev.room))}</span>
                <span class="checkin-checkout-row-service">${escapeHtml(service)}${bianStoneCheckinHtml}</span>
                <span class="checkin-checkout-row-length">${duration}</span>
            </div>
            ${srmExtrasBlock}
        </div>`;
    }).join('');
    bindDeskNoteQuickButtons(listEl, dateStr, 'checkin');
    listEl.querySelectorAll('.checkin-therapist-select').forEach(sel => {
        const bid = sel.dataset.bookingId;
        const slot = parseInt(sel.dataset.slot, 10) || 1;
        const ev = items.find(e => e.booking_id === bid);
        if (ev) {
            const display = effDisp(ev, slot);
            sel.value = display;
            sel.dataset.initialTherapistDisplay = display;
            syncCheckinTherapistSelectRequestedClass(sel, ev);
        }
    });
    function normalizePressureToMed(p) {
        if (!p || typeof p !== 'string') return '';
        const s = p.trim();
        if (s === 'medium') return 'med';
        if (s === 'deep/medium') return 'deep/med';
        if (s === 'medium/light') return 'med/light';
        return s;
    }
    listEl.querySelectorAll('.checkin-pressure-select').forEach(sel => {
        const bid = sel.dataset.bookingId;
        const slot = parseInt(sel.dataset.slot, 10) || 1;
        const ev = items.find(e => e.booking_id === bid);
        if (ev) {
            const raw = slot === 2
                ? ((ev.pressure_2 && ev.pressure_2.trim()) ? ev.pressure_2.trim() : '')
                : ((ev.pressure && ev.pressure.trim()) ? ev.pressure.trim() : (lastPressure[ev.customer_id] || ''));
            const v = normalizePressureToMed(raw);
            sel.value = PRESSURE_OPTIONS.includes(v) ? v : '';
        }
    });
    listEl.querySelectorAll('.checkin-done-cb').forEach(cb => {
        cb.addEventListener('change', async () => {
            if (!cb.checked) return;
            const bid = cb.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            const row = cb.closest('.checkin-checkout-row');
            const evRow = items.find(e => e.booking_id === bid);
            const order = listEl._momCheckinAssignOrder;
            const { therapists: tAs, dup: dAs, noteIdx: nAs, crItems: cAs } = getMomCustomerRequestMatchContext();
            try {
                if (row && evRow && order && order.length) {
                    const usedNow = collectUsedTherapistsInCheckinList(listEl, tAs, dAs);
                    const selects = row.querySelectorAll('.checkin-therapist-select');
                    for (const sel of selects) {
                        const cur = String(sel.value || '').trim();
                        if (cur && !isSlotTherapistUnset(cur)) continue;
                        let pick = pickNextAssignableFromCheckinStrip(order, usedNow);
                        if (!pick) break;
                        const slot = parseInt(sel.dataset.slot, 10) || 1;
                        const initial = sel.dataset.initialTherapistDisplay || '';
                        const prompt = therapistChangeConfirmPrompt(initial, pick, evRow, tAs, dAs, nAs, cAs, slot);
                        if (prompt && !confirm(prompt)) break;
                        const tr = await fetch('/api/therapist', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ booking_id: bid, date, therapist: pick, locked: true, slot }),
                        });
                        if (!tr.ok) break;
                        sel.value = pick;
                        sel.dataset.initialTherapistDisplay = pick;
                        syncCheckinTherapistSelectRequestedClass(sel, evRow);
                        usedNow.add(String(pick).trim().toLowerCase());
                    }
                }
                const res = await fetch('/api/check-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: bid, date, client_index: 1 }) });
                if (res.ok) loadDay({ soft: true });
            } catch (e) { console.error(e); }
        });
    });
    listEl.querySelectorAll('.checkin-therapist-select').forEach(sel => {
        sel.addEventListener('change', async () => {
            const bid = sel.dataset.bookingId;
            const slot = parseInt(sel.dataset.slot, 10) || 1;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            const ev = (currentData && currentData.events || []).find(e => e.booking_id === bid);
            const initial = sel.dataset.initialTherapistDisplay || '';
            const newVal = sel.value;
            syncCheckinTherapistSelectRequestedClass(sel, ev);
            const { therapists: tcf, dup: dcf, noteIdx: nicf, crItems: crcf } = getMomCustomerRequestMatchContext();
            const prompt = therapistChangeConfirmPrompt(initial, newVal, ev, tcf, dcf, nicf, crcf, slot);
            if (prompt && !confirm(prompt)) {
                sel.value = initial;
                syncCheckinTherapistSelectRequestedClass(sel, ev);
                return;
            }
            try {
                const res = await fetch('/api/therapist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: bid, date, therapist: newVal, locked: true, slot }) });
                if (res.ok) {
                    sel.dataset.initialTherapistDisplay = newVal;
                    loadDay({ soft: true });
                } else syncCheckinTherapistSelectRequestedClass(sel, ev);
            } catch (e) {
                console.error(e);
                syncCheckinTherapistSelectRequestedClass(sel, ev);
            }
        });
    });
    listEl.querySelectorAll('.checkin-pressure-select').forEach(sel => {
        sel.addEventListener('change', async () => {
            const bid = sel.dataset.bookingId;
            const customerId = sel.dataset.customerId || '';
            const slot = parseInt(sel.dataset.slot, 10) || 1;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            try {
                const body = { booking_id: bid, date, pressure: sel.value, slot };
                if (slot === 1 && customerId) body.customer_id = customerId;
                const res = await fetch('/api/pressure', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                if (res.ok) loadDay({ soft: true });
            } catch (e) { console.error(e); }
        });
    });
    listEl.querySelectorAll('.checkin-focus-wrap').forEach(wrap => {
        wrap.addEventListener('click', (e) => {
            e.preventDefault();
            const cb = wrap.querySelector('.checkin-focus-cb');
            const slot = parseInt(cb?.dataset?.slot, 10) || 1;
            const row = wrap.closest('.checkin-checkout-row');
            const bid = row?.dataset?.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            const ev = items.find(evt => evt.booking_id === bid);
            const focusStr = slot === 2 ? (ev?.focus_area_2 || '') : (ev?.focus_area || '');
            openFocusAreaModal(bid, date, focusStr, slot);
        });
    });
    listEl.querySelectorAll('.checkin-focus-cb').forEach(cb => {
        cb.addEventListener('click', (e) => e.preventDefault());
    });
    listEl.querySelectorAll('.checkin-split-cb').forEach(cb => {
        cb.addEventListener('change', async () => {
            const bid = cb.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            const durationMin = parseInt(cb.dataset.durationMin, 10) || 0;
            if (!date || !bid) return;
            if (cb.checked) {
                const half = durationMin > 0 ? Math.floor(durationMin / 2) : 30;
            try {
                const res = await fetch('/api/booking/split-time', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bid, date, minutes_first: half })
                });
                if (res.ok) {
                    momCheckinPanelDraftBookingIds.delete(bid);
                    loadDay({ soft: true });
                }
            } catch (e) { console.error(e); }
            } else {
                try {
                    const res = await fetch('/api/booking/split-time', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ booking_id: bid, date, minutes_first: null })
                    });
                    if (res.ok) {
                        momCheckinPanelDraftBookingIds.delete(bid);
                        loadDay({ soft: true });
                    }
                } catch (e) { console.error(e); }
            }
        });
    });
    listEl.querySelectorAll('.checkin-split-min-input').forEach(input => {
        input.addEventListener('change', async () => {
            const bid = input.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            const max = parseInt(input.dataset.durationMax, 10) || 999;
            if (!date || !bid) return;
            let val = parseInt(input.value, 10);
            if (isNaN(val)) return;
            val = Math.max(0, Math.min(val, max));
            input.value = String(val);
            try {
                const res = await fetch('/api/booking/split-time', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bid, date, minutes_first: val })
                });
                if (res.ok) {
                    momCheckinPanelDraftBookingIds.delete(bid);
                    loadDay({ soft: true });
                }
            } catch (e) { console.error(e); }
        });
    });
}

/** Narrow checkout list: green tip $ field when amount is greater than 0 and/or cash tip checked. */
function momSyncPhoneCheckoutTipEnteredClass(tipLine) {
    if (!tipLine || !tipLine.classList.contains('phone-checkout-tip-line')) return;
    const input = tipLine.querySelector('.checkout-tip-input');
    const cashCb = tipLine.querySelector('.checkout-tip-cash-cb');
    const v = input && input.value != null && String(input.value).trim() !== '' ? parseFloat(input.value) : NaN;
    const hasTip = Number.isFinite(v) && v > 0;
    const cashOn = !!(cashCb && cashCb.checked);
    tipLine.classList.toggle('phone-checkout-tip-entered', hasTip || cashOn);
}

function momBindPhoneCheckoutTipEnteredVisuals(container) {
    if (!container) return;
    container.querySelectorAll('.phone-checkout-card .phone-checkout-tip-line').forEach((line) => {
        const sync = () => momSyncPhoneCheckoutTipEnteredClass(line);
        const inp = line.querySelector('.checkout-tip-input');
        const cash = line.querySelector('.checkout-tip-cash-cb');
        if (inp) {
            inp.addEventListener('input', sync);
            inp.addEventListener('change', sync);
        }
        if (cash) cash.addEventListener('change', sync);
        sync();
    });
}

/** Out / services paid / tip / tip-cash — shared by checkout panel list and phone checkout list. */
function momBindCheckoutCoreControls(container) {
    if (!container) return;
    container.querySelectorAll('.checkout-done-cb').forEach((cb) => {
        cb.addEventListener('change', () => {
            const bid = cb.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            setCheckoutDone(date, bid, cb.checked);
            const row = cb.closest('.checkin-checkout-row, .phone-checkout-card');
            if (row) row.classList.toggle('checkout-row-done', cb.checked);
        });
    });
    container.querySelectorAll('.checkout-services-paid-cb').forEach((cb) => {
        cb.addEventListener('change', () => {
            const bid = cb.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            setCheckoutServicesPaid(date, bid, cb.checked);
            const row = cb.closest('.checkin-checkout-row, .phone-checkout-card');
            if (row) row.classList.toggle('checkout-row-services-paid', cb.checked);
        });
    });
    container.querySelectorAll('.checkout-tip-input').forEach((input) => {
        const bid = input.dataset.bookingId;
        input.addEventListener('change', async () => {
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            const val = parseFloat(input.value);
            if (Number.isNaN(val) || val < 0) return;
            const row = input.closest('.checkin-checkout-row, .phone-checkout-card');
            const isSplit = row && row.classList.contains('checkout-row-split');
            const body = { booking_id: bid, date, tip_amount: val };
            if (isSplit) {
                const minInput = row.querySelector('.checkout-split-min-input');
                const minFirst = minInput && !isNaN(parseInt(minInput.value, 10)) ? parseInt(minInput.value, 10) : undefined;
                if (minFirst != null) body.split_minutes_first = minFirst;
            }
            try {
                const res = await fetch('/api/tip', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                if (res.ok) {
                    momCheckoutPanelDraftBookingIds.delete(bid);
                    const data = await res.json().catch(() => ({}));
                    const fb = { tip_amount: val };
                    if (isSplit && body.split_minutes_first != null) fb.split_minutes_first = body.split_minutes_first;
                    applyTipApiResponseToEvent(bid, data, fb);
                    setCheckoutDone(date, bid, true);
                    if (row) {
                        row.classList.add('checkout-row-done');
                        const doneCb = row.querySelector('.checkout-done-cb');
                        if (doneCb) doneCb.checked = true;
                    }
                    const tipLineIn = input.closest('.phone-checkout-tip-line');
                    if (tipLineIn) momSyncPhoneCheckoutTipEnteredClass(tipLineIn);
                    updateCheckinCheckoutPanels();
                }
            } catch (e) { console.error(e); }
        });
    });
    container.querySelectorAll('.checkout-tip-cash-cb').forEach((cb) => {
        cb.addEventListener('change', async () => {
            const bid = cb.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            try {
                const res = await fetch('/api/tip', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bid, date, tip_cash: cb.checked }),
                });
                if (res.ok) {
                    const data = await res.json().catch(() => ({}));
                    applyTipApiResponseToEvent(bid, data, { tip_cash: cb.checked });
                    if (cb.checked) setCheckoutDone(date, bid, true);
                    const tipLine = cb.closest('.phone-checkout-tip-line');
                    if (tipLine) momSyncPhoneCheckoutTipEnteredClass(tipLine);
                    updateCheckinCheckoutPanels();
                }
            } catch (e) { console.error(e); }
        });
    });
    momBindPhoneCheckoutTipEnteredVisuals(container);
}

function renderCheckoutPanelList(timeStr) {
    const listEl = document.getElementById('checkoutPanelList');
    if (!listEl) return;
    const dateStr = document.getElementById('dateInput')?.value;
    const data = currentData;
    const events = data?.events || [];
    const therapists = data?.therapists || [];
    const items = getEventsAtEndTime(events, dateStr, timeStr);
    if (!items.length) {
        listEl.innerHTML = '<p class="checkin-checkout-empty">' + escapeHtml(uiT('checkout.empty', 'No checkouts at this time.')) + '</p>';
        return;
    }
    const { dup: dupCk, noteIdx: noteIdxCk, crItems: crItemsCk } = getMomCustomerRequestMatchContext();
    const massageAvailOrderedCk = getMassageStaffPickOrderedNamesForDate(dateStr);
    const slotDisplayMapCk = buildCheckinSliceSlotDisplayMap(items, therapists, crItemsCk, dupCk, data?.therapist_order, massageAvailOrderedCk);
    function checkoutTherapistSelectRequestedClass(ev, slot) {
        const display = effectiveCheckinTherapistDisplay(ev, slot, therapists, crItemsCk, dupCk, slotDisplayMapCk, items, massageAvailOrderedCk);
        if (!display || isSlotTherapistUnset(display)) return '';
        if (String(ev.type || '').toLowerCase() === 'couple' && slot === 2) {
            const sec = coupleSlot2CustomerRequestedCanonical(ev, therapists, dupCk, crItemsCk, massageAvailOrderedCk);
            return (sec && therapistNamesMatchForCalendar(display, sec, dupCk)) ? ' checkout-therapist-select--requested' : '';
        }
        return checkinTherapistMatchesCustomerRequestHighlight(display, ev, therapists, dupCk, noteIdxCk, crItemsCk) ? ' checkout-therapist-select--requested' : '';
    }
    function syncCheckoutTherapistSelectRequestedClass(sel, ev) {
        if (!sel || !ev) return;
        const { therapists: t0, dup: d0, noteIdx: n0, crItems: c0 } = getMomCustomerRequestMatchContext();
        const v = String(sel.value || '').trim();
        const slot = parseInt(sel.dataset.slot, 10) || 1;
        const dateStrCo = document.getElementById('dateInput')?.value;
        const massageOrdCo = getMassageStaffPickOrderedNamesForDate(dateStrCo);
        let isReq = false;
        if (v && !isSlotTherapistUnset(v)) {
            if (String(ev.type || '').toLowerCase() === 'couple' && slot === 2) {
                const sec = coupleSlot2CustomerRequestedCanonical(ev, t0, d0, c0, massageOrdCo);
                isReq = !!(sec && therapistNamesMatchForCalendar(v, sec, d0));
            } else {
                isReq = checkinTherapistMatchesCustomerRequestHighlight(v, ev, t0, d0, n0, c0);
            }
        }
        sel.classList.toggle('checkout-therapist-select--requested', isReq);
        if (isReq) sel.setAttribute('title', uiT('staff.availTurnTipRequestedAria', 'Customer requested this therapist'));
        else sel.removeAttribute('title');
    }
    const isCouple = (ev) => (ev.type || '').toLowerCase() === 'couple';
    const svcPaidLbl = escapeHtml(uiT('checkout.servicesPaidLabel', 'Services paid'));
    const svcPaidTitle = escapeHtml(
        uiT(
            'checkout.servicesPaidTitle',
            'Check when service charges are already collected (card/cash/Square) so you can ask about tip only.'
        )
    );
    listEl.innerHTML = items.map(ev => {
        const name = formatCustomerFirstLastInitial(ev.customer);
        const rawSvc = (ev.display_service && ev.display_service.trim()) ? ev.display_service.trim() : (ev.service || '—');
        let service = calendarStripPainReliefOilFromServiceLine(uiCatalogLine(rawSvc)).trim();
        if (!service) service = '—';
        const durationMin = getDurationMinutes(ev);
        const duration = formatDurationMinutes(durationMin);
        const isAddonBillOnly = (ev.room || '').trim() === 'ADDON';
        if (isAddonBillOnly) {
            const mainRm = resolveMainRoomForAddonBooking(ev, events);
            const billTitle = escapeHtml(uiT('checkout.addonBillTitle', 'Add-on billed with main appointment — use main row for tip/checkout.'));
            const roomHtml = mainRm
                ? `${escapeHtml(formatRoomForPanel(mainRm))} <span class="checkin-addon-main-room-hint">${escapeHtml(uiT('checkin.addonMainRoomHint', '(main massage)'))}</span>`
                : escapeHtml(formatRoomForPanel(ev.room));
            return `<div class="checkin-checkout-row checkin-checkout-row--addon-bill checkout-checkout-row--addon-bill" data-booking-id="${escapeHtml(ev.booking_id)}" data-customer-id="${escapeHtml(ev.customer_id || '')}" data-duration-min="${durationMin || 60}">
            <div class="checkin-checkout-row-info">
                <span class="checkin-checkout-row-name-wrap">
                    ${checkoutCheckinHoverIndicatorHtml(ev)}
                    <span class="checkin-checkout-row-name">${escapeHtml(name)}</span>
                    ${deskNoteQuickButtonHtml(ev, 'checkout')}
                </span>
                <span class="checkin-checkout-row-room">${roomHtml}</span>
                <span class="checkin-checkout-row-service">${escapeHtml(service)}</span>
                <span class="checkin-checkout-row-length">${duration}</span>
            </div>
            <div class="checkin-checkout-row-addon-bill" title="${billTitle}"><span class="checkin-addon-bill-marker" aria-label="${billTitle}">$</span></div>
        </div>`;
        }
        const couple = isCouple(ev);
        const splitTime = !couple && ev.split_minutes_first != null;
        const tipVal = (ev.tip_amount != null && ev.tip_amount_2 != null)
            ? (Number(ev.tip_amount) + Number(ev.tip_amount_2))
            : (ev.tip_amount != null ? Number(ev.tip_amount) : '');
        const curCk1 = effectiveCheckinTherapistDisplay(ev, 1, therapists, crItemsCk, dupCk, slotDisplayMapCk, items, massageAvailOrderedCk);
        const curCk2 = effectiveCheckinTherapistDisplay(ev, 2, therapists, crItemsCk, dupCk, slotDisplayMapCk, items, massageAvailOrderedCk);
        const opts1 = therapistOptionsFor(therapists, curCk1, massageAvailOrderedCk);
        const opts2 = therapistOptionsFor(therapists, curCk2, massageAvailOrderedCk);
        const checkoutDone = isCheckoutDone(dateStr, ev.booking_id);
        const servicesPaidChecked = isCheckoutServicesPaid(dateStr, ev.booking_id);
        const minFirst = ev.split_minutes_first != null ? Number(ev.split_minutes_first) : (durationMin ? Math.floor(durationMin / 2) : 30);
        let srmBlock;
        let tipRowSrm1Html = '';
        const srm1 = escapeHtml(uiT('label.srm1', 'Masseuse 1'));
        const srm2 = escapeHtml(uiT('label.srm2', 'Masseuse 2'));
        const srm = escapeHtml(uiT('label.srm', 'Masseuse'));
        const min1st = escapeHtml(uiT('checkout.minFirst', 'Min (1st)'));
        const minPh = escapeHtml(uiT('checkout.minPlaceholder', 'min'));
        const clrSplit = escapeHtml(uiT('checkout.clearSplit', 'Clear split'));
        if (couple) {
            tipRowSrm1Html = `<div class="checkout-srm1-inline"><div class="checkin-checkout-row-srm checkout-srm-narrow"><label>${srm1}</label><select class="checkout-therapist-select${checkoutTherapistSelectRequestedClass(ev, 1)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="1">${opts1}</select></div></div>`;
            srmBlock = `<div class="checkin-checkout-row-srms checkout-checkout-srm2-only"><div class="checkin-checkout-row-srm checkout-srm-narrow"><label>${srm2}</label><select class="checkout-therapist-select${checkoutTherapistSelectRequestedClass(ev, 2)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="2">${opts2}</select></div></div>`;
        } else if (splitTime) {
            const clrTitle = escapeHtml(uiT('checkout.clearSplitTitle', 'Clear split'));
            tipRowSrm1Html = `<div class="checkout-srm1-inline"><div class="checkin-checkout-row-srm checkout-srm-narrow"><label>${srm1}</label><select class="checkout-therapist-select${checkoutTherapistSelectRequestedClass(ev, 1)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="1">${opts1}</select></div><div class="checkin-checkout-row-split-min checkin-split-min-checkout-inline"><label>${min1st}</label><input type="number" min="0" step="1" class="checkout-split-min-input" data-booking-id="${escapeHtml(ev.booking_id)}" value="${minFirst}" placeholder="${minPh}" /></div></div>`;
            srmBlock = `<div class="checkin-checkout-row-srms checkin-checkout-row-split">
                <div class="checkout-split-line checkout-split-line-second">
                    <div class="checkin-checkout-row-srm checkout-srm-narrow"><label>${srm2}</label><select class="checkout-therapist-select${checkoutTherapistSelectRequestedClass(ev, 2)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="2">${opts2}</select></div>
                    <button type="button" class="checkout-clear-split-btn" data-booking-id="${escapeHtml(ev.booking_id)}" title="${clrTitle}">${clrSplit}</button>
                </div>
            </div>`;
        } else {
            srmBlock = `<div class="checkin-checkout-row-srm-wrap"><div class="checkin-checkout-row-srm"><label>${srm}</label><select class="checkout-therapist-select${checkoutTherapistSelectRequestedClass(ev, 1)}" data-booking-id="${escapeHtml(ev.booking_id)}" data-slot="1">${opts1}</select></div></div>`;
        }
        const outTitle = escapeHtml(uiT('checkout.outTitle', 'Checked out'));
        const outLbl = escapeHtml(uiT('checkout.out', 'Out'));
        const tipPh = escapeHtml(uiT('checkout.tipPlaceholder', 'Tip'));
        const cashLbl = escapeHtml(uiT('checkout.cash', 'cash'));
        const tipCash = ev.tip_cash === true;
        const svcLowerCheck = (ev.service || '').toLowerCase();
        const isLuxLuxuryCheckout = svcLowerCheck.includes('luxury') && (durationMin || 0) >= 100;
        const sepFsCk = luxurySeparateMiniFacialChecked(ev);
        const fsN = (ev.luxury_mini_facial_therapist || '').trim();
        const srm1Name = (ev.therapist || '').trim();
        const showLuxHint = !couple && isLuxLuxuryCheckout && sepFsCk && fsN && srm1Name && fsN !== srm1Name;
        const luxHintHtml = showLuxHint ? `<div class="checkout-luxury-tip-hint">${escapeHtml(uiT('checkout.luxuryTipHint', 'Tip defaults to 90% masseuse / 30% mini facial (FS) unless you set split amounts in the appointment detail.'))}</div>` : '';
        const stackedLayout = couple || splitTime;
        const tipLineInner = `<div class="checkout-tip-line">
                    <label class="checkout-tip-dollar" aria-hidden="true">$</label>
                    <input type="number" min="0" step="0.01" class="checkout-tip-input" data-booking-id="${escapeHtml(ev.booking_id)}" value="${tipVal}" placeholder="${tipPh}" />
                    <label class="checkout-tip-cash-label"><input type="checkbox" class="checkout-tip-cash-cb" data-booking-id="${escapeHtml(ev.booking_id)}" ${tipCash ? 'checked' : ''} /> ${cashLbl}</label>
                </div>`;
        const tipBlockInner = stackedLayout
            ? `<div class="checkout-tip-srm1-row">${tipLineInner}${tipRowSrm1Html}</div>${luxHintHtml}`
            : `${tipLineInner}${luxHintHtml}`;
        return `<div class="checkin-checkout-row${checkoutDone ? ' checkout-row-done' : ''}${servicesPaidChecked ? ' checkout-row-services-paid' : ''}${splitTime ? ' checkout-row-split' : ''}${stackedLayout ? ' checkout-row-stacked' : ''}" data-booking-id="${escapeHtml(ev.booking_id)}" data-duration-min="${durationMin || 60}">
            <div class="checkin-checkout-row-done">
                <label class="checkin-checkout-done-label" title="${outTitle}"><input type="checkbox" class="checkout-done-cb" data-booking-id="${escapeHtml(ev.booking_id)}" ${checkoutDone ? 'checked' : ''} /> ${outLbl}</label>
            </div>
            <div class="checkin-checkout-row-info">
                <span class="checkin-checkout-row-name-wrap">
                    ${checkoutCheckinHoverIndicatorHtml(ev)}
                    <span class="checkin-checkout-row-name">${escapeHtml(name)}</span>
                    ${deskNoteQuickButtonHtml(ev, 'checkout')}
                </span>
                <span class="checkin-checkout-row-room">${escapeHtml(formatRoomForPanel(ev.room))}</span>
                <span class="checkin-checkout-row-service">${escapeHtml(service)}</span>
                <span class="checkin-checkout-row-length">${duration}</span>
            </div>
            <div class="checkout-services-paid-wrap">
                <label class="checkout-services-paid-label" title="${svcPaidTitle}">
                    <input type="checkbox" class="checkout-services-paid-cb" data-booking-id="${escapeHtml(ev.booking_id)}" ${servicesPaidChecked ? 'checked' : ''} />
                    <span class="checkout-services-paid-text">${svcPaidLbl}</span>
                </label>
            </div>
            <div class="checkin-checkout-row-tip">
                ${tipBlockInner}
            </div>
            ${srmBlock}
        </div>`;
    }).join('');
    bindDeskNoteQuickButtons(listEl, dateStr, 'checkout');
    listEl.querySelectorAll('.checkout-therapist-select').forEach(sel => {
        const bid = sel.dataset.bookingId;
        const slot = parseInt(sel.dataset.slot, 10) || 1;
        const ev = items.find(e => e.booking_id === bid);
        if (ev) {
            const display = effectiveCheckinTherapistDisplay(ev, slot, therapists, crItemsCk, dupCk, slotDisplayMapCk, items, massageAvailOrderedCk);
            sel.value = display;
            sel.dataset.initialTherapistDisplay = display;
            syncCheckoutTherapistSelectRequestedClass(sel, ev);
        }
    });
    momBindCheckoutCoreControls(listEl);
    listEl.querySelectorAll('.checkout-split-time-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const bid = btn.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            const durationMin = parseInt(btn.dataset.durationMin, 10) || 60;
            if (!date || !bid) return;
            const minutesFirst = Math.floor(durationMin / 2);
            try {
                const res = await fetch('/api/booking/split-time', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: bid, date, minutes_first: minutesFirst }) });
                if (res.ok) {
                    momCheckoutPanelDraftBookingIds.delete(bid);
                    loadDay({ soft: true });
                }
            } catch (e) { console.error(e); }
        });
    });
    listEl.querySelectorAll('.checkout-split-min-input').forEach(input => {
        input.addEventListener('change', async () => {
            const bid = input.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            const val = input.value.trim() === '' ? null : parseInt(input.value, 10);
            if (val != null && (isNaN(val) || val < 0)) return;
            try {
                const res = await fetch('/api/booking/split-time', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: bid, date, minutes_first: val }) });
                if (res.ok) {
                    momCheckoutPanelDraftBookingIds.delete(bid);
                    loadDay({ soft: true });
                }
            } catch (e) { console.error(e); }
        });
    });
    listEl.querySelectorAll('.checkout-clear-split-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const bid = btn.dataset.bookingId;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            try {
                const res = await fetch('/api/booking/split-time', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: bid, date, minutes_first: null }) });
                if (res.ok) {
                    momCheckoutPanelDraftBookingIds.delete(bid);
                    loadDay({ soft: true });
                }
            } catch (e) { console.error(e); }
        });
    });
    listEl.querySelectorAll('.checkout-therapist-select').forEach(sel => {
        sel.addEventListener('change', async () => {
            const bid = sel.dataset.bookingId;
            const slot = parseInt(sel.dataset.slot, 10) || 1;
            const date = document.getElementById('dateInput')?.value;
            if (!date || !bid) return;
            const ev = (currentData && currentData.events || []).find(e => e.booking_id === bid);
            const initial = sel.dataset.initialTherapistDisplay || '';
            const newVal = sel.value;
            syncCheckoutTherapistSelectRequestedClass(sel, ev);
            const row = sel.closest('.checkin-checkout-row');
            const isSplitRow = row && row.classList.contains('checkout-row-split');
            if (slot === 2 && isSplitRow && !(newVal || '').trim()) {
                try {
                    const res = await fetch('/api/booking/split-time', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: bid, date, minutes_first: null }) });
                    if (res.ok) {
                        momCheckoutPanelDraftBookingIds.delete(bid);
                        loadDay({ soft: true });
                        return;
                    }
                } catch (e) { console.error(e); }
            }
            const { therapists: tcf, dup: dcf, noteIdx: nicf, crItems: crcf } = getMomCustomerRequestMatchContext();
            const prompt = therapistChangeConfirmPrompt(initial, newVal, ev, tcf, dcf, nicf, crcf, slot);
            if (prompt && !confirm(prompt)) {
                sel.value = initial;
                syncCheckoutTherapistSelectRequestedClass(sel, ev);
                return;
            }
            try {
                const res = await fetch('/api/therapist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: bid, date, therapist: newVal, locked: true, slot }) });
                if (res.ok) loadDay({ soft: true });
                else syncCheckoutTherapistSelectRequestedClass(sel, ev);
            } catch (e) {
                console.error(e);
                syncCheckoutTherapistSelectRequestedClass(sel, ev);
            }
        });
    });
}

function getNextCheckinCheckoutTimes() {
    const dateStr = document.getElementById('dateInput')?.value;
    const now = new Date();
    const checkinOpts = getCheckinCheckoutTimeOptions('checkin', dateStr);
    const checkoutOpts = getCheckinCheckoutTimeOptions('checkout', dateStr);
    let nextCheckin = null;
    let nextCheckout = null;
    const currentHM = now.getHours() * 60 + now.getMinutes();
    for (const o of checkinOpts) {
        const [h, m] = o.value.split(':').map(Number);
        const slotMin = h * 60 + m;
        if (slotMin > currentHM) {
            nextCheckin = o.value;
            break;
        }
    }
    if (!nextCheckin && checkinOpts.length) nextCheckin = checkinOpts[0].value;
    for (const o of checkoutOpts) {
        const [h, m] = o.value.split(':').map(Number);
        const slotMin = h * 60 + m;
        if (slotMin > currentHM) {
            nextCheckout = o.value;
            break;
        }
    }
    if (!nextCheckout && checkoutOpts.length) nextCheckout = checkoutOpts[checkoutOpts.length - 1].value;
    return { nextCheckin, nextCheckout };
}

function checkinCheckoutPanelsAreOpen() {
    const checkinPanel = document.getElementById('checkinPanel');
    const checkoutPanel = document.getElementById('checkoutPanel');
    const vis = (el) => !!(el && el.style.display && el.style.display !== 'none');
    return vis(checkinPanel) || vis(checkoutPanel);
}

function closeCheckinCheckoutPanels() {
    const checkinPanel = document.getElementById('checkinPanel');
    const checkoutPanel = document.getElementById('checkoutPanel');
    if (checkinPanel) checkinPanel.style.display = 'none';
    if (checkoutPanel) checkoutPanel.style.display = 'none';
    clearCheckinCheckoutDraftGuards();
    syncCheckinCheckoutToggleButton();
}

function syncCheckinCheckoutToggleButton() {
    const btn = document.getElementById('checkinCheckoutBtn');
    if (!btn) return;
    btn.setAttribute('aria-expanded', checkinCheckoutPanelsAreOpen() ? 'true' : 'false');
}

function resetCheckinCheckoutPanelPositions() {
    ['checkinPanel', 'checkoutPanel'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.transform = '';
        el.style.zIndex = '';
        delete el.dataset.dragTx;
        delete el.dataset.dragTy;
    });
}

/** Drag the yellow header to move a panel; toolbar re-open resets placement. */
function bindCheckinCheckoutPanelDrag(panel) {
    if (!panel || panel._momCheckinCheckoutDragBound) return;
    panel._momCheckinCheckoutDragBound = true;
    const header = panel.querySelector('.checkin-checkout-header');
    if (!header) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let baseTx = 0;
    let baseTy = 0;

    const stopDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        header.classList.remove('checkin-checkout-header--dragging');
        panel.style.zIndex = '';
        if (e && typeof e.pointerId === 'number') {
            try {
                header.releasePointerCapture(e.pointerId);
            } catch (_) { /* not captured */ }
        }
    };

    header.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, select, input, textarea, .checkin-checkout-note-lang-toggle')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        baseTx = parseFloat(panel.dataset.dragTx || '0', 10) || 0;
        baseTy = parseFloat(panel.dataset.dragTy || '0', 10) || 0;
        panel.style.zIndex = '2100';
        header.classList.add('checkin-checkout-header--dragging');
        try {
            header.setPointerCapture(e.pointerId);
        } catch (_) { /* ignore */ }
    });
    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const tx = baseTx + (e.clientX - startX);
        const ty = baseTy + (e.clientY - startY);
        panel.style.transform = `translate(${tx}px, ${ty}px)`;
        panel.dataset.dragTx = String(tx);
        panel.dataset.dragTy = String(ty);
    });
    header.addEventListener('pointerup', stopDrag);
    header.addEventListener('pointercancel', stopDrag);
}

function openCheckinCheckoutPanels() {
    /* Check-In / Check-Out panels removed from UI */
    closeCheckinCheckoutPanels();
}

/** Toolbar button: open both panels, or close both if either is already open. */
function toggleCheckinCheckoutPanels() {
    /* Check-In / Check-Out panels removed from UI */
    closeCheckinCheckoutPanels();
}

/** True if focus is on an input/select/textarea inside the panel (not chrome buttons like close). Avoids auto-refresh wiping in-progress typing. */
function isEditingInsideCheckinCheckoutPanel(panelEl) {
    if (!panelEl || panelEl.style.display === 'none') return false;
    const ae = document.activeElement;
    if (!ae || !panelEl.contains(ae)) return false;
    const tag = (ae.tagName || '').toLowerCase();
    if (tag === 'select' || tag === 'textarea') return true;
    if (tag === 'input') {
        const t = (ae.type || '').toLowerCase();
        if (t === 'button' || t === 'submit' || t === 'hidden') return false;
        return true;
    }
    return false;
}

function updateCheckinCheckoutPanels() {
    const checkinSel = document.getElementById('checkinTimeSelect');
    const checkoutSel = document.getElementById('checkoutTimeSelect');
    const checkinPanel = document.getElementById('checkinPanel');
    const checkoutPanel = document.getElementById('checkoutPanel');
    const cinVis = checkinPanel && checkinPanel.style.display !== 'none';
    const coutVis = checkoutPanel && checkoutPanel.style.display !== 'none';
    if (isCheckinCheckoutTimeSyncOn() && cinVis && coutVis && checkinSel && checkoutSel) {
        const editing =
            isEditingInsideCheckinCheckoutPanel(checkinPanel)
            || isEditingInsideCheckinCheckoutPanel(checkoutPanel);
        const drafts = momCheckinPanelDraftBookingIds.size > 0 || momCheckoutPanelDraftBookingIds.size > 0;
        if (!editing && !drafts) {
            const v = checkinSel.value || checkoutSel.value;
            if (v) {
                applyCheckinCheckoutSyncedTime(v);
                return;
            }
        }
    }
    if (checkinPanel && cinVis && checkinSel) {
        if (!isEditingInsideCheckinCheckoutPanel(checkinPanel) && momCheckinPanelDraftBookingIds.size === 0) {
            const v = checkinSel.value;
            fillTimeSelect('checkinTimeSelect', v, 'checkin');
            renderCheckinPanelList(checkinSel.value);
        }
    }
    if (checkoutPanel && coutVis && checkoutSel) {
        if (!isEditingInsideCheckinCheckoutPanel(checkoutPanel) && momCheckoutPanelDraftBookingIds.size === 0) {
            const v = checkoutSel.value;
            fillTimeSelect('checkoutTimeSelect', v, 'checkout');
            renderCheckoutPanelList(checkoutSel.value);
        }
    }
}

function initCheckinCheckoutPanels() {
    const checkinPanel = document.getElementById('checkinPanel');
    const checkoutPanel = document.getElementById('checkoutPanel');
    if (!checkinPanel || !checkoutPanel) return;

    bindCheckinCheckoutDraftGuards();

    document.getElementById('checkinCheckoutBtn')?.addEventListener('click', () => toggleCheckinCheckoutPanels());

    function stepTime(panelMode, delta) {
        const selectId = panelMode === 'checkin' ? 'checkinTimeSelect' : 'checkoutTimeSelect';
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const dateStr = document.getElementById('dateInput')?.value;
        const options = getCheckinCheckoutTimeOptions(panelMode, dateStr);
        const current = sel.value;
        const idx = options.findIndex(o => o.value === current);
        if (idx < 0) return;
        const nextIdx = idx + delta;
        if (nextIdx < 0 || nextIdx >= options.length) return;
        const next = options[nextIdx].value;
        if (isCheckinCheckoutTimeSyncOn()) {
            applyCheckinCheckoutSyncedTime(next);
            return;
        }
        sel.value = next;
        if (panelMode === 'checkin') {
            renderCheckinPanelList(next);
        } else {
            renderCheckoutPanelList(next);
        }
    }

    document.getElementById('checkinTimePrev')?.addEventListener('click', () => stepTime('checkin', -1));
    document.getElementById('checkinTimeNext')?.addEventListener('click', () => stepTime('checkin', 1));
    document.getElementById('checkoutTimePrev')?.addEventListener('click', () => stepTime('checkout', -1));
    document.getElementById('checkoutTimeNext')?.addEventListener('click', () => stepTime('checkout', 1));
    document.getElementById('checkinTimeNow')?.addEventListener('click', () => snapCheckinCheckoutTimeToNow('checkin'));
    document.getElementById('checkoutTimeNow')?.addEventListener('click', () => snapCheckinCheckoutTimeToNow('checkout'));

    ['checkinTimeSelect', 'checkoutTimeSelect'].forEach((id) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.addEventListener('change', () => {
            const timeStr = sel.value;
            if (isCheckinCheckoutTimeSyncOn()) {
                applyCheckinCheckoutSyncedTime(timeStr);
                return;
            }
            if (id === 'checkinTimeSelect') {
                renderCheckinPanelList(timeStr);
            } else {
                renderCheckoutPanelList(timeStr);
            }
        });
    });

    document.getElementById('checkinCheckoutTimeSync')?.addEventListener('change', (e) => {
        saveCheckinCheckoutTimeSyncPreference();
        if (e.target && e.target.checked) {
            const ci = document.getElementById('checkinTimeSelect');
            const co = document.getElementById('checkoutTimeSelect');
            const v = (ci && ci.value) || (co && co.value);
            if (v) applyCheckinCheckoutSyncedTime(v);
        }
    });
    loadCheckinCheckoutTimeSyncPreference();

    checkinPanel.querySelector('.checkin-checkout-close')?.addEventListener('click', () => {
        checkinPanel.style.display = 'none';
        syncCheckinCheckoutToggleButton();
    });
    checkinPanel.querySelector('.checkin-checkout-minimize')?.addEventListener('click', () => { checkinPanel.classList.toggle('minimized'); });
    checkoutPanel.querySelector('.checkin-checkout-close')?.addEventListener('click', () => {
        checkoutPanel.style.display = 'none';
        syncCheckinCheckoutToggleButton();
    });
    checkoutPanel.querySelector('.checkin-checkout-minimize')?.addEventListener('click', () => { checkoutPanel.classList.toggle('minimized'); });
    bindCheckinCheckoutPanelDrag(checkinPanel);
    bindCheckinCheckoutPanelDrag(checkoutPanel);
    syncCheckinCheckoutToggleButton();
    document.querySelectorAll('.checkin-checkout-note-lang-toggle').forEach((toggleRoot) => {
        if (toggleRoot._momDeskLangBound) return;
        toggleRoot._momDeskLangBound = true;
        toggleRoot.querySelectorAll('.desk-note-lang-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const lng = e.currentTarget.getAttribute('data-desk-note-lang');
                if (lng !== 'en' && lng !== 'zh') return;
                setCheckinCheckoutNotePreviewLang(lng);
            });
        });
    });
    syncDeskNoteLangToggleButtons();
    initCustomerDeskNoteModal();
}

/** Banner: names seen in Square bookings that aren't in the roster yet — prompt to Add or Ignore. */
function renderNewMasseuseBanner(data) {
    const id = 'newMasseuseBanner';
    let banner = document.getElementById(id);
    const names = (data && Array.isArray(data.detected_new_therapists)) ? data.detected_new_therapists : [];
    if (!window._momRosterSessionDismissed) window._momRosterSessionDismissed = new Set();
    const visible = names.filter((n) => n && !window._momRosterSessionDismissed.has(String(n).toLowerCase()));
    if (!visible.length) {
        if (banner) banner.remove();
        return;
    }
    if (!banner) {
        banner = document.createElement('div');
        banner.id = id;
        banner.className = 'mom-new-masseuse-banner';
        const grid = document.getElementById('calendarGrid');
        if (grid && grid.parentNode) {
            grid.parentNode.insertBefore(banner, grid);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }
    }
    const rows = visible.map((n) => {
        const esc = escapeHtml(n);
        return '<div class="mom-nmb-row" data-name="' + esc + '">' +
            '<span class="mom-nmb-text">New name on Square: <strong>' + esc + '</strong> — not in your roster.</span>' +
            '<span class="mom-nmb-actions">' +
            '<button type="button" class="mom-nmb-add">Add masseuse</button>' +
            '<button type="button" class="mom-nmb-ignore">Ignore</button>' +
            '</span></div>';
    }).join('');
    banner.innerHTML = '<div class="mom-nmb-title">New masseuse detected on Square</div>' + rows;
    banner.querySelectorAll('.mom-nmb-row').forEach((row) => {
        const name = row.getAttribute('data-name');
        const addBtn = row.querySelector('.mom-nmb-add');
        const ignBtn = row.querySelector('.mom-nmb-ignore');
        if (addBtn) addBtn.addEventListener('click', () => rosterAction('add', name, row));
        if (ignBtn) ignBtn.addEventListener('click', () => rosterAction('ignore', name, row));
    });
}

async function rosterAction(kind, name, row) {
    const btns = row ? row.querySelectorAll('button') : [];
    try {
        btns.forEach((b) => { b.disabled = true; });
        const res = await fetch('/api/roster/' + kind, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name }),
        });
        if (!res.ok) throw new Error('Request failed (' + res.status + ')');
        if (!window._momRosterSessionDismissed) window._momRosterSessionDismissed = new Set();
        window._momRosterSessionDismissed.add(String(name).toLowerCase());
        if (row) row.remove();
        const banner = document.getElementById('newMasseuseBanner');
        if (banner && !banner.querySelector('.mom-nmb-row')) banner.remove();
        if (kind === 'add' && typeof loadDay === 'function') {
            loadDay({ force: true });
        }
    } catch (e) {
        btns.forEach((b) => { b.disabled = false; });
        alert('Could not update roster: ' + (e && e.message ? e.message : e));
    }
}

function renderCalendar(data) {
    const byRoom = calendarViewMode === 'room';
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;
    try {
        const ds = (data && data.date) || document.getElementById('dateInput')?.value;
        if (ds && /^\d{4}-\d{2}-\d{2}$/.test(String(ds))) {
            const staffOpts = { events: data && data.events, therapists: data && data.therapists };
            applyMassageStaffSelectForDate(String(ds), staffOpts);
            applyFacialSpecialistsSelectForDate(String(ds), staffOpts);
        } else {
            applyMassageStaffSelectForCurrentDate();
            applyFacialSpecialistsSelectForCurrentDate();
        }
    } catch (e) { /* ignore */ }
    grid.innerHTML = '';

    /* Left sidebars (Staff B/A, Rooms available, Appointments Available / 15-min rows) removed from UI */
    const slotStepMinutes = 30;

    let columns = byRoom ? CALENDAR_ROOM_LIST : (data.therapists || []);
    let mainColumns = columns;
    let rightColumns = [];
    let rightSectionCollapsed = false;
    if (!byRoom && data.therapists && data.therapists.length) {
        rightColumns = getRightSectionTherapistsOrdered(data.therapists);
        mainColumns = data.therapists.filter(t => !isRightSectionTherapist(t));
        if (rightColumns.length > 0) {
            try {
                rightSectionCollapsed = sessionStorage.getItem(RIGHT_SECTION_KEY) === '1';
            } catch (e) {}
            grid.classList.add('calendar-has-right-section');
            grid.dataset.rightCollapsed = rightSectionCollapsed ? '1' : '0';
        } else {
            grid.classList.remove('calendar-has-right-section');
        }
    }
    if (columns.length === 0) {
        if (!byRoom) console.warn('[renderCalendar] No therapists found');
        return;
    }

    const totalMasseuseCols = mainColumns.length + (rightColumns.length > 0 ? 1 + (rightSectionCollapsed ? 0 : rightColumns.length) : 0);
    grid.style.setProperty('--num-therapists', byRoom ? columns.length : totalMasseuseCols);
    grid.style.setProperty('--num-main-therapists', mainColumns.length);
    grid.style.setProperty('--num-right-therapists', rightSectionCollapsed ? 0 : rightColumns.length);
    grid.style.setProperty('--calendar-slot-height', getCalendarSlotHeight() + 'px');
    grid.style.setProperty('--calendar-staff-col-width', '0px');
    grid.style.setProperty('--calendar-rooms-col-width', '0px');
    grid.style.setProperty('--calendar-cap-col-width', '0px');
    grid.style.setProperty('--calendar-time-sticky-left', '0px');
    grid.classList.remove('calendar-rooms-col-collapsed', 'calendar-capacity-col-collapsed');
    grid.dataset.calendarSlotStep = String(slotStepMinutes);
    if (byRoom) {
        grid.classList.remove('calendar-by-masseuse', 'calendar-has-right-section');
        grid.classList.add('calendar-by-room');
        grid.style.setProperty('--room-superheader-row-height', '48px');
    } else {
        grid.classList.add('calendar-by-masseuse');
        grid.classList.remove('calendar-by-room');
        grid.style.removeProperty('--room-superheader-row-height');
    }
    const therapistsForWho = data.therapists || [];

    const selectedDate = document.getElementById('dateInput')?.value || getTodayLocal();
    const eventsForCalendar = (data.events || []).filter(
        (e) => e.room !== 'ADDON'
    );
    const timeSlots = generateTimeSlots(selectedDate, slotStepMinutes);

    if (byRoom) {
        appendRoomViewSuperheaderRow(grid, columns);
    }

    /** Room view has a superheader row 1; masseuse view headers sit on row 1. Explicit rows avoid grid auto-placement mixing header/body rows. */
    const calendarHeaderRow = byRoom ? '2' : '1';

    // Headers: Time | therapist/room columns (Staff B/A, Rooms available, Appointments Available removed)
    const headerRow = document.createElement('div');
    headerRow.className = 'time-header';
    headerRow.style.gridRow = calendarHeaderRow;
    headerRow.textContent = uiT('calendar.time', 'Time');
    grid.appendChild(headerRow);

    /* Who column hidden for now - formatting not final
    const whoHeader = document.createElement('div');
    whoHeader.className = 'who-column-header';
    whoHeader.textContent = 'Who';
    grid.appendChild(whoHeader);
    */

    if (byRoom) {
        columns.forEach(room => {
            const header = document.createElement('div');
            header.className = 'room-header ' + roomKeyToColumnClass(room) + (room === 'UNASSIGNED' ? ' room-header-unassigned' : '');
            header.style.gridRow = calendarHeaderRow;
            const unass = uiT('calendar.unassigned', 'UNASSIGNED');
            const rmPrefix = uiT('calendar.rm', 'Rm');
            header.textContent = room === 'UNASSIGNED' ? unass : `${rmPrefix} ${roomKeyDisplayLabel(room)}`;
            grid.appendChild(header);
        });
    } else {
    const counts = data.therapist_service_counts || {};
    const orderMap = {};
    if (data.therapist_order && data.therapist_order.length) {
        data.therapist_order.forEach(o => { orderMap[o.therapist] = o.order; });
    } else {
        data.therapists.forEach((t, i) => { orderMap[t] = i + 1; });
    }
        mainColumns.forEach(therapist => {
        const header = document.createElement('div');
        header.className = 'therapist-header';
            const color = getMasseuseColor(therapist, data.therapists);
            header.style.borderLeftWidth = '4px';
            header.style.borderLeftStyle = 'solid';
            header.style.borderLeftColor = color;
        const n = counts[therapist] || 0;
        const orderNum = orderMap[therapist] != null ? orderMap[therapist] : '–';
            const ord = uiT('calendar.order', 'Order');
            const todayLine = uiTParams('calendar.sessionsLine', { n: String(n) }, String(n) + ' today');
            header.innerHTML = `<span class="therapist-name" title="${escapeHtml(therapist)}">${escapeHtml(therapistFirstNameOnly(therapist))}</span><span class="header-order">${escapeHtml(ord)} ${orderNum}</span><span class="service-count">${escapeHtml(todayLine)}</span>`;
        grid.appendChild(header);
    });
        if (rightColumns.length > 0) {
            const toggleHeader = document.createElement('div');
            toggleHeader.className = 'right-section-toggle-header';
            toggleHeader.style.gridRow = calendarHeaderRow;
            toggleHeader.title = rightSectionCollapsed ? uiT('right.toggleShow', 'Show Hongxia & Hannah') : uiT('right.toggleHide', 'Hide Hongxia & Hannah');
            toggleHeader.innerHTML = rightSectionCollapsed ? '&#9654;' : '&#9664;';
            toggleHeader.addEventListener('click', () => {
                try {
                    sessionStorage.setItem(RIGHT_SECTION_KEY, rightSectionCollapsed ? '0' : '1');
                } catch (e) {}
                loadDay({ soft: true });
            });
            grid.appendChild(toggleHeader);
            if (!rightSectionCollapsed) {
                rightColumns.forEach(therapist => {
                    const header = document.createElement('div');
                    header.className = 'therapist-header right-section-header';
                    header.style.gridRow = calendarHeaderRow;
                    const color = getMasseuseColor(therapist, data.therapists);
                    header.style.borderLeftWidth = '4px';
                    header.style.borderLeftStyle = 'solid';
                    header.style.borderLeftColor = color;
                    const n = counts[therapist] || 0;
                    const orderNum = orderMap[therapist] != null ? orderMap[therapist] : '–';
                    const ord2 = uiT('calendar.order', 'Order');
                    const todayLine2 = uiTParams('calendar.sessionsLine', { n: String(n) }, String(n) + ' today');
                    header.innerHTML = `<span class="therapist-name" title="${escapeHtml(therapist)}">${escapeHtml(therapistFirstNameOnly(therapist))}</span><span class="header-order">${escapeHtml(ord2)} ${orderNum}</span><span class="service-count">${escapeHtml(todayLine2)}</span>`;
                    grid.appendChild(header);
                });
            }
        }
    }

    // Group appointments by column key (therapist name or room)
    const appointmentsByColumn = {};
    const appointmentsWithPositions = {};
    if (byRoom) {
        CALENDAR_ROOM_LIST.forEach(room => {
            appointmentsByColumn[room] = [];
        });
        (eventsForCalendar || []).forEach(e => {
            roomViewColumnsForEvent(e).forEach(({ appointment, column }) => {
                if (appointmentsByColumn[column]) appointmentsByColumn[column].push(appointment);
            });
        });
        CALENDAR_ROOM_LIST.forEach(room => {
            const list = appointmentsByColumn[room] || [];
            appointmentsWithPositions[room] = calculateOverlapPositions(list);
        });
    } else {
        const therapistDupFirst = buildTherapistFirstNameDuplicates(data.therapists || []);
        (data.therapists || []).forEach(therapist => {
            const list = (eventsForCalendar || []).filter(e =>
                therapistNamesMatchForCalendar(e.therapist, therapist, therapistDupFirst) ||
                (e.type === 'couple' && therapistNamesMatchForCalendar(e.therapist_2, therapist, therapistDupFirst)) ||
                therapistNamesMatchForCalendar(e.facial_specialist, therapist, therapistDupFirst) ||
                therapistNamesMatchForCalendar(e.luxury_mini_facial_therapist, therapist, therapistDupFirst) ||
                therapistNamesMatchForCalendar(e.luxury_mini_facial_therapist_2, therapist, therapistDupFirst)
            );
            appointmentsByColumn[therapist] = list;
            appointmentsWithPositions[therapist] = calculateOverlapPositions(list);
        });
    }

    timeSlots.forEach((timeSlot, slotIndex) => {
        const slotStart = timeSlot.getTime();
        const slotEnd = slotStart + slotStepMinutes * 60 * 1000;
        /* :30 row bottom = thick hour line (整点); :00 row bottom = thin half-hour line */
        const isHourLine = slotStepMinutes === 30
            ? timeSlot.getMinutes() === 30
            : timeSlot.getMinutes() === 45;
        const isHalfHourLine = slotStepMinutes === 30
            ? timeSlot.getMinutes() === 0
            : timeSlot.getMinutes() === 15 || timeSlot.getMinutes() === 30;
        const gridLineClass = isHourLine ? ' grid-hour-line' : (isHalfHourLine ? ' grid-half-line' : '');
        const officialHrs = calendarOfficialHoursBoundaryClass(timeSlot);
        const plannedStaff = getPlannedMassageStaffTodayCount();
        const busyStaff = peakMassageStaffSlotsInWindow(eventsForCalendar, slotStart, slotEnd);
        const availStaff = Math.max(0, plannedStaff - busyStaff);
        const noMassageStaffAvail = availStaff === 0;
        const timeLabel = document.createElement('div');
        let timeSlotClasses = 'time-slot' + gridLineClass + officialHrs;
        if (calendarSlotNoNewApptAvailability(slotStart, eventsForCalendar)) {
            const bedsFreeHere = calendarBedsFree(eventsForCalendar, slotStart, slotEnd);
            timeSlotClasses += bedsFreeHere > 0
                ? ' time-slot--no-appt-beds-available'
                : ' time-slot--no-appt-no-beds-free';
        }
        if (noMassageStaffAvail) timeSlotClasses += ' time-slot--no-staff-avail';
        timeLabel.className = timeSlotClasses;
        timeLabel.dataset.slotIndex = String(slotIndex);
        timeLabel.textContent = formatTime(timeSlot);
        grid.appendChild(timeLabel);

        // In room view: which physical rooms 0 and 2 are in use this slot (by appt in 0, 2, or 02D)
        let room0Or2InUse = new Set();
        if (byRoom) {
            (eventsForCalendar || []).forEach(ev => {
                if (eventUsesPhysicalRoomInSlot(ev, slotStart, slotEnd, '0')) room0Or2InUse.add('0');
                if (eventUsesPhysicalRoomInSlot(ev, slotStart, slotEnd, '2')) room0Or2InUse.add('2');
            });
        }

        const colsToRender = byRoom ? columns : mainColumns;
        colsToRender.forEach(colKey => {
            const cell = document.createElement('div');
            cell.className = 'appointment-cell' + gridLineClass + officialHrs;
            if (byRoom) {
                cell.dataset.room = colKey;
                cell.classList.add(roomKeyToColumnClass(colKey));
                if (colKey === 'UNASSIGNED') cell.classList.add('unassigned-column');
                if ((colKey === '0' || colKey === '2') && room0Or2InUse.has(colKey)) {
                    cell.classList.add('room-in-use');
                }
                if (colKey === '02D' && room0Or2InUse.size > 0) {
                    cell.classList.add('room-02d-unavailable');
                }
            } else {
                cell.dataset.therapist = colKey;
            }
            cell.dataset.timeSlot = slotIndex;
            cell.dataset.timeSlotStart = timeSlot.getTime();
            
            const appointments = appointmentsByColumn[colKey] || [];
            const positions = appointmentsWithPositions[colKey] || {};
            appointments.forEach(appointment => {
                const eventStart = new Date(appointment.start_at).getTime();
                if (eventStart >= slotStart && eventStart < slotEnd) {
                    const lk = calendarAppointmentOverlapLayoutKey(appointment);
                    const position = positions[lk] || positions[appointment.booking_id] || { left: 0, width: 100 };
                    try {
                        const block = createAppointmentBlock(appointment, timeSlot, slotIndex, timeSlots, position, byRoom, colKey, slotStepMinutes);
                    cell.appendChild(block);
                    } catch (err) {
                        console.error('Error rendering appointment block', appointment?.booking_id, err);
                        const fallback = document.createElement('div');
                        fallback.className = 'appointment-block appointment-block-error';
                        fallback.textContent = (appointment.customer || uiT('word.appointment', 'Appointment')) + uiT('error.display', ' – error displaying');
                        cell.appendChild(fallback);
                    }
                }
            });

            if (byRoom) {
                cell.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    cell.classList.add('drop-target');
                });
                cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
                cell.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    cell.classList.remove('drop-target');
                    let payload;
                    try {
                        payload = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
                    } catch (_) { return; }
                    const targetRoom = cell.dataset.room;
                    if (!targetRoom || !payload.booking_id || !payload.date) return;
                    const facialSlice = payload.room_view_slice === 'couple_facial' || payload.room_view_slice === '02d_facial';
                    const ev = (currentData && currentData.events) ? currentData.events.find(x => x.booking_id === payload.booking_id) : null;
                    if (!facialSlice && ev && ev.room === targetRoom) return;
                    if (facialSlice && ev) {
                        const fr = (ev.facial_portion_room || '').trim();
                        const effectiveFacial = fr || (ev.room === '02D' ? '2' : 'UNASSIGNED');
                        if (effectiveFacial === targetRoom) return;
                    }
                    try {
                        const res = facialSlice
                            ? await putRoomAssignmentWithConfirm(payload.booking_id, payload.date, targetRoom, { room_view_slice: 'couple_facial' })
                            : await putRoomAssignmentWithConfirm(payload.booking_id, payload.date, targetRoom);
                        if (res.status === 499) return;
                        if (res.ok) {
                            if (!(await tryApplyDayFromRoomMutationResponse(res))) loadDay({ soft: true });
                        } else if (res.status !== 409) {
                            const err = await res.json().catch(() => ({}));
                            alert(err.detail || uiT('room.updateFailed', 'Could not update room.'));
                        }
                    } catch (err) { console.error(err); }
                });
            } else {
                cell.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    cell.classList.add('drop-target');
                });
                cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
                cell.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    cell.classList.remove('drop-target');
                    let payload;
                    try {
                        payload = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
                    } catch (_) { return; }
                    const targetTherapist = cell.dataset.therapist;
                    if (!targetTherapist || !payload.booking_id || !payload.date) return;
                    const ev = (currentData && currentData.events) ? currentData.events.find(x => x.booking_id === payload.booking_id) : null;
                    if (ev && ev.therapist === targetTherapist) return;
                    try {
                        const res = await fetch('/api/therapist', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ booking_id: payload.booking_id, date: payload.date, therapist: targetTherapist, locked: true, slot: 1 })
                        });
                        if (res.ok) loadDay({ soft: true });
                    } catch (err) { console.error(err); }
                });
            }
            grid.appendChild(cell);
        });
        if (!byRoom && rightColumns.length > 0) {
            const toggleCell = document.createElement('div');
            toggleCell.className = 'right-section-toggle-cell' + gridLineClass + officialHrs;
            toggleCell.dataset.timeSlot = slotIndex;
            grid.appendChild(toggleCell);
            if (!rightSectionCollapsed) {
                rightColumns.forEach(colKey => {
                    const cell = document.createElement('div');
                    cell.className = 'appointment-cell' + gridLineClass + officialHrs;
                    cell.dataset.therapist = colKey;
                    cell.dataset.timeSlot = slotIndex;
                    cell.dataset.timeSlotStart = timeSlot.getTime();
                    const appointments = appointmentsByColumn[colKey] || [];
                    const positions = appointmentsWithPositions[colKey] || {};
                    appointments.forEach(appointment => {
                        const eventStart = new Date(appointment.start_at).getTime();
                        if (eventStart >= slotStart && eventStart < slotEnd) {
                            const lk = calendarAppointmentOverlapLayoutKey(appointment);
                            const position = positions[lk] || positions[appointment.booking_id] || { left: 0, width: 100 };
                            try {
                                const block = createAppointmentBlock(appointment, timeSlot, slotIndex, timeSlots, position, byRoom, colKey, slotStepMinutes);
                                cell.appendChild(block);
                            } catch (err) {
                                console.error('Error rendering appointment block', appointment?.booking_id, err);
                                const fallback = document.createElement('div');
                                fallback.className = 'appointment-block appointment-block-error';
                                fallback.textContent = (appointment.customer || uiT('word.appointment', 'Appointment')) + uiT('error.display', ' – error displaying');
                                cell.appendChild(fallback);
                            }
                        }
                    });
                    cell.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        cell.classList.add('drop-target');
                    });
                    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
                    cell.addEventListener('drop', async (e) => {
                        e.preventDefault();
                        cell.classList.remove('drop-target');
                        let payload;
                        try {
                            payload = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
                        } catch (_) { return; }
                        const targetTherapist = cell.dataset.therapist;
                        if (!targetTherapist || !payload.booking_id || !payload.date) return;
                        const ev = (currentData && currentData.events) ? currentData.events.find(x => x.booking_id === payload.booking_id) : null;
                        if (ev && ev.therapist === targetTherapist) return;
                        try {
                            const res = await fetch('/api/therapist', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ booking_id: payload.booking_id, date: payload.date, therapist: targetTherapist, locked: true, slot: 1 })
                            });
                            if (res.ok) loadDay({ soft: true });
                        } catch (err) { console.error(err); }
                    });
                    grid.appendChild(cell);
                });
            }
        }
    });
    bindMomFacialCapacityHintsIn(grid);
    momSyncPhoneCalendarListAfterRender(data);
}

function generateTimeSlots(dateString, stepMinutes = TIME_SLOT_MINUTES) {
    const slots = [];
    const step = stepMinutes > 0 ? stepMinutes : TIME_SLOT_MINUTES;
    
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
        current = new Date(current.getTime() + step * 60 * 1000);
    }

    return slots;
}

function calendarEventsOverlapRange(evStartMs, evEndMs, rangeStartMs, rangeEndMs) {
    return !(evEndMs <= rangeStartMs || evStartMs >= rangeEndMs);
}

function calendarEventsOverlappingRoomWindow(events, rangeStartMs, rangeEndMs) {
    const out = [];
    for (const ev of events || []) {
        if (ev.room === 'UNASSIGNED' || ev.room === 'ADDON') continue;
        const s = new Date(ev.start_at).getTime();
        const e = calendarColumnEventWallEndMs(ev);
        if (calendarEventsOverlapRange(s, e, rangeStartMs, rangeEndMs)) out.push(ev);
    }
    return out;
}

function calendarEventIsCouple(ev) {
    return String(ev.type || '').toLowerCase() === 'couple';
}

/**
 * Max concurrent clients when empty: rooms 0–4 as five singles + two extra beds in dedicated couple rooms 5 & 6.
 * Ceiling drops by 1 per couple room (5 or 6) occupied by a single (non-couple) booking.
 */
const MAX_BEDS_BASE = 9;
const COUPLE_DEDICATED_ROOM_IDS = ['5', '6'];

function calendarBedsOccupied(events, rangeStartMs, rangeEndMs) {
    let n = 0;
    for (const ev of calendarEventsOverlappingRoomWindow(events, rangeStartMs, rangeEndMs)) {
        n += calendarEventIsCouple(ev) ? 2 : 1;
    }
    return n;
}

function calendarMaxBedsCeiling(events, rangeStartMs, rangeEndMs) {
    const ov = calendarEventsOverlappingRoomWindow(events, rangeStartMs, rangeEndMs);
    let max = MAX_BEDS_BASE;
    for (const rid of COUPLE_DEDICATED_ROOM_IDS) {
        if (ov.some((ev) => String(ev.room) === rid && !calendarEventIsCouple(ev))) max -= 1;
    }
    return max;
}

/** Remaining client capacity (bed slots) for [rangeStart, rangeEnd). */
function calendarBedsFree(events, rangeStartMs, rangeEndMs) {
    const max = calendarMaxBedsCeiling(events, rangeStartMs, rangeEndMs);
    const occ = calendarBedsOccupied(events, rangeStartMs, rangeEndMs);
    return Math.max(0, max - occ);
}

/**
 * Find time periods when no rooms or not enough rooms are available, and which therapists should be blocked on Square.
 * Includes: (1) No rooms at all. (2) More free masseuses than room capacity (e.g. 2 free but only 1 single room; couple room can take 2 so no block then).
 */
function computeNoRoomPeriods(data) {
    const events = data.events || [];
    const therapists = data.therapists || [];
    const dateString = data.date || document.getElementById('dateInput')?.value;
    if (!dateString || !dateString.match(/^\d{4}-\d{2}-\d{2}$/) || !therapists.length) {
        return [];
    }

    const timeSlots = generateTimeSlots(dateString);
    const SLOT_MS = TIME_SLOT_MINUTES * 60 * 1000;
    const PHYSICAL_ROOMS = ['0', '1', '2', '3', '4', '5', '6'];

    function roomsInUseAt(slotStartMs, slotEndMs) {
        return roomsPhysicallyUsedInSlotForEvents(events, slotStartMs, slotEndMs);
    }

    /** Remaining bed/client capacity (same model as calendar “Beds” column). */
    function capacityAt(slotStartMs, slotEndMs) {
        return calendarBedsFree(events, slotStartMs, slotEndMs);
    }

    function therapistsBusyInRange(rangeStartMs, rangeEndMs) {
        const busy = new Set();
        events.forEach(ev => {
            const start = new Date(ev.start_at).getTime();
            const end = calendarColumnEventWallEndMs(ev);
            if (start >= rangeEndMs || end <= rangeStartMs) return;
            if (ev.room === 'ADDON') return;
            if (ev.therapist) busy.add(ev.therapist);
            if (ev.type === 'couple' && ev.therapist_2) busy.add(ev.therapist_2);
        });
        return busy;
    }

    function freeTherapistsInRange(rangeStartMs, rangeEndMs) {
        const busy = therapistsBusyInRange(rangeStartMs, rangeEndMs);
        return therapists.filter(t => !busy.has(t));
    }

    const results = [];

    // (1) No rooms at all
    const noRoomSlots = [];
    timeSlots.forEach(slot => {
        const slotStart = slot.getTime();
        const slotEnd = slotStart + SLOT_MS;
        const inUse = roomsInUseAt(slotStart, slotEnd);
        if (inUse.size >= PHYSICAL_ROOMS.length) {
            noRoomSlots.push({ start: slotStart, end: slotEnd });
        }
    });

    if (noRoomSlots.length > 0) {
        let cur = { start: noRoomSlots[0].start, end: noRoomSlots[0].end };
        for (let i = 1; i < noRoomSlots.length; i++) {
            if (noRoomSlots[i].start <= cur.end + 1) cur.end = noRoomSlots[i].end;
            else {
                const free = freeTherapistsInRange(cur.start, cur.end);
                results.push({ type: 'no_rooms', start: cur.start, end: cur.end, therapistsToBlock: free });
                cur = { start: noRoomSlots[i].start, end: noRoomSlots[i].end };
            }
        }
        const free = freeTherapistsInRange(cur.start, cur.end);
        results.push({ type: 'no_rooms', start: cur.start, end: cur.end, therapistsToBlock: free });
    }

    // (2) Limited rooms: more free masseuses than capacity (e.g. 2 free but only 1 single room; if only couple room and 2 free, no block)
    const limitedSlots = [];
    timeSlots.forEach(slot => {
        const slotStart = slot.getTime();
        const slotEnd = slotStart + SLOT_MS;
        const cap = capacityAt(slotStart, slotEnd);
        if (cap === 0) return; // already in no_rooms
        const free = freeTherapistsInRange(slotStart, slotEnd);
        if (free.length > cap) {
            limitedSlots.push({ start: slotStart, end: slotEnd, capacity: cap, freeCount: free.length, freeList: free });
        }
    });

    if (limitedSlots.length > 0) {
        let cur = { start: limitedSlots[0].start, end: limitedSlots[0].end, capacities: [limitedSlots[0].capacity], freeList: limitedSlots[0].freeList };
        for (let i = 1; i < limitedSlots.length; i++) {
            const s = limitedSlots[i];
            if (s.start <= cur.end + 1) {
                cur.end = s.end;
                cur.capacities.push(s.capacity);
                cur.freeList = freeTherapistsInRange(cur.start, cur.end);
            } else {
                const minCap = Math.min(...cur.capacities);
                const free = cur.freeList;
                const needBlock = free.length - minCap;
                if (needBlock > 0) {
                    results.push({
                        type: 'limited_rooms',
                        start: cur.start,
                        end: cur.end,
                        capacity: minCap,
                        therapistsToBlock: free.slice(0, needBlock),
                        freeCount: free.length
                    });
                }
                cur = { start: s.start, end: s.end, capacities: [s.capacity], freeList: s.freeList };
            }
        }
        const minCap = Math.min(...cur.capacities);
        const free = freeTherapistsInRange(cur.start, cur.end);
        const needBlock = free.length - minCap;
        if (needBlock > 0) {
            results.push({
                type: 'limited_rooms',
                start: cur.start,
                end: cur.end,
                capacity: minCap,
                therapistsToBlock: free.slice(0, needBlock),
                freeCount: free.length
            });
        }
    }

    return results;
}

function calendarRoomBlockedForWindow(roomId, overlapping, rangeStartMs, rangeEndMs) {
    for (const ev of overlapping) {
        if (eventUsesPhysicalRoomInSlot(ev, rangeStartMs, rangeEndMs, roomId)) return true;
    }
    return false;
}

function calendarCountNewSingles(events, rangeStartMs, rangeEndMs) {
    const ov = calendarEventsOverlappingRoomWindow(events, rangeStartMs, rangeEndMs);
    return PHYSICAL_ROOM_IDS_CAP.filter((r) => !calendarRoomBlockedForWindow(r, ov, rangeStartMs, rangeEndMs)).length;
}

function calendarCountNewCouples(events, rangeStartMs, rangeEndMs) {
    const ov = calendarEventsOverlappingRoomWindow(events, rangeStartMs, rangeEndMs);
    let n = 0;
    if (!calendarRoomBlockedForWindow('5', ov, rangeStartMs, rangeEndMs)) n++;
    if (!calendarRoomBlockedForWindow('6', ov, rangeStartMs, rangeEndMs)) n++;
    if (!calendarRoomBlockedForWindow('0', ov, rangeStartMs, rangeEndMs) && !calendarRoomBlockedForWindow('2', ov, rangeStartMs, rangeEndMs)) n++;
    return n;
}

/** Saved facial specialist checkboxes (canonical roster names), or null if not using named pool. */
function getFacialSpecialistPickNamesForDate(dateStr, dupFirst) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return null;
    let arr = null;
    try {
        const raw = localStorage.getItem(facialStaffPickStorageKeyForDate(dateStr));
        if (!raw) return null;
        arr = JSON.parse(raw);
    } catch (e) {
        return null;
    }
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const roster = getTherapistsForStaffingPickList();
    const dup = dupFirst || buildTherapistFirstNameDuplicates(roster);
    const out = [];
    const seen = new Set();
    for (const entry of arr) {
        if (typeof entry !== 'string') continue;
        const hit = roster.find((r) => therapistNamesMatchForCalendar(r, entry.trim(), dup));
        if (!hit) continue;
        const key = hit.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(hit);
    }
    return out.length ? out : null;
}

function collectBlockingProviderNamesFromEvent(ev, roster, dup) {
    const rawFields = [
        ev.therapist,
        ev.therapist_2,
        ev.facial_specialist,
        ev.luxury_mini_facial_therapist,
        ev.luxury_mini_facial_therapist_2,
    ];
    const out = [];
    for (const raw of rawFields) {
        if (!raw || String(raw).trim().toLowerCase() === 'staff') continue;
        const hit = roster.find((r) => therapistNamesMatchForCalendar(r, raw, dup));
        out.push(hit || String(raw).trim());
    }
    return out;
}

function isFacialPoolMemberBusyInWindow(name, events, rangeStartMs, rangeEndMs, dup, roster, dateStrOpt) {
    for (const ev of events || []) {
        if (!ev || ev.room === 'ADDON') continue;
        const est = new Date(ev.start_at).getTime();
        const en = calendarColumnEventWallEndMs(ev);
        if (!Number.isFinite(est) || !Number.isFinite(en) || en <= est) continue;
        if (!calendarEventsOverlapRange(est, en, rangeStartMs, rangeEndMs)) continue;
        const blockers = collectBlockingProviderNamesFromEvent(ev, roster, dup);
        for (const b of blockers) {
            if (therapistNamesMatchForCalendar(name, b, dup)) return true;
        }
    }
    if (dateStrOpt && /^\d{4}-\d{2}-\d{2}$/.test(String(dateStrOpt))) {
        const sim = getMomFacialStaffingSimulationCached(dateStrOpt, events, roster, dup);
        if (sim.mode === 'sim' && sim.busyIntervalsByName) {
            const nk = rosterNameKeyLower(name);
            const segs = sim.busyIntervalsByName.get(nk);
            if (segs && segs.some(({ a, b }) => calendarEventsOverlapRange(a, b, rangeStartMs, rangeEndMs))) return true;
        }
    }
    return false;
}

function findBlockingEventForFacialPoolMember(name, events, rangeStartMs, rangeEndMs, dup, roster) {
    for (const ev of events || []) {
        if (!ev || ev.room === 'ADDON') continue;
        const est = new Date(ev.start_at).getTime();
        const en = calendarColumnEventWallEndMs(ev);
        if (!Number.isFinite(est) || !Number.isFinite(en) || en <= est) continue;
        if (!calendarEventsOverlapRange(est, en, rangeStartMs, rangeEndMs)) continue;
        const blockers = collectBlockingProviderNamesFromEvent(ev, roster, dup);
        if (blockers.some((b) => therapistNamesMatchForCalendar(name, b, dup))) return { ev };
    }
    return null;
}

/** True if this therapist appears on any overlapping booking as a provider (massage, facial, or luxury mini). */
function therapistBusyAsProviderExcludingBooking(name, events, rangeStartMs, rangeEndMs, dup, roster, excludeBookingId) {
    for (const ev of events || []) {
        if (!ev || ev.room === 'ADDON') continue;
        if (excludeBookingId && ev.booking_id === excludeBookingId) continue;
        const est = new Date(ev.start_at).getTime();
        const en = calendarColumnEventWallEndMs(ev);
        if (!Number.isFinite(est) || !Number.isFinite(en) || en <= est) continue;
        if (!calendarEventsOverlapRange(est, en, rangeStartMs, rangeEndMs)) continue;
        const blockers = collectBlockingProviderNamesFromEvent(ev, roster, dup);
        for (const b of blockers) {
            if (therapistNamesMatchForCalendar(name, b, dup)) return true;
        }
    }
    return false;
}

function therapistFreeForFullAppointmentMassage(name, apt, events, dup, roster) {
    if (!name || !apt) return false;
    const slotStart = new Date(apt.start_at).getTime();
    const durMin = eventMassageDurationMinutes(apt);
    const slotEnd = slotStart + durMin * 60 * 1000;
    if (!Number.isFinite(slotStart) || !Number.isFinite(slotEnd) || slotEnd <= slotStart) return true;
    return !therapistBusyAsProviderExcludingBooking(name, events, slotStart, slotEnd, dup, roster, apt.booking_id);
}

/** Words skipped between two first names in notes (e.g. "Sophia and May"). */
const COUPLE_NOTE_NAME_STOPWORDS = new Set([
    'and', 'or', 'with', 'plus', 'the', 'a', 'an', 'to', 'for', 'in', 'on', 'at', 'n',
    'room', 'rm', 'couple', 'couples', 'massage', 'min', 'mins', 'minutes', 'minute',
    'customer', 'staff', 'book', 'booking', 'appt', 'appointment',
]);

function tokenizeNoteTextForNameHints(text) {
    const s = String(text || '').toLowerCase();
    return s.match(/\b[a-z]{2,}\b/g) || [];
}

/** Roster full name when exactly one therapist has this first name (otherwise ambiguous). */
function findTherapistOnRosterByFirstNameToken(token, therapistsList) {
    const want = String(token || '').toLowerCase();
    if (!want) return null;
    const hits = [];
    for (const full of therapistsList || []) {
        if (!full || typeof full !== 'string' || String(full).trim().toLowerCase() === 'staff') continue;
        const fn = therapistFirstNameOnly(full).toLowerCase();
        if (fn === want) hits.push(full);
    }
    if (hits.length === 1) return hits[0];
    return null;
}

/**
 * Couples: infer masseuse 2 from staff/customer/add-on notes.
 * - Two roster first names in any order (e.g. "Rose Jenny" with M1 = Jenny → Rose).
 * - Or M1's first name followed by another first name (e.g. "Sophia may").
 */
function inferCoupleSecondMasseuseFromNotes(apt, therapistsList) {
    if (!apt || String(apt.type || '').toLowerCase() !== 'couple') return null;
    const t1 = (apt.therapist || '').trim();
    if (!t1) return null;
    const dup = buildTherapistFirstNameDuplicates(therapistsList);
    const noteBits = [apt.seller_note, apt.customer_note, apt.addon_note].filter((x) => x && String(x).trim());
    const tokens = tokenizeNoteTextForNameHints(noteBits.join(' '));
    if (!tokens.length) return null;

    const hits = [];
    tokens.forEach((tok, idx) => {
        const full = findTherapistOnRosterByFirstNameToken(tok, therapistsList);
        if (full) hits.push({ idx, full });
    });
    if (!hits.length) return null;

    const orderedNames = [];
    const seen = new Set();
    for (const { full } of hits) {
        const k = full.trim().toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        orderedNames.push(full);
    }

    if (orderedNames.length >= 2) {
        const t1In = orderedNames.some((n) => therapistNamesMatchForCalendar(n, t1, dup));
        if (t1In) {
            const others = orderedNames.filter((n) => !therapistNamesMatchForCalendar(n, t1, dup));
            if (others.length === 1) return others[0];
            if (others.length > 1) {
                let lastT1Idx = -1;
                for (const h of hits) {
                    if (therapistNamesMatchForCalendar(h.full, t1, dup)) lastT1Idx = Math.max(lastT1Idx, h.idx);
                }
                let best = null;
                let bestIdx = Infinity;
                for (const h of hits) {
                    if (therapistNamesMatchForCalendar(h.full, t1, dup)) continue;
                    if (h.idx <= lastT1Idx) continue;
                    if (h.idx < bestIdx) {
                        bestIdx = h.idx;
                        best = h.full;
                    }
                }
                if (best) return best;
                return others[0];
            }
        }
    }

    const fn1 = therapistFirstNameOnly(t1).toLowerCase();
    if (!fn1 || tokens.length < 2) return null;
    for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i] !== fn1) continue;
        let j = i + 1;
        while (j < tokens.length && COUPLE_NOTE_NAME_STOPWORDS.has(tokens[j])) j++;
        if (j >= tokens.length) continue;
        const tkn = tokens[j];
        if (tkn === fn1) continue;
        const hit = findTherapistOnRosterByFirstNameToken(tkn, therapistsList);
        if (!hit) continue;
        if (therapistNamesMatchForCalendar(hit, t1, dup)) continue;
        return hit;
    }
    return null;
}

/** Next masseuse for couple slot 2: notes (e.g. "Sophia may") then staff turn order; can replace slot 2 when notes name someone else who is free. */
function suggestCoupleTherapistSecond(apt, dateStr, therapistsList, events) {
    if (String(apt.type || '').toLowerCase() !== 'couple') return null;
    const roster = getTherapistsForStaffingPickList();
    if (!roster.length) return null;
    const dup = buildTherapistFirstNameDuplicates(roster);
    const t1 = apt.therapist || '';

    const notePick = inferCoupleSecondMasseuseFromNotes(apt, therapistsList);
    if (notePick && t1 && !therapistNamesMatchForCalendar(notePick, t1, dup)) {
        if (therapistFreeForFullAppointmentMassage(notePick, apt, events, dup, roster)) {
            const listName = therapistsList.find((t) => therapistNamesMatchForCalendar(t, notePick, dup)) || notePick;
            const cur2 = (apt.therapist_2 || '').trim();
            if (!cur2 || !therapistNamesMatchForCalendar(cur2, listName, dup)) {
                return listName;
            }
        }
    }

    if ((apt.therapist_2 || '').trim()) return null;

    const order = getMassageStaffPickOrderedNamesForDate(dateStr);
    for (const name of order) {
        const listName = therapistsList.find((t) => therapistNamesMatchForCalendar(t, name, dup));
        if (!listName) continue;
        if (t1 && therapistNamesMatchForCalendar(listName, t1, dup)) continue;
        if (!therapistFreeForFullAppointmentMassage(listName, apt, events, dup, roster)) continue;
        return listName;
    }
    return null;
}

/** First staff-order name who can cover the full massage window (excluding skip list). */
function findMassageTherapistReplacementForDuration(apt, dateStr, therapistsList, events, skipNames) {
    const roster = getTherapistsForStaffingPickList();
    if (!roster.length) return null;
    const dup = buildTherapistFirstNameDuplicates(roster);
    const order = getMassageStaffPickOrderedNamesForDate(dateStr);
    const skips = Array.isArray(skipNames) ? skipNames : [];
    for (const name of order) {
        const listName = therapistsList.find((t) => therapistNamesMatchForCalendar(t, name, dup));
        if (!listName) continue;
        if (skips.some((s) => s && therapistNamesMatchForCalendar(listName, s, dup))) continue;
        if (!therapistFreeForFullAppointmentMassage(listName, apt, events, dup, roster)) continue;
        return listName;
    }
    return null;
}

function mergeTherapistModalOptionList(baseOrder, therapistsList, dupList, ...currentVals) {
    const out = [];
    const seen = new Set();
    const pushOne = (nm) => {
        if (!nm || !String(nm).trim()) return;
        const hit = therapistsList.find((t) => therapistNamesMatchForCalendar(t, nm.trim(), dupList));
        if (!hit) return;
        const k = hit.trim().toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        out.push(hit);
    };
    for (const x of baseOrder || []) pushOne(x);
    for (const cv of currentVals) pushOne(cv);
    return out;
}

/**
 * Facial specialist dropdown list: saved facial pool or calendar facial names for the day;
 * prefers specialists free for this booking window, else full pool so staff can override.
 */
function getFacialModalTherapistOptions(apt, dateStr, therapistsList) {
    const roster = getTherapistsForStaffingPickList();
    const dup = buildTherapistFirstNameDuplicates(roster);
    const dupList = buildTherapistFirstNameDuplicates(therapistsList);
    const events = (currentData && currentData.events) || [];
    let pool = getFacialSpecialistPickNamesForDate(dateStr, dup);
    if (!pool || !pool.length) {
        const fromCal = collectFacialSpecialistNamesOnLocalDate(events, dateStr, roster);
        if (fromCal && fromCal.size) {
            pool = roster.filter((n) => {
                for (const fc of fromCal) {
                    if (therapistNamesMatchForCalendar(n, fc, dup)) return true;
                }
                return false;
            });
        } else {
            pool = [];
        }
    }
    const s = new Date(apt.start_at).getTime();
    const e = new Date(apt.end_at).getTime();
    let avail = pool;
    if (pool.length && Number.isFinite(s) && Number.isFinite(e) && e > s) {
        const filtered = pool.filter(
            (name) => !therapistBusyAsProviderExcludingBooking(name, events, s, e, dup, roster, apt.booking_id),
        );
        if (filtered.length) avail = filtered;
    }
    return mergeTherapistModalOptionList(
        avail,
        therapistsList,
        dupList,
        apt.facial_specialist,
        apt.luxury_mini_facial_therapist,
        apt.luxury_mini_facial_therapist_2,
    );
}

function countFacialPoolFreeInWindow(poolNames, events, rangeStartMs, rangeEndMs, dup, roster, dateStrOpt) {
    let n = 0;
    for (const name of poolNames || []) {
        if (!isFacialPoolMemberBusyInWindow(name, events, rangeStartMs, rangeEndMs, dup, roster, dateStrOpt)) n++;
    }
    return n;
}

function buildFacialNamedPoolHintLines(events, namedPool, rangeStartMs, rangeEndMs, dup, roster, ctx, dateStrOpt) {
    const lines = [];
    if (!namedPool || !namedPool.length) return lines;
    lines.push(
        uiTParams('calendar.facialHintPoolHeader', { list: namedPool.join(', ') }, `Facial specialist pool: ${namedPool.join(', ')}`),
    );
    const namedLimits = ctx.availF < ctx.structuralBeforeNamed;
    if (namedLimits || ctx.availF === 0) {
        for (const name of namedPool) {
            if (!isFacialPoolMemberBusyInWindow(name, events, rangeStartMs, rangeEndMs, dup, roster, dateStrOpt)) continue;
            const bk = findBlockingEventForFacialPoolMember(name, events, rangeStartMs, rangeEndMs, dup, roster);
            const nm = therapistFirstNameOnly(name) || name;
            if (bk && bk.ev) {
                const tr = formatTimeRangeSmart(new Date(bk.ev.start_at), new Date(calendarColumnEventWallEndMs(bk.ev)));
                lines.push(
                    uiTParams('calendar.facialHintPoolBusy', { name: nm, time: tr }, `${nm} has another appointment overlapping this window (${tr}).`),
                );
            } else {
                lines.push(
                    uiTParams(
                        'calendar.facialHintPoolBusySynthetic',
                        { name: nm },
                        `${nm} is not free in this window (includes projected facial load from checked specialists).`,
                    ),
                );
            }
        }
    }
    const seenReq = new Set();
    for (const name of namedPool) {
        for (const ev of events || []) {
            if (!ev || ev.room === 'ADDON' || ev.original_any_available) continue;
            const ori = (ev.original_therapist || '').trim();
            if (!ori) continue;
            if (!therapistNamesMatchForCalendar(name, ori, dup)) continue;
            const est = new Date(ev.start_at).getTime();
            const en = calendarColumnEventWallEndMs(ev);
            if (!Number.isFinite(est) || !Number.isFinite(en) || en <= est) continue;
            if (!calendarEventsOverlapRange(est, en, rangeStartMs, rangeEndMs)) continue;
            const assignedHere =
                therapistNamesMatchForCalendar(name, ev.therapist, dup)
                || (ev.therapist_2 && therapistNamesMatchForCalendar(name, ev.therapist_2, dup));
            if (assignedHere || isAssignedTherapistStaff(ev)) continue;
            const bid = ev.booking_id || '';
            const key = bid + '|' + name;
            if (seenReq.has(key)) continue;
            seenReq.add(key);
            const tr = formatTimeRangeSmart(new Date(ev.start_at), new Date(en));
            const nm = therapistFirstNameOnly(name) || name;
            lines.push(
                uiTParams(
                    'calendar.facialHintRequested',
                    { name: nm, time: tr },
                    `${nm} is the customer’s requested therapist on a booking at ${tr} but is not the assigned masseuse.`,
                ),
            );
        }
    }
    if (ctx.availM <= 0) {
        lines.push(uiT('calendar.facialHintNoMassageStaff', 'No massage staff free in this window, so new facial services are counted as 0.'));
    }
    return lines.filter(Boolean);
}

let momFacialCapHintHideT = null;
let momFacialCapHintMoveBound = false;
function hideMomFacialCapHintSoon() {
    if (momFacialCapHintHideT) clearTimeout(momFacialCapHintHideT);
    momFacialCapHintHideT = setTimeout(() => {
        const tip = document.getElementById('momFacialCapHint');
        if (tip) tip.remove();
        momFacialCapHintHideT = null;
    }, 120);
}
function hideMomFacialCapHintNow() {
    if (momFacialCapHintHideT) clearTimeout(momFacialCapHintHideT);
    momFacialCapHintHideT = null;
    const tip = document.getElementById('momFacialCapHint');
    if (tip) tip.remove();
}
function positionMomFacialCapHint(tip, clientX, clientY) {
    const pad = 10;
    let left = clientX + 12;
    let top = clientY + 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    const r = tip.getBoundingClientRect();
    if (r.right > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - r.width - pad);
    if (r.bottom > window.innerHeight - pad) top = Math.max(pad, clientY - r.height - 14);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
}
function showMomFacialCapHint(text, clientX, clientY) {
    hideMomFacialCapHintNow();
    const tip = document.createElement('div');
    tip.id = 'momFacialCapHint';
    tip.className = 'mom-facial-cap-hint';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    document.body.appendChild(tip);
    positionMomFacialCapHint(tip, clientX, clientY);
    if (!momFacialCapHintMoveBound) {
        momFacialCapHintMoveBound = true;
        document.addEventListener(
            'mousemove',
            (ev) => {
                const el = document.getElementById('momFacialCapHint');
                if (!el) return;
                positionMomFacialCapHint(el, ev.clientX, ev.clientY);
            },
            true,
        );
    }
}

function bindMomFacialCapacityHintsIn(grid) {
    if (!grid) return;
    grid.querySelectorAll('.capacity-appt-facial[data-mom-facial-hint]').forEach((td) => {
        const enc = td.getAttribute('data-mom-facial-hint');
        if (!enc || td.dataset.momFacialHintBound) return;
        let text = '';
        try {
            text = decodeURIComponent(enc);
        } catch (e) {
            return;
        }
        if (!text.trim()) return;
        td.dataset.momFacialHintBound = '1';
        td.addEventListener('mouseenter', (ev) => {
            showMomFacialCapHint(text, ev.clientX, ev.clientY);
        });
        td.addEventListener('mouseleave', () => hideMomFacialCapHintSoon());
    });
}

/** Same test as Appts avail table: every duration row has 0 single and 0 couple after room + massage staff caps. */
function calendarSlotNoNewApptAvailability(slotStartMs, events) {
    const plannedM = getPlannedMassageStaffTodayCount();
    for (const dur of APPOINTMENT_CAP_DURATIONS_MIN) {
        const endMs = slotStartMs + dur * 60 * 1000;
        const sRoom = calendarCountNewSingles(events, slotStartMs, endMs);
        const cRoom = calendarCountNewCouples(events, slotStartMs, endMs);
        const peakM = peakMassageStaffSlotsInWindow(events, slotStartMs, endMs);
        const availM = Math.max(0, plannedM - peakM);
        const s = Math.min(sRoom, availM);
        const c = Math.min(cRoom, Math.floor(availM / 2));
        if (s > 0 || c > 0) return false;
    }
    return true;
}

function calendarCapacityCellHtml(slotStartMs, events, slotSpanMinutes = TIME_SLOT_MINUTES, dateStrOpt, therapistDupFirstOpt) {
    const span = slotSpanMinutes > 0 ? slotSpanMinutes : TIME_SLOT_MINUTES;
    const slotEndMs = slotStartMs + span * 60 * 1000;
    const dateStr =
        (dateStrOpt && /^\d{4}-\d{2}-\d{2}$/.test(String(dateStrOpt)) && String(dateStrOpt))
        || (document.getElementById('dateInput') && document.getElementById('dateInput').value)
        || '';
    const roster = getTherapistsForStaffingPickList();
    const dup = therapistDupFirstOpt || buildTherapistFirstNameDuplicates(roster);
    const namedPool = getFacialSpecialistPickNamesForDate(dateStr, dup);
    const maxBeds = calendarMaxBedsCeiling(events, slotStartMs, slotEndMs);
    const occNow = calendarBedsOccupied(events, slotStartMs, slotEndMs);
    const freeNow = Math.max(0, maxBeds - occNow);
    const bedsTitle = uiTParams(
        'calendar.bedsSummaryTitle',
        { occ: String(occNow), free: String(freeNow), max: String(maxBeds) },
        `${occNow} clients on beds, ${freeNow} free (max ${maxBeds} for current room use)`
    );
    const bedsLine = uiTParams(
        'calendar.bedsSummary',
        { occ: String(occNow), max: String(maxBeds), free: String(freeNow) },
        `${occNow}/${maxBeds} · ${freeNow} free`
    );
    const slotTimeLabel = formatTime(new Date(slotStartMs));
    const slotTimeHint = uiTParams(
        'calendar.capacitySlotTimeHint',
        { time: slotTimeLabel },
        `Slot start ${slotTimeLabel}`
    );
    const nDur = APPOINTMENT_CAP_DURATIONS_MIN.length;
    let bedsCellMod = '';
    if (maxBeds === 7) bedsCellMod = ' capacity-beds-cell--max7';
    else if (maxBeds === 8) bedsCellMod = ' capacity-beds-cell--max8';
    const bedsInner =
        '<div class="capacity-beds-slot-time" title="' +
        escapeHtml(slotTimeHint) +
        '">' +
        escapeHtml(slotTimeLabel) +
        '</div><div class="capacity-beds-line">' +
        escapeHtml(bedsLine) +
        '</div>';
    const plannedM = getPlannedMassageStaffTodayCount();
    const plannedF = getPlannedFacialSpecialistsTodayCount();
    const ariaZeroSingle = escapeHtml(uiT('calendar.apptCapAriaZeroSingle', 'No new single slots'));
    const ariaZeroCouple = escapeHtml(uiT('calendar.apptCapAriaZeroCouple', 'No new couple slots'));
    const ariaZeroFacial = escapeHtml(uiT('calendar.apptCapAriaZeroFacial', 'No facial capacity free'));
    const rows = APPOINTMENT_CAP_DURATIONS_MIN.map((dur, i) => {
        const endMs = slotStartMs + dur * 60 * 1000;
        const sRoom = calendarCountNewSingles(events, slotStartMs, endMs);
        const cRoom = calendarCountNewCouples(events, slotStartMs, endMs);
        const peakM = peakMassageStaffSlotsInWindow(events, slotStartMs, endMs);
        const peakF = peakFacialAppointmentSlotsInWindow(events, slotStartMs, endMs);
        const availM = Math.max(0, plannedM - peakM);
        const availFFs = availM > 0 ? Math.max(0, plannedF - peakF) : 0;
        const s = Math.min(sRoom, availM);
        const c = Math.min(cRoom, Math.floor(availM / 2));
        /* Facial work needs a physical single room for that window (same basis as “Rooms available”). */
        const structuralBeforeNamed = Math.min(availFFs, sRoom);
        let freeNamed = null;
        if (namedPool && namedPool.length) {
            freeNamed = countFacialPoolFreeInWindow(namedPool, events, slotStartMs, endMs, dup, roster, dateStr);
        }
        const availF =
            freeNamed != null ? Math.min(structuralBeforeNamed, freeNamed) : structuralBeforeNamed;
        const rowTitle = uiTParams(
            'calendar.apptCapRowTitle',
            { min: String(dur), s: String(s), c: String(c), f: String(availF) },
            `Next ${dur} min: up to ${s} new single(s), ${c} couple(s) (rooms + massage staff); ${availF} facial slot(s) free (min of FS pool after overlaps, massage staff, and ${sRoom} free single room(s) in window; planned ${plannedF} FS, peak ${peakF} facials overlapping).`
        );
        const facialHintExtra = buildFacialNamedPoolHintLines(events, namedPool, slotStartMs, endMs, dup, roster, {
            availF,
            structuralBeforeNamed,
            availFFs,
            availM,
            plannedF,
            peakF,
            sRoom,
            freeNamed,
        }, dateStr);
        const facialHoverBody =
            facialHintExtra.length > 0 ? `${rowTitle}\n\n${facialHintExtra.join('\n')}` : rowTitle;
        const facialHintAttr = ` data-mom-facial-hint="${encodeURIComponent(facialHoverBody)}"`;
        /* Alternate stripe by duration band: 60/120/180 vs 90/150 — visually separates 60 vs 90 rows */
        const stripeClass =
            (dur / 30) % 2 === 0 ? 'capacity-appt-row--stripe-a' : 'capacity-appt-row--stripe-b';
        const bedsCell = i === 0
            ? `<td rowspan="${nDur}" class="capacity-beds-cell${bedsCellMod}" title="${escapeHtml(bedsTitle)}">${bedsInner}</td>`
            : '';
        const singleCls = 'capacity-appt-single' + (s === 0 ? ' capacity-appt-zero' : '');
        const coupleCls = 'capacity-appt-couple' + (c === 0 ? ' capacity-appt-zero' : '');
        const facialCls = 'capacity-appt-facial' + (availF === 0 ? ' capacity-appt-zero' : '');
        const singleTd =
            s === 0
                ? `<td class="${singleCls}" aria-label="${ariaZeroSingle}"></td>`
                : `<td class="${singleCls}">${s}</td>`;
        const coupleTd =
            c === 0
                ? `<td class="${coupleCls}" aria-label="${ariaZeroCouple}"></td>`
                : `<td class="${coupleCls}">${c}</td>`;
        const facialTd =
            availF === 0
                ? `<td class="${facialCls}" aria-label="${ariaZeroFacial}"${facialHintAttr}></td>`
                : `<td class="${facialCls}"${facialHintAttr}>${availF}</td>`;
        return (
            `<tr class="capacity-appt-row ${stripeClass}" title="${escapeHtml(rowTitle)}">` +
            `${bedsCell}<td class="capacity-appt-min">${dur}</td>${singleTd}${coupleTd}${facialTd}</tr>`
        );
    }).join('');
    const apptsHint = escapeHtml(
        uiT('calendar.apptsAvailHint', 'New appointments that fit (rooms, massage staff, facial capacity)')
    );
    return (
        `<div class="capacity-cell-inner" title="${escapeHtml(bedsTitle)}">` +
        `<table class="capacity-appt-table" aria-label="${apptsHint}">` +
        '<colgroup><col class="capacity-col-beds"><col class="capacity-col-min"><col class="capacity-col-s"><col class="capacity-col-c"><col class="capacity-col-f"></colgroup>' +
        `<tbody>${rows}</tbody></table></div>`
    );
}

function updateNoRoomsAlert(data) {
    const container = document.getElementById('noRoomsAlertContainer');
    if (!container) return;
    container.style.display = 'none';
    return;
    const periods = computeNoRoomPeriods(data);
    if (periods.length === 0) {
        container.style.display = 'none';
        return;
    }
    const formatRange = (startMs, endMs) => {
        const s = new Date(startMs);
        const e = new Date(endMs);
        return formatTimeRangeSmart(s, e);
    };
    const parts = periods.map(p => {
        const range = formatRange(p.start, p.end);
        const list = p.therapistsToBlock.length ? p.therapistsToBlock.join(', ') : '—';
        if (p.type === 'no_rooms') {
            return `• <strong>No rooms</strong> ${range}: block on Square — ${list}`;
        }
        const roomWord = p.capacity === 1 ? 'room' : 'rooms';
        return `• <strong>Only ${p.capacity} ${roomWord}</strong> ${range}: block on Square — ${list}`;
    });
    container.querySelector('.no-rooms-alert-message').innerHTML =
        '<strong>Block time on Square</strong> so masseuses are not bookable when there’s no room (or not enough room):<br><br>' +
        parts.join('<br>');
    container.style.display = 'block';

    if (!container.dataset.toggleBound) {
        container.dataset.toggleBound = '1';
        const header = container.querySelector('.no-rooms-alert-header');
        const toggle = () => {
            const collapsed = container.classList.toggle('no-rooms-alert-collapsed');
            if (header) header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        };
        if (header) {
            header.addEventListener('click', toggle);
            header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        }
    }
}

const NO_ROOM_ALERT_DISMISSED_KEY = 'mom_no_room_alert_dismissed';
const THERAPIST_REQUEST_OVERLAP_ALERT_DISMISSED_KEY = 'mom_therapist_request_overlap_alert_dismissed';

/** Red bar when the same therapist is requested on overlapping appointments (dismiss per calendar day). */
function updateTherapistRequestOverlapAlert(hasConflict, dateStr) {
    const container = document.getElementById('therapistRequestOverlapAlertContainer');
    if (!container) return;
    if (!hasConflict) {
        container.style.display = 'none';
        return;
    }
    const date = dateStr || (document.getElementById('dateInput') && document.getElementById('dateInput').value) || '';
    try {
        const dismissed = sessionStorage.getItem(THERAPIST_REQUEST_OVERLAP_ALERT_DISMISSED_KEY);
        if (dismissed === date) {
            container.style.display = 'none';
            return;
        }
    } catch (e) {}
    const msg = container.querySelector('.therapist-request-overlap-alert-message');
    if (msg) {
        msg.textContent = uiT(
            'therapistOverlap.msg',
            'The same therapist is requested for more than one appointment at overlapping times. Resolve assignments or reschedule.'
        );
    }
    container.style.display = 'block';
    const dismissBtn = container.querySelector('.therapist-request-overlap-alert-dismiss');
    if (dismissBtn && !dismissBtn.dataset.bound) {
        dismissBtn.dataset.bound = '1';
        dismissBtn.addEventListener('click', () => {
            container.style.display = 'none';
            try {
                sessionStorage.setItem(THERAPIST_REQUEST_OVERLAP_ALERT_DISMISSED_KEY, date || '');
            } catch (e2) {}
        });
    }
}

function updateNoRoomBookingAlert(data) {
    const container = document.getElementById('noRoomBookingAlertContainer');
    if (!container) return;
    if (!data || !data.no_room_alert) {
        container.style.display = 'none';
        return;
    }
    const date = data.date || (document.getElementById('dateInput') && document.getElementById('dateInput').value);
    try {
        const dismissed = sessionStorage.getItem(NO_ROOM_ALERT_DISMISSED_KEY);
        if (dismissed === date) {
            container.style.display = 'none';
            return;
        }
    } catch (e) {}
    const msg = container.querySelector('.no-room-booking-alert-message');
    if (msg) {
        let txt = uiT(
            'noRoom.msg',
            'Appointment(s) have no room (any service) — all rooms are booked. SMS and email sent to 917-378-7373 and melispatex@gmail.com with appointment details.'
        );
        const sugs = data.unassigned_fix_suggestions;
        if (Array.isArray(sugs) && sugs.length) {
            const lines = sugs.slice(0, 8).map((s) => `• ${formatUnassignedFixSuggestionPlain(s)}`);
            txt +=
                '\n\n' +
                uiT('unassigned.suggestionsShortLead', 'Ideas (verify on calendar before changing Square):') +
                '\n' +
                lines.join('\n');
        }
        msg.textContent = txt;
    }
    container.style.display = 'block';
    const dismissBtn = container.querySelector('.no-room-booking-alert-dismiss');
    if (dismissBtn && !dismissBtn.dataset.bound) {
        dismissBtn.dataset.bound = '1';
        dismissBtn.addEventListener('click', () => {
            container.style.display = 'none';
            try {
                sessionStorage.setItem(NO_ROOM_ALERT_DISMISSED_KEY, date || '');
            } catch (e) {}
        });
    }
}

function renderCancelledAlerts() {
    const container = document.getElementById('cancelledAlertsContainer');
    if (!container) return;
    const alerts = getCancelledAlerts();
    if (!alerts.length) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    function formatAlertTime(iso) {
        if (!iso) return '';
        return formatTimeCompactUS(new Date(iso));
    }
    container.innerHTML = alerts.map(a => {
        const timeStr = formatAlertTime(a.start_at);
        const atWord = uiT('alert.at', 'at');
        const prefix = escapeHtml(uiT('alert.cancelled', 'Appointment cancelled:'));
        const text = `${prefix} ${escapeHtml(a.customer || 'Unknown')} — ${escapeHtml(a.service || '')}${timeStr ? ' ' + escapeHtml(atWord) + ' ' + timeStr : ''}`;
        const dismiss = escapeHtml(uiT('btn.dismiss', 'Dismiss'));
        return `<div class="cancelled-alert-item" data-booking-id="${escapeHtml(a.booking_id)}" data-stored-at="${escapeHtml(a.stored_at)}">
            <span class="cancelled-alert-text">${text}</span>
            <button type="button" class="cancelled-alert-dismiss" title="${dismiss}" aria-label="${dismiss}">×</button>
        </div>`;
    }).join('');
    container.style.display = 'block';
    container.querySelectorAll('.cancelled-alert-dismiss').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.cancelled-alert-item');
            if (!item) return;
            const bookingId = item.getAttribute('data-booking-id');
            const storedAt = item.getAttribute('data-stored-at');
            try {
                const raw = sessionStorage.getItem(CANCELLED_ALERTS_KEY);
                const list = raw ? JSON.parse(raw) : [];
                const found = list.find(a => a.booking_id === bookingId && a.stored_at === storedAt);
                if (found) {
                    found.dismissed = true;
                    sessionStorage.setItem(CANCELLED_ALERTS_KEY, JSON.stringify(list));
                }
            } catch (e) {}
            renderCancelledAlerts();
        });
    });
}

function renderRescheduleAlerts() {
    const container = document.getElementById('rescheduleAlertsContainer');
    if (!container) return;
    const alerts = getRescheduleAlerts();
    if (!alerts.length) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    function formatAlertTime(iso) {
        if (!iso) return '';
        return formatTimeCompactUS(new Date(iso));
    }
    container.innerHTML = alerts.map(a => {
        const fromStr = formatAlertTime(a.from_start_at);
        const toStr = formatAlertTime(a.to_start_at);
        const fromW = uiT('alert.from', 'from');
        const toW = uiT('alert.to', 'to');
        const prefix = escapeHtml(uiT('alert.rescheduled', 'Appointment rescheduled:'));
        const text = `${prefix} ${escapeHtml(a.customer || 'Unknown')} — ${escapeHtml(a.service || '')} ${escapeHtml(fromW)} ${fromStr || '?'} ${escapeHtml(toW)} ${toStr || '?'}`;
        const dismiss = escapeHtml(uiT('btn.dismiss', 'Dismiss'));
        return `<div class="reschedule-alert-item" data-booking-id="${escapeHtml(a.booking_id)}" data-stored-at="${escapeHtml(a.stored_at)}">
            <span class="reschedule-alert-text">${text}</span>
            <button type="button" class="reschedule-alert-dismiss" title="${dismiss}" aria-label="${dismiss}">×</button>
        </div>`;
    }).join('');
    container.style.display = 'block';
    container.querySelectorAll('.reschedule-alert-dismiss').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.reschedule-alert-item');
            if (!item) return;
            const bookingId = item.getAttribute('data-booking-id');
            const storedAt = item.getAttribute('data-stored-at');
            try {
                const raw = sessionStorage.getItem(RESCHEDULE_ALERTS_KEY);
                const list = raw ? JSON.parse(raw) : [];
                const filtered = list.filter(a => !(a.booking_id === bookingId && a.stored_at === storedAt));
                sessionStorage.setItem(RESCHEDULE_ALERTS_KEY, JSON.stringify(filtered));
            } catch (e) {}
            renderRescheduleAlerts();
        });
    });
}

/** Single clock label (grid time column, etc.): compact, no space before AM/PM. */
function formatTime(date) {
    if (!date) return '';
    return formatTimeCompactUS(date);
}

async function showAppointmentDetailModal(aptInput) {
    const modal = document.getElementById('appointmentDetailModal');
    const bodyEl = document.getElementById('appointmentDetailBody');
    if (!modal || !bodyEl) return;
    const date = (document.getElementById('dateInput') && document.getElementById('dateInput').value) || '';
    let apt = aptInput;
    if (apt && apt.is_past && !apt.appointment_locked && momDayListEditPinActive() && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        try {
            const res = await fetch('/api/appointment/unlock', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ booking_id: apt.booking_id, date, unlocked: true }),
            });
            if (res.ok) {
                const ev = (currentData && currentData.events) ? currentData.events.find(e => e.booking_id === apt.booking_id) : null;
                if (ev) {
                    ev.appointment_locked = true;
                    apt = ev;
                } else {
                    apt = { ...apt, appointment_locked: true };
                }
            }
        } catch (e) {
            console.error(e);
        }
    }
    const therapists = (currentData && currentData.therapists) || [];
    const canEdit = !apt.is_past || apt.appointment_locked === true;
    const isCouple = (apt.type || '').toLowerCase() === 'couple';
    const aptPkg = apt.package_type || '';
    const isLuxury = aptPkg === 'luxury' || (apt.service || '').toLowerCase().includes('luxury');
    const serviceDisplayRaw = (apt.display_service && apt.display_service.trim()) ? apt.display_service.trim() : (apt.service || '—');
    const serviceDisplay = uiCatalogLine(serviceDisplayRaw);
    const start = new Date(apt.start_at);
    const end = new Date(apt.end_at);
    const squareEndDate = apt.square_end_at ? new Date(apt.square_end_at) : end;
    const addonNeutral = effectiveAddonTimeNeutralMinutes(apt);
    const displayEnd = addonNeutral > 0 ? new Date(end.getTime() - addonNeutral * 60000) : end;
    const timeStr = formatTimeRangeSmart(start, displayEnd);
    const squareOriginalDisplayEnd =
        addonNeutral > 0
            ? new Date(Math.max(start.getTime(), squareEndDate.getTime() - addonNeutral * 60000))
            : squareEndDate;
    const validRooms = ['0', '1', '2', '3', '4', '5', '6', '02D', 'UNASSIGNED'];

    const singleFacialMassage = !isCouple && apt.is_facial_with_massage === true;
    const hasFacialSpecialistSplit = (apt.is_facial_with_massage && apt.facial_specialist)
        || (isLuxury && luxurySeparateMiniFacialChecked(apt) && apt.luxury_mini_facial_therapist);
    const tipAmount = apt.tip_amount != null ? Number(apt.tip_amount) : 0;
    const tipAmount2 = apt.tip_amount_2 != null ? Number(apt.tip_amount_2) : 0;
    const oneTotalTipLuxury = isLuxury && isCouple && (tipAmount2 == null || tipAmount2 === 0) && tipAmount > 0;
    const tipVal = singleFacialMassage
        ? (apt.tip_amount != null ? Number(apt.tip_amount) : '')
        : (hasFacialSpecialistSplit && !oneTotalTipLuxury && (tipAmount > 0 || tipAmount2 > 0) && !(isLuxury && isCouple))
            ? (tipAmount + tipAmount2)
            : (oneTotalTipLuxury ? tipAmount : (apt.tip_amount != null ? Number(apt.tip_amount) : ''));
    const tipVal2 = oneTotalTipLuxury ? '' : (apt.tip_amount_2 != null ? Number(apt.tip_amount_2) : '');
    let tipAllocationHtml = '';
    if (isLuxury && isCouple && (tipAmount > 0 || tipAmount2 > 0)) {
        const side1 = oneTotalTipLuxury ? Math.round(tipAmount / 2 * 100) / 100 : tipAmount;
        const side2 = oneTotalTipLuxury ? Math.round(tipAmount / 2 * 100) / 100 : tipAmount2;
        const hasFS1 = luxurySeparateMiniFacialChecked(apt) && apt.luxury_mini_facial_therapist && apt.luxury_mini_facial_therapist !== apt.therapist;
        const hasFS2 = luxurySeparateMiniFacialChecked(apt) && apt.luxury_mini_facial_therapist_2 && apt.luxury_mini_facial_therapist_2 !== apt.therapist_2;
        const m1 = hasFS1 ? Math.round(side1 * 90 / 120 * 100) / 100 : side1;
        const fs1 = hasFS1 ? Math.round(side1 * 30 / 120 * 100) / 100 : 0;
        const m2 = hasFS2 ? Math.round(side2 * 90 / 120 * 100) / 100 : side2;
        const fs2 = hasFS2 ? Math.round(side2 * 30 / 120 * 100) / 100 : 0;
        const parts = [`M1 $${m1.toFixed(2)}`];
        if (fs1 > 0) parts.push(`FS1 $${fs1.toFixed(2)}`);
        parts.push(`M2 $${m2.toFixed(2)}`);
        if (fs2 > 0) parts.push(`FS2 $${fs2.toFixed(2)}`);
        tipAllocationHtml = `<div class="detail-row modal-tip-allocation"><span class="detail-label">${escapeHtml(uiT('detail.allocated', 'Allocated'))}</span><span class="detail-value">${parts.join(' · ')}</span></div>`;
    } else if (hasFacialSpecialistSplit && (tipAmount > 0 || tipAmount2 > 0)) {
        const allocLine = uiTParams('detail.tipMasseuseFs', { m: '$' + tipAmount.toFixed(2), f: '$' + tipAmount2.toFixed(2) }, 'Masseuse {m} · Facial Specialist {f}');
        tipAllocationHtml = `<div class="detail-row modal-tip-allocation"><span class="detail-label">${escapeHtml(uiT('detail.allocated', 'Allocated'))}</span><span class="detail-value">${escapeHtml(allocLine)}</span></div>`;
    }
    const roomVal = (apt.room === 'UNASSIGNED' || apt.room === 'ADDON') ? '' : (apt.room || '');
    const showCouple02dSingleFacial = isCouple && apt.is_couple_facial_with_massage === true
        && ['5', '6', '02D'].includes(apt.room || '');
    const couple02dSingleFacialChecked = apt.couple_02d_single_facial_only === true;
    const originalTimeStr = formatTimeRangeSmart(start, squareOriginalDisplayEnd);
    const originalTherapistRaw = apt.original_therapist || '—';
    const modalAnyAvail = customerAnyAvailEffective(apt);
    // Original (Square) column: only Square’s any-available flag; Staff is our assignment, not Square’s ORI text
    const anyAvailParen = ' (' + uiT('detail.bookWithAny', 'Book with any available') + ')';
    const originalTherapist = originalTherapistRaw + (apt.original_any_available ? anyAvailParen : '');
    const originalRoom = apt.original_room ? (apt.original_room === 'UNASSIGNED' ? uiT('calendar.unassigned', 'UNASSIGNED') : formatRoomForPanel(apt.original_room)) : '—';
    const modalOriName = (apt.original_therapist || '').trim() || '—';
    const originalBookedBy = apt.booked_by === 'customer'
        ? (modalAnyAvail ? uiT('detail.custAnyAvail', 'Cust – Any Avail') : uiTParams('detail.customerNamed', { name: modalOriName }, 'Customer — {name}'))
        : (apt.booked_by === 'us' ? uiT('detail.bookedByUs', 'Us') : '—');
    const originalTipDisplay = apt.original_tip_paid != null ? Number(apt.original_tip_paid)
        : (apt.tip_amount != null ? Number(apt.tip_amount) : null);
    const prepaymentAmount = (apt.prepayment_amount != null && !Number.isNaN(Number(apt.prepayment_amount)) && Number(apt.prepayment_amount) > 0) ? Number(apt.prepayment_amount) : null;
    const prePaidDisplay = prepaymentAmount != null
        ? uiTParams('detail.prepaidWithAmount', { amt: '$' + prepaymentAmount.toFixed(2) }, 'Yes — {amt}')
        : uiT('detail.prepaidNo', 'No');

    function parseCheckinNote(note) {
        if (!note || typeof note !== 'string') return { addons: '', pressure: '', focus: '' };
        const s = note.trim();
        let addons = '', pressure = '', focus = '';
        const addonMatch = s.match(/Add-on:\s*([\s\S]*?)(?=\s*Pressure:|\s*Focus:|$)/i);
        if (addonMatch) addons = addonMatch[1].trim().replace(/\.\s*$/, '');
        const pressureMatch = s.match(/Pressure:\s*([\s\S]*?)(?=\s*Focus:|$)/i);
        if (pressureMatch) pressure = pressureMatch[1].trim().replace(/\.\s*$/, '');
        const focusMatch = s.match(/Focus:\s*([\s\S]*)$/im);
        if (focusMatch) focus = focusMatch[1].trim().replace(/\.\s*$/, '');
        return { addons, pressure, focus };
    }
    const checkinNote = parseCheckinNote(apt.addon_note);
    const hasCheckinNote = checkinNote.addons || checkinNote.pressure || checkinNote.focus || (apt.addon_note && apt.addon_note.trim());

    // Parse focus string into list of area ids for body diagram (e.g. "shoulders, lower back" -> ["shoulders","lower-back"])
    function focusAreasToIds(focusStr) {
        if (!focusStr || typeof focusStr !== 'string') return [];
        return focusStr.split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
    }
    const focusAreaIds = focusAreasToIds(checkinNote.focus);

    // Body diagram SVG (back view) with regions; highlight those in focusAreaIds
    function bodyFocusDiagramSVG(highlightIds) {
        const set = new Set((highlightIds || []).map(id => id.toLowerCase()));
        const cls = (id) => set.has(id) ? ' body-focus-region-highlight' : '';
        return `
        <svg class="body-focus-diagram" viewBox="0 0 120 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <!-- back view silhouette: one closed path -->
          <path class="body-outline" d="M60 5 L88 22 L90 55 L85 58 L82 95 L79 130 L76 165 L74 198 L72 200 L48 200 L46 198 L44 165 L41 130 L38 95 L35 58 L30 55 L32 22 Z" fill="#e8ecef" stroke="#adb5bd" stroke-width="1.2"/>
          <!-- focus regions (invisible until highlighted) -->
          <ellipse class="body-focus-region${cls('neck')}" data-area="neck" cx="60" cy="32" rx="14" ry="10" fill="transparent"/>
          <ellipse class="body-focus-region${cls('shoulders')}" data-area="shoulders" cx="60" cy="52" rx="30" ry="12" fill="transparent"/>
          <path class="body-focus-region${cls('upper-back')}" data-area="upper-back" d="M42 58 L78 58 L75 92 L45 92 Z" fill="transparent"/>
          <path class="body-focus-region${cls('lower-back')}" data-area="lower-back" d="M45 94 L75 94 L72 132 L48 132 Z" fill="transparent"/>
          <path class="body-focus-region${cls('back')}" data-area="back" d="M44 58 L76 58 L73 132 L47 132 Z" fill="transparent"/>
          <path class="body-focus-region${cls('hips')}" data-area="hips" d="M48 134 L72 134 L70 158 L50 158 Z" fill="transparent"/>
          <path class="body-focus-region${cls('glutes')}" data-area="glutes" d="M46 158 L74 158 L72 182 L48 182 Z" fill="transparent"/>
          <path class="body-focus-region${cls('legs')}" data-area="legs" d="M42 182 L52 182 L52 200 L40 200 L38 198 Z M68 182 L78 182 L78 200 L82 200 L80 198 Z" fill="transparent"/>
          <path class="body-focus-region${cls('hamstrings')}" data-area="hamstrings" d="M42 182 L52 182 L52 200 L40 200 Z M68 182 L78 182 L78 200 L82 200 Z" fill="transparent"/>
          <path class="body-focus-region${cls('feet')}" data-area="feet" d="M40 198 L54 200 L54 202 L40 200 Z M66 198 L80 200 L80 202 L66 200 Z" fill="transparent"/>
          <path class="body-focus-region${cls('arms')}" data-area="arms" d="M18 54 L30 54 L30 118 L18 120 Z M90 54 L102 54 L102 120 L90 118 Z" fill="transparent"/>
        </svg>`;
    }

    function chineseSummary(apt, checkinNote) {
        const parts = [];
        const clz = window.MOM_I18N && window.MOM_I18N.catalogLineZh;
        const pz = window.MOM_I18N && window.MOM_I18N.pressureDisplayZh;
        const faz = window.MOM_I18N && window.MOM_I18N.focusAreaZh;
        if (apt.customer) parts.push(apt.customer + ' 的');
        const svcBase = (apt.display_service && apt.display_service.trim()) ? apt.display_service.trim() : (apt.service || '').trim();
        parts.push(svcBase ? (clz ? (clz(svcBase) || svcBase) : svcBase) : '按摩');
        if (apt.room && apt.room !== 'UNASSIGNED' && apt.room !== 'ADDON') parts.push('，' + roomKeyDisplayLabel(apt.room) + ' 号房');
        if (apt.therapist) parts.push('，按摩师 ' + apt.therapist);
        const timeStrCn = formatTimeRangeSmart(start, displayEnd);
        parts.push('。时间：' + timeStrCn);
        if (checkinNote.addons) parts.push('。加项：' + (clz ? (clz(checkinNote.addons) || checkinNote.addons) : checkinNote.addons));
        if (checkinNote.pressure) parts.push('。力度：' + (pz ? pz(checkinNote.pressure) : checkinNote.pressure));
        if (checkinNote.focus) {
            const fz = checkinNote.focus.split(/[,;]/).map(s => s.trim()).filter(Boolean).map(a => (faz ? faz(a) : a)).join('、');
            parts.push('。重点部位：' + fz);
        }
        if (parts.length === 0) return '';
        return parts.join('') + '。';
    }
    function englishSummary(apt, checkinNote) {
        const parts = [];
        if (apt.customer) parts.push(apt.customer);
        parts.push((apt.display_service && apt.display_service.trim()) ? apt.display_service.trim() : (apt.service || 'Massage'));
        if (apt.room && apt.room !== 'UNASSIGNED' && apt.room !== 'ADDON') parts.push(formatRoomForPanel(apt.room));
        if (apt.therapist) parts.push(apt.therapist);
        const timeStrEn = formatTimeRangeSmart(start, displayEnd);
        parts.push(timeStrEn);
        if (checkinNote.addons) parts.push('Add-ons: ' + checkinNote.addons);
        if (checkinNote.pressure) parts.push('Pressure: ' + checkinNote.pressure);
        if (checkinNote.focus) parts.push('Focus: ' + checkinNote.focus);
        return parts.join(' · ');
    }
    const chineseSummaryText = chineseSummary(apt, checkinNote);
    const englishSummaryText = englishSummary(apt, checkinNote);
    const SMS_NUMBER = '9173787373';
    const SMS_NUMBER_ENGLISH = '4697137856';

    const durAdjRaw = apt.duration_adjust_minutes != null && apt.duration_adjust_minutes !== '' ? Number(apt.duration_adjust_minutes) : 0;
    const durAdjActive = Number.isFinite(durAdjRaw) && durAdjRaw !== 0;
    const adjSignMinus = durAdjActive && durAdjRaw < 0;
    const adjMinutesAbs = durAdjActive ? Math.abs(durAdjRaw) : '';
    const durationApplyLockedTitle = escapeHtml(uiT('detail.adjustTimeNeedUnlock', 'Click “Unlock to edit” first, then Apply.'));

    const prepaymentReadonlyBanner = (!canEdit && prepaymentAmount != null && prepaymentAmount > 0)
        ? `<div class="modal-prepayment-box"><span class="prepayment-check">✓</span> $${prepaymentAmount.toFixed(2)} ${escapeHtml(uiT('calendar.prepaymentWord', 'prepayment'))}</div>`
        : '';
    const noteParts = [];
    if ((apt.seller_note || '').trim()) noteParts.push({ label: uiT('detail.notesStaff', 'Notes (staff)'), text: (apt.seller_note || '').trim() });
    if ((apt.customer_note || '').trim()) noteParts.push({ label: uiT('detail.notesCustomer', 'Notes (customer)'), text: (apt.customer_note || '').trim() });
    if ((apt.addon_note || '').trim()) noteParts.push({ label: uiT('detail.checkinNote', 'Check-in note'), text: (apt.addon_note || '').trim() });
    const appointmentNotesBoxHtml = noteParts.length
        ? `<div class="modal-notes-box"><span class="modal-notes-label">${escapeHtml(uiT('detail.appointmentNotes', 'Appointment notes'))}</span><div class="modal-notes-content">${noteParts.map(n => noteParts.length > 1 ? `<div class="modal-notes-section"><strong>${escapeHtml(n.label)}:</strong> ${uiFreeformNoteDisplayHtml(n.text)}</div>` : uiFreeformNoteDisplayHtml(n.text)).join('')}</div></div>`
        : '';
    const deskNotesHistoryRow =
        (apt.customer_id || '').trim()
            ? `<div class="detail-row customer-desk-notes-history-row"><span class="detail-label">${escapeHtml(uiT('deskNote.historyLabel', 'Front desk notes (saved)'))}</span><span class="detail-value" id="customerDeskNotesHistoryMount" data-customer-id="${escapeHtml((apt.customer_id || '').trim())}"><span class="desk-notes-history-loading">${escapeHtml(uiT('word.loading', 'Loading…'))}</span></span></div>`
            : '';

    const facialModalOptions =
        apt.is_facial_with_massage === true || isLuxury
            ? getFacialModalTherapistOptions(apt, date, therapists)
            : therapists;

    let html = `
        ${prepaymentReadonlyBanner}
        ${appointmentNotesBoxHtml}
        ${deskNotesHistoryRow}
        <div class="modal-detail-columns">
            <div class="modal-detail-editable">
        <div class="detail-row"><span class="detail-label">${escapeHtml(uiT('detail.time', 'Time'))}</span><span class="detail-value">${escapeHtml(timeStr)}</span></div>
        <div class="detail-row"><span class="detail-label">${escapeHtml(uiT('detail.customer', 'Customer'))}</span><span class="detail-value"><span id="modalCustomerNameDisplay" class="modal-customer-name-display">${escapeHtml(apt.customer || '—')}</span></span></div>
        <div class="detail-row"><span class="detail-label">${escapeHtml(uiT('detail.phone', 'Phone'))}</span><span class="detail-value">${escapeHtml(apt.customer_phone || '—')}</span></div>
        <div class="detail-row"><span class="detail-label">${escapeHtml(uiT('detail.service', 'Service'))}</span><span class="detail-value">${escapeHtml(serviceDisplay)}</span></div>
        ${canEdit ? `<div class="detail-row">
            <span class="detail-label">${escapeHtml(uiT('detail.prepaymentDollar', 'Prepayment $'))}</span>
            <span class="detail-value"><input type="number" min="0" step="0.01" class="modal-prepayment-input" value="${prepaymentAmount != null && prepaymentAmount > 0 ? prepaymentAmount : ''}" data-booking-id="${apt.booking_id}" placeholder="0" title="${escapeHtml(uiT('detail.prepaymentTitle', 'Customer prepayment (saved locally; clears if set to 0)'))}" /></span>
        </div>` : ''}
        ${hasCheckinNote ? `
        ${checkinNote.addons ? `<div class="detail-row"><span class="detail-label">${escapeHtml(uiT('detail.addonsCheckin', 'Add-ons (check-in)'))}</span><span class="detail-value">${escapeHtml(uiCatalogLine(checkinNote.addons))}</span></div>` : ''}
        ${checkinNote.pressure ? `<div class="detail-row"><span class="detail-label">${escapeHtml(uiT('detail.pressure', 'Pressure'))}</span><span class="detail-value">${escapeHtml((typeof window.MOM_I18N !== 'undefined' && window.MOM_I18N.pressureLabel) ? window.MOM_I18N.pressureLabel(checkinNote.pressure) : checkinNote.pressure)}</span></div>` : ''}
        ${checkinNote.focus ? `<div class="detail-row detail-row-focus">
            <span class="detail-label">${escapeHtml(uiT('detail.focusAreas', 'Focus areas'))}</span>
            <span class="detail-value">
                <span class="focus-areas-text">${escapeHtml(uiFocusAreasDisplay(checkinNote.focus))}</span>
                <div class="body-focus-wrap">${bodyFocusDiagramSVG(focusAreaIds)}</div>
            </span>
        </div>` : ''}
        ${!checkinNote.addons && !checkinNote.pressure && !checkinNote.focus ? `<div class="detail-row"><span class="detail-label">${escapeHtml(uiT('detail.checkinNote', 'Check-in note'))}</span><span class="detail-value">${escapeHtml(uiCatalogLine(apt.addon_note))}</span></div>` : ''}
        ` : ''}
        <div class="detail-row">
            <span class="detail-label">${escapeHtml(uiT('detail.room', 'Room'))}</span>
            <span class="detail-value">
                <select class="modal-room-select" ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}">
                    <option value="UNASSIGNED" ${roomVal === '' || apt.room === 'UNASSIGNED' || apt.room === 'ADDON' ? 'selected' : ''}>${escapeHtml(uiT('calendar.unassigned', 'UNASSIGNED'))}</option>
                    ${validRooms.filter(r => r !== 'UNASSIGNED').map(r => `<option value="${r}" ${roomVal === r ? 'selected' : ''}>${escapeHtml(formatRoomForPanel(r))}</option>`).join('')}
                </select>
            </span>
        </div>
        ${apt.room_placement_override === true ? `
        <div class="detail-row detail-row-room-override-undo">
            <span class="detail-label">${escapeHtml(uiT('room.overrideUndoLabel', 'Room override'))}</span>
            <span class="detail-value modal-room-override-undo-value">
                <span class="modal-room-override-hint">${escapeHtml(uiT('room.overrideUndoHint', 'OVR — placed while the calendar showed this room as busy.'))}</span>
                ${canEdit ? `<button type="button" class="modal-clear-room-override-btn">${escapeHtml(uiT('room.clearOverrideBtn', 'Clear override'))}</button>` : `<span class="modal-room-override-readonly">${escapeHtml(uiT('room.overrideReadonly', 'Unlock the appointment to clear.'))}</span>`}
            </span>
        </div>
        ` : ''}
        ${showCouple02dSingleFacial ? `
        <div class="detail-row">
            <span class="detail-label">${escapeHtml(uiT('coupleFacial.splitLabel', 'Split facial'))}</span>
            <span class="detail-value">
                <label title="${escapeHtml(uiT('coupleFacial.splitTitle', 'Two calendar blocks: couples massage, then one-person facial. Drag the lower block to a single room (or UNASSIGNED). 02C: Rm 0 frees at facial start; default facial room Rm 2.'))}">
                    <input type="checkbox" class="modal-couple-02d-single-facial" ${couple02dSingleFacialChecked ? 'checked' : ''} ${!canEdit ? 'disabled' : ''} />
                    ${escapeHtml(uiT('coupleFacial.splitCheckbox', 'Only one client gets post-massage facial (split boxes · drag facial to room)'))}
                </label>
            </span>
        </div>
        ` : ''}
        <div class="detail-row">
            <span class="detail-label">Masseuse</span>
            <span class="detail-value">
                <select class="modal-therapist-select" ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}">
                    ${therapists.map(t => `<option value="${t}" ${t === apt.therapist ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
                ${modalAnyAvail ? ' <span class="original-any-available">(Book with any available)</span>' : ''}
            </span>
        </div>
        ${apt.is_facial_with_massage ? `
        <div class="detail-row">
            <span class="detail-label">Facial Specialist</span>
            <span class="detail-value">
                <select class="modal-facial-specialist-select" ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}">
                    <option value="">-- (one person did massage + facial)</option>
                    ${facialModalOptions.map(t => `<option value="${t}" ${t === (apt.facial_specialist || '') ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
            </span>
        </div>
        ` : ''}
        ${isCouple ? `
        <div class="detail-row">
            <span class="detail-label">Masseuse 2</span>
            <span class="detail-value">
                <select class="modal-therapist-2-select" ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}">
                    <option value="">--</option>
                    ${therapists.map(t => `<option value="${t}" ${t === (apt.therapist_2 || '') ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
            </span>
        </div>
        ` : ''}
        <div class="detail-row">
            <span class="detail-label">${escapeHtml(uiT('detail.tipDollar', 'Tip $'))}</span>
            <span class="detail-value"><input type="number" min="0" step="0.01" class="modal-tip-input" value="${tipVal}" ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}" placeholder="${isLuxury && isCouple ? 'Total (leave Tip 2 empty to split $120 each, then 90/30)' : (hasFacialSpecialistSplit ? 'Enter total tip to allocate by time' : '')}" /></span>
        </div>
        ${tipAllocationHtml}
        ${isCouple ? `
        <div class="detail-row">
            <span class="detail-label">${escapeHtml(uiT('detail.tip2Dollar', 'Tip 2 $'))}</span>
            <span class="detail-value"><input type="number" min="0" step="0.01" class="modal-tip-2-input" value="${tipVal2}" ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}" placeholder="${isLuxury && isCouple ? 'Leave empty for one total (half each, then 90/30 per side)' : ''}" /></span>
        </div>
        <div class="detail-row">
            <span class="detail-label">${escapeHtml(uiT('detail.splitTip', 'Split tip'))}</span>
            <span class="detail-value"><input type="checkbox" class="modal-tip-split" ${apt.tip_split_evenly ? 'checked' : ''} ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}" /></span>
        </div>
        <div class="detail-row">
            <span class="detail-label">${escapeHtml(uiT('detail.checkinShort', 'Check-in'))}</span>
            <span class="detail-value">
                <button type="button" class="modal-checkin-btn" data-client="1" ${!canEdit ? 'disabled' : ''}>✓1</button>
                <span class="modal-arrived-1">${apt.arrived_at_1 ? formatTimeCompactUS(new Date(apt.arrived_at_1)) : ''}</span>
                <button type="button" class="modal-checkin-btn" data-client="2" ${!canEdit ? 'disabled' : ''}>✓2</button>
                <span class="modal-arrived-2">${apt.arrived_at_2 ? formatTimeCompactUS(new Date(apt.arrived_at_2)) : ''}</span>
            </span>
        </div>
        ` : ''}
        ${isLuxury ? `
        <div class="detail-row">
            <span class="detail-label">${escapeHtml(uiT('luxury.separateFsLabel', 'Separate FS (last 30 min)'))}</span>
            <span class="detail-value"><input type="checkbox" class="modal-luxury-separate-fs" ${luxurySeparateMiniFacialChecked(apt) ? 'checked' : ''} ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}" title="${escapeHtml(uiT('luxury.separateFsTitle', 'Different specialist does the mini facial in the last 30 minutes; tip splits 90/30 by default unless you set Tip 2 manually.'))}" /></span>
        </div>
        <div class="detail-row">
            <span class="detail-label">${escapeHtml(uiT('detail.miniFacialDone', 'Mini facial done'))}</span>
            <span class="detail-value"><input type="checkbox" class="modal-luxury-done" ${apt.luxury_mini_facial_done ? 'checked' : ''} ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}" /></span>
        </div>
        <div class="detail-row modal-luxury-fs-pick-row${luxurySeparateMiniFacialChecked(apt) ? '' : ' modal-luxury-fs-pick-hidden'}">
            <span class="detail-label">${escapeHtml(isCouple ? uiT('detail.facialSpecialist1', 'Facial Specialist 1') : uiT('detail.facialSpecialist', 'Facial Specialist'))}</span>
            <span class="detail-value">
                <select class="modal-luxury-therapist-select" ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}">
                    <option value="">--</option>
                    ${facialModalOptions.map(t => `<option value="${t}" ${t === (apt.luxury_mini_facial_therapist || '') ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
            </span>
        </div>
        ${isCouple ? `
        <div class="detail-row modal-luxury-fs-pick-row${luxurySeparateMiniFacialChecked(apt) ? '' : ' modal-luxury-fs-pick-hidden'}">
            <span class="detail-label">${escapeHtml(uiT('detail.facialSpecialist2', 'Facial Specialist 2'))}</span>
            <span class="detail-value">
                <select class="modal-luxury-therapist-2-select" ${!canEdit ? 'disabled' : ''} data-booking-id="${apt.booking_id}">
                    <option value="">--</option>
                    ${facialModalOptions.map(t => `<option value="${t}" ${t === (apt.luxury_mini_facial_therapist_2 || '') ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
            </span>
        </div>
        ` : ''}
        ` : ''}
        ${apt.is_past && !apt.appointment_locked ? '<div class="detail-row"><span class="detail-value"><button type="button" class="modal-unlock-past-btn" data-booking-id="' + apt.booking_id + '">' + escapeHtml(uiT('modal.unlockPast', 'Unlock to edit')) + '</button></span></div>' : ''}
            </div>
            <div class="modal-detail-original">
                <div class="detail-original-title">${escapeHtml(uiT('detail.originalSquare', 'Original (Square)'))}</div>
                <div class="detail-row detail-row-original"><span class="detail-label">${escapeHtml(uiT('detail.time', 'Time'))}</span><span class="detail-value">${escapeHtml(originalTimeStr)}</span></div>
                <div class="detail-row detail-row-original"><span class="detail-label">${escapeHtml(uiT('detail.masseuseOri', 'Masseuse ORI'))}</span><span class="detail-value">${escapeHtml(originalTherapist)}</span></div>
                <div class="detail-row detail-row-original"><span class="detail-label">${escapeHtml(uiT('detail.bookedBy', 'Booked by'))}</span><span class="detail-value">${escapeHtml(originalBookedBy)}</span></div>
                <div class="detail-row detail-row-original"><span class="detail-label">${escapeHtml(uiT('detail.room', 'Room'))}</span><span class="detail-value">${escapeHtml(originalRoom)}</span></div>
                ${originalTipDisplay != null && !Number.isNaN(originalTipDisplay) ? `<div class="detail-row detail-row-original"><span class="detail-label">${escapeHtml(uiT('detail.tip', 'Tip'))}</span><span class="detail-value">$${originalTipDisplay.toFixed(2)}</span></div>` : ''}
                <div class="modal-adjust-time-box">
                    <div class="modal-adjust-time-label">${escapeHtml(uiT('detail.adjustTime', 'Adjust time'))}</div>
                    ${apt.is_past && !apt.appointment_locked ? `<div class="modal-adjust-time-unlock-row"><button type="button" class="modal-unlock-past-btn modal-unlock-past-btn--compact">${escapeHtml(uiT('modal.unlockPast', 'Unlock to edit'))}</button></div>` : ''}
                    <p class="modal-adjust-time-hint">${escapeHtml(uiT('detail.adjustTimeHint', "If Square’s block is wrong, set minutes to add (+) or remove (−) from the calendar end only."))}</p>
                    ${apt.is_past && !apt.appointment_locked ? `<p class="modal-adjust-time-unlock-hint">${escapeHtml(uiT('detail.adjustTimeUnlockHint', 'Then Apply will enable so you can fix the calendar end.'))}</p>` : ''}
                    <div class="modal-adjust-time-controls">
                        <div class="modal-duration-sign-group" role="group" aria-label="${escapeHtml(uiT('detail.durationAddSub', 'Add or subtract minutes'))}">
                            <button type="button" class="modal-duration-sign-btn${adjSignMinus ? ' active' : ''}" data-sign="-" title="${escapeHtml(uiT('detail.shorterThanSquare', 'Shorter than Square'))}">−</button>
                            <button type="button" class="modal-duration-sign-btn${!adjSignMinus ? ' active' : ''}" data-sign="+" title="${escapeHtml(uiT('detail.longerThanSquare', 'Longer than Square'))}">+</button>
                        </div>
                        <input type="number" min="0" step="1" class="modal-duration-minutes-input" value="${adjMinutesAbs === '' ? '' : adjMinutesAbs}" placeholder="${escapeHtml(uiT('checkout.minPlaceholder', 'min'))}" inputmode="numeric" />
                        <span class="modal-duration-unit">${escapeHtml(uiT('checkout.minPlaceholder', 'min'))}</span>
                        <button type="button" class="modal-duration-apply-btn" ${!canEdit ? 'disabled title="' + durationApplyLockedTitle + '"' : ''}>${escapeHtml(uiT('detail.apply', 'Apply'))}</button>
                        ${durAdjActive ? `<button type="button" class="modal-duration-clear-btn" ${!canEdit ? 'disabled title="' + durationApplyLockedTitle + '"' : ''}>${escapeHtml(uiT('detail.clear', 'Clear'))}</button>` : ''}
                    </div>
                </div>
            </div>
        </div>
        ${chineseSummaryText ? `<div class="modal-chinese-summary">${escapeHtml(chineseSummaryText)}</div>` : ''}
        <div class="modal-text-summary-row">
            <a href="sms:+1${SMS_NUMBER}?body=${encodeURIComponent(chineseSummaryText || (apt.customer + ' ' + (apt.service || '') + ' ' + timeStr + ' ' + (apt.therapist || '')))}" class="modal-text-summary-btn" target="_blank" rel="noopener">${escapeHtml(uiT('detail.textSummaryZh', 'Text summary to 917-378-7373'))}</a>
            <a href="sms:+1${SMS_NUMBER_ENGLISH}?body=${encodeURIComponent(englishSummaryText || (apt.customer + ' ' + (apt.service || '') + ' ' + timeStr + ' ' + (apt.therapist || '')))}" class="modal-text-summary-btn" target="_blank" rel="noopener">${escapeHtml(uiT('detail.textSummaryEn', 'Text English summary to 469-713-7856'))}</a>
        </div>
        ${canEdit ? '<div class="detail-row detail-row-cancelled-noshow modal-bottom-action"><span class="detail-label">' + escapeHtml(uiT('detail.hideFromSchedule', 'Hide from schedule')) + '</span><span class="detail-value"><button type="button" class="modal-cancelled-noshow-btn" data-booking-id="' + apt.booking_id + '">' + escapeHtml(uiT('detail.markCancelled', 'Mark cancelled / no-show')) + '</button></span></div>' : ''}
    `;
    bodyEl.innerHTML = html;

    if (canEdit && date && /^\d{4}-\d{2}-\d{2}$/.test(date) && apt.room !== 'ADDON') {
        void (async () => {
            const events = (currentData && currentData.events) || [];
            const roster = getTherapistsForStaffingPickList();
            if (!roster.length) return;
            const dup = buildTherapistFirstNameDuplicates(roster);
            const ev = events.find((e) => e.booking_id === apt.booking_id);
            if (!ev) return;
            const working = ev;

            if (modalAnyAvail && (working.therapist || '').trim()) {
                if (!therapistFreeForFullAppointmentMassage(working.therapist, working, events, dup, roster)) {
                    const skips = [working.therapist, working.therapist_2].filter((s) => s && String(s).trim());
                    const repl = findMassageTherapistReplacementForDuration(working, date, therapists, events, skips);
                    if (repl && !therapistNamesMatchForCalendar(repl, working.therapist, dup)) {
                        try {
                            const res = await fetch('/api/therapist', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    booking_id: working.booking_id,
                                    date,
                                    therapist: repl,
                                    locked: true,
                                    slot: 1,
                                }),
                            });
                            if (res.ok) {
                                working.therapist = repl;
                                renderCalendar(currentData);
                                updateCheckinCheckoutPanels();
                                const sel1 = bodyEl.querySelector('.modal-therapist-select');
                                if (sel1) sel1.value = repl;
                            }
                        } catch (err) {
                            console.error(err);
                        }
                    }
                }
            }

            if (String(working.type || '').toLowerCase() === 'couple' && (working.therapist || '').trim()) {
                const t2 = suggestCoupleTherapistSecond(working, date, therapists, events);
                if (t2 && (!(working.therapist_2 || '').trim() || !therapistNamesMatchForCalendar(working.therapist_2, t2, dup))) {
                    try {
                        const res = await fetch('/api/therapist', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                booking_id: working.booking_id,
                                date,
                                therapist: t2,
                                locked: true,
                                slot: 2,
                            }),
                        });
                        if (res.ok) {
                            working.therapist_2 = t2;
                            renderCalendar(currentData);
                            updateCheckinCheckoutPanels();
                            const sel2 = bodyEl.querySelector('.modal-therapist-2-select');
                            if (sel2) sel2.value = t2;
                        }
                    } catch (err) {
                        console.error(err);
                    }
                }
            }
        })();
    }

    const deskHistMount = bodyEl.querySelector('#customerDeskNotesHistoryMount');
    if (deskHistMount && (apt.customer_id || '').trim()) {
        loadCustomerDeskNotesHistoryInto(deskHistMount, (apt.customer_id || '').trim());
    }
    modal.dataset.bookingId = apt.booking_id;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    const detailContentEl = modal.querySelector('.appointment-detail-content');
    momApplyAppointmentDetailContentPosition(detailContentEl);

    function refreshModalFromData() {
        const ev = (currentData && currentData.events) ? currentData.events.find(e => e.booking_id === apt.booking_id) : null;
        if (ev) void showAppointmentDetailModal(ev);
    }

    async function afterSave(res) {
        if (res && await tryApplyDayFromRoomMutationResponse(res)) {
            refreshModalFromData();
            return;
        }
        await loadDay({ soft: true });
        refreshModalFromData();
    }

    /* Past-day read-only modals still need Unlock + Adjust time listeners (must not be inside canEdit-only block). */
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        bodyEl.querySelectorAll('.modal-duration-sign-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                bodyEl.querySelectorAll('.modal-duration-sign-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        bodyEl.querySelectorAll('.modal-duration-apply-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const minus = bodyEl.querySelector('.modal-duration-sign-btn[data-sign="-"]') && bodyEl.querySelector('.modal-duration-sign-btn[data-sign="-"]').classList.contains('active');
                const inp = bodyEl.querySelector('.modal-duration-minutes-input');
                const n = inp ? parseInt(String(inp.value).trim(), 10) : NaN;
                if (!Number.isFinite(n) || n < 0) {
                    alert('Enter a number of minutes (0 or more).');
                    return;
                }
                if (n === 0) {
                    try {
                        const res = await fetch('/api/booking/duration-adjust', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: apt.booking_id, date, duration_adjust_minutes: null }) });
                        if (res.ok) afterSave();
                        else {
                            const err = await res.json().catch(() => ({}));
                            alert(err.detail || 'Could not update time adjustment.');
                        }
                    } catch (err) { console.error(err); }
                    return;
                }
                const signed = minus ? -n : n;
                try {
                    const res = await fetch('/api/booking/duration-adjust', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: apt.booking_id, date, duration_adjust_minutes: signed }) });
                    if (res.ok) afterSave();
                    else {
                        const err = await res.json().catch(() => ({}));
                        alert(err.detail || 'Could not update time adjustment.');
                    }
                } catch (err) { console.error(err); }
            });
        });
        bodyEl.querySelectorAll('.modal-duration-clear-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    const res = await fetch('/api/booking/duration-adjust', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: apt.booking_id, date, duration_adjust_minutes: null }) });
                    if (res.ok) afterSave();
                } catch (err) { console.error(err); }
            });
        });
        bodyEl.querySelectorAll('.modal-unlock-past-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    const res = await fetch('/api/appointment/unlock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: apt.booking_id, date, unlocked: true }) });
                    if (res.ok) afterSave();
                } catch (err) { console.error(err); }
            });
        });
    }

    if (date && canEdit) {
        bodyEl.querySelectorAll('.modal-room-select').forEach(el => {
            el.addEventListener('change', async () => {
                const room = el.value;
                const evBefore = (currentData && currentData.events) ? currentData.events.find(e => e.booking_id === apt.booking_id) : null;
                const rollbackRoom = evBefore ? evBefore.room : apt.room;
                try {
                    const res = await putRoomAssignmentWithConfirm(apt.booking_id, date, room);
                    if (res.status === 499) {
                        if (rollbackRoom != null && rollbackRoom !== undefined) el.value = rollbackRoom === 'UNASSIGNED' || !rollbackRoom ? 'UNASSIGNED' : rollbackRoom;
                        return;
                    }
                    if (res.ok) afterSave(res);
                    else if (res.status === 409) {
                        if (rollbackRoom != null && rollbackRoom !== undefined) el.value = rollbackRoom === 'UNASSIGNED' || !rollbackRoom ? 'UNASSIGNED' : rollbackRoom;
                    } else {
                        const err = await res.json().catch(() => ({}));
                        alert(err.detail || uiT('room.updateFailed', 'Could not update room.'));
                    }
                } catch (err) { console.error(err); }
            });
        });
        bodyEl.querySelectorAll('.modal-clear-room-override-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const evNow = (currentData && currentData.events) ? currentData.events.find(e => e.booking_id === apt.booking_id) : null;
                const roomNow = (evNow && evNow.room) ? evNow.room : (apt.room || 'UNASSIGNED');
                const msg = uiT(
                    'room.clearOverrideConfirm',
                    'Remove the room override (OVR)? Normal availability rules will run again and the room may change.'
                );
                if (!window.confirm(msg)) return;
                try {
                    btn.disabled = true;
                    const res = await putRoomAssignmentWithConfirm(apt.booking_id, date, roomNow, {
                        placement_override: false,
                        unlock_room_for_auto: true,
                    });
                    if (res.status === 499) return;
                    if (res.ok) await afterSave(res);
                    else if (res.status === 409) {
                        /* user declined in-progress move confirm */
                    } else {
                        const err = await res.json().catch(() => ({}));
                        alert(err.detail || uiT('room.updateFailed', 'Could not update room.'));
                    }
                } catch (err) {
                    console.error(err);
                    alert(uiT('room.updateFailed', 'Could not update room.'));
                } finally {
                    btn.disabled = false;
                }
            });
        });
        bodyEl.querySelectorAll('.modal-couple-02d-single-facial').forEach(el => {
            el.addEventListener('change', async () => {
                try {
                    const res = await fetch('/api/booking/couple-02d-single-facial', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            booking_id: apt.booking_id,
                            date,
                            single_facial_only: el.checked,
                        }),
                    });
                    if (res.ok) afterSave();
                    else {
                        const err = await res.json().catch(() => ({}));
                        alert(err.detail || 'Could not update.');
                        el.checked = !el.checked;
                    }
                } catch (err) {
                    console.error(err);
                    el.checked = !el.checked;
                }
            });
        });
        bodyEl.querySelectorAll('.modal-therapist-select').forEach(el => {
            el.addEventListener('change', async () => {
                try {
                    const res = await fetch('/api/therapist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: apt.booking_id, date, therapist: el.value, locked: true, slot: 1 }) });
                    if (res.ok) afterSave();
                } catch (err) { console.error(err); }
            });
        });
        bodyEl.querySelectorAll('.modal-therapist-2-select').forEach(el => {
            el.addEventListener('change', async () => {
                try {
                    const res = await fetch('/api/therapist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: apt.booking_id, date, therapist: el.value || '', locked: true, slot: 2 }) });
                    if (res.ok) afterSave();
                } catch (err) { console.error(err); }
            });
        });
        bodyEl.querySelectorAll('.modal-prepayment-input').forEach(el => {
            el.addEventListener('blur', async () => {
                const raw = String(el.value || '').trim();
                let bodyAmt = null;
                if (raw !== '' && !isNaN(parseFloat(raw))) {
                    const v = parseFloat(raw);
                    bodyAmt = v > 0 ? v : null;
                }
                try {
                    const res = await fetch('/api/booking/prepayment', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ booking_id: apt.booking_id, date, prepayment_amount: bodyAmt }),
                    });
                    if (res.ok) {
                        const data = await res.json().catch(() => ({}));
                        const ev = (currentData && currentData.events) ? currentData.events.find(e => e.booking_id === apt.booking_id) : null;
                        if (ev) {
                            ev.prepayment_amount = (data.prepayment_amount != null && !Number.isNaN(Number(data.prepayment_amount)))
                                ? Number(data.prepayment_amount)
                                : null;
                        }
                        renderCalendar(currentData);
                        updateCheckinCheckoutPanels();
                        refreshModalFromData();
                    }
                } catch (err) { console.error(err); }
            });
        });
        bodyEl.querySelectorAll('.modal-tip-input').forEach(el => {
            el.addEventListener('blur', async () => {
                const val = parseFloat(el.value);
                if (isNaN(val)) return;
                const tip2El = bodyEl.querySelector('.modal-tip-2-input');
                const splitEl = bodyEl.querySelector('.modal-tip-split');
                const splitFacialEl = bodyEl.querySelector('.modal-tip-split-facial');
                const tip2Empty = !tip2El || tip2El.value.trim() === '' || isNaN(parseFloat(tip2El.value));
                const tipVal2 = tip2El && !isNaN(parseFloat(tip2El.value)) ? parseFloat(tip2El.value) : undefined;
                let splitEvenly = undefined;
                if (splitEl) splitEvenly = splitEl.checked;
                else if (splitFacialEl) splitEvenly = splitFacialEl.checked;
                const luxuryCoupleOneTip = isLuxury && isCouple && tip2Empty;
                try {
                    const body = { booking_id: apt.booking_id, date, tip_amount: val };
                    if (luxuryCoupleOneTip) body.tip_amount_2 = null;
                    else if (tipVal2 !== undefined) body.tip_amount_2 = tipVal2;
                    if (splitEvenly !== undefined) body.split_evenly = splitEvenly;
                    const res = await fetch('/api/tip', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                    if (res.ok) {
                        const data = await res.json().catch(() => ({}));
                        const fb = { tip_amount: val };
                        if (luxuryCoupleOneTip) fb.tip_amount_2 = null;
                        else if (tipVal2 !== undefined) fb.tip_amount_2 = tipVal2;
                        if (splitEvenly !== undefined) fb.tip_split_evenly = splitEvenly;
                        applyTipApiResponseToEvent(apt.booking_id, data, fb);
                        renderCalendar(currentData);
                        updateCheckinCheckoutPanels();
                        refreshModalFromData();
                    }
                } catch (err) { console.error(err); }
            });
        });
        bodyEl.querySelectorAll('.modal-tip-2-input, .modal-tip-split, .modal-tip-split-facial').forEach(el => {
            el.addEventListener('change', () => {
                const tipEl = bodyEl.querySelector('.modal-tip-input');
                if (!tipEl) return;
                tipEl.dispatchEvent(new Event('blur'));
            });
        });
        bodyEl.querySelectorAll('.modal-checkin-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const clientIndex = parseInt(btn.dataset.client, 10);
                try {
                    const res = await fetch('/api/check-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: apt.booking_id, date, client_index: clientIndex }) });
                    if (res.ok) afterSave();
                } catch (err) { console.error(err); }
            });
        });
        bodyEl.querySelectorAll('.modal-cancelled-noshow-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Remove this appointment from the schedule (cancelled / no-show)? It will disappear from the calendar and reports.')) return;
                try {
                    const res = await fetch('/api/booking/cancelled-noshow', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: apt.booking_id, date, cancelled_or_noshow: true }) });
                    if (res.ok) {
                        closeAppointmentDetailModal();
                        await loadDay({ soft: true });
                        refreshTodayAppointmentsModalTable();
                    }
                } catch (err) { console.error(err); }
            });
        });
        bodyEl.querySelectorAll('.modal-facial-specialist-select').forEach(el => {
            el.addEventListener('change', async () => {
                const thEl = bodyEl.querySelector('.modal-facial-specialist-select');
                try {
                    const res = await fetch('/api/booking/facial-specialist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: apt.booking_id, date, therapist: thEl ? thEl.value || null : null }) });
                    if (res.ok) afterSave();
                } catch (err) { console.error(err); }
            });
        });
        async function saveModalLuxuryMini() {
            const doneEl = bodyEl.querySelector('.modal-luxury-done');
            const sepEl = bodyEl.querySelector('.modal-luxury-separate-fs');
            const thEl = bodyEl.querySelector('.modal-luxury-therapist-select');
            const thEl2 = bodyEl.querySelector('.modal-luxury-therapist-2-select');
            const separate = sepEl ? sepEl.checked : false;
            const body = { booking_id: apt.booking_id, date, done: doneEl ? doneEl.checked : false, separate_specialist: separate };
            if (separate) {
                body.therapist = thEl ? thEl.value || null : null;
                if (thEl2) body.therapist_2 = thEl2.value || null;
            } else {
                body.therapist = null;
                body.therapist_2 = null;
            }
            try {
                const res = await fetch('/api/booking/luxury-mini-facial', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                if (res.ok) afterSave();
            } catch (err) { console.error(err); }
        }
        bodyEl.querySelectorAll('.modal-luxury-separate-fs').forEach(el => {
            el.addEventListener('change', () => {
                bodyEl.querySelectorAll('.modal-luxury-fs-pick-row').forEach(r => r.classList.toggle('modal-luxury-fs-pick-hidden', !el.checked));
                saveModalLuxuryMini();
            });
        });
        bodyEl.querySelectorAll('.modal-luxury-done, .modal-luxury-therapist-select, .modal-luxury-therapist-2-select').forEach(el => {
            el.addEventListener('change', () => saveModalLuxuryMini());
        });
    }
}

function momPositionAppointmentDetailContentDefault(content) {
    if (!content) return;
    content.style.position = 'fixed';
    content.style.left = '50%';
    content.style.top = '50%';
    content.style.right = 'auto';
    content.style.bottom = 'auto';
    content.style.transform = 'translate(-50%, -50%)';
    content.style.margin = '0';
}

function momClampAppointmentDetailContentOnScreen(content) {
    if (!content || content.style.position !== 'fixed') return;
    const r = content.getBoundingClientRect();
    const w = r.width;
    const h = r.height;
    let left = r.left;
    let top = r.top;
    const maxL = Math.max(8, window.innerWidth - w - 8);
    const maxT = Math.max(8, window.innerHeight - h - 8);
    left = Math.min(maxL, Math.max(8, left));
    top = Math.min(maxT, Math.max(8, top));
    content.style.left = `${Math.round(left)}px`;
    content.style.top = `${Math.round(top)}px`;
    content.style.transform = 'none';
}

function momApplyAppointmentDetailContentPosition(content) {
    if (!content) return;
    try {
        const raw = localStorage.getItem(MOM_APPOINTMENT_DETAIL_POS_KEY);
        if (raw) {
            const j = JSON.parse(raw);
            if (typeof j.left === 'number' && typeof j.top === 'number' && Number.isFinite(j.left) && Number.isFinite(j.top)) {
                content.style.position = 'fixed';
                content.style.transform = 'none';
                content.style.left = `${j.left}px`;
                content.style.top = `${j.top}px`;
                content.style.right = 'auto';
                content.style.bottom = 'auto';
                content.style.margin = '0';
                momClampAppointmentDetailContentOnScreen(content);
                return;
            }
        }
    } catch (e) { /* ignore */ }
    momPositionAppointmentDetailContentDefault(content);
}

function momSaveAppointmentDetailContentPosition(content) {
    if (!content) return;
    try {
        const r = content.getBoundingClientRect();
        const left = Math.round(r.left);
        const top = Math.round(r.top);
        localStorage.setItem(MOM_APPOINTMENT_DETAIL_POS_KEY, JSON.stringify({ left, top }));
    } catch (e) { /* ignore */ }
}

function initAppointmentDetailModalDrag() {
    const modal = document.getElementById('appointmentDetailModal');
    const header = modal?.querySelector('.appointment-detail-header');
    const content = modal?.querySelector('.appointment-detail-content');
    if (!modal || !header || !content || modal.dataset.apptDetailDragBound === '1') return;
    modal.dataset.apptDetailDragBound = '1';

    let drag = null;
    header.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.appointment-detail-close')) return;
        if (e.target.closest('button, a, input, select, textarea, label')) return;
        const r = content.getBoundingClientRect();
        drag = { sx: e.clientX, sy: e.clientY, left: r.left, top: r.top };
        modal.classList.add('appointment-detail-modal--dragging');
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        let left = drag.left + dx;
        let top = drag.top + dy;
        const w = content.offsetWidth || 400;
        const h = content.offsetHeight || 300;
        const maxL = Math.max(8, window.innerWidth - w - 8);
        const maxT = Math.max(8, window.innerHeight - h - 8);
        left = Math.min(maxL, Math.max(8, left));
        top = Math.min(maxT, Math.max(8, top));
        content.style.position = 'fixed';
        content.style.transform = 'none';
        content.style.left = `${Math.round(left)}px`;
        content.style.top = `${Math.round(top)}px`;
        content.style.right = 'auto';
        content.style.bottom = 'auto';
        content.style.margin = '0';
    });
    document.addEventListener('mouseup', () => {
        if (!drag) return;
        drag = null;
        modal.classList.remove('appointment-detail-modal--dragging');
        if (modal.style.display === 'flex') momSaveAppointmentDetailContentPosition(content);
    });
}

function closeAppointmentDetailModal() {
    const modal = document.getElementById('appointmentDetailModal');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    if (momReturnToDayListAfterDetailClose) {
        momReturnToDayListAfterDetailClose = false;
        momOpenTodayAppointmentsModal({ preservePinMessage: true });
    }
}

function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** Calendar dropdowns: option value = full name (API), label = first name only. */
function therapistSelectOptionsHtml(therapists, selectedFullName) {
    if (!therapists || !therapists.length) return '';
    return therapists.map(t => {
        const sel = t === selectedFullName ? ' selected' : '';
        return `<option value="${escapeHtml(t)}"${sel}>${escapeHtml(therapistFirstNameOnly(t))}</option>`;
    }).join('');
}

/** First name + last initial, e.g. "John Smith" -> "John S." */
function customerShortName(fullName) {
    if (!fullName || typeof fullName !== 'string') return fullName || '';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    return parts[0] + ' ' + (last.charAt(0).toUpperCase()) + '.';
}

/** Calendar headline: 🎂 / 💍 if birthday / anniversary appears in customer, staff, or addon notes. */
function appointmentOccasionIconsHtml(appointment) {
    const blob = [
        appointment.customer_note,
        appointment.seller_note,
        appointment.addon_note,
    ].filter(Boolean).join('\n');
    if (!blob) return '';
    const bits = [];
    if (/birthday/i.test(blob)) {
        bits.push('<span class="appointment-occasion-icon appointment-occasion-birthday" title="Birthday mentioned in notes">🎂</span>');
    }
    if (/anniversary/i.test(blob)) {
        bits.push('<span class="appointment-occasion-icon appointment-occasion-anniversary" title="Anniversary mentioned in notes">💍</span>');
    }
    return bits.length ? `<span class="appointment-occasion-icons">${bits.join('')}</span>` : '';
}

/** Two glass cups on skin line — used for air cupping on calendar */
/** Single air-cupping glass upside down: rim on skin (bottom), dome up */
const CALENDAR_CUPPING_AIR_SVG = '<svg class="calendar-cupping-air-svg" viewBox="0 0 20 26" width="14" height="18" aria-hidden="true" focusable="false"><line x1="0" y1="23.5" x2="20" y2="23.5" stroke="currentColor" stroke-width="0.9" opacity="0.45"/><ellipse cx="10" cy="20" rx="6.8" ry="2.25" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.2 20 Q3.2 11.5 10 4.5 Q16.8 11.5 16.8 20" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Sheet-style facial mask — shown bottom-center on calendar facial appointments */
const CALENDAR_FACIAL_MASK_SVG = '<svg class="calendar-facial-mask-svg" viewBox="0 0 64 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" d="M32 10 C16 10 6 24 6 40c0 12 8 22 26 26 18-4 26-14 26-26C58 24 48 10 32 10z"/><ellipse cx="23" cy="34" rx="7" ry="5.5" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="41" cy="34" rx="7" ry="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M32 42v10"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18 54c8 7 20 7 28 0"/></svg>';

/**
 * Calendar: show fire 🔥 for fire cupping, cup icons for air cupping (service + notes).
 * Fire wins if both are mentioned.
 */
function appointmentCuppingIconHtml(appointment) {
    const blob = [
        appointment.display_service,
        appointment.service,
        appointment.customer_note,
        appointment.seller_note,
        appointment.addon_note,
    ].filter(Boolean).join('\n');
    if (!blob) return '';
    const t = blob.toLowerCase();
    const hasFire = /\bfire[\s-]*cupping\b/i.test(t)
        || /\bcupping\s*\([^)]*fire/i.test(t)
        || /\bcupping[^a-z0-9]{0,6}fire\b/i.test(t);
    const hasAir = /\bair[\s-]*cupping\b/i.test(t)
        || /\bcupping\s*\([^)]*air/i.test(t)
        || /\bcupping[^a-z0-9]{0,6}air\b/i.test(t);
    if (hasFire) {
        const ft = escapeHtml(uiT('cupping.fireTitle', 'Fire cupping'));
        return `<span class="appointment-cupping-icon appointment-cupping-fire" title="${ft}">🔥</span>`;
    }
    if (hasAir) {
        const at = escapeHtml(uiT('cupping.airTitle', 'Air cupping'));
        return `<span class="appointment-cupping-icon appointment-cupping-air" title="${at}">${CALENDAR_CUPPING_AIR_SVG}</span>`;
    }
    return '';
}

/** Small stacked smooth stones — Bian stone / hot-stone style massage on calendar & check-in */
const CALENDAR_BIAN_STONE_SVG = '<svg class="calendar-bian-stone-svg" viewBox="0 0 22 18" width="15" height="12" aria-hidden="true" focusable="false"><ellipse cx="11" cy="14.5" rx="9" ry="2.6" fill="currentColor" opacity="0.22"/><ellipse cx="11" cy="10" rx="7.2" ry="2.2" fill="currentColor" opacity="0.35"/><ellipse cx="11" cy="6" rx="5.4" ry="1.85" fill="currentColor" opacity="0.5"/><ellipse cx="11" cy="3.2" rx="3.6" ry="1.5" fill="currentColor" opacity="0.65"/></svg>';

/**
 * Bian stone massage (service + notes). Matches "Bian Stone", "bianstone", en dash, 砭石, etc.
 */
function appointmentBianStoneIconHtml(appointment) {
    const blob = [
        appointment && appointment.display_service,
        appointment && appointment.service,
        appointment && appointment.customer_note,
        appointment && appointment.seller_note,
        appointment && appointment.addon_note,
    ].filter(Boolean).join('\n');
    if (!blob) return '';
    if (/砭石/.test(blob)) {
        const bt = escapeHtml(uiT('bianStone.title', 'Bian stone massage'));
        return `<span class="appointment-bian-stone-icon" title="${bt}">${CALENDAR_BIAN_STONE_SVG}</span>`;
    }
    const t = blob
        .toLowerCase()
        .replace(/[\u2013\u2014\u2212]/g, '-')
        .replace(/[\u00a0\u202f\u3000]/g, ' ');
    if (!/\bbian[\s-]*stone\b/i.test(t) && !/\bbianstone\b/i.test(t)) return '';
    const bt = escapeHtml(uiT('bianStone.title', 'Bian stone massage'));
    return `<span class="appointment-bian-stone-icon" title="${bt}">${CALENDAR_BIAN_STONE_SVG}</span>`;
}

/**
 * Remove pain-relief oil from displayed service text (calendar, check-in, checkout).
 * Handles Square phrasing like "Pain Relief Oil H add-on, … 15 min" and zh 舒缓精油.
 */
function calendarStripPainReliefOilFromServiceLine(line) {
    if (line == null || typeof line !== 'string') return '';
    let s = line.replace(/^\s*[–—-]\s*/u, '');
    const painOilChunk =
        /\bpain\s+relief\s+oil(?:\s+[a-z])?\s*(?:add-?ons?)?(?:\s+\d+\s*min)?\b/gi;
    for (let i = 0; i < 10; i++) {
        const next = s
            .replace(painOilChunk, '')
            .replace(/\s*[,;]\s*[,;]+/g, ', ')
            .replace(/^[,;\s]+|[,;\s]+$/g, '')
            .trim();
        if (next === s) break;
        s = next;
    }
    s = s.replace(/\s*[,;]\s*pain\s+relief\s+oil\s*/gi, ', ');
    s = s.replace(/\bpain\s+relief\s+oil\s*[,;]?\s*/gi, '');
    s = s.replace(/\s*[,;]\s*舒缓精油\s*/g, ', ');
    s = s.replace(/\b舒缓精油\s*[,;]?\s*/g, '');
    s = s.replace(/^[,;\s]+|[,;\s]+$/g, '').replace(/\s*,\s*,/g, ',').trim();
    return s.replace(/\s{2,}/g, ' ');
}

function customerCalendarMatchKey(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

/** True when Square service line looks like pain-relief add-on only (not a massage/facial service name). */
function eventLooksLikePainReliefOilOnlySegment(ev) {
    if (!ev) return false;
    const combined = `${String(ev.service || '')} ${String(ev.display_service || '')}`.toLowerCase();
    const hasOil = combined.includes('pain relief') || combined.includes('舒缓精油');
    if (!hasOil) return false;
    if (combined.includes('massage') || combined.includes('按摩')) return false;
    if (combined.includes('facial') || combined.includes('面部')) return false;
    return true;
}

function painReliefMentionedOnAppointment(appointment) {
    const blob = [
        appointment.display_service,
        appointment.service,
        appointment.customer_note,
        appointment.seller_note,
        appointment.addon_note,
    ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
    return blob.includes('pain relief') || blob.includes('舒缓精油');
}

/** Overlapping same-day booking for same customer that is pain-relief oil only (separate Square segment). */
function appointmentPainReliefSiblingOverlap(appointment) {
    if (eventLooksLikePainReliefOilOnlySegment(appointment)) return false;
    const evs = typeof currentData !== 'undefined' && currentData && Array.isArray(currentData.events) ? currentData.events : [];
    const selfStart = new Date(appointment.start_at).getTime();
    const selfEnd = new Date(appointment.end_at).getTime();
    if (!Number.isFinite(selfStart) || !Number.isFinite(selfEnd)) return false;
    const selfId = appointment.booking_id;
    const selfCust = customerCalendarMatchKey(appointment.customer);
    const selfCid = String(appointment.customer_id || '').trim();
    for (const ev of evs) {
        if (!ev || ev.booking_id === selfId) continue;
        if (!eventLooksLikePainReliefOilOnlySegment(ev)) continue;
        const oS = new Date(ev.start_at).getTime();
        const oE = new Date(ev.end_at).getTime();
        if (!Number.isFinite(oS) || !Number.isFinite(oE)) continue;
        if (oS >= selfEnd || oE <= selfStart) continue;
        const ocid = String(ev.customer_id || '').trim();
        if (selfCid && ocid && selfCid === ocid) return true;
        const oc = customerCalendarMatchKey(ev.customer);
        if (selfCust && oc && selfCust === oc) return true;
    }
    return false;
}

function appointmentPainReliefOilIconHtml(appointment) {
    const show =
        painReliefMentionedOnAppointment(appointment) || appointmentPainReliefSiblingOverlap(appointment);
    if (!show) return '';
    const t = escapeHtml(uiT('calendar.painReliefOilTitle', 'Pain relief oil add-on — charge at checkout (on Square booking).'));
    return `<span class="appointment-pain-relief-icon" title="${t}" aria-label="${t}">💲</span>`;
}

/** True when calendar date is today and local time is inside [start_at, service end). Service end omits add-on-neutral billing padding on Square’s end. */
function appointmentIsInProgressNow(appointment) {
    const dateStr = document.getElementById('dateInput')?.value;
    if (!dateStr || dateStr !== getTodayLocal()) return false;
    if (!appointment.start_at || !appointment.end_at) return false;
    const now = Date.now();
    const startMs = new Date(appointment.start_at).getTime();
    let endMs = new Date(appointment.end_at).getTime();
    const neutral = appointment._roomViewSlice ? 0 : effectiveAddonTimeNeutralMinutes(appointment);
    if (neutral > 0 && !Number.isNaN(endMs)) endMs -= neutral * 60000;
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
    return now >= startMs && now < endMs;
}

/** Toggle .appointment-in-progress from data-start-at / data-end-at (runs ~1s on today’s calendar). */
function syncAppointmentInProgressClasses() {
    const dateInput = document.getElementById('dateInput');
    const calendarContainer = document.getElementById('calendarContainer');
    const grid = document.getElementById('calendarGrid');
    const selectedDate = dateInput?.value;
    const today = getTodayLocal();
    if (!calendarContainer || calendarContainer.style.display === 'none' || !selectedDate || selectedDate !== today) {
        document.querySelectorAll('.appointment-block.appointment-in-progress').forEach((el) => el.classList.remove('appointment-in-progress'));
        document.querySelectorAll('.phone-calendar-card--now').forEach((el) => el.classList.remove('phone-calendar-card--now'));
        return;
    }
    if (!grid) return;
    const now = Date.now();
    document.querySelectorAll('.appointment-block[data-booking-id]').forEach((el) => {
        const s = el.dataset.startAt;
        const e = el.dataset.endAt;
        if (!s || !e) {
            el.classList.remove('appointment-in-progress');
            return;
        }
        const startMs = new Date(s).getTime();
        const endMs = new Date(e).getTime();
        const on = !Number.isNaN(startMs) && !Number.isNaN(endMs) && now >= startMs && now < endMs;
        el.classList.toggle('appointment-in-progress', on);
    });
    document.querySelectorAll('.phone-calendar-card[data-start-at]').forEach((el) => {
        const s = el.getAttribute('data-start-at');
        const e = el.getAttribute('data-end-at');
        if (!s || !e) {
            el.classList.remove('phone-calendar-card--now');
            return;
        }
        const startMs = new Date(s).getTime();
        const endMs = new Date(e).getTime();
        const on = !Number.isNaN(startMs) && !Number.isNaN(endMs) && now >= startMs && now < endMs;
        el.classList.toggle('phone-calendar-card--now', on);
    });
}

function createAppointmentBlock(appointment, timeSlot, _slotIndex, _allTimeSlots, position = { left: 0, width: 100 }, byRoom = false, columnTherapist = null, slotStepMinutes = TIME_SLOT_MINUTES) {
    const block = document.createElement('div');
    const extraClass = appointment.is_voice_test ? ' voice-test' : '';
    const createdAt = appointment.created_at;
    let isNew = false;
    if (createdAt) {
        const createdDate = new Date(createdAt);
        if (!Number.isNaN(createdDate.getTime())) {
            const createdHour = createdDate.getHours();
            if (createdHour >= 21) {
                // Booked at or after 9pm local: show as NEW until 10am the following morning (local)
                const nextMorning10am = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate() + 1, 10, 0, 0, 0);
                isNew = Date.now() < nextMorning10am.getTime();
            } else {
                isNew = (Date.now() - createdDate.getTime()) < 60 * 60 * 1000; // 1 hour
            }
        }
    }
    /* NEW badge shown top-right; do not override single/couple/facial card colors */
    const newClass = '';
    const isUnassigned = appointment.room === 'UNASSIGNED';
    const dateStr = document.getElementById('dateInput') && document.getElementById('dateInput').value;
    const flashDismissed = dateStr ? getUnassignedFlashDismissed(dateStr).has(appointment.booking_id) : true;
    const unassignedFlashClass = isUnassigned && !flashDismissed ? ' unassigned-flash' : '';
    const inProgressClass = appointmentIsInProgressNow(appointment) ? ' appointment-in-progress' : '';
    const davidGoldenClass = shouldShowDavidGoldenFun(byRoom, columnTherapist, appointment) ? ' appointment-block-david-golden' : '';
    block.className = `appointment-block ${appointment.type} ${isUnassigned ? 'unassigned' : ''}${unassignedFlashClass} by-room-block${extraClass}${newClass}${inProgressClass}${davidGoldenClass}`;
    block.title = uiT('calendar.blockTitle', 'Double-click for full details. Drag to another column to reassign masseuse.');
    const couplesSlotN = parseCouplesSlotNoteFromAppointment(appointment);
    if (couplesSlotN != null && couplesSlotN >= 2) {
        block.title += ` — couples #${couplesSlotN}`;
    }
    block.draggable = true;
    block.dataset.bookingId = appointment.booking_id;
    const startTime = new Date(appointment.start_at);
    const endTime = new Date(appointment.end_at);
    const addonNeutralMin = appointment._roomViewSlice ? 0 : effectiveAddonTimeNeutralMinutes(appointment);
    const displayEndTime = addonNeutralMin > 0
        ? new Date(endTime.getTime() - addonNeutralMin * 60000)
        : endTime;
    if (appointment.start_at) block.dataset.startAt = appointment.start_at;
    if (appointment.end_at && !Number.isNaN(displayEndTime.getTime())) {
        block.dataset.endAt = displayEndTime.toISOString();
    }
    
    // Block height / grid alignment use service end (same as card time + duration badge). Square ISO end may include billing-only padding.
    const slotStart = timeSlot.getTime();
    const eventStart = startTime.getTime();
    const eventEndLayout = displayEndTime.getTime();

    const stepMin = slotStepMinutes > 0 ? slotStepMinutes : TIME_SLOT_MINUTES;
    const offsetMinutes = (eventStart - slotStart) / (60 * 1000);
    const topPercent = (offsetMinutes / stepMin) * 100;

    const durationMinutesFullBlock = (eventEndLayout - eventStart) / (60 * 1000);
    const slotHeight = getCalendarSlotHeight();
    const heightPixels = (durationMinutesFullBlock / stepMin) * slotHeight;
    
    // Apply position for overlapping appointments
    block.style.top = `${topPercent}%`;
    block.style.height = `${heightPixels}px`;
    block.style.left = `${position.left}%`;
    // Use calc to account for margins - each block needs a small gap
    const marginGap = position.width < 100 ? 1 : 0; // Only add gap if not full width
    block.style.width = `calc(${position.width}% - ${marginGap * 2}px)`;
    block.style.zIndex = position.width < 100 ? '15' : '10'; // Higher z-index for side-by-side

    // Format time (end shows service end — omit aromatherapy / pain relief oil minutes)
    const timeStr = formatTimeRangeSmart(startTime, displayEndTime);
    
    const roomLocked = appointment.room_locked === true;
    const therapistLocked = appointment.therapist_locked === true;
    const therapistLocked2 = appointment.therapist_locked_2 === true;
    const tipVal = appointment.tip_amount != null ? Number(appointment.tip_amount) : '';
    const tipVal2 = appointment.tip_amount_2 != null ? Number(appointment.tip_amount_2) : '';
    const isCouple = appointment.type === 'couple';
    const therapist2 = appointment.therapist_2 || '';
    const isPast = appointment.is_past === true;
    const canEdit = !isPast || appointment.appointment_locked === true;
    const therapists = (currentData && currentData.therapists) || [];
    /* Calendar cards: headline + top-right meta only — no time row / SRM / tip on card (see block.innerHTML below). */
    const CALENDAR_CARD_MINIMAL = true;
    const rawService = appointment.service;
    const serviceStr = (rawService != null && typeof rawService === 'string') ? rawService : (rawService != null ? String(rawService) : '');
    const serviceLower = serviceStr.toLowerCase();
    const packageType = appointment.package_type || '';
    const displayService = appointment.display_service || '';
    const isLuxury = packageType === 'luxury' || serviceLower.includes('luxury');
    const isExclusive = packageType === 'exclusive' || serviceLower.includes('exclusive');
    const luxuryMiniDone = appointment.luxury_mini_facial_done === true;
    const luxuryMiniTherapist = appointment.luxury_mini_facial_therapist || '';
    const luxuryMiniTherapist2 = appointment.luxury_mini_facial_therapist_2 || '';
    const luxurySepFsChecked = luxurySeparateMiniFacialChecked(appointment);
    const isFacialWithMassage = appointment.is_facial_with_massage === true;
    const facialSpecialist = appointment.facial_specialist || '';
    const lockTitle = roomLocked ? uiT('calendar.roomLockedTitle', 'Room locked (click to unlock)') : uiT('calendar.roomUnlockedTitle', 'Room unlocked');
    /* Calendar: keep cards light — hide couple-only block (M2, Tip2, split tip, ✓1/✓2). Edit via appointment detail; may restore or replace with compact masseuse/tip for all services later. */
    const coupleExtra = '';
    const prepaymentAmount = appointment.prepayment_amount != null && !Number.isNaN(Number(appointment.prepayment_amount))
        ? Number(appointment.prepayment_amount) : null;
    const prepaymentBadge = (prepaymentAmount != null && prepaymentAmount > 0)
        ? `<span class="appointment-prepayment-badge"><span class="prepayment-check">✓</span> $${prepaymentAmount.toFixed(2)} ${escapeHtml(uiT('calendar.prepaymentWord', 'prepayment'))}</span>` : '';
    const visits = appointment.customer_visits != null ? Number(appointment.customer_visits) : null;
    const LOYALTY_MIN_VISITS = 20;
    const isLoyaltyCustomer = visits != null && !Number.isNaN(visits) && visits >= LOYALTY_MIN_VISITS;
    const firstVisitT = escapeHtml(uiT('calendar.badgeFirstVisitTitle', 'First visit (1 visit in profile)'));
    const firstVisitBadge = (visits === 1) ? `<span class="appointment-first-visit-badge" title="${firstVisitT}">1stV</span>` : '';
    const loyaltyTitleRaw = uiTParams('calendar.badgeLoyaltyTitle', { n: String(visits) }, 'Loyalty customer — {n} visits in profile');
    const loyaltyBadge = isLoyaltyCustomer
        ? `<span class="appointment-loyalty-badge" title="${escapeHtml(loyaltyTitleRaw)}">LOYAL</span>`
        : '';
    const newBadgeT = escapeHtml(uiT('calendar.badgeNewTitle', 'Booked in the last hour'));
    const newBadge = isNew ? `<span class="appointment-new-badge" title="${newBadgeT}">NEW</span>` : '';
    const roomOverrideBadge = appointment.room_placement_override === true
        ? `<span class="appointment-room-override-badge" title="${escapeHtml(uiT('room.overrideBadgeTitle', 'Room override — placed while the calendar showed this room as unavailable; confirm on the floor.'))}">${escapeHtml(uiT('room.overrideBadgeShort', 'OVR'))}</span>`
        : '';
    const backWalkAlertRaw = (appointment.back_walking_room_alert || '').trim();
    const backWalkBadge = backWalkAlertRaw
        ? `<span class="appointment-back-walk-badge" title="${escapeHtml(backWalkAlertRaw)}">${escapeHtml(uiT('calendar.backWalkBadge', 'Bars'))}</span>`
        : '';
    const startShort = formatTimeCompactUS(startTime);
    const displayEndMs = displayEndTime.getTime();
    const durationMinutesForBadge = (displayEndMs - eventStart) / (60 * 1000);
    const durRound = Math.max(0, Math.round(durationMinutesForBadge));
    const durStr = formatDurationMinutes(durRound);
    const displayRoomForCard = (byRoom && appointment._displayRoomForCalendar) ? appointment._displayRoomForCalendar : appointment.room;
    const roomCompact = formatRoomForPanel(displayRoomForCard);
    const roomColClass = roomKeyToColumnClass(displayRoomForCard);
    const badgeLineHtml = (firstVisitBadge || loyaltyBadge)
        ? `<div class="appointment-badge-line">${firstVisitBadge}${loyaltyBadge}</div>`
        : '';
    const boxTitle = escapeHtml(`${startShort} · ${durStr} · ${roomCompact}`);
    const sqHintLetters = isSquareOriCalendarHintOn() ? squareOriginalTherapistFirstThreeLetters(appointment) : '';
    const oriFullForHint = (appointment.original_therapist || '').trim();
    const sqHintInBoxHtml = sqHintLetters
        ? `<span class="appointment-square-ms-hint-bg" aria-hidden="true" title="${escapeHtml(oriFullForHint || sqHintLetters)}">${escapeHtml(sqHintLetters)}</span>`
        : '';
    const bookedBy = appointment.booked_by;
    const anyAvailDisplay = customerAnyAvailEffective(appointment);
    const oriName = (appointment.original_therapist || '').trim() || '—';
    const oriNameCalendar = oriName !== '—' ? therapistFirstNameOnly(oriName) : oriName;
    const customerTitle = (bookedBy === 'customer' && anyAvailDisplay)
        ? uiT('bookedBy.customerAnyMasseuse', 'Booked by customer — any available masseuse')
        : (bookedBy === 'customer' ? (uiT('bookedBy.masseuseOri', 'Masseuse ORI:') + ' ' + oriName.replace(/"/g, '&quot;')) : uiT('bookedBy.customer', 'Booked by customer'));
    const customerMasseuseChip = bookedBy === 'customer' && !anyAvailDisplay && oriName !== '—';
    let byUsNamesHtml = '';
    let byUsTitle = 'Booked by us';
    if (bookedBy === 'us') {
        /* Same source as “Requested therapist” bar: names from notes only (seller + customer + addon), never assigned dropdown */
        const noteIdx = buildTherapistFirstNameIndexForNotes(therapists, [appointment]);
        const sellerText = (appointment.seller_note || '').trim();
        const custAddonText = [appointment.customer_note, appointment.addon_note].filter(Boolean).join('\n');
        const fromSeller = matchTherapistFirstNamesInNoteText(sellerText, noteIdx);
        const fromCustAddon = matchTherapistFirstNamesInNoteText(custAddonText, noteIdx);
        const seenLower = new Set();
        const byUsFull = [];
        function addByUsFullName(full) {
            const k = (full || '').trim().toLowerCase();
            if (!k || seenLower.has(k)) return;
            seenLower.add(k);
            byUsFull.push(full.trim());
        }
        for (const full of fromSeller) addByUsFullName(full);
        for (const full of fromCustAddon) addByUsFullName(full);
        if (byUsFull.length) {
            byUsTitle = `Booked by us — ${byUsFull.join(', ')}`;
            byUsNamesHtml = byUsFull.map((full) => {
                const fn = therapistFirstNameOnly(full);
                const st = masseuseChipInlineStyleCompact(full);
                return `<span class="appointment-booked-by-name-chip" style="${st}">${escapeHtml(fn)}</span>`;
            }).join('');
        }
    }
    const bookedByBadge = bookedBy === 'customer'
        ? (customerMasseuseChip
            ? `<span class="appointment-booked-by-customer-line" title="${escapeHtml(customerTitle)}"><span class="appointment-booked-by-masseuse-name-only" style="${masseuseChipInlineStyleCalendarName(oriName)}">${escapeHtml(oriNameCalendar)}</span></span>`
            : '')
        : (bookedBy === 'us'
            ? `<span class="appointment-booked-by-us-group" title="${escapeHtml(byUsTitle)}"><span class="appointment-booked-by appointment-booked-by-us" aria-label="Booked by us" title="${escapeHtml(byUsTitle)}">📞</span>${byUsNamesHtml}</span>`
            : '');
    /* Minimal: sandwich stack (name → service → room → requested masseuse). No time/duration sub-box. */
    const calendarMinimalMasseuseHtml = CALENDAR_CARD_MINIMAL ? calendarMinimalMasseuseStackHtml(appointment, therapists) : '';
    const calendarMasseuseUnderMetaHtml = !CALENDAR_CARD_MINIMAL ? calendarIntentMasseuseStackHtml(appointment, therapists) : '';
    const bookedByUsPhoneBottomHtml = (CALENDAR_CARD_MINIMAL && bookedBy === 'us')
        ? `<div class="appointment-calendar-us-phone-row"><span class="appointment-booked-by appointment-booked-by-us" aria-label="Booked by us" title="${escapeHtml(byUsTitle)}">📞</span></div>`
        : '';
    const topRightMetaHtml = CALENDAR_CARD_MINIMAL ? '' : `<div class="appointment-calendar-top-right">
        ${badgeLineHtml}
        ${isNew ? newBadge : ''}
        ${roomOverrideBadge}
        ${backWalkBadge}
        <div class="appointment-time-duration-box ${calendarDurationTierClass(durRound)}" title="${boxTitle}">
            ${sqHintInBoxHtml}
            <div class="appointment-time-duration-stack">
            <span class="appointment-start-compact">${escapeHtml(startShort)}</span>
            <span class="appointment-duration-compact">${escapeHtml(durStr)}</span>
            <span class="appointment-room-compact ${roomColClass}">${escapeHtml(roomCompact)}</span>
            </div>
        </div>
        ${calendarMasseuseUnderMetaHtml}
    </div>`;
    const customerShort = calendarCustomerHeadlineShort(appointment);
    const partnerFullForTitle = couplePartnerFullNameForDisplay(appointment);
    const coupleNameTitle =
        isCouple && partnerFullForTitle
            ? ` title="${escapeHtml(String(appointment.customer || '').trim() + ' · ' + partnerFullForTitle)}"`
            : '';
    // Use same block layout as by-room in both views: headline (client + service), then time/room/masseuse/tip
    const parts = [];
    if ((appointment.seller_note || '').trim()) parts.push((appointment.seller_note || '').trim());
    if ((appointment.customer_note || '').trim()) parts.push((appointment.customer_note || '').trim());
    if ((appointment.addon_note || '').trim()) parts.push((appointment.addon_note || '').trim());
    const notesText = parts.join('\n\n');
    const notesEscapedForAttr = notesText ? (notesText.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\n/g, '&#10;')) : '';
    const notesIndicatorHtml = notesText
        ? `<span class="appointment-notes-indicator" data-notes="${notesEscapedForAttr}">📝</span>`
        : '';
    const isFacial = serviceLower.includes('facial') || String(displayService).toLowerCase().includes('facial');
    let serviceClass = isFacial ? ' appointment-headline-service-facial' : '';
    if (isLuxury) serviceClass += ' appointment-headline-service-luxury';
    if (isExclusive) serviceClass += ' appointment-headline-service-exclusive';
    const sliceServicePrefix = appointment._roomViewSlice === 'couple_massage'
        ? uiT('calendar.sliceCoupleMassage', 'Couples massage · ')
        : appointment._roomViewSlice === 'couple_facial'
            ? uiT('calendar.sliceFacialOne', 'Facial (1 client) · ')
            : '';
    const rawCatalogService = ((displayService && displayService.trim()) ? displayService.trim() : serviceStr);
    let serviceDisplayStr = calendarStripPainReliefOilFromServiceLine(sliceServicePrefix + uiCatalogLine(rawCatalogService));
    if (isCouple && !appointment._roomViewSlice) {
        serviceDisplayStr = calendarReorderCoupleServiceHeadline(serviceDisplayStr, durRound);
    }
    const is3Senses = serviceLower.includes('3 senses');
    const t3s = escapeHtml(uiT('calendar.badge3sTitle', '3 Senses'));
    const badge3S = is3Senses ? `<span class="appointment-badge appointment-badge-3s" title="${t3s}">3S</span>` : '';
    const luxLabel = isCouple ? 'LUX2' : 'LUX';
    const luxT = escapeHtml(uiT('calendar.badgeLuxuryTitle', 'Luxury package'));
    const badgeLux = isLuxury ? `<span class="appointment-badge appointment-badge-lux" title="${luxT}">${luxLabel}</span>` : '';
    const excT = escapeHtml(uiT('calendar.badgeExclusiveTitle', 'Exclusive'));
    const badgeExc = isExclusive ? `<span class="appointment-badge appointment-badge-exc" title="${excT}">EXC</span>` : '';
    const occasionIconsHtml = appointmentOccasionIconsHtml(appointment);
    const cuppingIconHtml = appointmentCuppingIconHtml(appointment);
    const bianStoneIconHtml = appointmentBianStoneIconHtml(appointment);
    const painReliefIconHtml = appointmentPainReliefOilIconHtml(appointment);
    const facialApptLabel = escapeHtml(uiT('calendar.facialApptAria', 'Facial appointment'));
    /* Minimal sandwich: facial icon goes top-right (compact); non-minimal keeps bottom mask */
    const facialMaskFooterHtml = (!CALENDAR_CARD_MINIMAL && isFacial)
        ? `<div class="appointment-facial-mask-wrap" role="img" aria-label="${facialApptLabel}" title="${facialApptLabel}">${CALENDAR_FACIAL_MASK_SVG}</div>`
        : '';
    const loyaltyNameClass = isLoyaltyCustomer ? ' appointment-headline-name--loyalty' : '';
    const masseuseRowHtml = (!CALENDAR_CARD_MINIMAL && bookedByBadge)
        ? `<span class="appointment-headline-masseuse-row">${bookedByBadge}</span>`
        : '';
    const serviceHeadlineHtml = escapeHtml(serviceDisplayStr).replace(/\n/g, '<br>');
    const sandwichServiceHtml = calendarSandwichServiceLinesWithDurationHtml(
        serviceDisplayStr,
        durStr,
        isCouple && !appointment._roomViewSlice,
        appointment.service_segments
    );
    const sandwichTimeRangeStr = formatTimeRangeNoAmPm(startTime, displayEndTime);
    const headlineMainInner = `<span class="appointment-headline-name${loyaltyNameClass}"${coupleNameTitle}>${escapeHtml(customerShort)}${occasionIconsHtml}</span><span class="appointment-headline-service${serviceClass}">${serviceHeadlineHtml}</span>${badge3S}${badgeLux}${badgeExc}${cuppingIconHtml}${bianStoneIconHtml}${painReliefIconHtml}${notesIndicatorHtml}`;
    let headlineHtml;
    if (CALENDAR_CARD_MINIMAL) {
        const sandwichBadges = [badgeLineHtml, roomOverrideBadge, backWalkBadge]
            .filter(Boolean)
            .join('');
        const sandwichBadgesHtml = sandwichBadges
            ? `<div class="appointment-sandwich-badges">${sandwichBadges}</div>`
            : '';
        const sandwichFacialIconHtml = isFacial
            ? `<span class="appointment-sandwich-facial" role="img" aria-label="${facialApptLabel}" title="${facialApptLabel}">${CALENDAR_FACIAL_MASK_SVG}</span>`
            : '';
        const sandwichPhoneIconHtml = (bookedBy === 'us')
            ? `<span class="appointment-booked-by appointment-booked-by-us appointment-sandwich-phone" aria-label="Booked by us" title="${escapeHtml(byUsTitle)}">📞</span>`
            : '';
        /* Top-right: icon row (NEW, face, cupping, bian, 3S, phone), note icon directly below */
        const sandwichIconsTrRowInner = [
            isNew ? newBadge : '',
            sandwichFacialIconHtml,
            cuppingIconHtml,
            bianStoneIconHtml,
            badge3S,
            sandwichPhoneIconHtml,
        ].filter(Boolean).join('');
        const sandwichIconsTrHtml = (sandwichIconsTrRowInner || notesIndicatorHtml)
            ? (
                `<div class="appointment-sandwich-icons-tr">` +
                (sandwichIconsTrRowInner
                    ? `<div class="appointment-sandwich-icons-tr-row">${sandwichIconsTrRowInner}</div>`
                    : '') +
                (notesIndicatorHtml
                    ? `<div class="appointment-sandwich-notes-below">${notesIndicatorHtml}</div>`
                    : '') +
                `</div>`
            )
            : '';
        /* name + start–end (same line/font) → (duration + service) lines → requested masseuse → Rm */
        const sandwichNameTimeHtml =
            `<span class="appointment-headline-name appointment-sandwich-name-time${loyaltyNameClass}"${coupleNameTitle}>` +
            `<span class="appointment-sandwich-customer">${escapeHtml(customerShort)}</span>` +
            `<span class="appointment-sandwich-name-time-sep">   </span>` +
            `<span class="appointment-sandwich-time-inline" title="${escapeHtml(sandwichTimeRangeStr)}">${escapeHtml(sandwichTimeRangeStr)}</span>` +
            `${occasionIconsHtml}` +
            `</span>`;
        const sandwichRoomHtml =
            `<div class="appointment-sandwich-room appointment-room-compact ${roomColClass}" title="${escapeHtml(roomCompact)}">${escapeHtml(roomCompact)}</div>`;
        headlineHtml =
            `<div class="appointment-headline appointment-headline--sandwich${sandwichIconsTrHtml ? ' appointment-headline--sandwich-has-icons' : ''}">` +
            sandwichIconsTrHtml +
            sandwichBadgesHtml +
            sandwichNameTimeHtml +
            `<span class="appointment-headline-service${serviceClass}">${sandwichServiceHtml}</span>` +
            `${badgeLux}${badgeExc}${painReliefIconHtml}` +
            calendarMinimalMasseuseHtml +
            sandwichRoomHtml +
            `</div>`;
    } else {
        headlineHtml = `<div class="appointment-headline appointment-headline--float-meta">${topRightMetaHtml}<div class="appointment-headline-main">${headlineMainInner}</div>${masseuseRowHtml}</div>`;
    }
    const customerServiceRows = '';
    const roomWrapHtml = `<span class="room-wrap" title="${escapeHtml(lockTitle)}">
                <span class="room-lock">${roomLocked ? '🔒' : '🔓'}</span>
                <span class="appointment-room ${appointment.room === 'UNASSIGNED' ? 'unassigned' : ''}" 
                     data-booking-id="${appointment.booking_id}"
                     data-current-room="${appointment.room}"
                     data-appointment-type="${appointment.type}"
                     data-room-locked="${roomLocked}">
                    ${appointment.room === 'UNASSIGNED' ? escapeHtml(uiT('calendar.unassigned', 'UNASSIGNED')) : escapeHtml(formatRoomForPanel(appointment.room))}
                </span>
            </span>`;
    const facialFsTipCalendar = (!isCouple && isFacialWithMassage) ? `
                <span class="tip-wrap" title="Facial Specialist tip">
                    <label>FS $</label>
                    <input type="number" min="0" step="0.01" class="tip-input-2" value="${tipVal2}" data-booking-id="${appointment.booking_id}" ${!canEdit ? 'disabled' : ''} />
                </span>` : '';
    const facialSpecialistSelectHtml = (!isCouple && isFacialWithMassage) ? `
                <span class="facial-specialist-inline-wrap" title="${escapeHtml(uiT('facialSpecialist.calendarTitle', 'Facial Specialist for the facial portion — leave blank if the masseuse did both'))}">
                    <label class="fs-label">${escapeHtml(uiT('facialSpecialist.shortLabel', 'FS'))}</label>
                    <select class="facial-specialist-select" data-booking-id="${appointment.booking_id}" ${!canEdit ? 'disabled' : ''}>
                        <option value="">--</option>
                        ${therapistSelectOptionsHtml(therapists, facialSpecialist)}
                    </select>
                </span>` : '';
    const mtRowHtml = `<span class="appointment-mt-row">
                <span class="appointment-srm-tip-group">
            <span class="therapist-wrap">
                <select class="therapist-select" data-booking-id="${appointment.booking_id}" ${!canEdit ? 'disabled' : ''} title="Therapist">
                            ${therapistSelectOptionsHtml(therapists, appointment.therapist)}
                </select>
                        ${isCouple && therapist2 ? `<span class="therapist-second-name" title="${escapeHtml(therapist2.trim())}"> / ${escapeHtml(therapistFirstNameOnly(therapist2.trim()))}</span>` : ''}
                <span class="therapist-lock">${therapistLocked ? '🔒' : '🔓'}</span>
            </span>
                    <span class="tip-wrap" title="Masseuse tip">
                <label>Tip $</label>
                <input type="number" min="0" step="0.01" class="tip-input" value="${tipVal}" data-booking-id="${appointment.booking_id}" ${!canEdit ? 'disabled' : ''} />
            </span>
                </span>
                ${facialSpecialistSelectHtml}
                ${facialFsTipCalendar}
            </span>`;
    const davidGoldDecorHtml = shouldShowDavidGoldenFun(byRoom, columnTherapist, appointment)
        ? buildDavidGoldenFunHtml()
        : '';
    const topRowContent = byRoom
        ? `<span class="appointment-time">${timeStr}</span>${mtRowHtml}`
        : `<span class="appointment-time">${timeStr}</span>${roomWrapHtml}${mtRowHtml}`;
    const roomRowHtml = byRoom ? `<div class="appointment-room-row">${roomWrapHtml}</div>` : '';
    block.innerHTML = CALENDAR_CARD_MINIMAL
        ? `${prepaymentBadge}
        ${davidGoldDecorHtml}
        ${headlineHtml}${facialMaskFooterHtml}`
        : `${prepaymentBadge}
        ${davidGoldDecorHtml}
        ${headlineHtml}
        <div class="appointment-top-row">
            ${topRowContent}
        </div>
        ${roomRowHtml}
        ${coupleExtra}
        ${customerServiceRows}
        ${isLuxury ? `
        <div class="appointment-luxury-row">
            <label class="luxury-separate-fs-label" title="${escapeHtml(uiT('luxury.separateFsTitle', 'Different specialist does the mini facial in the last 30 minutes; checkout tip defaults to 90% masseuse / 30% FS unless customer specifies otherwise.'))}">
                <input type="checkbox" class="luxury-separate-fs-cb" data-booking-id="${appointment.booking_id}" ${luxurySepFsChecked ? 'checked' : ''} ${!canEdit ? 'disabled' : ''} />
                ${escapeHtml(uiT('luxury.separateFsShort', 'Separate FS (last 30 min)'))}
            </label>
            <div class="luxury-fs-pick-wrap${luxurySepFsChecked ? '' : ' luxury-fs-pick-hidden'}">
                <span class="luxury-mini-therapist-wrap">
                    <label>${isCouple ? 'FS1:' : 'Facial Specialist:'}</label>
                    <select class="luxury-mini-therapist-select" data-booking-id="${appointment.booking_id}" ${!canEdit ? 'disabled' : ''}>
                        <option value="">--</option>
                        ${therapistSelectOptionsHtml(therapists, luxuryMiniTherapist)}
                    </select>
                </span>
                ${isCouple ? `
                <span class="luxury-mini-therapist-wrap">
                    <label>FS2:</label>
                    <select class="luxury-mini-therapist-2-select" data-booking-id="${appointment.booking_id}" ${!canEdit ? 'disabled' : ''}>
                        <option value="">--</option>
                        ${therapistSelectOptionsHtml(therapists, luxuryMiniTherapist2)}
                    </select>
                </span>
                ` : ''}
            </div>
            <label class="luxury-mini-done-label"><input type="checkbox" class="luxury-mini-done" data-booking-id="${appointment.booking_id}" ${luxuryMiniDone ? 'checked' : ''} ${!canEdit ? 'disabled' : ''} /> ${escapeHtml(uiT('luxury.miniFacialDone', 'Mini facial done'))}</label>
        </div>
        ` : ''}
        ${isPast && !appointment.appointment_locked ? '<button type="button" class="unlock-past-btn">' + escapeHtml(uiT('modal.unlockPast', 'Unlock to edit')) + '</button>' : ''}${facialMaskFooterHtml}`;
    if (CALENDAR_CARD_MINIMAL) block.classList.add('appointment-block-minimal');
    else block.classList.remove('appointment-block-minimal');
    if (isFacial) {
        block.classList.add('appointment-facial');
        /* Bottom facial mask padding only for non-minimal cards */
        if (CALENDAR_CARD_MINIMAL) block.classList.remove('appointment-has-facial-mask');
        else block.classList.add('appointment-has-facial-mask');
    } else {
        block.classList.remove('appointment-has-facial-mask', 'appointment-facial');
    }

    const notesIndicator = block.querySelector('.appointment-notes-indicator');
    if (notesIndicator && notesText) {
        let tooltipEl = null;
        notesIndicator.addEventListener('mouseenter', () => {
            if (tooltipEl && tooltipEl.parentNode) tooltipEl.remove();
            const rect = notesIndicator.getBoundingClientRect();
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'appointment-notes-tooltip';
            tooltipEl.textContent = uiNotesHoverText(notesText);
            const pad = 8;
            const maxW = 320;
            tooltipEl.style.maxWidth = maxW + 'px';
            tooltipEl.style.position = 'fixed';
            tooltipEl.style.left = rect.left + 'px';
            tooltipEl.style.top = (rect.top - 10) + 'px';
            document.body.appendChild(tooltipEl);
            const tr = tooltipEl.getBoundingClientRect();
            let left = rect.left;
            let top = rect.top - tr.height - pad;
            if (left + tr.width > window.innerWidth) left = window.innerWidth - tr.width - pad;
            if (left < pad) left = pad;
            if (top < pad) top = pad;
            tooltipEl.style.left = left + 'px';
            tooltipEl.style.top = top + 'px';
        });
        notesIndicator.addEventListener('mouseleave', () => {
            if (tooltipEl && tooltipEl.parentNode) tooltipEl.remove();
            tooltipEl = null;
        });
    }
    
    const date = document.getElementById('dateInput') && document.getElementById('dateInput').value;

    // Drag: reassign to another masseuse when dropped on a different column
    block.addEventListener('dragstart', (e) => {
        if (e.target.closest('input, select, button')) {
            e.preventDefault();
            return;
        }
        const dt = e.dataTransfer;
        dt.effectAllowed = 'move';
        dt.setData('application/json', JSON.stringify({
            booking_id: appointment.booking_id,
            date: date || '',
            room_view_slice: appointment._roomViewSlice || null,
        }));
        dt.setData('text/plain', appointment.booking_id);
        e.target.closest('.appointment-block').classList.add('dragging');
    });
    block.addEventListener('dragend', () => block.classList.remove('dragging'));
    
    // Room lock icon: click to unlock room (re-run auto-assign)
    const roomLockEl = block.querySelector('.room-lock');
    if (roomLockEl && roomLocked && canEdit) {
        roomLockEl.style.cursor = 'pointer';
        roomLockEl.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!date) return;
            try {
                const res = await fetch('/api/room/unlock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: appointment.booking_id, date })
                });
                if (res.ok) {
                    if (!(await tryApplyDayFromRoomMutationResponse(res))) loadDay({ soft: true });
                }
            } catch (err) { console.error(err); }
        });
    }
    
    // Therapist select: save and lock
    const therapistSelect = block.querySelector('.therapist-select');
    if (therapistSelect && canEdit) {
        therapistSelect.addEventListener('change', async () => {
            if (!date) return;
            try {
                const res = await fetch('/api/therapist', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: appointment.booking_id,
                        date,
                        therapist: therapistSelect.value,
                        locked: true,
                        slot: 1
                    })
                });
                if (res.ok) loadDay({ soft: true });
            } catch (err) { console.error(err); }
        });
    }
    
    // Therapist lock icon: toggle lock (TODO: could add separate unlock API call with locked: false)
    const therapistLockSpan = block.querySelector('.therapist-lock');
    if (therapistLockSpan && canEdit) {
        therapistLockSpan.style.cursor = 'pointer';
        therapistLockSpan.addEventListener('click', async () => {
            if (!date) return;
            const newLocked = !therapistLocked;
            try {
                const res = await fetch('/api/therapist', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: appointment.booking_id,
                        date,
                        therapist: therapistSelect ? therapistSelect.value : appointment.therapist,
                        locked: newLocked,
                        slot: 1
                    })
                });
                if (res.ok) loadDay({ soft: true });
            } catch (err) { console.error(err); }
        });
    }
    
    // Tip input: save on blur
    const tipInput = block.querySelector('.tip-input');
    if (tipInput && canEdit) {
        tipInput.addEventListener('blur', async () => {
            if (!date) return;
            const val = parseFloat(tipInput.value);
            if (isNaN(val)) return;
            const tipInput2 = block.querySelector('.tip-input-2');
            const tipVal2 = tipInput2 && !isNaN(parseFloat(tipInput2.value)) ? parseFloat(tipInput2.value) : undefined;
            const splitCheck = block.querySelector('.tip-split-checkbox');
            const splitEvenly = splitCheck ? splitCheck.checked : undefined;
            try {
                const body = { booking_id: appointment.booking_id, date, tip_amount: val };
                if (tipVal2 !== undefined) body.tip_amount_2 = tipVal2;
                if (splitEvenly !== undefined) body.split_evenly = splitEvenly;
                await fetch('/api/tip', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            } catch (err) { console.error(err); }
        });
    }

    // Luxury package: separate FS checkbox + mini facial done + who does it (FS1 and FS2 for couple)
    const luxurySeparateFsCb = block.querySelector('.luxury-separate-fs-cb');
    const luxuryFsPickWrap = block.querySelector('.luxury-fs-pick-wrap');
    const luxuryMiniDoneCheck = block.querySelector('.luxury-mini-done');
    const luxuryMiniTherapistSelect = block.querySelector('.luxury-mini-therapist-select');
    const luxuryMiniTherapist2Select = block.querySelector('.luxury-mini-therapist-2-select');
    if (isLuxury && (luxurySeparateFsCb || luxuryMiniDoneCheck || luxuryMiniTherapistSelect || luxuryMiniTherapist2Select) && date && canEdit) {
        const saveLuxuryMini = async () => {
            try {
                const separate = luxurySeparateFsCb ? luxurySeparateFsCb.checked : false;
                const body = {
                    booking_id: appointment.booking_id,
                    date,
                    done: luxuryMiniDoneCheck ? luxuryMiniDoneCheck.checked : false,
                    separate_specialist: separate
                };
                if (separate) {
                    body.therapist = luxuryMiniTherapistSelect ? luxuryMiniTherapistSelect.value || null : null;
                    if (luxuryMiniTherapist2Select) body.therapist_2 = luxuryMiniTherapist2Select.value || null;
                } else {
                    body.therapist = null;
                    body.therapist_2 = null;
                }
                await fetch('/api/booking/luxury-mini-facial', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                loadDay({ soft: true });
            } catch (err) { console.error(err); }
        };
        const toggleLuxuryFsPick = () => {
            if (!luxuryFsPickWrap) return;
            luxuryFsPickWrap.classList.toggle('luxury-fs-pick-hidden', !(luxurySeparateFsCb && luxurySeparateFsCb.checked));
        };
        if (luxurySeparateFsCb) {
            luxurySeparateFsCb.addEventListener('change', () => {
                toggleLuxuryFsPick();
                saveLuxuryMini();
            });
        }
        if (luxuryMiniDoneCheck) luxuryMiniDoneCheck.addEventListener('change', saveLuxuryMini);
        if (luxuryMiniTherapistSelect) luxuryMiniTherapistSelect.addEventListener('change', saveLuxuryMini);
        if (luxuryMiniTherapist2Select) luxuryMiniTherapist2Select.addEventListener('change', saveLuxuryMini);
    }

    // Facial+massage: Facial Specialist (who does facial; blank = one person did massage + facial)
    const facialSpecialistSelect = block.querySelector('.facial-specialist-select');
    if (facialSpecialistSelect && date && canEdit) {
        facialSpecialistSelect.addEventListener('change', async () => {
            try {
                const res = await fetch('/api/booking/facial-specialist', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: appointment.booking_id,
                        date,
                        therapist: facialSpecialistSelect.value || null
                    })
                });
                if (res.ok) loadDay({ soft: true });
            } catch (err) { console.error(err); }
        });
    }

    // Single click: dismiss unassigned flash so it stops flashing
    block.addEventListener('click', function(e) {
        if (e.target.closest('input, select, button')) return;
        if (block.classList.contains('unassigned-flash')) {
            const d = document.getElementById('dateInput') && document.getElementById('dateInput').value;
            if (d) setUnassignedFlashDismissed(d, appointment.booking_id);
            block.classList.remove('unassigned-flash');
        }
    });
    // Double-click on block (not on inputs) opens full-detail popup
    block.addEventListener('dblclick', function(e) {
        if (e.target.closest('input, select, button')) return;
        if (appointment.room === 'UNASSIGNED') {
            const d = document.getElementById('dateInput') && document.getElementById('dateInput').value;
            if (d) setUnassignedFlashDismissed(d, appointment.booking_id);
        }
        const fullEv = (currentData && currentData.events && appointment.booking_id)
            ? currentData.events.find(x => x.booking_id === appointment.booking_id)
            : null;
        void showAppointmentDetailModal(fullEv || appointment);
    });

    // Second therapist (couple): select and lock
    const therapistSelect2 = block.querySelector('.therapist-select-2');
    if (therapistSelect2 && canEdit) {
        therapistSelect2.addEventListener('change', async () => {
            if (!date) return;
            try {
                const res = await fetch('/api/therapist', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: appointment.booking_id,
                        date,
                        therapist: therapistSelect2.value,
                        locked: true,
                        slot: 2
                    })
                });
                if (res.ok) loadDay({ soft: true });
            } catch (err) { console.error(err); }
        });
    }
    const therapistLockSpan2 = block.querySelector('.therapist-lock-2');
    if (therapistLockSpan2 && canEdit) {
        therapistLockSpan2.style.cursor = 'pointer';
        therapistLockSpan2.addEventListener('click', async () => {
            if (!date) return;
            const newLocked = !therapistLocked2;
            try {
                const res = await fetch('/api/therapist', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: appointment.booking_id,
                        date,
                        therapist: therapistSelect2 ? therapistSelect2.value : (appointment.therapist_2 || ''),
                        locked: newLocked,
                        slot: 2
                    })
                });
                if (res.ok) loadDay({ soft: true });
            } catch (err) { console.error(err); }
        });
    }
    // Tip 2 and split: save on blur
    const tipInput2 = block.querySelector('.tip-input-2');
    if (tipInput2 && canEdit) {
        tipInput2.addEventListener('blur', async () => {
            if (!date) return;
            const val = parseFloat(tipInput.value);
            const val2 = parseFloat(tipInput2.value);
            const splitCheck = block.querySelector('.tip-split-checkbox');
            try {
                await fetch('/api/tip', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: appointment.booking_id,
                        date,
                        tip_amount: isNaN(val) ? 0 : val,
                        tip_amount_2: isNaN(val2) ? undefined : val2,
                        split_evenly: splitCheck ? splitCheck.checked : undefined
                    })
                });
            } catch (err) { console.error(err); }
        });
    }
    const splitCheckbox = block.querySelector('.tip-split-checkbox');
    if (splitCheckbox && canEdit) {
        splitCheckbox.addEventListener('change', async () => {
            if (!date) return;
            const val = parseFloat(tipInput.value);
            const tipInput2El = block.querySelector('.tip-input-2');
            const val2 = tipInput2El ? parseFloat(tipInput2El.value) : NaN;
            try {
                const res = await fetch('/api/tip', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: appointment.booking_id,
                        date,
                        tip_amount: isNaN(val) ? 0 : val,
                        tip_amount_2: isNaN(val2) ? undefined : val2,
                        split_evenly: splitCheckbox.checked
                    })
                });
                if (res.ok) loadDay({ soft: true });
            } catch (err) { console.error(err); }
        });
    }
    // Check-in buttons
    block.querySelectorAll('.checkin-btn').forEach(btn => {
        if (!canEdit) return;
        btn.addEventListener('click', async () => {
            if (!date) return;
            const clientIndex = parseInt(btn.dataset.client, 10);
            try {
                const res = await fetch('/api/check-in', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: appointment.booking_id, date, client_index: clientIndex })
                });
                if (res.ok) loadDay({ soft: true });
            } catch (err) { console.error(err); }
        });
    });
    
    // Unlock past appointment
    const unlockPastBtn = block.querySelector('.unlock-past-btn');
    if (unlockPastBtn) {
        unlockPastBtn.addEventListener('click', async () => {
            if (!date) return;
            try {
                const res = await fetch('/api/appointment/unlock', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: appointment.booking_id, date, unlocked: true })
                });
                if (res.ok) loadDay({ soft: true });
            } catch (err) { console.error(err); }
        });
    }
    
    // Make room number editable on click (calendar minimal mode has no .appointment-room — edit room in detail modal)
    const roomElement = block.querySelector('.appointment-room');
    if (roomElement) {
    roomElement._isEditing = false;
    (function(el, apt) {
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            e.stopImmediatePropagation();
            const canEditApt = !apt.is_past || apt.appointment_locked === true;
            if (!canEditApt) return;
            
            if (el._isEditing) return;
            
            el._isEditing = true;
            const currentRoom = el.dataset.currentRoom;
            const currentText = el.textContent.trim();
        
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
            
            setTimeout(() => {
                input.focus();
                input.select();
                if (document.activeElement !== input) {
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
                
                // Convert to uppercase for 02D/02C, but keep numbers as-is
                // Handle "Rm 5" or just "5"
                if (newRoom.toUpperCase().startsWith('RM ')) {
                    newRoom = newRoom.substring(3).trim();
                }
                if (newRoom.toUpperCase().startsWith('ROOM ')) {
                    newRoom = newRoom.substring(5).trim();
                }
                
                // Normalize: keep numbers as string; UI label 02C and legacy 02d/02D → stored 02D
                let normalizedRoom;
                if (newRoom.toUpperCase() === '02D' || newRoom.toLowerCase() === '02d'
                    || newRoom.toUpperCase() === '02C' || newRoom.toLowerCase() === '02c') {
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
                
                // If empty or same as current, cancel
                if (normalizedRoom === '' || normalizedRoom === currentRoom) {
                    el.textContent = currentText;
                    el._isEditing = false;
                    return;
                }
                
                const validRooms = ['0', '1', '2', '3', '4', '5', '6', '02D', 'UNASSIGNED'];
                
                if (!validRooms.includes(normalizedRoom)) {
                    console.error(`[ROOM INPUT] Invalid room: "${normalizedRoom}" (from "${input.value}")`);
                    alert(`Invalid room number: "${normalizedRoom}". Valid rooms: 0, 1, 2, 3, 4, 5, 6, 02C, UNASSIGNED`);
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
                el.textContent = 'Saving...';
                
                try {
                    // Get current date
                    const date = document.getElementById('dateInput').value;
                    
                    // Update room via API (409 → confirm, then retry with confirmed=true)
                    const response = await putRoomAssignmentWithConfirm(apt.booking_id, date, roomToSave);
                    
                    if (!response.ok) {
                        if (response.status === 499 || response.status === 409) {
                            el.textContent = currentText;
                            el._isEditing = false;
                            return;
                        }
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
                    if (!(await tryApplyDayFromRoomMutationResponse(response))) void loadDay({ soft: true });
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
            });
            
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    finishEdit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    finishEditCalled = true;
                    el.textContent = currentText;
                    el._isEditing = false;
                }
                // Don't prevent other keys - allow normal typing and deletion
            });
            
            // Handle blur - only finish edit if user clicks away (not when pressing Enter)
            input.addEventListener('blur', () => {
                setTimeout(() => {
                    if (!finishEditCalled && document.activeElement !== input) finishEdit();
                }, 200);
            });
        });
    })(roomElement, appointment);
    }

    return block;
}

function formatUnassignedFixSuggestionPlain(s) {
    if (!s || !s.template) return '';
    const r = (key) => roomKeyDisplayLabel(s[key] || '');
    const cust = String(s.customer || '').trim() || 'Customer';
    const other = String(s.other_customer || '').trim() || 'Customer';
    if (s.template === 'assign_direct') {
        return uiTParams(
            'unassignedSug.assignDirect',
            { customer: cust, room: r('room') },
            `Assign ${cust} to Rm ${r('room')} (no other booking changes).`
        );
    }
    if (s.template === 'move_then_assign') {
        return uiTParams(
            'unassignedSug.moveThenAssign',
            {
                customer: cust,
                room: r('room'),
                other,
                fromRoom: r('from_room'),
                toRoom: r('to_room'),
            },
            `Move ${other} from Rm ${r('from_room')} → Rm ${r('to_room')}, then assign ${cust} to Rm ${r('room')} (one other room change).`
        );
    }
    if (s.template === 'square_time_shift') {
        let span = '';
        try {
            const a = new Date(s.new_start_at_iso);
            const b = new Date(s.new_end_at_iso);
            if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
                span = `${formatTime(a)}–${formatTime(b)}`;
            }
        } catch (_e) { /* ignore */ }
        return uiTParams(
            'unassignedSug.squareShift',
            { customer: cust, room: r('room'), span: span || '—' },
            `If ${cust} can start at ${span || '—'} in Square then Refresh, Rm ${r('room')} is open (only that booking’s time changes).`
        );
    }
    return '';
}

function showUnassigned(events) {
    const unassigned = (events || []).filter(e => e.room === 'UNASSIGNED');
    const container = document.getElementById('unassignedContainer');
    const list = document.getElementById('unassignedList');

    if (!container || !list) return;

    if (unassigned.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    list.innerHTML = '';
    const oldSug = container.querySelector('.unassigned-suggestions-wrap');
    if (oldSug) oldSug.remove();

    unassigned.forEach(event => {
        const item = document.createElement('div');
        item.className = 'unassigned-item';
        
        const startTime = new Date(event.start_at);
        const timeStr = formatTime(startTime);
        
        const body = document.createElement('div');
        body.className = 'unassigned-item-body';
        body.innerHTML = `
            <strong>${escapeHtml(timeStr)}</strong> - ${escapeHtml(event.customer)} (${escapeHtml(event.service)}) - ${escapeHtml(event.therapist)}
            <div class="reason">Reason: ${escapeHtml(event.reason || 'No room available')}</div>
        `;

        item.appendChild(body);
        list.appendChild(item);
    });

    const sugSrc = currentData && Array.isArray(currentData.unassigned_fix_suggestions)
        ? currentData.unassigned_fix_suggestions
        : null;
    if (sugSrc && sugSrc.length) {
        const wrap = document.createElement('div');
        wrap.className = 'unassigned-suggestions-wrap';
        const h = document.createElement('div');
        h.className = 'unassigned-suggestions-heading';
        h.textContent = uiT('unassigned.suggestionsTitle', 'Suggested fixes (least disruptive first)');
        const ul = document.createElement('ul');
        ul.className = 'unassigned-suggestions-list';
        sugSrc.slice(0, 10).forEach((s) => {
            const li = document.createElement('li');
            li.className = `unassigned-suggestion-item unassigned-suggestion-tier-${Number(s.tier) || 0}`;
            li.textContent = formatUnassignedFixSuggestionPlain(s);
            ul.appendChild(li);
        });
        wrap.appendChild(h);
        wrap.appendChild(ul);
        container.appendChild(wrap);
    }
}

// Current time line management
let currentTimeLineInterval = null;

function updateCurrentTimeLine() {
    if (currentTimeLineInterval) {
        clearInterval(currentTimeLineInterval);
        currentTimeLineInterval = null;
    }
    
    const existingLine = document.querySelector('.current-time-line');
    if (existingLine) existingLine.remove();
    
    const dateInput = document.getElementById('dateInput');
    if (!dateInput) return;
    
    const selectedDate = dateInput.value;
    const today = getTodayLocal();
    if (selectedDate !== today) {
        syncAppointmentInProgressClasses();
        return;
    }
    
    const calendarContainer = document.getElementById('calendarContainer');
    if (!calendarContainer || calendarContainer.style.display === 'none') {
        syncAppointmentInProgressClasses();
        return;
    }
    
    const calendarGrid = document.getElementById('calendarGrid');
    if (!calendarGrid) return;
    
    const timeLine = document.createElement('div');
    timeLine.className = 'current-time-line';
    timeLine.id = 'currentTimeLine';
    const timeLineParent = momCalendarTimeLineScrollParent();
    timeLineParent.appendChild(timeLine);
    
    const updatePosition = () => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentSecond = now.getSeconds();
        const currentMs = now.getMilliseconds();

        const grid = document.getElementById('calendarGrid');
        syncAppointmentInProgressClasses();
        if (!grid) {
            timeLine.style.display = 'none';
            return;
        }
        
        const slot0El = grid.querySelector('.time-slot[data-slot-index="0"]') || grid.querySelector('.time-slot');
        if (!slot0El) {
            timeLine.style.display = 'none';
            return;
        }
        
        if (currentHour < START_HOUR || currentHour >= END_HOUR) {
            timeLine.style.display = 'none';
            grid.querySelectorAll('.current-time-slot').forEach(el => el.classList.remove('current-time-slot'));
            return;
        }
        
        timeLine.style.display = 'block';
        
        // Minutes from calendar start (START_HOUR), including ms for smoother placement
        const minutesFromStart = (currentHour - START_HOUR) * 60 + currentMinute;
        const totalMinutes = minutesFromStart + currentSecond / 60 + currentMs / 60000;
        const slotStep = (() => {
            const raw = grid.dataset.calendarSlotStep;
            const n = raw != null ? parseInt(raw, 10) : TIME_SLOT_MINUTES;
            return n === 30 || n === 15 ? n : TIME_SLOT_MINUTES;
        })();
        let maxSlotIdx = 0;
        grid.querySelectorAll('.time-slot[data-slot-index]').forEach((el) => {
            const i = parseInt(el.dataset.slotIndex, 10);
            if (!Number.isNaN(i)) maxSlotIdx = Math.max(maxSlotIdx, i);
        });
        let rowIdx = Math.floor(totalMinutes / slotStep);
        rowIdx = Math.max(0, Math.min(rowIdx, maxSlotIdx));
        const slotStartMin = rowIdx * slotStep;
        let frac = (totalMinutes - slotStartMin) / slotStep;
        if (frac < 0) frac = 0;
        if (frac > 1) frac = 1;

        grid.querySelectorAll('.current-time-slot').forEach(el => el.classList.remove('current-time-slot'));
        const slotStr = String(rowIdx);
        const timeSlotEl = grid.querySelector('.time-slot[data-slot-index="' + slotStr + '"]');
        const staffCellEl = grid.querySelector('.staff-col-cell[data-slot-index="' + slotStr + '"]');
        const roomsCellEl = grid.querySelector('.rooms-cell[data-slot-index="' + slotStr + '"]');
        const capacityCellEl = grid.querySelector('.capacity-cell[data-slot-index="' + slotStr + '"]');
        if (timeSlotEl) timeSlotEl.classList.add('current-time-slot');
        if (staffCellEl) staffCellEl.classList.add('current-time-slot');
        if (roomsCellEl) roomsCellEl.classList.add('current-time-slot');
        if (capacityCellEl) capacityCellEl.classList.add('current-time-slot');
        grid.querySelectorAll('.appointment-cell[data-time-slot="' + slotStr + '"]').forEach(el => el.classList.add('current-time-slot'));

        // Use viewport geometry + scroll: grid was position:static so offsetTop chained past #calendarGrid
        // and grid.offsetTop + cell.offsetTop mixed roots (~one row / ~30 min off). Anchor on appointment-cell
        // (not sticky time column) for the row band height.
        const anchor = grid.querySelector('.appointment-cell[data-time-slot="' + slotStr + '"]')
            || grid.querySelector('.rooms-cell[data-slot-index="' + slotStr + '"]')
            || timeSlotEl
            || slot0El;
        const c = momCalendarTimeLineScrollParent();
        const ar = anchor.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const rowTop = ar.top - cr.top + c.scrollTop;
        const rowH = ar.height > 0 ? ar.height : (anchor.offsetHeight || getCalendarSlotHeight());
        const topPosition = rowTop + frac * rowH;
        const containerPadding = 15;
        
        timeLine.style.top = `${topPosition}px`;
        timeLine.style.left = `${containerPadding}px`;
        timeLine.style.width = `calc(100% - ${containerPadding * 2}px)`;
    };

    updatePosition();
    currentTimeLineInterval = setInterval(updatePosition, 250);
}

/** Re-apply language to dynamic UI (after toggling EN / 中文 / 中英). */
function momApplyLanguage() {
    if (window.MOM_I18N && typeof window.MOM_I18N.applyStaticI18n === 'function') {
        window.MOM_I18N.applyStaticI18n();
    }
    updateDateDayOfWeek();
    refreshHeaderToolbarLinksToggleTitles();
    checkApiStatus();
    updateCheckinPanelTitle();
    updateCheckoutPanelTitle();
    syncDeskNoteLangToggleButtons();
    updateCalendarZoomUI();
    const checkinPanel = document.getElementById('checkinPanel');
    if (checkinPanel && checkinPanel.style.display !== 'none') {
        const sel = document.getElementById('checkinTimeSelect');
        if (sel) renderCheckinPanelList(sel.value);
    }
    const checkoutPanel = document.getElementById('checkoutPanel');
    if (checkoutPanel && checkoutPanel.style.display !== 'none') {
        const sel = document.getElementById('checkoutTimeSelect');
        if (sel) renderCheckoutPanelList(sel.value);
    }
    updateDayLayoutFreezeTooltip(currentData);
    if (currentData) {
        updateHeaderDateHoverSummary(currentData);
        renderNextAvailable(currentData.next_couple_available, currentData.next_single_available);
        renderCustomerRequestsSummary(currentData.events, currentData.therapists);
        renderFacialSummary(currentData.facial_summary);
        renderTherapistOrderBar(currentData.therapists, currentData.therapist_order, currentData.date);
        renderCalendar(currentData);
        showUnassigned(currentData.events);
        updateNoRoomsAlert(currentData);
        updateNoRoomBookingAlert(currentData);
    }
    const detailModal = document.getElementById('appointmentDetailModal');
    const openBid = detailModal && detailModal.style.display !== 'none' && detailModal.dataset && detailModal.dataset.bookingId;
    if (openBid && currentData && currentData.events) {
        const evOpen = currentData.events.find(e => e.booking_id === openBid);
        if (evOpen) void showAppointmentDetailModal(evOpen);
    }
    renderCancelledAlerts();
    renderRescheduleAlerts();
    const nextModal = document.getElementById('nextAvailableModal');
    if (nextModal && nextModal.style.display !== 'none') {
        openNextAvailableModal();
    }
    const focusModal = document.getElementById('focusAreaModal');
    if (focusModal && focusModal.style.display !== 'none' && focusAreaModalState && focusAreaModalState.bookingId && focusAreaModalState.date) {
        const st = focusAreaModalState;
        const ev = (currentData && currentData.events || []).find(e => e.booking_id === st.bookingId);
        const focusStr = st.slot === 2 ? (ev && ev.focus_area_2 || '') : (ev && ev.focus_area || '');
        openFocusAreaModal(st.bookingId, st.date, focusStr, st.slot || 1);
    }
    setTimeout(() => updateCurrentTimeLine(), 150);
}
window.momApplyLanguage = momApplyLanguage;

