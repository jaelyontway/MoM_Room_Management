/**
 * Masseuse scheduling sheet — rules from static/docs/sheet_rules.md
 */
(function () {
    'use strict';

    const BASE_SLOTS_MAX = 9;
    const BASE_SLOTS_WEEKDAY = 6; /* Mon–Thu default card count on first open */
    const BASE_SLOTS_WEEKEND = 9; /* Fri–Sun default card count on first open */
    const ROWS_MIN = 3; /* cannot shrink below this with − */
    const ROWS_DEFAULT = 9; /* initial empty rows per card */
    const ROWS_MAIN = ROWS_DEFAULT;
    const ROWS_PER = ROWS_DEFAULT; /* legacy alias */
    const STORAGE_PREFIX = 'mom_mss_edits_v7:';
    const SKILLS_KEY = 'mom_mss_skills_v1';
    /** Fixed tipSlot for split-created 小工 partner rows (survives redistribute when pinned). */
    const SPLIT_XG_TIP = 30;

    /** Defaults — editable on the sheet page (rules 9, 10, 24, 26). */
    const DEFAULT_SKILLS = {
        facial: ['Tina', 'Lynn'],
        trigger: ['Casey', 'Cassey', 'May'],
        fireCupping: ['Sophia', 'Casey', 'Cassey', 'Vicky'],
        manualOnly: ['Lynn'], /* rule 24: no auto turn distribution */
    };

    let skills = loadSkills();
    let rosterInputDirty = false;
    let prefetchGen = 0;

    let state = {
        date: '',
        slots: [], // { name, rows: [...], extra?: bool }
        edits: {
            names: {},
            cells: {},
            rows: {},
            extraCount: 0,
            roster: null,
            rowCounts: {},
            rowMeta: {},
        },
        calendarTips: {}, // "slot-row" -> tip from calendar
        picker: { slotIdx: -1, rowIdx: -1 },
        namePickerSlot: -1,
        namePickerPrevName: null,
        detail: { slotIdx: -1, rowIdx: -1, selectedKeys: [] },
        baseCount: BASE_SLOTS_MAX, // rule 21: may be < 9
        nowTimer: null,
    };

    function cloneDefaultSkills() {
        return {
            facial: DEFAULT_SKILLS.facial.slice(),
            trigger: DEFAULT_SKILLS.trigger.slice(),
            fireCupping: DEFAULT_SKILLS.fireCupping.slice(),
            manualOnly: DEFAULT_SKILLS.manualOnly.slice(),
        };
    }

    function normalizeSkills(p) {
        if (!p || typeof p !== 'object') return cloneDefaultSkills();
        return {
            facial: Array.isArray(p.facial) ? p.facial.map(String).map((s) => s.trim()).filter(Boolean) : DEFAULT_SKILLS.facial.slice(),
            trigger: Array.isArray(p.trigger) ? p.trigger.map(String).map((s) => s.trim()).filter(Boolean) : DEFAULT_SKILLS.trigger.slice(),
            fireCupping: Array.isArray(p.fireCupping) ? p.fireCupping.map(String).map((s) => s.trim()).filter(Boolean) : DEFAULT_SKILLS.fireCupping.slice(),
            manualOnly: Array.isArray(p.manualOnly) ? p.manualOnly.map(String).map((s) => s.trim()).filter(Boolean) : DEFAULT_SKILLS.manualOnly.slice(),
        };
    }

    function loadSkills() {
        try {
            const raw = localStorage.getItem(SKILLS_KEY);
            if (!raw) return cloneDefaultSkills();
            return normalizeSkills(JSON.parse(raw));
        } catch (e) {
            return cloneDefaultSkills();
        }
    }

    function saveSkillsLocal() {
        try {
            localStorage.setItem(SKILLS_KEY, JSON.stringify(skills));
        } catch (e) {}
    }

    /** Persist to disk (server) + localStorage so names survive reopen / browser clear. */
    async function saveSkills() {
        saveSkillsLocal();
        try {
            const res = await fetch('/api/sheet-skills', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(skills),
            });
            if (!res.ok) throw new Error(await res.text());
            return true;
        } catch (e) {
            console.warn('sheet-skills disk save failed; kept in browser only', e);
            return false;
        }
    }

    async function hydrateSkillsFromServer() {
        try {
            const res = await fetch('/api/sheet-skills');
            if (!res.ok) return false;
            const data = await res.json();
            skills = normalizeSkills(data);
            saveSkillsLocal();
            fillSkillsForm();
            return true;
        } catch (e) {
            return false;
        }
    }

    function toggleSkillsPanel() {
        const panel = document.getElementById('mssSkillsPanel');
        const btn = document.getElementById('mssSkillsBtn');
        if (!panel) return;
        const open = !panel.classList.contains('open');
        panel.classList.toggle('open', open);
        panel.hidden = !open;
        btn?.classList.toggle('active', open);
        if (open) fillSkillsForm();
    }

    function parseNameList(str) {
        return String(str || '')
            .split(/[,，;；\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    function isManualOnlyName(name) {
        return nameInList(name, skills.manualOnly || []);
    }

    function getTodayLocal() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function formatDateLocal(d) {
        if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function addDaysToDate(dateStr, delta) {
        const d = new Date((dateStr || getTodayLocal()) + 'T12:00:00');
        if (Number.isNaN(d.getTime())) return getTodayLocal();
        d.setDate(d.getDate() + delta);
        return formatDateLocal(d);
    }

    function getDateFromQuery() {
        const date = new URLSearchParams(window.location.search).get('date');
        return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getTodayLocal();
    }

    function setStatus(msg, isError) {
        const el = document.getElementById('mssStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.className = 'mss-status' + (isError ? ' error' : '');
    }

    function storageKey(date) {
        return STORAGE_PREFIX + date;
    }

    function loadEdits(date) {
        const empty = {
            names: {},
            cells: {},
            rows: {},
            extraCount: 0,
            roster: null,
            rowCounts: {},
            rowMeta: {},
        };
        try {
            let raw = localStorage.getItem(storageKey(date));
            let fromLegacyFullSnap = false;
            if (!raw) {
                raw = localStorage.getItem('mom_mss_edits_v6:' + date);
            }
            if (!raw) {
                raw = localStorage.getItem('mom_mss_edits_v5:' + date);
            }
            if (!raw) {
                raw = localStorage.getItem('mom_mss_edits_v4:' + date);
            }
            if (!raw) {
                const v3 = localStorage.getItem('mom_mss_edits_v3:' + date);
                if (v3) {
                    raw = v3;
                    fromLegacyFullSnap = true;
                }
            }
            if (!raw) {
                raw = localStorage.getItem('mom_mss_edits_v2:' + date);
            }
            if (!raw) return empty;
            const parsed = JSON.parse(raw);
            let roster = Array.isArray(parsed.roster) ? parsed.roster.map((n) => String(n || '').trim()) : null;
            if (roster && !roster.length) roster = null;
            /* v6: drop auto-past freezes (they blocked turn after Jude→Sophia) */
            let rows = fromLegacyFullSnap ? {} : parsed.rows || {};
            const cleaned = {};
            Object.keys(rows).forEach((key) => {
                const snap = rows[key];
                if (!snap) return;
                if (snap.past) return;
                if (snap.bid && snap.pinned === true) {
                    cleaned[lockKey(snap.bid, snap.tipSlot || 1)] = { ...snap, pinned: true };
                } else if (!snap.bid && /^\d+-\d+$/.test(key)) {
                    cleaned[key] = snap;
                }
            });
            return {
                names: parsed.names || {},
                cells: parsed.cells || {},
                rows: cleaned,
                extraCount: Math.max(0, parseInt(parsed.extraCount, 10) || 0),
                roster: roster,
                rowCounts:
                    parsed.rowCounts && typeof parsed.rowCounts === 'object'
                        ? parsed.rowCounts
                        : {},
                rowMeta:
                    parsed.rowMeta && typeof parsed.rowMeta === 'object' ? parsed.rowMeta : {},
            };
        } catch (e) {
            return empty;
        }
    }

    function lockKey(bid, tipSlot) {
        return String(bid || '') + '#' + (tipSlot || 1);
    }

    function rowStartMs(row) {
        if (!row) return 0;
        if (row._start && typeof row._start.getTime === 'function') return row._start.getTime();
        return 0;
    }

    function isPastAppointment(rowOrStart) {
        const now = Date.now();
        if (rowOrStart && typeof rowOrStart.getTime === 'function') return rowOrStart.getTime() < now;
        return rowStartMs(rowOrStart) > 0 && rowStartMs(rowOrStart) < now;
    }

    /**
     * Locks = manual NM pins only (masseuse name + bid).
     * Do NOT freeze auto-past rows — that left Christalle/Fay stuck after Jude→Sophia.
     */
    function collectAssignmentLocks(prevSlots, editsRows) {
        const map = new Map();
        function add(lock) {
            if (!lock || !lock.bid || !lock.pinned) return;
            const masseuse = String(lock.masseuse || '').trim();
            if (!masseuse) return;
            map.set(lockKey(lock.bid, lock.tipSlot), {
                bid: String(lock.bid),
                tipSlot: lock.tipSlot || 1,
                masseuse: masseuse,
                pinned: true,
                past: !!lock.past,
                requested: !!lock.requested,
            });
        }
        (prevSlots || []).forEach((slot) => {
            const masseuse = String((slot && slot.name) || '').trim();
            (slot.rows || []).forEach((row) => {
                if (!row || !row._bid || !row._pinned) return;
                add({
                    bid: row._bid,
                    tipSlot: row._tipSlot || 1,
                    masseuse: masseuse,
                    pinned: true,
                    past: isPastAppointment(row),
                    requested: !!row.requested,
                });
            });
        });
        Object.keys(editsRows || {}).forEach((key) => {
            const snap = editsRows[key];
            if (!snap || !snap.bid) return;
            /* Only true manual / checkbox pins — ignore old auto-past freezes */
            if (snap.pinned !== true) return;
            let masseuse = String(snap.masseuse || '').trim();
            if (!masseuse && /^\d+-\d+$/.test(key)) {
                const s = parseInt(key.split('-')[0], 10);
                if (prevSlots && prevSlots[s]) masseuse = String(prevSlots[s].name || '').trim();
                if (!masseuse && Array.isArray(state.edits.roster)) {
                    masseuse = String(state.edits.roster[s] || '').trim();
                }
            }
            add({
                bid: snap.bid,
                tipSlot: snap.tipSlot || 1,
                masseuse: masseuse,
                pinned: true,
                past: !!snap.past,
                requested: !!snap.requested,
            });
        });
        return Array.from(map.values());
    }

    /** Drop auto-past locks; keep only pinned booking locks. */
    function keepOnlyPinnedLocks(editsRows) {
        const out = {};
        Object.keys(editsRows || {}).forEach((key) => {
            const snap = editsRows[key];
            if (!snap) return;
            if (snap.bid && snap.pinned === true) {
                out[lockKey(snap.bid, snap.tipSlot || 1)] = { ...snap, pinned: true };
            } else if (!snap.bid && /^\d+-\d+$/.test(key)) {
                out[key] = snap;
            }
        });
        return out;
    }

    /**
     * Changing masseuse order or +/- count: unlock everything (including past)
     * so the whole day redistributes by turn on the new roster.
     */
    function clearAssignmentLocksForRedistribute() {
        state.edits.rows = {};
        (state.slots || []).forEach((slot) => {
            (slot.rows || []).forEach((row) => {
                if (!row) return;
                row._pinned = false;
                row._pastLock = false;
            });
        });
    }

    /**
     * Rule 15: save manual NM pins only.
     * Auto rows (even past) recalculate on Load so turn stays correct after edits.
     */
    function persistFullSheet() {
        if (!state.date || !state.slots.length) {
            saveEdits();
            scheduleDiskSave();
            return;
        }
        const rows = {};
        state.slots.forEach((slot) => {
            const masseuse = String((slot && slot.name) || '').trim();
            (slot.rows || []).forEach((row) => {
                if (!row || !row._bid || !row._pinned) return;
                const key = lockKey(row._bid, row._tipSlot || 1);
                rows[key] = {
                    nm: row.nm || '',
                    rm: row.rm || '',
                    dur: row.dur || '',
                    price: row.price || '',
                    tip: row.tip || '',
                    note: row.note || '',
                    bid: String(row._bid),
                    tipSlot: row._tipSlot || 1,
                    masseuse: masseuse,
                    requested: !!row.requested,
                    pinned: true,
                    past: isPastAppointment(row),
                };
            });
        });
        Object.keys(state.edits.rows || {}).forEach((key) => {
            if (rows[key]) return;
            const snap = state.edits.rows[key];
            if (snap && !snap.bid && /^\d+-\d+$/.test(key)) rows[key] = snap;
        });
        state.edits.rows = rows;
        saveEdits();
        scheduleDiskSave();
    }

    let diskSaveTimer = null;
    function scheduleDiskSave() {
        if (!state.date || !state.slots.length) return;
        if (diskSaveTimer) clearTimeout(diskSaveTimer);
        diskSaveTimer = setTimeout(() => {
            diskSaveTimer = null;
            void saveSheetToDisk();
        }, 700);
    }

    /** Rule 18: archive the visible day sheet under appt records/YYYY-MM-DD.json */
    async function saveSheetToDisk() {
        if (!state.date || !state.slots.length) return;
        const payload = {
            date: state.date,
            saved_at: new Date().toISOString(),
            slots: state.slots.map((slot) => ({
                name: slot.name || '',
                extra: !!slot.extra,
                rows: (slot.rows || []).map((row) => ({
                    nm: row.nm || '',
                    rm: row.rm || '',
                    dur: row.dur || '',
                    price: row.price || '',
                    tip: row.tip || '',
                    note: row.note || '',
                    bid: row._bid || '',
                    tipSlot: row._tipSlot || 1,
                    requested: !!row.requested,
                    xg: !!row._xg,
                    split: !!row._split,
                    timeBlocks: Array.isArray(row._timeBlocks) ? row._timeBlocks.slice() : [],
                    splitWith: row._splitWith || '',
                })),
            })),
            edits: {
                names: state.edits.names || {},
                cells: state.edits.cells || {},
                rows: state.edits.rows || {},
                extraCount: state.edits.extraCount || 0,
                roster: state.edits.roster || null,
                rowCounts: collectRowCounts(),
                rowMeta: collectRowMeta(),
            },
        };
        try {
            const res = await fetch('/api/appt-records/' + encodeURIComponent(state.date), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                console.warn('Appt record save failed', err.detail || res.statusText);
            }
        } catch (e) {
            console.warn('Appt record save failed', e);
        }
    }

    function saveEdits() {
        if (!state.date) return;
        try {
            localStorage.setItem(
                storageKey(state.date),
                JSON.stringify({
                    names: state.edits.names,
                    cells: state.edits.cells,
                    rows: state.edits.rows || {},
                    extraCount: state.edits.extraCount || 0,
                    roster: state.edits.roster || null,
                    rowCounts: collectRowCounts(),
                    rowMeta: collectRowMeta(),
                    savedAt: new Date().toISOString(),
                })
            );
        } catch (e) {
            console.warn('MSS save failed', e);
        }
    }

    function rowFromEvent(ev, tipSlot) {
        if (!ev) {
            return {
                nm: '',
                rm: '',
                dur: '',
                price: '',
                tip: '',
                note: '',
                requested: false,
                skillWarn: false,
                _bid: '',
                _tipSlot: tipSlot || 1,
            };
        }
        const start = parseIso(ev.start_at);
        const end = parseIso(ev.display_end_at || ev.end_at);
        return {
            nm: customerShort(ev.customer),
            rm: roomLabel(ev),
            dur: formatDurCol(ev),
            price: priceDurationLabel(ev),
            tip: tipLabel(ev, tipSlot || 1),
            note: noteFromEvent(ev),
            requested: !isAnyAvailableForSheet(ev),
            skillWarn: false,
            future: start && start.getTime() > Date.now(),
            _start: start,
            _end: end,
            _bid: ev.booking_id,
            _tipSlot: tipSlot || 1,
        };
    }

    function cloneRow(row) {
        return {
            nm: row.nm || '',
            rm: row.rm || '',
            dur: row.dur || '',
            price: row.price || '',
            tip: row.tip || '',
            note: row.note || '',
            requested: !!row.requested,
            skillWarn: !!row.skillWarn,
            future: !!row.future,
            empty: !!row.empty,
            _start: row._start,
            _end: row._end,
            _bid: row._bid || '',
            _tipSlot: row._tipSlot || 1,
            _nmEdited: row._nmEdited,
            _rmEdited: row._rmEdited,
            _durEdited: row._durEdited,
            _priceEdited: row._priceEdited,
            _tipEdited: row._tipEdited,
            _noteEdited: row._noteEdited,
            _xg: !!row._xg,
            _split: !!row._split,
            _timeBlocks: Array.isArray(row._timeBlocks) ? row._timeBlocks.slice() : [],
            _splitWith: row._splitWith || '',
            _pinned: !!row._pinned,
        };
    }

    function emptyRow() {
        return {
            nm: '',
            rm: '',
            dur: '',
            price: '',
            tip: '',
            note: '',
            requested: false,
            skillWarn: false,
            future: false,
            empty: true,
            _bid: '',
            _tipSlot: 1,
        };
    }

    function findSheetRowByBid(bid, tipSlot) {
        if (!bid) return null;
        const wantTip = tipSlot != null ? tipSlot || 1 : null;
        for (let s = 0; s < state.slots.length; s++) {
            for (let r = 0; r < (state.slots[s].rows || []).length; r++) {
                const row = state.slots[s].rows[r];
                if (!row || String(row._bid) !== String(bid)) continue;
                if (wantTip != null && (row._tipSlot || 1) !== wantTip) continue;
                return { slotIdx: s, rowIdx: r, row };
            }
        }
        return null;
    }

    function clearBidFromSheet(bid, tipSlot, exceptSlotIdx, exceptRowIdx) {
        if (!bid) return;
        const wantTip = tipSlot || 1;
        for (let s = 0; s < state.slots.length; s++) {
            for (let r = 0; r < (state.slots[s].rows || []).length; r++) {
                if (s === exceptSlotIdx && r === exceptRowIdx) continue;
                const row = state.slots[s].rows[r];
                if (!row || String(row._bid) !== String(bid)) continue;
                if ((row._tipSlot || 1) !== wantTip) continue;
                state.slots[s].rows[r] = emptyRow();
                clearCellEditsForRow(s, r);
                delete (state.edits.rows || {})[lockKey(bid, wantTip)];
                delete (state.edits.rows || {})[s + '-' + r];
            }
        }
    }

    /** Remove duplicate booking rows (same bid+tip) — keep first occurrence. */
    function dedupeBidsOnSlots(slots) {
        const seen = new Set();
        for (const slot of slots || []) {
            (slot.rows || []).forEach((row, r) => {
                if (!row || !row._bid) return;
                const k = lockKey(row._bid, row._tipSlot || 1);
                if (seen.has(k)) {
                    slot.rows[r] = emptyRow();
                } else {
                    seen.add(k);
                }
            });
        }
        return slots;
    }

    /** Legacy index snapshots only (bid locks are applied inside buildSheetAssignments). */
    function applyRowSnapshots(slots) {
        const snaps = state.edits.rows || {};
        Object.keys(snaps).forEach((key) => {
            if (!/^\d+-\d+$/.test(key)) return;
            const snap = snaps[key];
            if (!snap || snap.bid) return; /* bid locks handled in build */
            const parts = key.split('-');
            const s = parseInt(parts[0], 10);
            const r = parseInt(parts[1], 10);
            if (!Number.isFinite(s) || !Number.isFinite(r) || !slots[s]) return;
            while (slots[s].rows.length <= r) slots[s].rows.push(emptyRow());
            slots[s].rows[r] = {
                ...emptyRow(),
                nm: snap.nm || '',
                rm: snap.rm || '',
                dur: snap.dur || '',
                price: snap.price || '',
                tip: snap.tip || '',
                note: snap.note || '',
                empty: !snap.nm,
                _pinned: true,
            };
        });
        return dedupeBidsOnSlots(slots);
    }

    function clearCellEditsForRow(slotIdx, rowIdx) {
        for (const field of ['nm', 'rm', 'dur', 'price', 'tip', 'note']) {
            delete state.edits.cells[cellKey(slotIdx, rowIdx, field)];
        }
    }

    function hidePickerModal() {
        const modal = document.getElementById('mssPickerModal');
        if (modal) modal.hidden = true;
        state.picker = { slotIdx: -1, rowIdx: -1, selectedBid: '' };
        const detailsBtn = document.getElementById('mssPickerDetailsBtn');
        if (detailsBtn) detailsBtn.hidden = true;
    }

    function dayEventsSorted() {
        const events = ((window._mssData && window._mssData.events) || []).slice();
        events.sort((a, b) => {
            const as = parseIso(a.start_at);
            const bs = parseIso(b.start_at);
            return (as ? as.getTime() : 0) - (bs ? bs.getTime() : 0);
        });
        return events;
    }

    function sheetMasseuseForBid(bid) {
        if (!bid) return '';
        for (let s = 0; s < state.slots.length; s++) {
            const name = firstName(state.slots[s].name) || '#' + (s + 1);
            for (const row of state.slots[s].rows || []) {
                if (row && String(row._bid) === String(bid) && !row._xg) return name;
            }
        }
        return '';
    }

    function renderPickerList(filterText) {
        const list = document.getElementById('mssPickerList');
        if (!list) return;
        const q = String(filterText || '')
            .trim()
            .toLowerCase();
        const { slotIdx, rowIdx } = state.picker;
        const currentBid =
            slotIdx >= 0 && state.slots[slotIdx] && state.slots[slotIdx].rows[rowIdx]
                ? String(state.slots[slotIdx].rows[rowIdx]._bid || '')
                : '';
        list.innerHTML = '';
        let shown = 0;
        for (const ev of dayEventsSorted()) {
            const nm = customerShort(ev.customer) || ev.customer || '(no name)';
            const onSheet = sheetMasseuseForBid(ev.booking_id);
            const meta =
                (formatDurCol(ev) || formatTimeRange(ev) || '') +
                (roomLabel(ev) ? ' · Rm ' + roomLabel(ev) : '') +
                (priceDurationLabel(ev) ? ' · ' + priceDurationLabel(ev) + 'm' : '') +
                (onSheet ? ' · now: ' + onSheet : '');
            const hay = (
                nm +
                ' ' +
                (ev.customer || '') +
                ' ' +
                meta +
                ' ' +
                (ev.room || '') +
                ' ' +
                onSheet
            ).toLowerCase();
            if (q && hay.indexOf(q) === -1) continue;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mss-picker-item';
            if (String(ev.booking_id) === currentBid) btn.classList.add('current');
            btn.innerHTML =
                '<span>' +
                escapeHtml(nm) +
                '</span><span class="mss-picker-meta">' +
                escapeHtml(meta) +
                '</span>';
            btn.addEventListener('click', () => {
                state.picker.selectedBid = String(ev.booking_id || '');
                const detailsBtn = document.getElementById('mssPickerDetailsBtn');
                if (detailsBtn) detailsBtn.hidden = !state.picker.selectedBid;
                assignCustomerToRow(ev.booking_id);
            });
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showDetailModal(ev.booking_id);
            });
            list.appendChild(btn);
            shown++;
        }
        if (!shown) {
            const empty = document.createElement('div');
            empty.className = 'mss-picker-item';
            empty.style.cursor = 'default';
            empty.textContent = q ? 'No matches' : 'No appointments for this day';
            list.appendChild(empty);
        }
    }

    function openPicker(slotIdx, rowIdx) {
        state.picker = { slotIdx, rowIdx, selectedBid: '' };
        const modal = document.getElementById('mssPickerModal');
        const title = document.getElementById('mssPickerTitle');
        const search = document.getElementById('mssPickerSearch');
        const detailsBtn = document.getElementById('mssPickerDetailsBtn');
        const slot = state.slots[slotIdx];
        const row = slot && slot.rows[rowIdx];
        const masseuse = firstName(slot && slot.name) || 'this masseuse';
        if (title) {
            title.textContent =
                'Choose customer · #' +
                (slotIdx + 1) +
                ' ' +
                masseuse +
                ' · row ' +
                (rowIdx + 1);
        }
        if (detailsBtn) {
            detailsBtn.hidden = !(row && row._bid);
            state.picker.selectedBid = row && row._bid ? String(row._bid) : '';
        }
        if (search) search.value = '';
        renderPickerList('');
        if (modal) modal.hidden = false;
        if (search) setTimeout(() => search.focus(), 30);
    }

    function rowIsBusyAt(row, start, end) {
        if (!row || !row._start || !row._end || !start || !end) return false;
        if (!row.nm && !row._bid) return false;
        return rangesOverlap(start, end, row._start, row._end);
    }

    function slotBusyAt(slotIdx, start, end) {
        const slot = state.slots[slotIdx];
        if (!slot) return true;
        return (slot.rows || []).some((r) => rowIsBusyAt(r, start, end));
    }

    function slotFilledCount(slotIdx) {
        const slot = state.slots[slotIdx];
        if (!slot) return 0;
        return (slot.rows || []).filter((r) => r && (r.nm || r._bid)).length;
    }

    /** Rule 11: place displaced customer A on masseuse with fewest customers who is free then. */
    function placeDisplacedOnLeastBusy(displaced, excludeSlotIdx) {
        if (!displaced || (!displaced._bid && !displaced.nm)) return -1;
        const start = displaced._start;
        const end = displaced._end;
        let best = -1;
        let bestCount = Infinity;
        for (let i = 0; i < state.slots.length; i++) {
            if (i === excludeSlotIdx) continue;
            const name = (state.slots[i].name || '').trim();
            const hasEditName = state.edits.names[String(i)] != null && String(state.edits.names[String(i)]).trim();
            if (!name && !hasEditName && !state.slots[i].extra) continue;
            if (start && end && slotBusyAt(i, start, end)) continue;
            const c = slotFilledCount(i);
            if (c < bestCount) {
                bestCount = c;
                best = i;
            }
        }
        if (best < 0) {
            setStatus('No free masseuse for displaced ' + (displaced.nm || 'customer'), true);
            return -1;
        }
        const rows = state.slots[best].rows;
        let dest = rows.findIndex((r) => !r.nm && !r._bid);
        if (dest < 0) dest = Math.min(rows.length - 1, Math.max(rows.length - 1, 0));
        rows[dest] = { ...cloneRow(displaced), _pinned: true, empty: false };
        clearCellEditsForRow(best, dest);
        return best;
    }

    /**
     * Checkbox lock: keep this customer on this masseuse; turn will not move them.
     * Unlock → remove pin and redistribute.
     */
    function setRowLock(slotIdx, rowIdx, locked) {
        const slot = state.slots[slotIdx];
        if (!slot) return;
        const row = slot.rows[rowIdx];
        if (!row || !row._bid) {
            setStatus('Empty row — nothing to lock', true);
            return;
        }
        const tipSlot = row._tipSlot || 1;
        const key = lockKey(row._bid, tipSlot);
        const nm = row.nm || 'customer';
        const who = firstName(slot.name) || '#' + (slotIdx + 1);

        if (locked) {
            row._pinned = true;
            state.edits.rows = keepOnlyPinnedLocks(state.edits.rows || {});
            state.edits.rows[key] = {
                nm: row.nm || '',
                rm: row.rm || '',
                dur: row.dur || '',
                price: row.price || '',
                tip: row.tip || '',
                note: row.note || '',
                bid: String(row._bid),
                tipSlot: tipSlot,
                masseuse: String(slot.name || '').trim(),
                requested: !!row.requested,
                pinned: true,
                past: isPastAppointment(row),
            };
            /* Lock only this seat — do not wipe/redistribute others (that moved Jude etc.) */
            persistFullSheet();
            renderSheet();
            setStatus('Locked ' + nm + ' on ' + who + ' · others stay put');
            return;
        }

        row._pinned = false;
        if (state.edits.rows) delete state.edits.rows[key];
        persistFullSheet();
        setStatus('Unlocked ' + nm + ' · redistributing by turn…');
        void loadSheet();
    }

    /**
     * Rule 16: put customer B on this NM cell (pinned to this masseuse).
     * Only moves B (+ whoever was on this row). Does NOT wipe the whole sheet /
     * redistribute Jude & others (that was scrambling same-time 2pm picks).
     */
    function assignCustomerToRow(bid) {
        const { slotIdx, rowIdx } = state.picker;
        if (slotIdx < 0 || rowIdx < 0 || !state.slots[slotIdx]) return;
        const ev = findEventById(bid);
        if (!ev) {
            setStatus('Appointment not found', true);
            return;
        }
        const tipSlot =
            (state.slots[slotIdx].rows[rowIdx] && state.slots[slotIdx].rows[rowIdx]._tipSlot) || 1;
        const incoming = rowFromEvent(ev, tipSlot);
        incoming.skillWarn = false;
        const displaced = cloneRow(state.slots[slotIdx].rows[rowIdx] || emptyRow());
        const displacing =
            !!(displaced._bid || displaced.nm) && String(displaced._bid || '') !== String(bid);

        /* Remove B from every other seat (same tip slot) before placing */
        clearBidFromSheet(bid, tipSlot, slotIdx, rowIdx);

        state.slots[slotIdx].rows[rowIdx] = {
            ...incoming,
            empty: false,
            _pinned: true,
            skillWarn: false,
        };
        clearCellEditsForRow(slotIdx, rowIdx);

        const who = firstName(state.slots[slotIdx].name) || '#' + (slotIdx + 1);
        let msg = 'Assigned ' + (incoming.nm || 'customer') + ' to ' + who;

        if (displacing) {
            delete (state.edits.rows || {})[lockKey(displaced._bid, displaced._tipSlot || 1)];
            const dest = placeDisplacedOnLeastBusy(displaced, slotIdx);
            if (dest >= 0) {
                const dRow = state.slots[dest].rows.find(
                    (r) => r && String(r._bid) === String(displaced._bid)
                );
                if (dRow) dRow._pinned = true;
                const dKey = lockKey(displaced._bid, displaced._tipSlot || 1);
                state.edits.rows = keepOnlyPinnedLocks(state.edits.rows || {});
                state.edits.rows[dKey] = {
                    nm: displaced.nm || '',
                    rm: displaced.rm || '',
                    dur: displaced.dur || '',
                    price: displaced.price || '',
                    tip: displaced.tip || '',
                    note: displaced.note || '',
                    bid: String(displaced._bid),
                    tipSlot: displaced._tipSlot || 1,
                    masseuse: String((state.slots[dest] && state.slots[dest].name) || '').trim(),
                    requested: !!displaced.requested,
                    pinned: true,
                    past: isPastAppointment(displaced),
                };
                msg +=
                    ' · moved ' +
                    (displaced.nm || 'customer') +
                    ' → ' +
                    (firstName(state.slots[dest].name) || '#' + (dest + 1));
            }
        }

        state.edits.rows = keepOnlyPinnedLocks(state.edits.rows || {});
        const pinKey = lockKey(bid, tipSlot);
        state.edits.rows[pinKey] = {
            nm: incoming.nm || '',
            rm: incoming.rm || '',
            dur: incoming.dur || '',
            price: incoming.price || '',
            tip: incoming.tip || '',
            note: incoming.note || '',
            bid: String(bid),
            tipSlot: tipSlot,
            masseuse: String((state.slots[slotIdx] && state.slots[slotIdx].name) || '').trim(),
            requested: !!incoming.requested,
            pinned: true,
            past: isPastAppointment(incoming),
        };

        persistFullSheet();
        hidePickerModal();
        renderSheet();
        setStatus(msg + ' · others unchanged');
    }

    function clearPickerRow() {
        const { slotIdx, rowIdx } = state.picker;
        if (slotIdx < 0 || rowIdx < 0 || !state.slots[slotIdx]) return;
        state.slots[slotIdx].rows[rowIdx] = { ...emptyRow(), _pinned: true };
        clearCellEditsForRow(slotIdx, rowIdx);
        persistFullSheet();
        hidePickerModal();
        renderSheet();
        setStatus('Cleared row ' + (rowIdx + 1));
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function firstName(full) {
        const s = String(full || '').trim();
        return s ? s.split(/\s+/)[0] : '';
    }

    function parseIso(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function durationMinutes(ev) {
        const s = parseIso(ev.start_at);
        const e = parseIso(ev.display_end_at || ev.end_at);
        if (!s || !e) return null;
        const m = Math.round((e - s) / 60000);
        return m > 0 ? m : null;
    }

    function priceDurationLabel(ev) {
        const m = durationMinutes(ev);
        if (m == null) return '';
        if (m >= 55 && m <= 65) return '60';
        if (m >= 85 && m <= 95) return '90';
        if (m >= 115 && m <= 125) return '120';
        if (m >= 145 && m <= 155) return '150';
        if (m >= 175 && m <= 185) return '180';
        return String(m);
    }

    function serviceSegmentText(ev) {
        return ((ev && ev.service_segments) || [])
            .map((s) => String((s && s.name) || ''))
            .filter(Boolean)
            .join(' ');
    }

    function eventBlob(ev) {
        return [
            ev.display_service,
            ev.service,
            serviceSegmentText(ev),
            ev.package_type,
            ev.addon_note,
            ev.seller_note,
            ev.customer_note,
        ]
            .map((x) => String(x || ''))
            .join(' ')
            .toLowerCase();
    }

    /**
     * Note: 3 senses, facial, cupping, other massage add-ons.
     * Exclude aromatherapy, scalp oil, pain relief oil, and 大套 / luxury / exclusive.
     */
    function noteFromEvent(ev) {
        const blob = eventBlob(ev);
        const tags = [];
        if (/\b3\s*senses\b/.test(blob) || /\bthree\s*senses\b/.test(blob) || /三感/.test(blob)) {
            tags.push('3 senses');
        }
        if (/\bfacial\b/.test(blob) || /面部/.test(blob) || /\blymphatic\b/.test(blob) || /淋巴/.test(blob)) {
            tags.push('facial');
        }
        if (/\bcupping\b/.test(blob) || /拔罐/.test(blob)) tags.push('cupping');
        if (/\bbian\s*stone\b/.test(blob) || /\bhot\s*stone\b/.test(blob) || /砭石/.test(blob)) {
            tags.push('stone');
        }
        if (/\btrigger\s*point\b/.test(blob)) tags.push('trigger');
        /* Explicitly do NOT add 大套 / luxury / exclusive / aromatherapy / scalp / pain relief */
        return tags.join(', ');
    }

    function needsFacialOrLymphatic(ev) {
        const blob = eventBlob(ev);
        return /\bfacial\b/.test(blob) || /面部/.test(blob) || /\blymphatic\b/.test(blob) || /淋巴/.test(blob);
    }

    function needsTriggerPoint(ev) {
        return /\btrigger\s*point\b/.test(eventBlob(ev));
    }

    function tipLabel(ev, tipSlot) {
        let tip = null;
        if (tipSlot === 2 && ev.tip_amount_2 != null) tip = ev.tip_amount_2;
        else if (ev.tip_amount != null) tip = ev.tip_amount;
        if (tip == null || tip === '') return '';
        const n = Number(tip);
        if (Number.isNaN(n)) return '';
        return n % 1 === 0 ? String(n) : n.toFixed(2);
    }

    function roomLabel(ev) {
        const r = String(ev.room || '').trim();
        if (!r || r === 'UNASSIGNED' || r === 'ADDON') return '';
        return r.replace(/^Rm\s*/i, '');
    }

    /** Rule 12: short name column — first name only on the sheet. */
    function customerShort(name) {
        const s = String(name || '').trim();
        if (!s) return '';
        return s.split(/\s+/)[0];
    }

    function findEventById(bid) {
        const events = (window._mssData && window._mssData.events) || [];
        return events.find((e) => String(e.booking_id) === String(bid)) || null;
    }

    function formatTimeRange(ev) {
        const s = parseIso(ev.start_at);
        const e = parseIso(ev.display_end_at || ev.end_at);
        if (!s || !e) return '';
        const fmt = (d) => {
            let h = d.getHours();
            const m = String(d.getMinutes()).padStart(2, '0');
            const ap = h >= 12 ? 'PM' : 'AM';
            h = h % 12 || 12;
            return h + ':' + m + ' ' + ap;
        };
        return fmt(s) + ' – ' + fmt(e);
    }

    /** Full start–end for Dur column (always includes minutes). */
    function formatDurCol(evOrStart, endMaybe) {
        let s;
        let e;
        if (evOrStart && typeof evOrStart === 'object' && !(evOrStart instanceof Date)) {
            s = parseIso(evOrStart.start_at);
            e = parseIso(evOrStart.display_end_at || evOrStart.end_at);
        } else {
            s = evOrStart instanceof Date ? evOrStart : null;
            e = endMaybe instanceof Date ? endMaybe : null;
        }
        if (!s || !e) return '';
        const fmt = (d) => {
            let h = d.getHours() % 12 || 12;
            const m = String(d.getMinutes()).padStart(2, '0');
            return h + ':' + m;
        };
        return fmt(s) + '-' + fmt(e);
    }

    /**
     * Detail "Requested":
     * - Square "Name (Booked with any available)" / original_any_available → not a request
     *   unless staff/customer notes mention masseuse names.
     * - Named Square booking (no any-available) → that masseuse is requested.
     * - Note mentions (seller_note / customer_note / addon_note) → those names.
     */
    function candidateMasseuseNamesForNotes() {
        const out = [];
        const push = (n) => {
            n = String(n || '').trim();
            if (!n) return;
            if (!out.some((x) => namesMatch(x, n))) out.push(n);
        };
        (state.slots || []).forEach((s) => push(s && s.name));
        const data = window._mssData || {};
        (data.therapists || []).forEach(push);
        (data.therapist_order || []).forEach((row) => push(row && row.therapist));
        []
            .concat(skills.facial || [])
            .concat(skills.trigger || [])
            .concat(skills.fireCupping || [])
            .concat(skills.manualOnly || [])
            .forEach(push);
        return out;
    }

    function namesMentionedInBookingNotes(ev) {
        if (!ev || staffNoteMeansTurnAny(ev)) return [];
        const text = [ev.seller_note, ev.customer_note, ev.addon_note]
            .filter(Boolean)
            .join(' ');
        if (!text) return [];
        const hits = [];
        for (const n of candidateMasseuseNamesForNotes()) {
            const first = String(n).trim().split(/\s+/)[0];
            if (first.length < 3) continue;
            const re = new RegExp(
                '\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b',
                'i'
            );
            const m = re.exec(text);
            if (m) hits.push({ name: firstName(n) || n, at: m.index });
        }
        hits.sort((a, b) => a.at - b.at);
        const uniq = [];
        hits.forEach((h) => {
            if (!uniq.some((u) => namesMatch(u, h.name))) uniq.push(h.name);
        });
        return uniq;
    }

    function requestedMasseuseLabel(ev) {
        if (!ev) return 'None';
        /* 正常轮 / 不找人 / 不着人 → no request */
        if (staffNoteMeansTurnAny(ev)) return 'None';

        const fromNotes = namesMentionedInBookingNotes(ev);
        if (fromNotes.length) return fromNotes.join(' · ');

        /* Square: "Sophia E (Booked with any available)" → None */
        if (ev.original_any_available === true || isAnyAvailableForSheet(ev)) {
            return 'None';
        }

        /* Named Square booking (no any-available) */
        const names = [ev.original_therapist, ev.therapist, ev.therapist_2]
            .map((n) => String(n || '').trim())
            .filter(Boolean)
            .filter((n) => !/staff/i.test(n));
        const uniq = [];
        names.forEach((n) => {
            const short = firstName(n) || n;
            if (!uniq.some((u) => namesMatch(u, short))) uniq.push(short);
        });
        return uniq.length ? uniq.join(' · ') : 'None';
    }

    function openRowDetail(slotIdx, rowIdx) {
        const modal = document.getElementById('mssDetailModal');
        const body = document.getElementById('mssDetailBody');
        const title = document.getElementById('mssDetailTitle');
        const applyBtn = document.getElementById('mssDetailApplyBtn');
        if (!modal || !body) return;
        const row = state.slots[slotIdx] && state.slots[slotIdx].rows[rowIdx];
        if (!row || !row._bid) {
            body.innerHTML = '<p>No appointment on this row.</p>';
            if (applyBtn) applyBtn.hidden = true;
            state.detail = { slotIdx: -1, rowIdx: -1, selectedKeys: [] };
            modal.hidden = false;
            return;
        }
        const ev = findEventById(row._bid);
        if (!ev) {
            body.innerHTML = '<p>No appointment details found.</p>';
            if (applyBtn) applyBtn.hidden = true;
            modal.hidden = false;
            return;
        }

        const blocks = apptTimeBlocks(ev);
        let selectedKeys =
            Array.isArray(row._timeBlocks) && row._timeBlocks.length
                ? row._timeBlocks.slice()
                : blocks.map((b) => b.key);
        state.detail = { slotIdx, rowIdx, selectedKeys };

        if (title) title.textContent = customerShort(ev.customer) || 'Appointment';
        if (applyBtn) applyBtn.hidden = !blocks.length;

        const svc = (ev.display_service || ev.service || '—').toString();
        const info = [
            ['Customer', ev.customer || '—'],
            ['Time', formatTimeRange(ev) || '—'],
            ['Service', svc],
            ['Requested', requestedMasseuseLabel(ev)],
            ['Room', roomLabel(ev) || ev.room || '—'],
            ['This card', state.slots[slotIdx].name || '—'],
        ];
        body.innerHTML = '';
        const dl = document.createElement('dl');
        info.forEach(([k, v]) => {
            const dt = document.createElement('dt');
            dt.textContent = k;
            const dd = document.createElement('dd');
            dd.textContent = String(v);
            dl.appendChild(dt);
            dl.appendChild(dd);
        });
        body.appendChild(dl);

        if (blocks.length) {
            const panel = buildDetailSplitBar(ev, blocks, selectedKeys, (keys) => {
                state.detail.selectedKeys = keys.slice();
            });
            body.appendChild(panel);
        }
        modal.hidden = false;
    }

    function showDetailModal(bid) {
        const found = findSheetRowByBid(bid, null);
        if (found) {
            openRowDetail(found.slotIdx, found.rowIdx);
            return;
        }
        const modal = document.getElementById('mssDetailModal');
        const body = document.getElementById('mssDetailBody');
        const title = document.getElementById('mssDetailTitle');
        const applyBtn = document.getElementById('mssDetailApplyBtn');
        if (!modal || !body) return;
        if (applyBtn) applyBtn.hidden = true;
        state.detail = { slotIdx: -1, rowIdx: -1, selectedKeys: [] };
        const ev = findEventById(bid);
        if (!ev) {
            body.innerHTML = '<p>No appointment details found.</p>';
            modal.hidden = false;
            return;
        }
        if (title) title.textContent = customerShort(ev.customer) || 'Appointment';
        body.innerHTML =
            '<dl>' +
            [
                ['Customer', ev.customer || '—'],
                ['Time', formatTimeRange(ev) || '—'],
                ['Service', (ev.display_service || ev.service || '—').toString()],
                ['Requested', requestedMasseuseLabel(ev)],
            ]
                .map(
                    ([k, v]) =>
                        '<dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(String(v)) + '</dd>'
                )
                .join('') +
            '</dl>';
        modal.hidden = false;
    }

    function hideDetailModal() {
        const modal = document.getElementById('mssDetailModal');
        if (modal) modal.hidden = true;
        state.detail = { slotIdx: -1, rowIdx: -1, selectedKeys: [] };
    }

    function applyDetailSplit() {
        const { slotIdx, rowIdx, selectedKeys } = state.detail || {};
        if (slotIdx < 0 || rowIdx < 0) {
            hideDetailModal();
            return;
        }
        const row = state.slots[slotIdx] && state.slots[slotIdx].rows[rowIdx];
        if (!row || !row._bid) {
            hideDetailModal();
            return;
        }
        const keys = Array.isArray(selectedKeys) ? selectedKeys.slice() : [];
        if (!keys.length) {
            setStatus('Select at least one 15‑min block for this masseuse', true);
            return;
        }
        commitSplitSelection(slotIdx, rowIdx, keys);
        hideDetailModal();
        renderSheet();
        setStatus('Split applied — duration updated' + (row._splitWith ? ' · w/ ' + row._splitWith : ''));
    }

    async function pushTipToCalendar(slotIdx, rowIdx, tipStr) {
        const row = state.slots[slotIdx] && state.slots[slotIdx].rows[rowIdx];
        if (!row || !row._bid || !state.date) return;
        const trimmed = String(tipStr || '').trim();
        let amount = trimmed === '' ? 0 : parseFloat(trimmed);
        if (Number.isNaN(amount)) {
            setStatus('Tip must be a number', true);
            return;
        }
        const ev = findEventById(row._bid);
        const tipSlot = row._tipSlot || 1;
        const body = {
            booking_id: row._bid,
            date: state.date,
            tip_amount:
                tipSlot === 2
                    ? ev && ev.tip_amount != null
                        ? Number(ev.tip_amount)
                        : amount
                    : amount,
        };
        if (tipSlot === 2) body.tip_amount_2 = amount;
        else if (ev && String(ev.type || '').toLowerCase() === 'couple' && ev.tip_amount_2 != null) {
            body.tip_amount_2 = Number(ev.tip_amount_2);
        }
        try {
            const res = await fetch('/api/tip', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || res.statusText || 'Tip save failed');
            }
            if (ev) {
                if (tipSlot === 2) ev.tip_amount_2 = amount;
                else ev.tip_amount = amount;
            }
            setStatus('Tip saved to calendar for ' + (row.nm || 'appointment'));
        } catch (e) {
            setStatus('Tip sync error: ' + (e.message || e), true);
        }
    }

    let nameRebuildTimer = null;
    function scheduleRebuildAfterNameChange() {
        if (nameRebuildTimer) clearTimeout(nameRebuildTimer);
        nameRebuildTimer = setTimeout(() => {
            nameRebuildTimer = null;
            /* Order change: past must not stay locked */
            clearAssignmentLocksForRedistribute();
            persistFullSheet();
            loadSheet();
        }, 550);
    }

    /** True if first names differ by at most one character (Casey ↔ Cassey). */
    function firstNamesNearlyEqual(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        if (Math.abs(a.length - b.length) > 1) return false;
        let i = 0;
        let j = 0;
        let diffs = 0;
        while (i < a.length && j < b.length) {
            if (a[i] === b[j]) {
                i++;
                j++;
                continue;
            }
            diffs++;
            if (diffs > 1) return false;
            if (a.length > b.length) i++;
            else if (b.length > a.length) j++;
            else {
                i++;
                j++;
            }
        }
        diffs += a.length - i + (b.length - j);
        return diffs <= 1;
    }

    function namesMatch(a, b) {
        const x = String(a || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
        const y = String(b || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
        if (!x || !y) return false;
        if (x === y) return true;
        const fa = x.split(' ')[0];
        const fb = y.split(' ')[0];
        if (fa.length >= 3 && fa === fb) return true;
        /* Casey / Cassey and similar roster spelling variants */
        if (fa.length >= 4 && fb.length >= 4 && firstNamesNearlyEqual(fa, fb)) return true;
        return false;
    }

    function nameInList(name, list) {
        return list.some((n) => namesMatch(name, n));
    }

    function rangesOverlap(aStart, aEnd, bStart, bEnd) {
        return aStart < bEnd && bStart < aEnd;
    }

    function isSheetEvent(ev) {
        return !!(ev && String(ev.room || '') !== 'ADDON');
    }

    /**
     * Staff note 「正常轮」「不找人」(also 「不着人」) = 不着人 → turn, not request.
     * Matches backend _staff_note_means_turn_any_available.
     */
    function staffNoteMeansTurnAny(ev) {
        const text = [ev && ev.seller_note, ev && ev.customer_note, ev && ev.addon_note]
            .filter(Boolean)
            .join(' ');
        if (!text) return false;
        if (
            text.indexOf('正常轮') >= 0 ||
            text.indexOf('不着人') >= 0 ||
            text.indexOf('不找人') >= 0
        ) {
            return true;
        }
        const low = text.toLowerCase();
        if (/\bnormal\s*turn\b/.test(low)) return true;
        if (/\bany\s*available\b/.test(low) || /\banyone\b/.test(low)) return true;
        if (/\bno\s*request\b/.test(low) || /\bnot\s*requested\b/.test(low)) return true;
        return false;
    }

    /**
     * True → turn. False → named request.
     * Rule: guest booked a masseuse = request UNLESS staff note says 正常轮/不找人.
     */
    function isAnyAvailableForSheet(ev) {
        if (!ev) return false;
        if (staffNoteMeansTurnAny(ev)) return true;
        return ev.original_any_available === true;
    }

    /** Rule 23: keep first occurrence of each masseuse name; drop later duplicates. */
    function dedupeRosterNames(list) {
        const out = [];
        for (const raw of list || []) {
            const n = String(raw || '').trim();
            if (!n) {
                out.push('');
                continue;
            }
            if (out.some((x) => x && namesMatch(x, n))) continue;
            out.push(n);
        }
        return out;
    }

    function calendarRosterNames(data) {
        const order = Array.isArray(data.therapist_order) ? data.therapist_order.slice() : [];
        order.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const names = [];
        function push(n) {
            n = String(n || '').trim();
            if (!n) return;
            if (names.some((x) => namesMatch(x, n))) return;
            names.push(n);
        }
        /* Prefer working order only — do not pad with every Square team member */
        for (const row of order) push(row && row.therapist);
        if (!names.length) {
            for (const t of data.therapists || []) push(t);
        }
        /* If still empty, derive from today's events */
        if (!names.length) {
            for (const ev of data.events || []) {
                push(ev.therapist);
                push(ev.therapist_2);
            }
        }
        return names;
    }

    function syncRosterFromSlots() {
        state.edits.roster = (state.slots || []).map((s, i) => {
            const edit = state.edits.names[String(i)];
            if (edit != null) return String(edit).trim();
            return String((s && s.name) || '').trim();
        });
    }

    function nameTakenOnSheet(name, exceptSlotIdx) {
        return findSlotIndexWithName(name, exceptSlotIdx) >= 0;
    }

    /** Index of another card with this masseuse name, or -1. */
    function findSlotIndexWithName(name, exceptSlotIdx) {
        const n = String(name || '').trim();
        if (!n) return -1;
        for (let i = 0; i < state.slots.length; i++) {
            if (i === exceptSlotIdx) continue;
            const edit = state.edits.names[String(i)];
            const other =
                edit != null ? String(edit).trim() : String((state.slots[i] && state.slots[i].name) || '').trim();
            if (other && namesMatch(n, other)) return i;
        }
        return -1;
    }

    /**
     * Set slot to `nextName`. If that name is already on another card, swap the two.
     * Never leaves duplicate masseuse names on the sheet.
     */
    function applyMasseuseNameWithSwap(slotIdx, nextName) {
        const next = String(nextName || '').trim();
        syncRosterFromSlots();
        const roster = (state.edits.roster || []).slice();
        while (roster.length <= slotIdx) roster.push('');
        const prev = String(roster[slotIdx] || '').trim();
        if (!next) {
            roster[slotIdx] = '';
            commitRoster(roster);
            clearAssignmentLocksForRedistribute();
            return { swapped: false, prev: prev, next: '' };
        }
        if (namesMatch(prev, next)) {
            commitRoster(roster);
            return { swapped: false, prev: prev, next: next };
        }
        /* Roster order changed (swap or replace) — unlock past + pins for full turn redistribute */
        clearAssignmentLocksForRedistribute();
        const otherIdx = findSlotIndexWithName(next, slotIdx);
        roster[slotIdx] = next;
        if (otherIdx >= 0) {
            while (roster.length <= otherIdx) roster.push('');
            roster[otherIdx] = prev;
            commitRoster(roster);
            return { swapped: true, prev: prev, next: next, otherIdx: otherIdx };
        }
        commitRoster(roster);
        return { swapped: false, prev: prev, next: next };
    }

    /**
     * Merge per-slot name picks into a flat list, then drop duplicates.
     * Names on the sheet are the assign roster — never relabel cards after assign.
     */
    function mergeNamesOntoRoster(baseNames, edits) {
        const names = (baseNames || []).map((n) => String(n || '').trim());
        const nameMap = edits && edits.names ? edits.names : {};
        const idxs = Object.keys(nameMap)
            .map((k) => parseInt(k, 10))
            .filter((i) => Number.isFinite(i) && i >= 0);
        const maxIdx = idxs.length ? Math.max.apply(null, idxs) : -1;
        while (names.length <= maxIdx) names.push('');
        for (let i = 0; i < names.length; i++) {
            if (nameMap[String(i)] != null) {
                names[i] = String(nameMap[String(i)]).trim();
            }
        }
        return dedupeRosterNames(names);
    }

    /**
     * First open of a day (no saved roster yet):
     * Mon–Thu → 6 cards; Fri–Sun → 9 cards.
     * User then manually picks masseuse order on each card.
     */
    function defaultSlotCountForDate(dateStr) {
        const d = new Date((dateStr || getTodayLocal()) + 'T12:00:00');
        if (Number.isNaN(d.getTime())) return BASE_SLOTS_WEEKDAY;
        const day = d.getDay(); /* 0=Sun … 5=Fri 6=Sat */
        if (day === 0 || day === 5 || day === 6) return BASE_SLOTS_WEEKEND;
        return BASE_SLOTS_WEEKDAY;
    }

    /**
     * Commit final roster so assignment + display use the same names.
     * Clears edits.names (index remaps) which used to leave Jenny with 0 customers.
     * Trailing empty slots are kept (for + Masseuse).
     */
    function commitRoster(names) {
        const cleaned = dedupeRosterNames(names || []).slice();
        if (!cleaned.length) cleaned.push('');
        state.edits.roster = cleaned.slice();
        state.edits.names = {};
        state.baseCount = Math.max(1, cleaned.length);
        return cleaned;
    }

    /**
     * Rule 21: roster size = names you typed (or custom list after delete / name pick).
     * Rule 23: no duplicate names.
     * First open: Mon–Thu 6 empty cards / Fri–Sun 9. Calendar does not fill names.
     */
    function orderedRoster(data, extraCount) {
        const edits = state.edits || {};
        let names;

        if (Array.isArray(edits.roster) && edits.roster.length > 0) {
            names = mergeNamesOntoRoster(edits.roster, edits);
            return commitRoster(names);
        }

        const defaultN = defaultSlotCountForDate(state.date || getTodayLocal());
        names = Array.from({ length: defaultN }, () => '');
        const total = defaultN + Math.max(0, extraCount || 0);
        names = mergeNamesOntoRoster(names, edits);
        while (names.length < total) names.push('');
        return commitRoster(names.slice(0, Math.max(total, names.length)));
    }

    function requestMap(data) {
        const map = new Map();
        const items = (data.customer_requests_summary && data.customer_requests_summary.items) || [];
        const events = data.events || [];
        for (const it of items) {
            const req = String((it && it.requested_masseuse) || '').trim();
            if (!req) continue;
            let bid = String((it && it.booking_id) || '').trim();
            if (!bid) {
                const cust = String((it && it.customer) || '').trim().toLowerCase();
                const start = String((it && it.start_at) || '');
                const hit = events.find(
                    (e) =>
                        String(e.customer || '')
                            .trim()
                            .toLowerCase() === cust && String(e.start_at || '') === start
                );
                bid = hit ? String(hit.booking_id || '') : '';
            }
            if (!bid) continue;
            if (!map.has(bid)) map.set(bid, []);
            map.get(bid).push(req);
        }
        return map;
    }

    function buildSheetAssignments(data, extraCount, lockList) {
        const roster = orderedRoster(data, extraCount);
        const baseCount = state.baseCount || BASE_SLOTS_MAX;
        const slots = roster.map((name, idx) => ({
            name,
            rows: [],
            xgJobs: [],
            extra: idx >= baseCount,
        }));
        const reqByBid = requestMap(data);
        const slotCount = slots.length;
        const assigned = new Set(); /* bid#tipSlot already placed (locks / assigns) */

        const events = (data.events || [])
            .filter(isSheetEvent)
            .slice()
            .sort((a, b) => {
                const c = String(a.start_at || '').localeCompare(String(b.start_at || ''));
                if (c !== 0) return c;
                /* Same start: requests before turn (“着人先分，再轮”) */
                const ra = isAnyAvailableForSheet(a) ? 1 : 0;
                const rb = isAnyAvailableForSheet(b) ? 1 : 0;
                if (ra !== rb) return ra - rb;
                return String(a.booking_id || '').localeCompare(String(b.booking_id || ''));
            });
        const eventsByBid = new Map();
        for (const ev of events) {
            if (ev && ev.booking_id) eventsByBid.set(String(ev.booking_id), ev);
        }

        function busyAt(slotIdx, start, end) {
            return slots[slotIdx].rows.some((r) => rangesOverlap(start, end, r._start, r._end));
        }
        function countSoFar(slotIdx) {
            /* 小工不算工 — do not count toward turn fairness */
            return slots[slotIdx].rows.filter((r) => r && !r._xg && (r.nm || r._bid)).length;
        }
        function findRosterIndex(name) {
            if (!name) return -1;
            for (let i = 0; i < slotCount; i++) {
                if (roster[i] && namesMatch(roster[i], name)) return i;
            }
            return -1;
        }
        function findPreferredSkillIndexes(ev) {
            if (needsFacialOrLymphatic(ev)) {
                return (skills.facial || []).map(findRosterIndex).filter((i) => i >= 0);
            }
            if (needsTriggerPoint(ev)) {
                return (skills.trigger || []).map(findRosterIndex).filter((i) => i >= 0);
            }
            return null;
        }

        function pushRow(slotIdx, ev, tipSlot, requested, skillWarn, overrides) {
            if (slotIdx < 0 || slotIdx >= slotCount) return;
            const start = (overrides && overrides.start) || parseIso(ev.start_at);
            const end = (overrides && overrides.end) || parseIso(ev.display_end_at || ev.end_at);
            if (!start || !end) return;
            const now = Date.now();
            const k = lockKey(ev.booking_id, tipSlot);
            if (assigned.has(k)) return;
            slots[slotIdx].rows.push({
                nm: customerShort(ev.customer),
                rm: roomLabel(ev),
                dur: overrides && overrides.dur != null ? overrides.dur : formatDurCol(start, end),
                price:
                    overrides && overrides.price != null
                        ? overrides.price
                        : priceDurationLabel(ev),
                tip: tipLabel(ev, tipSlot),
                note: overrides && overrides.note != null ? overrides.note : noteFromEvent(ev),
                requested: !!requested,
                skillWarn: !!skillWarn,
                future: start.getTime() > now,
                _start: start,
                _end: end,
                _bid: ev.booking_id,
                _tipSlot: tipSlot,
                _pinned: !!(overrides && overrides.pinned),
                _pastLock: !!(overrides && overrides.pastLock),
            });
            assigned.add(k);
        }

        let turn = 0;

        /* Place manual pins + past distribution first (no skill-warn red box) */
        for (const lock of lockList || []) {
            const tipSlot = lock.tipSlot || 1;
            /* 小工 / split-partner tips must never freeze turn (was scrambling distribution) */
            if (tipSlot >= 20 || tipSlot === SPLIT_XG_TIP) continue;
            const idx = findRosterIndex(lock.masseuse);
            if (idx < 0) continue;
            const ev = eventsByBid.get(String(lock.bid));
            if (!ev) continue;
            const k = lockKey(lock.bid, tipSlot);
            if (assigned.has(k)) continue;
            pushRow(idx, ev, tipSlot, !!lock.requested, false, {
                pinned: !!lock.pinned,
                pastLock: !!lock.past,
            });
            /* Manual / checkbox pins still advance turn so remaining turns stay fair */
            if (lock.pinned && !lock.past) turn = (idx + 1) % Math.max(slotCount, 1);
        }

        /**
         * 小工 as a normal bottom row (same NM/RM/Dur/Price/Tip/Note).
         * Does not count as turn (already assigned separately).
         */
        function addXgJob(slotIdx, kind, ev, tipSlot) {
            if (slotIdx < 0 || slotIdx >= slotCount || !ev) return;
            const start = parseIso(ev.start_at);
            const end = parseIso(ev.display_end_at || ev.end_at);
            if (!start || !end) return;
            let segStart = start;
            let segEnd = end;
            const k = String(kind || '').trim() || '小工';
            if (k === '小脸' || /facial|脸/.test(k)) {
                segStart = new Date(end.getTime() - 30 * 60000);
                segEnd = end;
            }
            const xgTip =
                20 +
                slots.reduce(
                    (n, s) => n + (s.rows || []).filter((r) => r && r._xg).length,
                    0
                );
            if (assigned.has(lockKey(ev.booking_id, xgTip))) return;
            pushRow(slotIdx, ev, xgTip, false, false, {
                start: segStart,
                end: segEnd,
                dur: formatDurCol(segStart, segEnd),
                price: k === '小脸' || /facial|脸/.test(k) ? '30' : '',
                note: k,
            });
            const rows = slots[slotIdx].rows;
            const last = rows[rows.length - 1];
            if (last && String(last._bid) === String(ev.booking_id)) {
                last._xg = true;
                last.note = k;
            }
        }

        function inAutoPool(i) {
            if (!roster[i]) return false;
            /* Rule 24: Lynn / part-time — manual NM only, skip auto distribute */
            if (isManualOnlyName(roster[i])) return false;
            return true;
        }

        /**
         * @param windowOpt optional { start, end, dur, price, note }
         * @param opts optional { ignoreSkills: true } — massage leg of facial packages
         */
        function assignOne(ev, preferredName, tipSlot, forceRequest, windowOpt, opts) {
            if (assigned.has(lockKey(ev.booking_id, tipSlot))) return -1;
            const start =
                (windowOpt && windowOpt.start) || parseIso(ev.start_at);
            const end =
                (windowOpt && windowOpt.end) ||
                parseIso(ev.display_end_at || ev.end_at);
            if (!start || !end) return -1;
            const rowOv = windowOpt
                ? {
                      start: start,
                      end: end,
                      dur:
                          windowOpt.dur != null
                              ? windowOpt.dur
                              : formatDurCol(start, end),
                      price: windowOpt.price,
                      note: windowOpt.note,
                  }
                : null;

            const skillIdxs =
                opts && opts.ignoreSkills ? null : findPreferredSkillIndexes(ev);

            if (forceRequest) {
                let idx = findRosterIndex(preferredName);
                if (idx >= 0) {
                    /* Rule 9/10: named request cannot override facial / trigger skill */
                    const lacksSkill =
                        skillIdxs && skillIdxs.length && skillIdxs.indexOf(idx) < 0;
                    if (!lacksSkill && !busyAt(idx, start, end)) {
                        const warn =
                            (needsFacialOrLymphatic(ev) &&
                                !(opts && opts.ignoreSkills) &&
                                !nameInList(roster[idx], skills.facial || [])) ||
                            (needsTriggerPoint(ev) &&
                                !nameInList(roster[idx], skills.trigger || []));
                        pushRow(idx, ev, tipSlot, true, warn, rowOv);
                        turn = (idx + 1) % Math.max(slotCount, 1);
                        return idx;
                    }
                }
            }

            let pool = [];
            for (let i = 0; i < slotCount; i++) {
                if (!inAutoPool(i)) continue;
                if (busyAt(i, start, end)) continue;
                if (skillIdxs && skillIdxs.length && skillIdxs.indexOf(i) < 0) continue;
                pool.push(i);
            }
            if (!pool.length) {
                for (let i = 0; i < slotCount; i++) {
                    if (!inAutoPool(i)) continue;
                    if (busyAt(i, start, end)) continue;
                    pool.push(i);
                }
            }

            if (!forceRequest) preferredName = '';

            if (!pool.length) {
                let best = -1;
                let bestCount = Infinity;
                for (let k = 0; k < slotCount; k++) {
                    const i = (turn + k) % slotCount;
                    if (!inAutoPool(i)) continue;
                    const c = countSoFar(i);
                    if (c < bestCount) {
                        bestCount = c;
                        best = i;
                    }
                }
                if (best >= 0) {
                    const warn = skillIdxs && skillIdxs.length && skillIdxs.indexOf(best) < 0;
                    pushRow(best, ev, tipSlot, false, warn, rowOv);
                    turn = (best + 1) % slotCount;
                    return best;
                }
                return -1;
            }

            pool.sort((a, b) => {
                const ca = countSoFar(a);
                const cb = countSoFar(b);
                if (ca !== cb) return ca - cb;
                const da = (a - turn + slotCount) % slotCount;
                const db = (b - turn + slotCount) % slotCount;
                return da - db;
            });
            const pick = pool[0];
            const warn = skillIdxs && skillIdxs.length && skillIdxs.indexOf(pick) < 0;
            pushRow(pick, ev, tipSlot, false, warn, rowOv);
            turn = (pick + 1) % slotCount;
            return pick;
        }

        function needsFireCupping(ev) {
            const b = eventBlob(ev);
            return /fire\s*cup|火罐/.test(b);
        }

        function isLuxuryPackage(ev) {
            if (String(ev.package_type || '').toLowerCase() === 'luxury') return true;
            return /\bluxury\b/.test(eventBlob(ev));
        }

        /** Relax / Basic Facial + 90 min massage (not luxury mini). */
        function isMassageFacialCombo(ev) {
            if (isLuxuryPackage(ev)) return false;
            const b = eventBlob(ev);
            if (/basic\s*facial/.test(b) && /\b90\b/.test(b)) return true;
            if (/facial\s*w\s*90/.test(b)) return true;
            if (/relax\s*package/.test(b) && /facial/.test(b)) return true;
            return false;
        }

        /** Standalone facial / lymphatic (not a same-booking massage combo). */
        function isFacialOnlyService(ev) {
            if (!needsFacialOrLymphatic(ev)) return false;
            if (isLuxuryPackage(ev) || isMassageFacialCombo(ev)) return false;
            const b = eventBlob(ev);
            if (/\bmassag/.test(b) && /\bfacial\b/.test(b)) return false;
            return true;
        }

        function isMassageLikeService(ev) {
            if (!ev || isFacialOnlyService(ev)) return false;
            const b = eventBlob(ev);
            if (/\bfacial\b/.test(b) && !/\bmassag/.test(b)) return false;
            return (
                /\bmassag/.test(b) ||
                /\bdeep\s*tissue\b/.test(b) ||
                /\bswedish\b/.test(b) ||
                /\btrigger\s*point\b/.test(b)
            );
        }

        function sameSheetCustomer(a, b) {
            if (!a || !b) return false;
            const ida = String(a.customer_id || '').trim();
            const idb = String(b.customer_id || '').trim();
            if (ida && idb) return ida === idb;
            return (
                String(a.customer || '')
                    .trim()
                    .toLowerCase() ===
                String(b.customer || '')
                    .trim()
                    .toLowerCase()
            );
        }

        function findOverlappingSibling(ev, pred) {
            const start = parseIso(ev && ev.start_at);
            const end = parseIso(ev && (ev.display_end_at || ev.end_at));
            if (!start || !end) return null;
            for (const other of events) {
                if (!other || other === ev) continue;
                if (String(other.booking_id || '') === String(ev.booking_id || '')) continue;
                if (!sameSheetCustomer(ev, other)) continue;
                const os = parseIso(other.start_at);
                const oe = parseIso(other.display_end_at || other.end_at);
                if (!os || !oe) continue;
                if (!rangesOverlap(start, end, os, oe)) continue;
                if (pred(other)) return other;
            }
            return null;
        }

        function bookingRequestNames(ev) {
            if (!ev) return [];
            const noteNames = masseuseNamesFromStaffNote(ev);
            if (noteNames.length) return noteNames.slice();
            if (isAnyAvailableForSheet(ev)) return [];
            let names = (reqByBid.get(String(ev.booking_id || '')) || []).slice();
            if (!names.length) {
                const n = String(ev.original_therapist || ev.therapist || '').trim();
                if (n && n.toLowerCase() !== 'staff') names = [n];
            }
            return names;
        }

        /** Staff note names e.g. "Rose Vicky" → ordered roster matches. */
        function masseuseNamesFromStaffNote(ev) {
            if (staffNoteMeansTurnAny(ev)) return [];
            const text = [ev.seller_note, ev.customer_note, ev.addon_note]
                .filter(Boolean)
                .join(' ');
            if (!text) return [];
            const low = text.toLowerCase();
            const hits = [];
            for (let i = 0; i < slotCount; i++) {
                const n = roster[i];
                if (!n) continue;
                const first = String(n).trim().split(/\s+/)[0];
                if (first.length < 3) continue;
                const re = new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
                const m = re.exec(text);
                if (m) hits.push({ name: n, at: m.index });
            }
            /* Also match known skill names not on roster (e.g. Vicky) for tipSlot 2 try */
            for (const extra of []
                .concat(skills.facial || [])
                .concat(skills.fireCupping || [])
                .concat(skills.trigger || [])) {
                const first = String(extra || '')
                    .trim()
                    .split(/\s+/)[0];
                if (first.length < 3) continue;
                if (hits.some((h) => namesMatch(h.name, extra))) continue;
                const re = new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
                const m = re.exec(text);
                if (m) hits.push({ name: String(extra).trim(), at: m.index });
            }
            hits.sort((a, b) => a.at - b.at);
            return hits.map((h) => h.name);
        }

        /** Rule 27: place a time-split segment; <30 min → 小工 (no turn), else normal turn. */
        function placeSplitSegment(ev, name, segStart, segEnd, mins, tipSlot, force) {
            if (assigned.has(lockKey(ev.booking_id, tipSlot))) return -1;
            const xg = mins < 30;
            const overrides = {
                start: segStart,
                end: segEnd,
                dur: formatDurCol(segStart, segEnd),
                price: mins > 0 ? String(mins) : '',
            };
            let idx = findRosterIndex(name);
            if (idx < 0) {
                if (xg) {
                    idx = (skills.facial || [])
                        .concat(skills.fireCupping || [])
                        .map(findRosterIndex)
                        .find((i) => i >= 0);
                    if (idx == null) idx = -1;
                } else if (!force) {
                    idx = assignOne(ev, '', tipSlot, false);
                    if (idx >= 0) {
                        const rows = slots[idx].rows;
                        const last = rows[rows.length - 1];
                        if (last && String(last._bid) === String(ev.booking_id)) {
                            last._start = segStart;
                            last._end = segEnd;
                            last.dur = overrides.dur;
                            last.price = overrides.price;
                        }
                    }
                    return idx;
                }
            }
            if (idx == null || idx < 0) return -1;
            if (xg) {
                addXgJob(idx, mins > 0 ? mins + 'min' : '小工', ev, tipSlot);
                return idx;
            }
            pushRow(idx, ev, tipSlot, !!force, false, overrides);
            turn = (idx + 1) % Math.max(slotCount, 1);
            return idx;
        }

        for (const ev of events) {
            const isCouple = String(ev.type || '').toLowerCase() === 'couple';
            const anyAvail = isAnyAvailableForSheet(ev);
            let reqNames = [];
            if (!anyAvail) {
                reqNames = (reqByBid.get(String(ev.booking_id || '')) || []).slice();
                if (!reqNames.length) {
                    const n = String(ev.original_therapist || ev.therapist || '').trim();
                    if (n && n.toLowerCase() !== 'staff') reqNames = [n];
                }
            }
            const noteNames = masseuseNamesFromStaffNote(ev);
            /* Notes naming a masseuse = request even if Square says any-available */
            if (noteNames.length) {
                reqNames = noteNames.slice();
            }
            /*
             * Request when:
             * - staff/customer notes mention a masseuse, OR
             * - Square named booking (not any-available) with a therapist name
             * Not request: any-available with no note names (e.g. Sophia E Booked with any available)
             */
            const hasRequest = noteNames.length > 0 || (!anyAvail && reqNames.length > 0);
            const t1 = (ev.therapist || '').trim();
            const t2 = (ev.therapist_2 || '').trim();
            const splitFirst = parseInt(ev.split_minutes_first, 10);
            const totalMin = durationMinutes(ev);
            const evStart = parseIso(ev.start_at);
            const evEnd = parseIso(ev.display_end_at || ev.end_at);

            /* Already locked (manual NM pin only) — do not reassign */
            if (!isCouple && assigned.has(lockKey(ev.booking_id, 1))) continue;
            if (
                isCouple &&
                assigned.has(lockKey(ev.booking_id, 1)) &&
                assigned.has(lockKey(ev.booking_id, 2))
            ) {
                continue;
            }

            /*
             * Same customer, overlapping facial + massage booked as two Square singles
             * (e.g. Arti: Basic Facial + Deep Tissue). Facial → Tina/Lynn; if the facial
             * was named to someone who cannot do facial, that person takes the massage.
             */
            if (!isCouple) {
                const pairFacial = isFacialOnlyService(ev)
                    ? ev
                    : isMassageLikeService(ev)
                      ? findOverlappingSibling(ev, isFacialOnlyService)
                      : null;
                const pairMassage = isMassageLikeService(ev)
                    ? ev
                    : isFacialOnlyService(ev)
                      ? findOverlappingSibling(ev, isMassageLikeService)
                      : null;
                if (
                    pairFacial &&
                    pairMassage &&
                    !assigned.has(lockKey(pairFacial.booking_id, 1)) &&
                    !assigned.has(lockKey(pairMassage.booking_id, 1))
                ) {
                    const facialIdxs = (skills.facial || [])
                        .map(findRosterIndex)
                        .filter((i) => i >= 0);
                    const fStart = parseIso(pairFacial.start_at);
                    const fEnd = parseIso(pairFacial.display_end_at || pairFacial.end_at);
                    let fi =
                        fStart && fEnd
                            ? facialIdxs.find((i) => !busyAt(i, fStart, fEnd))
                            : facialIdxs[0];
                    if (fi == null) fi = facialIdxs[0];
                    const facialName = fi != null && fi >= 0 ? roster[fi] : '';
                    const facialReq = bookingRequestNames(pairFacial);
                    const massageReq = bookingRequestNames(pairMassage);
                    let massageName = '';
                    let massageForce = false;
                    for (const n of facialReq) {
                        if (n && !nameInList(n, skills.facial || [])) {
                            massageName = n;
                            massageForce = true;
                            break;
                        }
                    }
                    if (!massageName && massageReq.length) {
                        massageName = massageReq[0];
                        massageForce = true;
                    }
                    if (facialName) {
                        assignOne(pairFacial, facialName, 1, true);
                    } else {
                        assignOne(pairFacial, facialReq[0] || '', 1, facialReq.length > 0);
                    }
                    assignOne(pairMassage, massageName, 1, massageForce);
                    continue;
                }
            }

            /*
             * Luxury 大套: turn masseuse busy for 90min massage only;
             * Tina/Lynn mini facial → 小工 小脸 (not a turn).
             */
            if (
                !isCouple &&
                isLuxuryPackage(ev) &&
                evStart &&
                evEnd &&
                totalMin != null &&
                totalMin >= 90
            ) {
                const massageEnd = new Date(evEnd.getTime() - 30 * 60000);
                const win = {
                    start: evStart,
                    end: massageEnd,
                    price: '90',
                    note: '',
                };
                if (hasRequest) {
                    assignOne(ev, reqNames[0] || t1, 1, true, win, { ignoreSkills: true });
                } else {
                    assignOne(ev, '', 1, false, win, { ignoreSkills: true });
                }
                let massageSlot = -1;
                for (let s = 0; s < slotCount; s++) {
                    if ((slots[s].rows || []).some((r) => String(r._bid) === String(ev.booking_id))) {
                        massageSlot = s;
                        break;
                    }
                }
                const mainName = massageSlot >= 0 ? roster[massageSlot] : '';
                const userSplit =
                    assigned.has(lockKey(ev.booking_id, SPLIT_XG_TIP)) ||
                    !!(state.edits.rowMeta || {})[lockKey(ev.booking_id, 1)]?.split ||
                    !!(state.edits.rowMeta || {})[lockKey(ev.booking_id, SPLIT_XG_TIP)]
                        ?.timeBlocks?.length;
                if (!userSplit && !nameInList(mainName, skills.facial || [])) {
                    const facialIdxs = (skills.facial || [])
                        .map(findRosterIndex)
                        .filter((i) => i >= 0);
                    let fi = facialIdxs.find((i) => !busyAt(i, massageEnd, evEnd));
                    if (fi == null) fi = facialIdxs[0];
                    if (fi != null && fi >= 0) addXgJob(fi, '小脸', ev, 1);
                }
                continue;
            }

            /*
             * Basic facial + 90min massage: massage on turn first if Tina free for facial
             * after; else Tina facial first, massage back to turn.
             */
            if (
                !isCouple &&
                isMassageFacialCombo(ev) &&
                evStart &&
                evEnd &&
                totalMin != null &&
                totalMin > 90
            ) {
                const massageMins = 90;
                const facialMins = totalMin - massageMins;
                const mid = new Date(evStart.getTime() + massageMins * 60000);
                const facialIdxs = (skills.facial || [])
                    .map(findRosterIndex)
                    .filter((i) => i >= 0);
                const tinaFreeForFacialAfter = facialIdxs.find((i) => !busyAt(i, mid, evEnd));
                if (tinaFreeForFacialAfter != null && tinaFreeForFacialAfter >= 0) {
                    assignOne(
                        ev,
                        hasRequest ? reqNames[0] || t1 : '',
                        1,
                        hasRequest,
                        { start: evStart, end: mid, price: '90', note: '' },
                        { ignoreSkills: true }
                    );
                    if (!assigned.has(lockKey(ev.booking_id, 2))) {
                        pushRow(tinaFreeForFacialAfter, ev, 2, false, false, {
                            start: mid,
                            end: evEnd,
                            dur: formatDurCol(mid, evEnd),
                            price: String(facialMins),
                            note: 'facial',
                        });
                        turn = (tinaFreeForFacialAfter + 1) % Math.max(slotCount, 1);
                    }
                } else {
                    const facialEnd = new Date(evStart.getTime() + facialMins * 60000);
                    const tinaFreeFirst = facialIdxs.find((i) => !busyAt(i, evStart, facialEnd));
                    if (tinaFreeFirst != null && tinaFreeFirst >= 0) {
                        pushRow(tinaFreeFirst, ev, 1, false, false, {
                            start: evStart,
                            end: facialEnd,
                            dur: formatDurCol(evStart, facialEnd),
                            price: String(facialMins),
                            note: 'facial',
                        });
                        turn = (tinaFreeFirst + 1) % Math.max(slotCount, 1);
                        assignOne(
                            ev,
                            '',
                            2,
                            false,
                            { start: facialEnd, end: evEnd, price: '90', note: '' },
                            { ignoreSkills: true }
                        );
                    } else if (hasRequest) {
                        assignOne(ev, reqNames[0] || t1, 1, true, null, { ignoreSkills: true });
                    } else {
                        assignOne(ev, '', 1, false, null, { ignoreSkills: true });
                    }
                }
                continue;
            }

            /* Rule 27: calendar split into two therapists */
            if (
                !isCouple &&
                Number.isFinite(splitFirst) &&
                splitFirst > 0 &&
                t2 &&
                totalMin != null &&
                totalMin > splitFirst
            ) {
                const start = evStart;
                const end = parseIso(ev.display_end_at || ev.end_at);
                if (start && end) {
                    const mid = new Date(start.getTime() + splitFirst * 60000);
                    const m2 = totalMin - splitFirst;
                    if (!assigned.has(lockKey(ev.booking_id, 1))) {
                        placeSplitSegment(ev, t1, start, mid, splitFirst, 1, hasRequest);
                    }
                    if (!assigned.has(lockKey(ev.booking_id, 2))) {
                        placeSplitSegment(
                            ev,
                            t2,
                            mid,
                            end,
                            m2,
                            2,
                            hasRequest && reqNames.length > 1
                        );
                    }
                    continue;
                }
            }

            /*
             * Turn pointer (past + future same): by start time, among free masseuses
             * pick fewest customers, then next from turn index #1…#N. Do NOT glue to
             * Square calendar therapist for non-request / 正常轮.
             */
            if (isCouple) {
                if (hasRequest) {
                    const r0 = reqNames[0] || t1;
                    const r1 = reqNames[1] || '';
                    if (!assigned.has(lockKey(ev.booking_id, 1))) assignOne(ev, r0, 1, !!r0);
                    if (!assigned.has(lockKey(ev.booking_id, 2))) {
                        if (reqNames.length > 1 && r1) assignOne(ev, r1, 2, true);
                        else assignOne(ev, '', 2, false);
                    }
                } else {
                    if (!assigned.has(lockKey(ev.booking_id, 1))) assignOne(ev, '', 1, false);
                    if (!assigned.has(lockKey(ev.booking_id, 2))) assignOne(ev, '', 2, false);
                }
            } else if (hasRequest) {
                assignOne(ev, reqNames[0] || t1, 1, true);
            } else {
                assignOne(ev, '', 1, false);
            }
        }

        function findSlotWithBid(bid) {
            if (!bid) return -1;
            for (let s = 0; s < slotCount; s++) {
                if ((slots[s].rows || []).some((r) => String(r._bid) === String(bid))) {
                    return s;
                }
            }
            return -1;
        }

        /* 小工 rows (小脸 / cupping) — same columns, stay at bottom after sort */
        for (const ev of events) {
            const start = parseIso(ev.start_at);
            const end = parseIso(ev.display_end_at || ev.end_at);
            if (!start || !end) continue;
            const massageSlot = findSlotWithBid(ev.booking_id);
            const bid = String(ev.booking_id || '');

            if (isLuxuryPackage(ev)) {
                const userSplit =
                    assigned.has(lockKey(ev.booking_id, SPLIT_XG_TIP)) ||
                    !!(state.edits.rowMeta || {})[lockKey(bid, 1)]?.split ||
                    !!(state.edits.rowMeta || {})[lockKey(bid, SPLIT_XG_TIP)]?.timeBlocks
                        ?.length;
                const alreadyXg = slots.some((s) =>
                    (s.rows || []).some(
                        (r) => r && r._xg && String(r._bid) === bid && /小脸|facial/.test(r.note || '')
                    )
                );
                if (!userSplit && !alreadyXg) {
                    const mainName = massageSlot >= 0 ? roster[massageSlot] : '';
                    if (!nameInList(mainName, skills.facial || [])) {
                        const facialIdxs = (skills.facial || [])
                            .map(findRosterIndex)
                            .filter((i) => i >= 0);
                        let fi = facialIdxs.find(
                            (i) => !busyAt(i, new Date(end.getTime() - 30 * 60000), end)
                        );
                        if (fi == null) fi = facialIdxs[0];
                        if (fi != null && fi >= 0) addXgJob(fi, '小脸', ev, 1);
                    }
                }
            }

            if (needsFireCupping(ev)) {
                const alreadyCup = slots.some((s) =>
                    (s.rows || []).some(
                        (r) => r && r._xg && String(r._bid) === bid && /cupping/.test(r.note || '')
                    )
                );
                if (!alreadyCup) {
                    const cupIdxs = (skills.fireCupping || [])
                        .map(findRosterIndex)
                        .filter((i) => i >= 0 && i !== massageSlot);
                    cupIdxs.sort((a, b) => countSoFar(a) - countSoFar(b));
                    const ci = cupIdxs[0];
                    if (ci != null && ci >= 0) addXgJob(ci, 'cupping', ev, 1);
                }
            }
        }

        const emptyRow = () => ({
            nm: '',
            rm: '',
            dur: '',
            price: '',
            tip: '',
            note: '',
            requested: false,
            skillWarn: false,
            future: false,
            empty: true,
            _xg: false,
            _split: false,
            _timeBlocks: [],
        });
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            const main = (slot.rows || []).slice();
            main.sort((a, b) => {
                const ax = a && a._xg ? 1 : 0;
                const bx = b && b._xg ? 1 : 0;
                if (ax !== bx) return ax - bx;
                const at = a && a._start ? a._start.getTime() : 0;
                const bt = b && b._start ? b._start.getTime() : 0;
                return at - bt;
            });
            const filled = main.filter((r) => r && (r.nm || r._bid)).length;
            const want = Math.max(
                ROWS_MIN,
                filled,
                parseInt((state.edits.rowCounts || {})[String(si)], 10) || ROWS_DEFAULT
            );
            while (main.length < want) main.push(emptyRow());
            slot.rows = main;
            slot.xgJobs = [];
        }
        return slots;
    }

    function collectRowCounts() {
        const out = {};
        (state.slots || []).forEach((slot, i) => {
            out[String(i)] = Math.max(ROWS_MIN, (slot.rows || []).length);
        });
        state.edits.rowCounts = out;
        return out;
    }

    function collectRowMeta() {
        const out = {};
        (state.slots || []).forEach((slot) => {
            (slot.rows || []).forEach((row) => {
                if (!row || !row._bid) return;
                const key = lockKey(row._bid, row._tipSlot || 1);
                if (
                    row._split ||
                    (row._timeBlocks && row._timeBlocks.length) ||
                    row._xg ||
                    row._splitWith
                ) {
                    out[key] = {
                        split: !!row._split,
                        timeBlocks: Array.isArray(row._timeBlocks) ? row._timeBlocks.slice() : [],
                        xg: !!row._xg,
                        splitWith: row._splitWith || '',
                    };
                }
            });
        });
        state.edits.rowMeta = out;
        return out;
    }

    /** 15-minute blocks covering the full Square appointment. */
    function apptTimeBlocks(ev) {
        const start = parseIso(ev && ev.start_at);
        const end = parseIso(ev && (ev.display_end_at || ev.end_at));
        if (!start || !end || end <= start) return [];
        const blocks = [];
        let t = new Date(start.getTime());
        while (t < end) {
            const n = new Date(t.getTime() + 15 * 60000);
            const blockEnd = n > end ? end : n;
            blocks.push({
                start: new Date(t.getTime()),
                end: blockEnd,
                key: formatDurCol(t, blockEnd),
            });
            t = n;
        }
        return blocks;
    }

    /** @deprecated alias — use apptTimeBlocks (15‑min). */
    function apptThirtyMinBlocks(ev) {
        return apptTimeBlocks(ev);
    }

    function formatDurFromBlocks(blocks) {
        if (!blocks || !blocks.length) return '';
        const sorted = blocks.slice().sort((a, b) => a.start - b.start);
        const parts = [];
        let gStart = sorted[0].start;
        let gEnd = sorted[0].end;
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].start.getTime() <= gEnd.getTime() + 1000) {
                if (sorted[i].end > gEnd) gEnd = sorted[i].end;
            } else {
                parts.push(formatDurCol(gStart, gEnd));
                gStart = sorted[i].start;
                gEnd = sorted[i].end;
            }
        }
        parts.push(formatDurCol(gStart, gEnd));
        return parts.join(', ');
    }

    function minutesFromBlocks(blocks) {
        if (!blocks || !blocks.length) return 0;
        return blocks.reduce(
            (n, b) => n + Math.round((b.end.getTime() - b.start.getTime()) / 60000),
            0
        );
    }

    function applyTimeBlocksToRow(row, selectedKeys, ev) {
        if (!row) return;
        row._timeBlocks = (selectedKeys || []).slice();
        const blocks = apptTimeBlocks(ev).filter((b) => selectedKeys.indexOf(b.key) >= 0);
        if (!blocks.length) return;
        blocks.sort((a, b) => a.start - b.start);
        row._start = blocks[0].start;
        row._end = blocks[blocks.length - 1].end;
        row.dur = formatDurFromBlocks(blocks);
        row._durEdited = true;
        const mins = minutesFromBlocks(blocks);
        if (!row._priceEdited) {
            if (mins >= 55 && mins <= 65) row.price = '60';
            else if (mins >= 85 && mins <= 95) row.price = '90';
            else if (mins >= 25 && mins <= 35) row.price = '30';
            else row.price = String(mins);
        }
    }

    function findFacialSlotIdx(excludeSlotIdx) {
        const list = skills.facial || [];
        for (let pass = 0; pass < 2; pass++) {
            for (const name of list) {
                for (let i = 0; i < state.slots.length; i++) {
                    if (pass === 0 && i === excludeSlotIdx) continue;
                    if (namesMatch(state.slots[i].name, name)) return i;
                }
            }
        }
        return -1;
    }

    function clearSplitXgForBid(bid) {
        const found = findSheetRowByBid(bid, SPLIT_XG_TIP);
        if (!found) return;
        const rows = state.slots[found.slotIdx].rows;
        rows.splice(found.rowIdx, 1);
        const k = lockKey(bid, SPLIT_XG_TIP);
        if (state.edits.rows) delete state.edits.rows[k];
        if (state.edits.rowMeta) delete state.edits.rowMeta[k];
    }

    /** Remove auto luxury 小脸 rows so split partner is the only facial 小工 for this booking. */
    function clearOtherFacialXgForBid(bid, keepTipSlot) {
        for (let s = state.slots.length - 1; s >= 0; s--) {
            const rows = state.slots[s].rows || [];
            for (let r = rows.length - 1; r >= 0; r--) {
                const row = rows[r];
                if (!row || !row._xg || String(row._bid) !== String(bid)) continue;
                if ((row._tipSlot || 1) === keepTipSlot) continue;
                if (!/小脸|facial/i.test(row.note || '')) continue;
                rows.splice(r, 1);
                const k = lockKey(bid, row._tipSlot || 1);
                if (state.edits.rows) delete state.edits.rows[k];
                if (state.edits.rowMeta) delete state.edits.rowMeta[k];
            }
        }
    }

    /**
     * Apply selected 15‑min blocks to this row; unselected blocks → facial 小工 partner.
     * Notes show w/ Partner under each Note cell after close.
     */
    function commitSplitSelection(slotIdx, rowIdx, selectedKeys) {
        const row = state.slots[slotIdx] && state.slots[slotIdx].rows[rowIdx];
        if (!row || !row._bid) return;
        const ev = findEventById(row._bid);
        if (!ev) return;
        const all = apptTimeBlocks(ev);
        const selSet = new Set(selectedKeys || []);
        const selected = all.filter((b) => selSet.has(b.key));
        const complement = all.filter((b) => !selSet.has(b.key));
        if (!selected.length) return;

        applyTimeBlocksToRow(row, selected.map((b) => b.key), ev);
        row._split = true;
        /* Do NOT pin — pins freeze turn and scramble massage distribution */

        const mainName = firstName(state.slots[slotIdx].name) || state.slots[slotIdx].name || '';

        if (!complement.length) {
            clearSplitXgForBid(row._bid);
            row._splitWith = '';
            collectRowMeta();
            persistFullSheet();
            return;
        }

        clearOtherFacialXgForBid(row._bid, SPLIT_XG_TIP);

        let xgSlot = findFacialSlotIdx(slotIdx);
        if (xgSlot < 0) {
            clearSplitXgForBid(row._bid);
            row._splitWith = '';
            collectRowMeta();
            persistFullSheet();
            setStatus('Split saved on this row — add a facial specialist (Skills) for 小工 partner', true);
            return;
        }

        /* Move partner if it was on another card */
        const existing = findSheetRowByBid(row._bid, SPLIT_XG_TIP);
        if (existing && existing.slotIdx !== xgSlot) {
            state.slots[existing.slotIdx].rows.splice(existing.rowIdx, 1);
        }

        let xgRow =
            existing && existing.slotIdx === xgSlot
                ? state.slots[xgSlot].rows[existing.rowIdx]
                : null;
        if (!xgRow) {
            xgRow = {
                nm: customerShort(ev.customer),
                rm: roomLabel(ev),
                dur: '',
                price: '',
                tip: '',
                note: '小脸',
                requested: false,
                skillWarn: false,
                empty: false,
                _xg: true,
                _split: true,
                _timeBlocks: [],
                _bid: row._bid,
                _tipSlot: SPLIT_XG_TIP,
                _pinned: false,
                _splitWith: '',
            };
            state.slots[xgSlot].rows.push(xgRow);
        }

        applyTimeBlocksToRow(xgRow, complement.map((b) => b.key), ev);
        xgRow._xg = true;
        xgRow._split = true;
        xgRow._pinned = false;
        xgRow._bid = row._bid;
        xgRow._tipSlot = SPLIT_XG_TIP;
        xgRow.nm = customerShort(ev.customer);
        xgRow.rm = roomLabel(ev);
        if (!xgRow._noteEdited) xgRow.note = '小脸';
        const partnerName = firstName(state.slots[xgSlot].name) || state.slots[xgSlot].name || '';
        xgRow._splitWith = mainName;
        row._splitWith = partnerName;

        collectRowMeta();
        persistFullSheet();
    }

    /** Drop accidental 小工/split pins so turn redistribute is clean. */
    function stripXgPinsFromEdits(editsRows) {
        const out = {};
        Object.keys(editsRows || {}).forEach((key) => {
            const snap = editsRows[key];
            if (!snap) return;
            const tip = snap.tipSlot != null ? snap.tipSlot || 1 : 1;
            if (tip >= 20 || tip === SPLIT_XG_TIP) return;
            if (snap.bid && /#(?:2\d|30)$/.test(key)) return;
            out[key] = snap;
        });
        return out;
    }

    function findMainRowOnSlots(slots, bid, tipSlot) {
        const tip = tipSlot || 1;
        for (let s = 0; s < slots.length; s++) {
            for (let r = 0; r < (slots[s].rows || []).length; r++) {
                const row = slots[s].rows[r];
                if (!row || row._xg) continue;
                if (String(row._bid) !== String(bid)) continue;
                if ((row._tipSlot || 1) !== tip) continue;
                return { slotIdx: s, rowIdx: r, row };
            }
        }
        return null;
    }

    /**
     * Re-apply saved split time blocks onto whoever currently holds the booking
     * (after turn redistribute). Does not pin.
     */
    function reconcileSplitPartnersOnSlots(slots) {
        const meta = state.edits.rowMeta || {};
        const prev = state.slots;
        state.slots = slots;
        try {
            Object.keys(meta).forEach((key) => {
                const m = meta[key];
                if (!m || !Array.isArray(m.timeBlocks) || !m.timeBlocks.length) return;
                const hash = key.lastIndexOf('#');
                if (hash < 0) return;
                const bid = key.slice(0, hash);
                const tip = parseInt(key.slice(hash + 1), 10) || 1;
                const ev = findEventById(bid);
                if (!ev) return;
                const all = apptTimeBlocks(ev);
                if (!all.length) return;

                let mainTip = 1;
                let selectedKeys = [];
                let complementKeys = [];

                if (tip === SPLIT_XG_TIP || tip >= 20) {
                    /* Only 小工 meta survived — infer main blocks as the complement */
                    if (meta[lockKey(bid, 1)]?.timeBlocks?.length) return;
                    complementKeys = m.timeBlocks.slice();
                    const comp = new Set(complementKeys);
                    selectedKeys = all.filter((b) => !comp.has(b.key)).map((b) => b.key);
                    if (!selectedKeys.length) return;
                    mainTip = 1;
                } else if (tip === 1 || tip === 2) {
                    if (!m.split) return;
                    selectedKeys = m.timeBlocks.slice();
                    const sel = new Set(selectedKeys);
                    complementKeys = all.filter((b) => !sel.has(b.key)).map((b) => b.key);
                    mainTip = tip;
                } else {
                    return;
                }

                const found = findMainRowOnSlots(slots, bid, mainTip);
                if (!found) return;

                applyTimeBlocksToRow(found.row, selectedKeys, ev);
                found.row._split = true;

                clearOtherFacialXgForBid(bid, SPLIT_XG_TIP);
                clearSplitXgForBid(bid);
                if (!complementKeys.length) {
                    found.row._splitWith = '';
                    return;
                }

                const xgSlot = findFacialSlotIdx(found.slotIdx);
                if (xgSlot < 0) return;
                const mainName =
                    firstName(slots[found.slotIdx].name) || slots[found.slotIdx].name || '';
                const partnerName = firstName(slots[xgSlot].name) || slots[xgSlot].name || '';
                const xgRow = {
                    nm: customerShort(ev.customer),
                    rm: roomLabel(ev),
                    dur: '',
                    price: '',
                    tip: '',
                    note: '小脸',
                    requested: false,
                    skillWarn: false,
                    empty: false,
                    _xg: true,
                    _split: true,
                    _timeBlocks: [],
                    _bid: bid,
                    _tipSlot: SPLIT_XG_TIP,
                    _pinned: false,
                    _splitWith: mainName,
                };
                applyTimeBlocksToRow(xgRow, complementKeys, ev);
                found.row._splitWith = partnerName;
                slots[xgSlot].rows.push(xgRow);
            });
        } finally {
            state.slots = prev;
        }
        return slots;
    }

    /** Click-to-toggle 15‑min blocks for the detail modal (short chips). */
    function buildDetailSplitBar(ev, blocks, initialKeys, onChange) {
        const selected = new Set(initialKeys || []);
        const panel = document.createElement('div');
        panel.className = 'mss-split-panel';
        const title = document.createElement('div');
        title.className = 'mss-split-panel-title';
        title.textContent = 'Split time (15 min) — click blocks for this masseuse';
        const hint = document.createElement('p');
        hint.className = 'mss-split-hint';
        hint.textContent =
            'Click to select/deselect (gaps OK). Unselected → facial 小工 (e.g. Tina) with w/ notes.';
        panel.appendChild(title);
        panel.appendChild(hint);

        const track = document.createElement('div');
        track.className = 'mss-split-track';
        const segs = [];
        /* Prior flex-fill ≈ 560px / n; chips = 25% of that */
        const segW = Math.max(10, Math.round((560 / Math.max(blocks.length, 1)) * 0.25));

        function paint() {
            segs.forEach((seg, i) => {
                seg.classList.toggle('selected', selected.has(blocks[i].key));
            });
            const keys = blocks.filter((b) => selected.has(b.key)).map((b) => b.key);
            rangeLab.textContent = keys.length
                ? formatDurFromBlocks(blocks.filter((b) => selected.has(b.key))) +
                  '  (' +
                  minutesFromBlocks(blocks.filter((b) => selected.has(b.key))) +
                  ' min)'
                : 'click to select';
            if (typeof onChange === 'function') onChange(keys);
        }

        const rangeLab = document.createElement('div');
        rangeLab.className = 'mss-split-range';

        blocks.forEach((b, i) => {
            const seg = document.createElement('div');
            seg.className = 'mss-split-seg';
            seg.style.width = segW + 'px';
            seg.title = b.key + ' — click to toggle';
            const tick = document.createElement('span');
            tick.className = 'mss-seg-tick';
            const h = b.start.getHours() % 12 || 12;
            const m = b.start.getMinutes();
            tick.textContent = m === 0 ? String(h) : m === 30 ? ':30' : '';
            seg.appendChild(tick);
            segs.push(seg);
            seg.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (selected.has(b.key)) selected.delete(b.key);
                else selected.add(b.key);
                paint();
            });
            track.appendChild(seg);
        });

        panel.appendChild(track);
        panel.appendChild(rangeLab);
        paint();
        return panel;
    }

    function cellKey(slotIdx, rowIdx, field) {
        return slotIdx + '-' + rowIdx + '-' + field;
    }

    function applyEditsToSlots(slots) {
        const tips = {};
        for (let s = 0; s < slots.length; s++) {
            /* Names already committed into roster before assign — do not remount labels here */
            const editName = state.edits.names[String(s)];
            if (editName != null && String(editName).trim()) {
                slots[s].name = String(editName).trim();
            }
            const rowN = Math.max((slots[s].rows || []).length, ROWS_MIN);
            while ((slots[s].rows || []).length < rowN) {
                slots[s].rows.push({
                    nm: '',
                    rm: '',
                    dur: '',
                    price: '',
                    tip: '',
                    note: '',
                    requested: false,
                    skillWarn: false,
                    empty: true,
                });
            }
            for (let r = 0; r < slots[s].rows.length; r++) {
                const row = slots[s].rows[r] || {
                    nm: '',
                    rm: '',
                    dur: '',
                    price: '',
                    tip: '',
                    note: '',
                    requested: false,
                    skillWarn: false,
                };
                tips[s + '-' + r] = row.tip || '';
                for (const field of ['nm', 'rm', 'dur', 'price', 'tip', 'note']) {
                    const k = cellKey(s, r, field);
                    if (Object.prototype.hasOwnProperty.call(state.edits.cells, k)) {
                        row[field] = state.edits.cells[k];
                        row['_' + field + 'Edited'] = true;
                    }
                }
                /* Tip: calendar tip shows unless user edited tip */
                if (!row._tipEdited && tips[s + '-' + r]) {
                    row.tip = tips[s + '-' + r];
                }
                if (row._bid) {
                    const meta = (state.edits.rowMeta || {})[lockKey(row._bid, row._tipSlot || 1)];
                    if (meta) {
                        if (meta.split) row._split = true;
                        if (Array.isArray(meta.timeBlocks) && meta.timeBlocks.length) {
                            row._timeBlocks = meta.timeBlocks.slice();
                            const ev = findEventById(row._bid);
                            if (ev) applyTimeBlocksToRow(row, row._timeBlocks, ev);
                        }
                        if (meta.xg) row._xg = true;
                        if (meta.splitWith) row._splitWith = meta.splitWith;
                    }
                }
                slots[s].rows[r] = row;
            }
        }
        state.calendarTips = tips;
        return slots;
    }

    function addRowToCard(slotIdx) {
        if (!state.slots[slotIdx]) return;
        if (!state.slots[slotIdx].rows) state.slots[slotIdx].rows = [];
        /* Insert empty regular row before 小工 rows */
        const rows = state.slots[slotIdx].rows;
        let insertAt = rows.length;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i] && rows[i]._xg) {
                insertAt = i;
                break;
            }
        }
        rows.splice(insertAt, 0, {
            nm: '',
            rm: '',
            dur: '',
            price: '',
            tip: '',
            note: '',
            requested: false,
            skillWarn: false,
            empty: true,
            _xg: false,
            _split: false,
            _timeBlocks: [],
        });
        collectRowCounts();
        persistFullSheet();
        renderSheet();
        setStatus('Added row on #' + (slotIdx + 1));
    }

    /** Add a 小工 row under regular rows (same columns). */
    function addXgRowToCard(slotIdx) {
        if (!state.slots[slotIdx]) return;
        if (!state.slots[slotIdx].rows) state.slots[slotIdx].rows = [];
        state.slots[slotIdx].rows.push({
            nm: '',
            rm: '',
            dur: '',
            price: '',
            tip: '',
            note: '',
            requested: false,
            skillWarn: false,
            empty: true,
            _xg: true,
            _split: false,
            _timeBlocks: [],
        });
        collectRowCounts();
        persistFullSheet();
        renderSheet();
        const n = state.slots[slotIdx].rows.filter((r) => r && r._xg).length;
        setStatus('Added 小工#' + n + ' on #' + (slotIdx + 1));
    }

    function removeRegularRowFromCard(slotIdx) {
        const slot = state.slots[slotIdx];
        if (!slot || !slot.rows) return;
        const mainCount = slot.rows.filter((r) => r && !r._xg).length;
        if (mainCount <= ROWS_MIN) {
            setStatus('Need at least ' + ROWS_MIN + ' regular (#) rows', true);
            return;
        }
        for (let i = slot.rows.length - 1; i >= 0; i--) {
            const row = slot.rows[i];
            if (!row || row._xg) continue;
            if (!row._bid && !row.nm) {
                slot.rows.splice(i, 1);
                collectRowCounts();
                persistFullSheet();
                renderSheet();
                setStatus('Removed empty # row');
                return;
            }
        }
        setStatus('Clear an empty # row first', true);
    }

    function removeXgRowFromCard(slotIdx) {
        const slot = state.slots[slotIdx];
        if (!slot || !slot.rows) return;
        for (let i = slot.rows.length - 1; i >= 0; i--) {
            const row = slot.rows[i];
            if (row && row._xg && !row._bid && !row.nm) {
                slot.rows.splice(i, 1);
                collectRowCounts();
                persistFullSheet();
                renderSheet();
                setStatus('Removed empty 小工 row');
                return;
            }
        }
        setStatus('No empty 小工 row to remove', true);
    }

    function makeRowControlGroup(labelText, onPlus, onMinus, plusTitle, minusTitle) {
        const group = document.createElement('span');
        group.className = 'mss-row-ctrl';
        const lab = document.createElement('span');
        lab.className = 'mss-row-ctrl-lab';
        lab.textContent = labelText;
        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'mss-row-btn';
        plusBtn.textContent = '+';
        plusBtn.title = plusTitle;
        plusBtn.addEventListener('click', (e) => {
            e.preventDefault();
            onPlus();
        });
        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'mss-row-btn';
        minusBtn.textContent = '−';
        minusBtn.title = minusTitle;
        minusBtn.addEventListener('click', (e) => {
            e.preventDefault();
            onMinus();
        });
        group.appendChild(lab);
        group.appendChild(plusBtn);
        group.appendChild(minusBtn);
        return group;
    }

    function fitSheetToViewport() {
        const host = document.getElementById('mssFitHost');
        const sheet = document.getElementById('mssSheet');
        if (!host || !sheet || sheet.hidden) return;
        sheet.style.transform = 'scale(1)';
        const extra = document.getElementById('mssGridExtra');
        const hasExtra = extra && !extra.hidden && extra.children.length > 1;
        host.classList.toggle('mss-has-extra', !!hasExtra);

        const availW = Math.max(320, (host.clientWidth || window.innerWidth) - 8);
        const headerH =
            (document.querySelector('.mss-header')?.offsetHeight || 0) +
            (document.getElementById('mssStatus')?.offsetHeight || 0) +
            16;
        const availH = Math.max(320, window.innerHeight - headerH);

        const naturalW = Math.max(sheet.scrollWidth, 1);
        /* When extras exist: scale to width only, full height scrollable on the page */
        const naturalH = Math.max(sheet.scrollHeight, 1);
        let scale;
        if (hasExtra) {
            scale = Math.min(availW / naturalW, 1.35);
            scale = Math.max(0.75, scale);
            sheet.style.transform = 'scale(' + scale + ')';
            host.style.height = Math.ceil(naturalH * scale + 24) + 'px';
            host.style.overflowY = 'visible';
            document.body.style.overflowY = 'auto';
        } else {
            scale = Math.min(availW / naturalW, availH / naturalH);
            scale = Math.max(0.8, Math.min(scale, 1.6));
            sheet.style.transform = 'scale(' + scale + ')';
            host.style.height = Math.ceil(naturalH * scale + 12) + 'px';
            host.style.overflowY = 'visible';
        }
    }

    function renderDateBoxes(dateStr) {
        const boxes = document.getElementById('mssDateBoxes');
        const label = document.getElementById('mssDateLabel');
        if (!boxes) return;
        boxes.innerHTML = '';
        for (const ch of dateStr || '') {
            const span = document.createElement('span');
            span.className = 'mss-date-box';
            span.textContent = ch;
            boxes.appendChild(span);
        }
        if (label) {
            label.textContent = dateStr
                ? '(' +
                  new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                  }) +
                  ')'
                : '';
        }
    }

    function makeCard(slot, slotIdx) {
        const card = document.createElement('div');
        card.className = 'mss-card';
        card.dataset.slot = String(slotIdx);

        const title = document.createElement('div');
        title.className = 'mss-card-title';
        const num = document.createElement('span');
        num.className = 'mss-slot-num';
        num.textContent = '#' + (slotIdx + 1);
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'mss-name-input';
        nameInput.placeholder = 'Type name';
        nameInput.value = slot.name || '';
        nameInput.title = 'Type a masseuse name, or click ▾ to pick from Square';
        nameInput.autocomplete = 'off';
        if (state.edits.names[String(slotIdx)] != null) nameInput.classList.add('edited');
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nameInput.blur();
            }
        });
        nameInput.addEventListener('change', () => {
            applyTypedMasseuseName(slotIdx, nameInput);
        });
        title.appendChild(num);
        title.appendChild(nameInput);
        const pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = 'mss-name-pick-btn';
        pickBtn.textContent = '▾';
        pickBtn.title = 'Pick from Square roster (white = working today)';
        pickBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openMasseuseNamePicker(slotIdx);
        });
        title.appendChild(pickBtn);

        /* # + −  |  小工 + −  — separate add/delete for each kind */
        title.appendChild(
            makeRowControlGroup(
                '#',
                () => addRowToCard(slotIdx),
                () => removeRegularRowFromCard(slotIdx),
                'Add regular (#) row',
                'Remove empty regular (#) row'
            )
        );
        title.appendChild(
            makeRowControlGroup(
                '小工',
                () => addXgRowToCard(slotIdx),
                () => removeXgRowFromCard(slotIdx),
                'Add 小工 row',
                'Remove empty 小工 row'
            )
        );

        /* Rule 21: any card can be removed; sheet redistributes to remaining */
        if (state.slots.length > 1) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'mss-remove-masseuse';
            delBtn.title = 'Remove this masseuse and redistribute appointments';
            delBtn.textContent = '×';
            delBtn.addEventListener('click', (e) => {
                e.preventDefault();
                removeMasseuse(slotIdx);
            });
            title.appendChild(delBtn);
        }
        card.appendChild(title);

        const table = document.createElement('table');
        table.className = 'mss-table';
        table.innerHTML =
            '<thead><tr>' +
            '<th class="col-num">#</th><th class="col-nm">NM</th><th class="col-rm">RM</th>' +
            '<th class="col-dur">Dur</th><th class="col-price">Price</th><th class="col-tip">Tip</th>' +
            '<th class="col-note">Note</th>' +
            '</tr></thead><tbody></tbody>';
        const tbody = table.querySelector('tbody');
        const nowMs = Date.now();

        const allRows = slot.rows || [];
        while (allRows.filter((r) => r && !r._xg).length < ROWS_MIN) {
            let insertAt = allRows.length;
            for (let i = 0; i < allRows.length; i++) {
                if (allRows[i] && allRows[i]._xg) {
                    insertAt = i;
                    break;
                }
            }
            allRows.splice(insertAt, 0, {
                nm: '',
                rm: '',
                dur: '',
                price: '',
                tip: '',
                note: '',
                empty: true,
                _xg: false,
            });
        }
        slot.rows = allRows;

        const mainIdxs = [];
        const xgIdxs = [];
        allRows.forEach((row, ri) => {
            if (row && row._xg) xgIdxs.push(ri);
            else mainIdxs.push(ri);
        });

        let displayNum = 0;
        mainIdxs.forEach((r) => {
            displayNum++;
            tbody.appendChild(buildDataRow(slotIdx, r, allRows[r], displayNum, nowMs));
        });

        /* 小工 rows under regular — same columns, label 小工#1 … (no purple bar) */
        let xgNum = 0;
        xgIdxs.forEach((r) => {
            xgNum++;
            tbody.appendChild(
                buildDataRow(slotIdx, r, allRows[r], '小工#' + xgNum, nowMs, true)
            );
        });

        card.appendChild(table);
        return card;
    }

    function buildDataRow(slotIdx, rowIdx, row, displayNum, nowMs, isXg) {
        row = row || {};
        const tr = document.createElement('tr');
        if (row.requested) tr.classList.add('row-req');
        if (row.skillWarn) tr.classList.add('row-warn');
        if (row._pinned) tr.classList.add('row-locked');
        if (isXg || row._xg) tr.classList.add('row-xg');
        if (
            row._start &&
            row._end &&
            (row.nm || row._bid) &&
            row._start.getTime() <= nowMs &&
            nowMs < row._end.getTime()
        ) {
            tr.classList.add('row-now');
        }

        const tdNum = document.createElement('td');
        tdNum.className = 'num';
        const lockWrap = document.createElement('label');
        lockWrap.className = 'mss-lock-wrap';
        lockWrap.title = row._bid
            ? 'Lock: keep on this masseuse (skip turn redistribute)'
            : 'No customer on this row';
        const lockCb = document.createElement('input');
        lockCb.type = 'checkbox';
        lockCb.className = 'mss-lock-cb';
        lockCb.checked = !!row._pinned;
        lockCb.disabled = !row._bid;
        lockCb.addEventListener('click', (e) => e.stopPropagation());
        lockCb.addEventListener('change', () => {
            setRowLock(slotIdx, rowIdx, lockCb.checked);
        });
        const numSpan = document.createElement('span');
        numSpan.className = 'mss-row-num';
        numSpan.textContent = String(displayNum);
        lockWrap.appendChild(lockCb);
        lockWrap.appendChild(numSpan);
        tdNum.appendChild(lockWrap);
        tr.appendChild(tdNum);

        for (const field of ['nm', 'rm', 'dur', 'price', 'tip', 'note']) {
            const td = document.createElement('td');
            td.className = field;
            if (field === 'note') {
                td.appendChild(buildNoteCell(slotIdx, rowIdx, row, isXg));
                tr.appendChild(td);
                continue;
            }
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'mss-cell';
            input.value = row[field] != null ? String(row[field]) : '';
            input.dataset.slot = String(slotIdx);
            input.dataset.row = String(rowIdx);
            input.dataset.field = field;
            if (row['_' + field + 'Edited']) input.classList.add('edited');
            if (field === 'nm') {
                input.classList.add('mss-nm-clickable');
                input.title = 'Click to choose another customer · double-click to type a name';
                input.readOnly = true;
                let nmClickTimer = null;
                input.addEventListener('click', () => {
                    if (nmClickTimer) clearTimeout(nmClickTimer);
                    nmClickTimer = setTimeout(() => {
                        nmClickTimer = null;
                        openPicker(slotIdx, rowIdx);
                    }, 280);
                });
                input.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (nmClickTimer) clearTimeout(nmClickTimer);
                    nmClickTimer = null;
                    input.readOnly = false;
                    input.focus();
                    input.select();
                });
                input.addEventListener('blur', () => {
                    input.readOnly = true;
                });
            }
            input.addEventListener('input', () => {
                const k = cellKey(slotIdx, rowIdx, field);
                state.edits.cells[k] = input.value;
                if (state.slots[slotIdx] && state.slots[slotIdx].rows[rowIdx]) {
                    state.slots[slotIdx].rows[rowIdx][field] = input.value;
                    state.slots[slotIdx].rows[rowIdx]['_' + field + 'Edited'] = true;
                    if (!isXg) state.slots[slotIdx].rows[rowIdx]._pinned = true;
                }
                input.classList.add('edited');
                persistFullSheet();
            });
            if (field === 'tip') {
                input.addEventListener('change', () => {
                    void pushTipToCalendar(slotIdx, rowIdx, input.value);
                });
            }
            td.appendChild(input);
            tr.appendChild(td);
        }
        return tr;
    }

    /**
     * Note cell: text + optional "w/ Partner" + detail button.
     * Split time bar lives inside the Detail modal (15‑min blocks).
     */
    function buildNoteCell(slotIdx, rowIdx, row, isXg) {
        const wrap = document.createElement('div');
        wrap.className = 'mss-note-wrap';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'mss-cell';
        input.value = row.note != null ? String(row.note) : '';
        input.dataset.slot = String(slotIdx);
        input.dataset.row = String(rowIdx);
        input.dataset.field = 'note';
        if (row._noteEdited) input.classList.add('edited');
        input.addEventListener('input', () => {
            const k = cellKey(slotIdx, rowIdx, 'note');
            state.edits.cells[k] = input.value;
            if (state.slots[slotIdx] && state.slots[slotIdx].rows[rowIdx]) {
                state.slots[slotIdx].rows[rowIdx].note = input.value;
                state.slots[slotIdx].rows[rowIdx]._noteEdited = true;
            }
            input.classList.add('edited');
            persistFullSheet();
        });
        wrap.appendChild(input);

        const foot = document.createElement('div');
        foot.className = 'mss-note-foot';
        if (row._splitWith) {
            const withLab = document.createElement('span');
            withLab.className = 'mss-with-lab';
            withLab.textContent = 'w/ ' + row._splitWith;
            withLab.title = 'Split partner';
            foot.appendChild(withLab);
        }
        const detailBtn = document.createElement('button');
        detailBtn.type = 'button';
        detailBtn.className = 'mss-detail-btn';
        detailBtn.textContent = 'detail';
        detailBtn.disabled = !row._bid;
        detailBtn.title = row._bid ? 'Appointment detail + split time' : 'No customer';
        detailBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!row._bid) return;
            openRowDetail(slotIdx, rowIdx);
        });
        foot.appendChild(detailBtn);
        wrap.appendChild(foot);

        return wrap;
    }

    function makeEmptyRows() {
        return Array.from({ length: ROWS_DEFAULT }, () => ({
            nm: '',
            rm: '',
            dur: '',
            price: '',
            tip: '',
            note: '',
            requested: false,
            skillWarn: false,
            empty: true,
        }));
    }

    function makeEmptySlot(name) {
        return {
            name: String(name || '').trim(),
            rows: makeEmptyRows(),
            xgJobs: [],
            extra: false,
        };
    }

    function sheetHasDistributedRows() {
        return (state.slots || []).some((s) =>
            (s.rows || []).some((r) => r && !r.empty && (r.nm || r._bid))
        );
    }

    function rosterHasNames(list) {
        return (list || []).some((n) => String(n || '').trim());
    }

    function cardNamesFromDom() {
        const live = [];
        document.querySelectorAll('#mssGrid .mss-name-input, #mssGridExtra .mss-name-input').forEach((inp) => {
            live.push(String(inp.value || '').trim());
        });
        return live;
    }

    function collectTypedRosterFromUi() {
        const bulk = parseNameList(document.getElementById('mssRosterInput')?.value);
        const dirty = rosterInputDirty;
        rosterInputDirty = false;
        if (dirty && bulk.length) return bulk;
        const live = cardNamesFromDom();
        if (live.some(Boolean)) return live;
        if (bulk.length) return bulk;
        return null;
    }

    function syncRosterInputFromState() {
        const el = document.getElementById('mssRosterInput');
        if (!el) return;
        if (document.activeElement === el) return;
        if (rosterInputDirty) return;
        const roster = state.edits.roster || (state.slots || []).map((s) => (s && s.name) || '');
        el.value = (roster || [])
            .map((n) => String(n || '').trim())
            .filter(Boolean)
            .join(', ');
    }

    async function prefetchDayForPicker(date) {
        const gen = ++prefetchGen;
        try {
            const res = await fetch('/api/day?date=' + encodeURIComponent(date) + '&fast=1');
            if (!res.ok) return;
            const data = await res.json();
            if (gen !== prefetchGen) return;
            window._mssData = data;
        } catch (e) {
            /* picker can stay empty until Load */
        }
    }

    function showEmptySheet(date, opts) {
        const d = date || getTodayLocal();
        state.date = d;
        const defaultN = defaultSlotCountForDate(d);
        let roster = Array.isArray(state.edits.roster) ? state.edits.roster.slice() : [];
        if (!roster.length) {
            roster = Array.from({ length: defaultN }, () => '');
            state.edits.roster = roster.slice();
        }
        state.baseCount = Math.max(1, roster.length);
        state.slots = roster.map((name) => makeEmptySlot(name));
        renderSheet();
        syncRosterInputFromState();
        if (!(opts && opts.keepStatus)) {
            setStatus('Type masseuse names in turn order, then click Load appointments.');
        }
        void prefetchDayForPicker(d);
    }

    function openDate(date) {
        const input = document.getElementById('mssDate');
        const d = date || (input && input.value) || getTodayLocal();
        if (input) input.value = d;
        const url = new URL(window.location.href);
        url.searchParams.set('date', d);
        window.history.replaceState({}, '', url);
        state.date = d;
        state.edits = loadEdits(d);
        if (rosterHasNames(state.edits.roster)) {
            loadSheet();
        } else {
            showEmptySheet(d);
        }
    }

    function maybeRebuildAfterRosterChange() {
        persistFullSheet();
        if (sheetHasDistributedRows()) {
            syncRosterInputFromState();
            scheduleRebuildAfterNameChange();
            return;
        }
        showEmptySheet(state.date, { keepStatus: true });
        setStatus('Name saved. Click Load appointments to distribute.');
    }

    function applyTypedMasseuseName(slotIdx, nameInput) {
        const next = String((nameInput && nameInput.value) || '').trim();
        const result = applyMasseuseNameWithSwap(slotIdx, next);
        if (nameInput) nameInput.classList.add('edited');
        if (result.swapped) {
            setStatus(
                'Swapped ' +
                    (firstName(result.prev) || '—') +
                    ' ↔ ' +
                    (firstName(result.next) || '—')
            );
        }
        maybeRebuildAfterRosterChange();
    }

    function renderSheet() {
        const sheet = document.getElementById('mssSheet');
        const grid = document.getElementById('mssGrid');
        const extra = document.getElementById('mssGridExtra');
        if (!sheet || !grid || !extra) return;
        sheet.hidden = false;
        renderDateBoxes(state.date);
        grid.innerHTML = '';
        extra.innerHTML = '';
        extra.hidden = true;

        const base = state.baseCount || BASE_SLOTS_MAX;
        const slots = state.slots;
        for (let i = 0; i < Math.min(base, slots.length); i++) {
            grid.appendChild(makeCard(slots[i], i));
        }
        if (slots.length > base) {
            extra.hidden = false;
            const lab = document.createElement('div');
            lab.className = 'mss-extra-label';
            lab.textContent = 'Additional masseuses (scroll if needed) — use × to remove';
            extra.appendChild(lab);
            for (let i = base; i < slots.length; i++) {
                extra.appendChild(makeCard(slots[i], i));
            }
        }
        requestAnimationFrame(() => {
            fitSheetToViewport();
            requestAnimationFrame(fitSheetToViewport);
        });
        syncRosterInputFromState();
    }

    async function loadSheet(opts) {
        const useTyped = opts && opts.useTypedRoster;
        prefetchGen += 1;
        const input = document.getElementById('mssDate');
        const date = (input && input.value) || getTodayLocal();
        if (input) input.value = date;
        const url = new URL(window.location.href);
        url.searchParams.set('date', date);
        window.history.replaceState({}, '', url);

        const bulkReplace = useTyped && rosterInputDirty;
        const typedRoster = useTyped ? collectTypedRosterFromUi() : null;

        state.date = date;
        const prevSlots = state.slots || [];
        state.edits = loadEdits(date);

        if (typedRoster && rosterHasNames(typedRoster)) {
            commitRoster(typedRoster);
        }
        if (bulkReplace) {
            clearAssignmentLocksForRedistribute();
        }
        if (!rosterHasNames(state.edits.roster)) {
            setStatus('Type masseuse names first, then click Load appointments.', true);
            showEmptySheet(date, { keepStatus: true });
            return;
        }

        setStatus('Loading appointments for ' + date + '…');
        try {
            /* Parallel: disk roster/locks + Square day (fast=1 skips per-therapist booking merge) */
            const [recRes, dayRes] = await Promise.all([
                fetch('/api/appt-records/' + encodeURIComponent(date)),
                fetch('/api/day?date=' + encodeURIComponent(date) + '&fast=1'),
            ]);

            try {
                if (recRes.ok) {
                    const rec = await recRes.json();
                    const diskEdits = (rec && rec.edits) || {};
                    if (Array.isArray(diskEdits.roster) && diskEdits.roster.length) {
                        if (!state.edits.roster || !state.edits.roster.length) {
                            state.edits.roster = diskEdits.roster.slice();
                        }
                    }
                    if (diskEdits.force_clear_locks === true) {
                        state.edits.rows = {};
                        if (Array.isArray(diskEdits.roster) && diskEdits.roster.length) {
                            state.edits.roster = diskEdits.roster.slice();
                        }
                        saveEdits();
                        const cleaned = Object.assign({}, diskEdits, {
                            force_clear_locks: false,
                            rows: state.edits.rows || {},
                            roster: state.edits.roster || diskEdits.roster || null,
                        });
                        void fetch('/api/appt-records/' + encodeURIComponent(date), {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(
                                Object.assign({}, rec, { edits: cleaned, date: date })
                            ),
                        });
                    }
                }
            } catch (e) {
                /* ignore missing / corrupt appt record */
            }

            /* Split/小工 must not pin-lock turn (bug: tip#30 Gillian froze Tina + advanced turn) */
            state.edits.rows = stripXgPinsFromEdits(state.edits.rows || {});
            const locks = collectAssignmentLocks(prevSlots, state.edits.rows || {});
            if (!dayRes.ok) {
                const err = await dayRes.json().catch(() => ({}));
                throw new Error(err.detail || dayRes.statusText || 'Failed to load');
            }
            const data = await dayRes.json();
            window._mssData = data;
            let slots = buildSheetAssignments(data, state.edits.extraCount, locks);
            const base = state.baseCount || BASE_SLOTS_MAX;
            /* Ensure empty extra slots exist for added masseuses */
            while (slots.length < base + state.edits.extraCount) {
                slots.push({
                    name: '',
                    rows: Array.from({ length: ROWS_PER }, () => ({
                        nm: '',
                        rm: '',
                        dur: '',
                        price: '',
                        tip: '',
                        note: '',
                        requested: false,
                        skillWarn: false,
                        empty: true,
                    })),
                    xgJobs: [],
                    extra: true,
                });
            }
            slots = applyRowSnapshots(slots);
            slots = applyEditsToSlots(slots);
            slots = reconcileSplitPartnersOnSlots(slots);
            slots = dedupeBidsOnSlots(slots);
            state.slots = slots;
            persistFullSheet();
            renderSheet();
            syncRosterInputFromState();
            const filled = slots.reduce(
                (n, s) => n + s.rows.filter((r) => r.nm || r.rm || r.price).length,
                0
            );
            const lockN = locks.length;
            setStatus(
                `Loaded ${date} · ${slots.filter((s) => s.name).length} named · ${filled} rows · ` +
                    (lockN ? lockN + ' pinned · ' : '') +
                    'distributed · saved to appt records'
            );
        } catch (e) {
            setStatus('Error: ' + (e.message || e), true);
        }
    }

    function clearEdits() {
        if (!state.date) return;
        if (!confirm('Clear names and appointments for ' + state.date + '? You can type names again, then Load appointments.')) return;
        const d = state.date;
        try {
            /* Wipe all legacy keys — otherwise Clear reloads old v4 roster and freezes empty cards */
            localStorage.removeItem(storageKey(d));
            localStorage.removeItem('mom_mss_edits_v6:' + d);
            localStorage.removeItem('mom_mss_edits_v5:' + d);
            localStorage.removeItem('mom_mss_edits_v4:' + d);
            localStorage.removeItem('mom_mss_edits_v3:' + d);
            localStorage.removeItem('mom_mss_edits_v2:' + d);
        } catch (e) {}
        state.edits = {
            names: {},
            cells: {},
            rows: {},
            extraCount: 0,
            roster: null,
            rowCounts: {},
            rowMeta: {},
        };
        rosterInputDirty = false;
        const rosterEl = document.getElementById('mssRosterInput');
        if (rosterEl) rosterEl.value = '';
        showEmptySheet(d);
    }

    function addMasseuse() {
        const typed = collectTypedRosterFromUi();
        const roster = (typed && typed.length ? typed.slice() : (state.edits.roster || []).slice());
        roster.push('');
        commitRoster(roster);
        state.edits.extraCount = 0;
        persistFullSheet();
        if (sheetHasDistributedRows()) {
            clearAssignmentLocksForRedistribute();
            loadSheet();
        } else {
            showEmptySheet(state.date);
        }
    }

    /**
     * Rules 8 + 21: remove any masseuse card; remaining list becomes the roster
     * and appointments redistribute among them on reload (including past).
     */
    async function removeMasseuse(slotIdx) {
        if (state.slots.length <= 1) {
            setStatus('Need at least one masseuse on the sheet', true);
            return;
        }
        const who = firstName(state.slots[slotIdx] && state.slots[slotIdx].name) || '#' + (slotIdx + 1);
        const distributed = sheetHasDistributedRows();
        if (
            !confirm(
                distributed
                    ? 'Remove ' + who + ' and redistribute appointments to the remaining masseuses?'
                    : 'Remove ' + who + ' from the sheet?'
            )
        ) {
            return;
        }
        const live = cardNamesFromDom();
        const roster = (live.length ? live : (state.edits.roster || []).slice());
        roster.splice(slotIdx, 1);
        const kept = dedupeRosterNames(roster);
        commitRoster(kept.length ? kept : ['']);
        state.edits.cells = {};
        state.edits.extraCount = 0;
        persistFullSheet();
        if (distributed) {
            clearAssignmentLocksForRedistribute();
            await loadSheet();
            setStatus('已按新名单重分（含过去的预约）· ' + kept.length + ' 人');
        } else {
            showEmptySheet(state.date);
        }
    }

    function shiftDay(delta) {
        const input = document.getElementById('mssDate');
        if (!input) return;
        input.value = addDaysToDate(input.value || getTodayLocal(), delta);
        openDate(input.value);
    }

    function workingMasseuseNames() {
        const data = window._mssData || {};
        const order = Array.isArray(data.therapist_order) ? data.therapist_order.slice() : [];
        order.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const names = [];
        for (const row of order) {
            const n = String((row && row.therapist) || '').trim();
            if (n && !names.some((x) => namesMatch(x, n))) names.push(n);
        }
        return names;
    }

    function allMasseuseNames() {
        const data = window._mssData || {};
        const all = [];
        for (const t of data.therapists || []) {
            const n = String(t || '').trim();
            if (n && !all.some((x) => namesMatch(x, n))) all.push(n);
        }
        for (const n of workingMasseuseNames()) {
            if (!all.some((x) => namesMatch(x, n))) all.push(n);
        }
        all.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        return all;
    }

    function hideMasseuseNamePicker(opts) {
        const keepEmpty = opts && opts.picked;
        const slotIdx = state.namePickerSlot;
        const modal = document.getElementById('mssNamePickerModal');
        if (modal) modal.hidden = true;
        /* Restore name if user cancelled with empty field */
        if (!keepEmpty && slotIdx >= 0 && state.namePickerPrevName != null) {
            const card = document.querySelector('.mss-card[data-slot="' + slotIdx + '"]');
            const nameInput = card && card.querySelector('.mss-name-input');
            if (nameInput && !String(nameInput.value || '').trim()) {
                nameInput.value = state.namePickerPrevName;
            }
        }
        state.namePickerSlot = -1;
        state.namePickerPrevName = null;
    }

    /** Rule 25: pick masseuse name — working (white) vs not working (gray). Swap if already on sheet. */
    function openMasseuseNamePicker(slotIdx) {
        state.namePickerSlot = slotIdx;
        const modal = document.getElementById('mssNamePickerModal');
        const list = document.getElementById('mssNamePickerList');
        const title = document.getElementById('mssNamePickerTitle');
        if (!modal || !list) return;
        if (title) title.textContent = 'Choose masseuse · #' + (slotIdx + 1);
        const card = document.querySelector('.mss-card[data-slot="' + slotIdx + '"]');
        const nameInput = card && card.querySelector('.mss-name-input');
        const currentName =
            (nameInput && nameInput.value) ||
            (state.slots[slotIdx] && state.slots[slotIdx].name) ||
            '';
        state.namePickerPrevName = String(currentName || '').trim();
        const working = workingMasseuseNames();
        const all = allMasseuseNames();
        list.innerHTML = '';
        function addSection(label, names, workingClass) {
            if (!names.length) return;
            const h = document.createElement('div');
            h.className = 'mss-name-picker-section';
            h.textContent = label;
            list.appendChild(h);
            names.forEach((n) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mss-picker-item ' + workingClass;
                btn.textContent = n;
                const otherIdx = findSlotIndexWithName(n, slotIdx);
                if (otherIdx >= 0) {
                    btn.title = 'Swap with #' + (otherIdx + 1);
                }
                btn.addEventListener('click', () => {
                    const result = applyMasseuseNameWithSwap(slotIdx, n);
                    persistFullSheet();
                    if (result.swapped) {
                        setStatus(
                            '已交换 #' +
                                (slotIdx + 1) +
                                ' ↔ #' +
                                (result.otherIdx + 1) +
                                ' · 过去预约也按轮班重分'
                        );
                    } else {
                        setStatus('已更新按摩师 · 按新顺序重分（含过去）');
                    }
                    hideMasseuseNamePicker({ picked: true });
                    maybeRebuildAfterRosterChange();
                });
                list.appendChild(btn);
            });
        }
        const workSet = working.slice();
        const notWork = all.filter((n) => !workSet.some((w) => namesMatch(w, n)));
        addSection('Working today', workSet, 'mss-working');
        addSection('Not working today', notWork, 'mss-not-working');
        if (!workSet.length && !notWork.length) {
            const empty = document.createElement('div');
            empty.className = 'mss-name-picker-section';
            empty.textContent = 'No Square names yet — type the name, or click Load appointments first';
            list.appendChild(empty);
        }
        modal.hidden = false;
    }

    function fillSkillsForm() {
        const set = (id, arr) => {
            const el = document.getElementById(id);
            if (el) el.value = (arr || []).join(', ');
        };
        set('mssSkillFacial', skills.facial);
        set('mssSkillTrigger', skills.trigger);
        set('mssSkillCupping', skills.fireCupping);
        set('mssSkillManual', skills.manualOnly);
    }

    function readSkillsFromForm() {
        skills = {
            facial: parseNameList(document.getElementById('mssSkillFacial')?.value),
            trigger: parseNameList(document.getElementById('mssSkillTrigger')?.value),
            fireCupping: parseNameList(document.getElementById('mssSkillCupping')?.value),
            manualOnly: parseNameList(document.getElementById('mssSkillManual')?.value),
        };
    }

    async function persistSkillsFromForm(reload) {
        readSkillsFromForm();
        const ok = await saveSkills();
        if (reload) {
            setStatus(ok ? 'Skills saved forever — reloading sheet…' : 'Skills saved in this browser only (server save failed) — reloading…');
            if (rosterHasNames(state.edits.roster) || sheetHasDistributedRows()) {
                loadSheet();
            }
        } else {
            setStatus(ok ? 'Skills saved forever' : 'Skills saved in this browser only (server save failed)');
        }
        return ok;
    }

    function applySkillsFromForm() {
        return persistSkillsFromForm(true);
    }

    async function init() {
        const input = document.getElementById('mssDate');
        if (input) input.value = getDateFromQuery();
        document.getElementById('mssLoadBtn')?.addEventListener('click', () => {
            persistFullSheet();
            loadSheet({ useTypedRoster: true });
        });
        document.getElementById('mssRefreshBtn')?.addEventListener('click', () => {
            persistFullSheet();
            loadSheet({ useTypedRoster: true });
        });
        const rosterEl = document.getElementById('mssRosterInput');
        rosterEl?.addEventListener('input', () => {
            rosterInputDirty = true;
        });
        rosterEl?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                rosterInputDirty = true;
                persistFullSheet();
                loadSheet({ useTypedRoster: true });
            }
        });
        document.getElementById('mssPrevDay')?.addEventListener('click', () => {
            persistFullSheet();
            shiftDay(-1);
        });
        document.getElementById('mssNextDay')?.addEventListener('click', () => {
            persistFullSheet();
            shiftDay(1);
        });
        document.getElementById('mssPrintBtn')?.addEventListener('click', () => window.print());
        document.getElementById('mssClearEditsBtn')?.addEventListener('click', clearEdits);
        document.getElementById('mssSkillsBtn')?.addEventListener('click', toggleSkillsPanel);
        document.getElementById('mssAddMasseuseBtn')?.addEventListener('click', addMasseuse);
        document.getElementById('mssDetailClose')?.addEventListener('click', hideDetailModal);
        document.getElementById('mssDetailBackdrop')?.addEventListener('click', hideDetailModal);
        document.getElementById('mssDetailApplyBtn')?.addEventListener('click', applyDetailSplit);
        document.getElementById('mssPickerCloseBtn')?.addEventListener('click', hidePickerModal);
        document.getElementById('mssPickerBackdrop')?.addEventListener('click', hidePickerModal);
        document.getElementById('mssPickerClearBtn')?.addEventListener('click', clearPickerRow);
        document.getElementById('mssPickerDetailsBtn')?.addEventListener('click', () => {
            const bid = state.picker.selectedBid;
            if (bid) showDetailModal(bid);
        });
        document.getElementById('mssPickerSearch')?.addEventListener('input', (e) => {
            renderPickerList(e.target.value);
        });
        document.getElementById('mssNamePickerCloseBtn')?.addEventListener('click', hideMasseuseNamePicker);
        document.getElementById('mssNamePickerBackdrop')?.addEventListener('click', hideMasseuseNamePicker);
        document.getElementById('mssSkillsSaveBtn')?.addEventListener('click', applySkillsFromForm);
        document.getElementById('mssSkillsResetBtn')?.addEventListener('click', async () => {
            skills = cloneDefaultSkills();
            const ok = await saveSkills();
            fillSkillsForm();
            setStatus(ok ? 'Skills reset to defaults (saved forever)' : 'Skills reset (browser only)');
            if (rosterHasNames(state.edits.roster) || sheetHasDistributedRows()) {
                loadSheet();
            }
        });
        /* Auto-save when leaving a skills field (no reload); Save button reloads sheet */
        ['mssSkillFacial', 'mssSkillTrigger', 'mssSkillCupping', 'mssSkillManual'].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', () => {
                persistSkillsFromForm(false);
            });
        });
        fillSkillsForm();
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const panel = document.getElementById('mssSkillsPanel');
                if (panel?.classList.contains('open')) {
                    toggleSkillsPanel();
                    return;
                }
                hidePickerModal();
                hideMasseuseNamePicker();
                hideDetailModal();
            }
        });
        input?.addEventListener('change', () => {
            persistFullSheet();
            openDate(input.value);
        });
        window.addEventListener('resize', () => fitSheetToViewport());
        window.addEventListener('beforeunload', () => persistFullSheet());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') persistFullSheet();
        });
        /* Rule 22: refresh in-progress green highlight */
        if (state.nowTimer) clearInterval(state.nowTimer);
        state.nowTimer = setInterval(() => {
            if (state.slots.length && document.getElementById('mssSheet') && !document.getElementById('mssSheet').hidden) {
                renderSheet();
            }
        }, 60000);
        await hydrateSkillsFromServer();
        openDate(input?.value || getTodayLocal());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
