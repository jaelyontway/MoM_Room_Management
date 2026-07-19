/**
 * Masseuse scheduling sheet — rules from static/docs/sheet_rules.md
 */
(function () {
    'use strict';

    const BASE_SLOTS = 9;
    const ROWS_PER = 9;
    const STORAGE_PREFIX = 'mom_mss_edits_v4:';

    /** Auto-assign preferences (manager may override by editing). */
    const FACIAL_ONLY = ['Tina'];
    /* Roster uses "Cassey T"; keep Casey alias for matching / skills */
    const TRIGGER_ONLY = ['Casey', 'Cassey', 'May'];

    let state = {
        date: '',
        slots: [], // { name, rows: [...], extra?: bool }
        edits: { names: {}, cells: {}, rows: {}, extraCount: 0 },
        calendarTips: {}, // "slot-row" -> tip from calendar
        picker: { slotIdx: -1, rowIdx: -1 },
    };

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
        const empty = { names: {}, cells: {}, rows: {}, extraCount: 0 };
        try {
            let raw = localStorage.getItem(storageKey(date));
            let fromLegacyFullSnap = false;
            if (!raw) {
                /* v3 saved every filled row and could freeze a bad layout — keep names/cells only */
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
            return {
                names: parsed.names || {},
                cells: parsed.cells || {},
                /* v4: only user-pinned / edited rows; skip v3 full-sheet freezes */
                rows: fromLegacyFullSnap ? {} : parsed.rows || {},
                extraCount: Math.max(0, parseInt(parsed.extraCount, 10) || 0),
            };
        } catch (e) {
            return empty;
        }
    }

    /**
     * Rule 15: save last user edits (names, cells, picker-pinned rows).
     * Auto-filled turn rows are NOT frozen — Refresh recalculates them (rules 3 + 17).
     */
    function persistFullSheet() {
        if (!state.date || !state.slots.length) {
            saveEdits();
            scheduleDiskSave();
            return;
        }
        const rows = {};
        state.slots.forEach((slot, s) => {
            (slot.rows || []).forEach((row, r) => {
                const key = s + '-' + r;
                const cellTouched = ['nm', 'rm', 'dur', 'price', 'tip', 'note'].some((f) =>
                    Object.prototype.hasOwnProperty.call(state.edits.cells, cellKey(s, r, f))
                );
                const pinned = !!row._pinned;
                if (!cellTouched && !pinned) return;
                rows[key] = {
                    nm: row.nm || '',
                    rm: row.rm || '',
                    dur: row.dur || '',
                    price: row.price || '',
                    tip: row.tip || '',
                    note: row.note || '',
                    bid: row._bid || '',
                    tipSlot: row._tipSlot || 1,
                    requested: !!row.requested,
                    pinned: true,
                };
            });
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
                })),
            })),
            edits: {
                names: state.edits.names || {},
                cells: state.edits.cells || {},
                rows: state.edits.rows || {},
                extraCount: state.edits.extraCount || 0,
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
            requested: ev.original_any_available === false,
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

    function findSheetRowByBid(bid) {
        if (!bid) return null;
        for (let s = 0; s < state.slots.length; s++) {
            for (let r = 0; r < ROWS_PER; r++) {
                const row = state.slots[s].rows[r];
                if (row && String(row._bid) === String(bid)) return { slotIdx: s, rowIdx: r, row };
            }
        }
        return null;
    }

    function applyRowSnapshots(slots) {
        const snaps = state.edits.rows || {};
        Object.keys(snaps).forEach((key) => {
            const parts = key.split('-');
            const s = parseInt(parts[0], 10);
            const r = parseInt(parts[1], 10);
            if (!Number.isFinite(s) || !Number.isFinite(r) || !slots[s]) return;
            const snap = snaps[key];
            if (!snap) return;
            while (slots[s].rows.length <= r) slots[s].rows.push(emptyRow());
            const ev = snap.bid ? findEventById(snap.bid) : null;
            const base = ev ? rowFromEvent(ev, snap.tipSlot || 1) : emptyRow();
            slots[s].rows[r] = {
                ...base,
                nm: snap.nm != null ? snap.nm : base.nm,
                rm: snap.rm != null ? snap.rm : base.rm,
                dur: snap.dur != null ? snap.dur : base.dur,
                price: snap.price != null ? snap.price : base.price,
                tip: snap.tip != null ? snap.tip : base.tip,
                note: snap.note != null ? snap.note : base.note,
                requested: !!snap.requested,
                _bid: snap.bid || base._bid || '',
                _tipSlot: snap.tipSlot || base._tipSlot || 1,
                empty: !(snap.nm || snap.bid),
                _pinned: true,
            };
        });
        return slots;
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
            const meta =
                (formatDurCol(ev) || formatTimeRange(ev) || '') +
                (roomLabel(ev) ? ' · Rm ' + roomLabel(ev) : '') +
                (priceDurationLabel(ev) ? ' · ' + priceDurationLabel(ev) + 'm' : '');
            const hay = (nm + ' ' + (ev.customer || '') + ' ' + meta + ' ' + (ev.room || '')).toLowerCase();
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

    /** Rule 16: put selected day appointment on this NM row; swap if already placed. */
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
        const existing = findSheetRowByBid(bid);
        const targetClone = cloneRow(state.slots[slotIdx].rows[rowIdx] || emptyRow());

        if (existing && (existing.slotIdx !== slotIdx || existing.rowIdx !== rowIdx)) {
            state.slots[existing.slotIdx].rows[existing.rowIdx] = {
                ...targetClone,
                empty: !(targetClone.nm || targetClone._bid),
                _pinned: true,
            };
            clearCellEditsForRow(existing.slotIdx, existing.rowIdx);
            setStatus(
                'Swapped with #' +
                    (existing.slotIdx + 1) +
                    ' row ' +
                    (existing.rowIdx + 1)
            );
        } else {
            setStatus('Assigned ' + (incoming.nm || 'customer') + ' to this row');
        }

        state.slots[slotIdx].rows[rowIdx] = { ...incoming, empty: false, _pinned: true };
        clearCellEditsForRow(slotIdx, rowIdx);
        persistFullSheet();
        hidePickerModal();
        renderSheet();
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

    function eventBlob(ev) {
        return [
            ev.display_service,
            ev.service,
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

    /** Compact start–end for Dur column (no AM/PM, fits narrow 4-across cards). */
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
            const m = d.getMinutes();
            return m ? h + ':' + String(m).padStart(2, '0') : String(h);
        };
        return fmt(s) + '-' + fmt(e);
    }

    function showDetailModal(bid) {
        const modal = document.getElementById('mssDetailModal');
        const body = document.getElementById('mssDetailBody');
        const title = document.getElementById('mssDetailTitle');
        if (!modal || !body) return;
        const ev = findEventById(bid);
        if (!ev) {
            body.innerHTML = '<p>No appointment details found.</p>';
            modal.hidden = false;
            return;
        }
        if (title) title.textContent = customerShort(ev.customer) || 'Appointment';
        const svc = (ev.display_service || ev.service || '—').toString();
        const rows = [
            ['Customer', ev.customer || '—'],
            ['Time', formatTimeRange(ev) || '—'],
            ['Duration', (priceDurationLabel(ev) || '—') + ' min'],
            ['Room', roomLabel(ev) || ev.room || '—'],
            ['Service', svc],
            ['Masseuse', [ev.therapist, ev.therapist_2].filter(Boolean).join(' · ') || '—'],
            ['Tip', tipLabel(ev, 1) || (ev.tip_amount != null ? String(ev.tip_amount) : '—')],
            ['Tip 2', ev.type === 'couple' ? tipLabel(ev, 2) || '—' : ''],
            ['Note', noteFromEvent(ev) || '—'],
            ['Requested', ev.original_any_available === false ? 'Named / requested' : ev.original_any_available ? 'Any available' : '—'],
            ['Booking', ev.booking_id || '—'],
        ].filter((r) => r[1] !== '');
        body.innerHTML =
            '<dl>' +
            rows
                .map(
                    ([k, v]) =>
                        '<dt>' +
                        escapeHtml(k) +
                        '</dt><dd>' +
                        escapeHtml(String(v)) +
                        '</dd>'
                )
                .join('') +
            '</dl>';
        modal.hidden = false;
    }

    function hideDetailModal() {
        const modal = document.getElementById('mssDetailModal');
        if (modal) modal.hidden = true;
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

    function orderedRoster(data, extraCount) {
        const order = Array.isArray(data.therapist_order) ? data.therapist_order.slice() : [];
        order.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const names = [];
        const seen = new Set();
        function push(n) {
            n = String(n || '').trim();
            if (!n) return;
            const key = n.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            names.push(n);
        }
        for (const row of order) push(row && row.therapist);
        for (const t of data.therapists || []) push(t);
        const total = BASE_SLOTS + Math.max(0, extraCount || 0);
        while (names.length < total) names.push('');
        /* Rule 11: user-adjusted masseuse names drive re-assignment / skill matching */
        const edits = (state.edits && state.edits.names) || {};
        for (let i = 0; i < total; i++) {
            if (edits[String(i)] != null && String(edits[String(i)]).trim()) {
                names[i] = String(edits[String(i)]).trim();
            }
        }
        return names.slice(0, total);
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

    function buildSheetAssignments(data, extraCount) {
        const roster = orderedRoster(data, extraCount);
        const slots = roster.map((name, idx) => ({
            name,
            rows: [],
            extra: idx >= BASE_SLOTS,
        }));
        const reqByBid = requestMap(data);
        const slotCount = slots.length;

        const events = (data.events || [])
            .filter(isSheetEvent)
            .slice()
            .sort((a, b) => String(a.start_at || '').localeCompare(String(b.start_at || '')));

        function busyAt(slotIdx, start, end) {
            return slots[slotIdx].rows.some((r) => rangesOverlap(start, end, r._start, r._end));
        }
        function countSoFar(slotIdx) {
            return slots[slotIdx].rows.length;
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
                return FACIAL_ONLY.map(findRosterIndex).filter((i) => i >= 0);
            }
            if (needsTriggerPoint(ev)) {
                return TRIGGER_ONLY.map(findRosterIndex).filter((i) => i >= 0);
            }
            return null;
        }

        function pushRow(slotIdx, ev, tipSlot, requested, skillWarn) {
            if (slotIdx < 0 || slotIdx >= slotCount) return;
            const start = parseIso(ev.start_at);
            const end = parseIso(ev.display_end_at || ev.end_at);
            if (!start || !end) return;
            const now = Date.now();
            slots[slotIdx].rows.push({
                nm: customerShort(ev.customer),
                rm: roomLabel(ev),
                dur: formatDurCol(ev),
                price: priceDurationLabel(ev),
                tip: tipLabel(ev, tipSlot),
                note: noteFromEvent(ev),
                requested: !!requested,
                skillWarn: !!skillWarn,
                future: start.getTime() > now,
                _start: start,
                _end: end,
                _bid: ev.booking_id,
                _tipSlot: tipSlot,
            });
        }

        let turn = 0;

        function assignOne(ev, preferredName, tipSlot, forceRequest) {
            const start = parseIso(ev.start_at);
            const end = parseIso(ev.display_end_at || ev.end_at);
            if (!start || !end) return -1;

            const skillIdxs = findPreferredSkillIndexes(ev);

            if (forceRequest) {
                let idx = findRosterIndex(preferredName);
                if (idx >= 0) {
                    const warn =
                        (skillIdxs && skillIdxs.length && skillIdxs.indexOf(idx) < 0) ||
                        (needsFacialOrLymphatic(ev) && !nameInList(roster[idx], FACIAL_ONLY)) ||
                        (needsTriggerPoint(ev) && !nameInList(roster[idx], TRIGGER_ONLY));
                    pushRow(idx, ev, tipSlot, true, warn);
                    /* Rule 17: requested appts still consume a turn */
                    turn = (idx + 1) % Math.max(slotCount, 1);
                    return idx;
                }
                /* Requested name missing from sheet roster — fall through to turn order */
            }

            /* Skill-constrained pool for auto turn (facial→Tina, trigger→Casey/May) */
            let pool = [];
            for (let i = 0; i < slotCount; i++) {
                if (!roster[i]) continue;
                if (busyAt(i, start, end)) continue;
                if (skillIdxs && skillIdxs.length && skillIdxs.indexOf(i) < 0) continue;
                pool.push(i);
            }
            /* If skill people all busy / missing, fall back to anyone free (manager can reassign) */
            if (!pool.length) {
                for (let i = 0; i < slotCount; i++) {
                    if (!roster[i]) continue;
                    if (busyAt(i, start, end)) continue;
                    pool.push(i);
                }
            }

            let prefIdx = findRosterIndex(preferredName);
            if (prefIdx >= 0 && pool.indexOf(prefIdx) >= 0) {
                const warn = skillIdxs && skillIdxs.length && skillIdxs.indexOf(prefIdx) < 0;
                pushRow(prefIdx, ev, tipSlot, false, warn);
                turn = (prefIdx + 1) % Math.max(slotCount, 1);
                return prefIdx;
            }

            if (!pool.length) {
                let best = -1;
                let bestCount = Infinity;
                for (let k = 0; k < slotCount; k++) {
                    const i = (turn + k) % slotCount;
                    if (!roster[i]) continue;
                    const c = countSoFar(i);
                    if (c < bestCount) {
                        bestCount = c;
                        best = i;
                    }
                }
                if (best >= 0) {
                    const warn = skillIdxs && skillIdxs.length && skillIdxs.indexOf(best) < 0;
                    pushRow(best, ev, tipSlot, false, warn);
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
            pushRow(pick, ev, tipSlot, false, warn);
            turn = (pick + 1) % slotCount;
            return pick;
        }

        for (const ev of events) {
            const isCouple = String(ev.type || '').toLowerCase() === 'couple';
            const anyAvail = ev.original_any_available === true;
            const reqNames = reqByBid.get(String(ev.booking_id || '')) || [];
            const hasRequest = reqNames.length > 0 || anyAvail === false;

            if (isCouple) {
                const t1 = (ev.therapist || '').trim();
                const t2 = (ev.therapist_2 || '').trim();
                /* Couples need 2 at once: requested names first, partner by turn if only one request */
                if (hasRequest) {
                    const r0 = reqNames[0] || t1;
                    const r1 = reqNames[1] || t2;
                    assignOne(ev, r0, 1, !!r0);
                    if (r1) assignOne(ev, r1, 2, reqNames.length > 1 || (!!t2 && anyAvail === false));
                    else assignOne(ev, '', 2, false);
                } else {
                    assignOne(ev, t1, 1, false);
                    assignOne(ev, t2, 2, false);
                }
            } else {
                const t1 = (ev.therapist || '').trim();
                if (hasRequest) {
                    assignOne(ev, reqNames[0] || t1, 1, true);
                } else {
                    assignOne(ev, t1, 1, false);
                }
            }
        }

        for (const slot of slots) {
            slot.rows.sort((a, b) => a._start - b._start);
            while (slot.rows.length < ROWS_PER) {
                slot.rows.push({
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
                });
            }
            slot.rows = slot.rows.slice(0, ROWS_PER);
        }
        return slots;
    }

    function cellKey(slotIdx, rowIdx, field) {
        return slotIdx + '-' + rowIdx + '-' + field;
    }

    function applyEditsToSlots(slots) {
        const tips = {};
        for (let s = 0; s < slots.length; s++) {
            const editName = state.edits.names[String(s)];
            if (editName != null) slots[s].name = editName;
            for (let r = 0; r < ROWS_PER; r++) {
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
                slots[s].rows[r] = row;
            }
        }
        state.calendarTips = tips;
        return slots;
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
            (document.getElementById('mssRules')?.offsetHeight || 0) +
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
        nameInput.placeholder = 'Masseuse first name';
        nameInput.value = firstName(slot.name) || slot.name || '';
        nameInput.title = 'Editable — manager can put any name (overrides skill rules)';
        if (state.edits.names[String(slotIdx)] != null) nameInput.classList.add('edited');
        nameInput.addEventListener('change', () => {
            state.edits.names[String(slotIdx)] = nameInput.value;
            nameInput.classList.add('edited');
            persistFullSheet();
            scheduleRebuildAfterNameChange();
        });
        nameInput.addEventListener('input', () => {
            state.edits.names[String(slotIdx)] = nameInput.value;
            nameInput.classList.add('edited');
            persistFullSheet();
        });
        title.appendChild(num);
        title.appendChild(nameInput);
        card.appendChild(title);

        const table = document.createElement('table');
        table.className = 'mss-table';
        table.innerHTML =
            '<thead><tr>' +
            '<th class="col-num">#</th><th class="col-nm">NM</th><th class="col-rm">RM</th>' +
            '<th class="col-dur">Dur</th><th class="col-price">Price</th><th class="col-tip">Tip</th><th class="col-note">Note</th>' +
            '</tr></thead><tbody></tbody>';
        const tbody = table.querySelector('tbody');

        for (let r = 0; r < ROWS_PER; r++) {
            const row = slot.rows[r] || {};
            const tr = document.createElement('tr');
            if (row.requested) tr.classList.add('row-req');
            if (row.skillWarn) tr.classList.add('row-warn');

            const tdNum = document.createElement('td');
            tdNum.className = 'num';
            tdNum.textContent = String(r + 1);
            tr.appendChild(tdNum);

            for (const field of ['nm', 'rm', 'dur', 'price', 'tip', 'note']) {
                const td = document.createElement('td');
                td.className = field;
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'mss-cell';
                input.value = row[field] != null ? String(row[field]) : '';
                input.dataset.slot = String(slotIdx);
                input.dataset.row = String(r);
                input.dataset.field = field;
                if (row['_' + field + 'Edited']) input.classList.add('edited');
                if (field === 'nm') {
                    input.classList.add('mss-nm-clickable');
                    input.title = 'Click to choose another customer · double-click to type a name';
                    input.readOnly = true;
                    input.placeholder = '';
                    let nmClickTimer = null;
                    input.addEventListener('click', () => {
                        if (nmClickTimer) clearTimeout(nmClickTimer);
                        nmClickTimer = setTimeout(() => {
                            nmClickTimer = null;
                            openPicker(slotIdx, r);
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
                    const k = cellKey(slotIdx, r, field);
                    state.edits.cells[k] = input.value;
                    if (state.slots[slotIdx] && state.slots[slotIdx].rows[r]) {
                        state.slots[slotIdx].rows[r][field] = input.value;
                        state.slots[slotIdx].rows[r]['_' + field + 'Edited'] = true;
                        state.slots[slotIdx].rows[r]._pinned = true;
                    }
                    input.classList.add('edited');
                    persistFullSheet();
                });
                if (field === 'tip') {
                    input.addEventListener('change', () => {
                        void pushTipToCalendar(slotIdx, r, input.value);
                    });
                }
                td.appendChild(input);
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        card.appendChild(table);
        return card;
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

        const slots = state.slots;
        for (let i = 0; i < Math.min(BASE_SLOTS, slots.length); i++) {
            grid.appendChild(makeCard(slots[i], i));
        }
        if (slots.length > BASE_SLOTS) {
            extra.hidden = false;
            const lab = document.createElement('div');
            lab.className = 'mss-extra-label';
            lab.textContent = 'Additional masseuses (scroll if needed)';
            extra.appendChild(lab);
            for (let i = BASE_SLOTS; i < slots.length; i++) {
                extra.appendChild(makeCard(slots[i], i));
            }
        }
        requestAnimationFrame(() => {
            fitSheetToViewport();
            requestAnimationFrame(fitSheetToViewport);
        });
    }

    async function loadSheet() {
        const input = document.getElementById('mssDate');
        const date = (input && input.value) || getTodayLocal();
        if (input) input.value = date;
        const url = new URL(window.location.href);
        url.searchParams.set('date', date);
        window.history.replaceState({}, '', url);

        state.date = date;
        state.edits = loadEdits(date);

        setStatus('Loading schedule for ' + date + '…');
        try {
            const res = await fetch('/api/day?date=' + encodeURIComponent(date));
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || res.statusText || 'Failed to load');
            }
            const data = await res.json();
            window._mssData = data;
            let slots = buildSheetAssignments(data, state.edits.extraCount);
            /* Ensure empty extra slots exist for added masseuses */
            while (slots.length < BASE_SLOTS + state.edits.extraCount) {
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
                    extra: true,
                });
            }
            const hadPins = Object.keys(state.edits.rows || {}).length > 0;
            if (hadPins) slots = applyRowSnapshots(slots);
            slots = applyEditsToSlots(slots);
            state.slots = slots;
            persistFullSheet();
            renderSheet();
            const filled = slots.reduce(
                (n, s) => n + s.rows.filter((r) => r.nm || r.rm || r.price).length,
                0
            );
            setStatus(
                `Loaded ${date} · ${slots.filter((s) => s.name).length} named · ${filled} rows · ` +
                    (hadPins ? 'kept your pinned edits · ' : '') +
                    'saved to appt records · tips from calendar'
            );
        } catch (e) {
            setStatus('Error: ' + (e.message || e), true);
            const sheet = document.getElementById('mssSheet');
            if (sheet) sheet.hidden = true;
        }
    }

    function clearEdits() {
        if (!state.date) return;
        if (!confirm('Clear all local edits for ' + state.date + ' and reload from calendar?')) return;
        try {
            localStorage.removeItem(storageKey(state.date));
        } catch (e) {}
        state.edits = { names: {}, cells: {}, rows: {}, extraCount: 0 };
        loadSheet();
    }

    function addMasseuse() {
        persistFullSheet();
        state.edits.extraCount = (state.edits.extraCount || 0) + 1;
        persistFullSheet();
        loadSheet();
    }

    function shiftDay(delta) {
        const input = document.getElementById('mssDate');
        if (!input) return;
        input.value = addDaysToDate(input.value || getTodayLocal(), delta);
        loadSheet();
    }

    function init() {
        const input = document.getElementById('mssDate');
        if (input) input.value = getDateFromQuery();
        document.getElementById('mssLoadBtn')?.addEventListener('click', () => {
            persistFullSheet();
            loadSheet();
        });
        document.getElementById('mssRefreshBtn')?.addEventListener('click', () => {
            persistFullSheet();
            loadSheet();
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
        document.getElementById('mssAddMasseuseBtn')?.addEventListener('click', addMasseuse);
        document.getElementById('mssDetailClose')?.addEventListener('click', hideDetailModal);
        document.getElementById('mssDetailBackdrop')?.addEventListener('click', hideDetailModal);
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
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hidePickerModal();
                hideDetailModal();
            }
        });
        input?.addEventListener('change', () => {
            persistFullSheet();
            loadSheet();
        });
        window.addEventListener('resize', () => fitSheetToViewport());
        window.addEventListener('beforeunload', () => persistFullSheet());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') persistFullSheet();
        });
        loadSheet();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
