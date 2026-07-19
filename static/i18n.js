/**
 * Dashboard UI language: English, 中文, or bilingual (English + 中文).
 * Cycles with #langToggleBtn. Preference saved in localStorage.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'mom_ui_lang_mode';
    /** @type {'en'|'zh'|'both'} */
    const MODES = ['en', 'zh', 'both'];

    function getMode() {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            if (v === 'zh' || v === 'both' || v === 'en') return v;
        } catch (e) {}
        return 'en';
    }

    function setMode(mode) {
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch (e) {}
    }

    function cycleMode() {
        const i = MODES.indexOf(getMode());
        const next = MODES[(i + 1) % MODES.length];
        setMode(next);
        return next;
    }

    /** @param {{en:string, zh:string}} row */
    function format(row) {
        if (!row) return '';
        const mode = getMode();
        if (mode === 'zh') return row.zh || row.en;
        if (mode === 'both') {
            const z = row.zh || '';
            if (!z || z === row.en) return row.en;
            return row.en + ' \u00A0' + z;
        }
        return row.en;
    }

    /** @param {{en:string, zh:string}} row */
    function formatHtml(row) {
        if (!row) return '';
        const mode = getMode();
        if (mode === 'zh') return (row.zh || row.en).replace(/\n/g, '<br>');
        if (mode === 'both') {
            const z = row.zh || '';
            if (!z || z === row.en) return row.en.replace(/\n/g, '<br>');
            return (row.en + ' \u00A0' + z).replace(/\n/g, '<br>');
        }
        return row.en.replace(/\n/g, '<br>');
    }

    /**
     * @type {Record<string, {en:string, zh:string}>}
     */
    const STRINGS = {
        'doc.title': { en: 'Spa Room Management Dashboard', zh: '水疗房间管理' },
        'header.title': { en: 'Spa Room Management', zh: '水疗房间管理' },
        'label.date': { en: 'Date:', zh: '日期：' },
        'label.dateAria': { en: 'Date', zh: '日期' },
        'btn.load': { en: 'Load', zh: '加载' },
        'btn.squareOriHint': { en: 'ORI', zh: '原' },
        'btn.squareOriHintTitle': {
            en: 'Toggle: show Square-booked masseuse as up to 3 brick-red italic letters (first name) on each card — does not change layout.',
            zh: '切换：在每张预约卡上以最多三个砖红色斜体字母显示 Square 预约按摩师（名字）— 不改变排版。',
        },
        'btn.refresh': { en: 'Refresh', zh: '刷新' },
        'dayLayout.freezeLabel': { en: 'Lock Appointments for Day', zh: '锁定当日预约房间' },
        'dayLayout.freezeAria': { en: 'Lock appointments for the day (pin auto-assigned rooms)', zh: '锁定当日预约（固定自动排房）' },
        'dayLayout.freezeTitleUnchecked': {
            en: 'Check to pin every auto-assigned room for this calendar day. New Square bookings can still fill gaps; existing pinned placements will not move. Manual per-appointment locks are unchanged. Use “Lock from a time…” (or Shift+click the checkbox) to pin only later appointments.',
            zh: '勾选可固定当日全部自动排房。新 Square 预约仍可填入空档；已固定排房不会移动；单个手动锁房不变。用「按时间锁定」或 Shift+点击复选框可只固定较晚开始的预约。',
        },
        'dayLayout.lockFromTime': { en: 'Lock from a time…', zh: '按时间锁定…' },
        'dayLayout.lockFromTimeTitle': {
            en: 'Lock only appointments starting at or after a chosen time (Shift+click the checkbox for the same)',
            zh: '只固定所选时间及之后开始的预约（也可 Shift+点击复选框）',
        },
        'dayLayout.lockModalTitle': { en: 'Lock from a start time', zh: '按开始时间锁定' },
        'dayLayout.lockModalIntro': {
            en: 'Pin only auto-assigned rooms for appointments whose Square start time is on or after the time you pick. Earlier appointments stay auto-assigned (unpinned) unless you lock the full day with the checkbox.',
            zh: '只把「Square 预约开始时间」不早于所选时间的自动排房固定为当日布局钉；更早的预约仍为自动排房，除非你用复选框做全日锁定。',
        },
        'dayLayout.lockModalFieldLabel': { en: 'Appointments starting at or after', zh: '预约开始时间不早于' },
        'dayLayout.lockModalHint': {
            en: 'Comparison uses each booking’s scheduled start from Square. Combine with partial unlock if you need to remove only newer pin waves.',
            zh: '按 Square 每条预约的开始时间比较。若只需撤销较晚一批固定，可在解锁时选「按时间」部分解锁。',
        },
        'dayLayout.lockModalCancel': { en: 'Cancel', zh: '取消' },
        'dayLayout.lockModalConfirm': { en: 'Lock', zh: '锁定' },
        'dayLayout.lockModalNeedTime': {
            en: 'Choose a date and time on this calendar day.',
            zh: '请在该日历日内选择一个日期和时间。',
        },
        'dayLayout.lockModalBadTime': {
            en: 'Could not read that date and time.',
            zh: '无法识别该日期和时间。',
        },
        'dayLayout.freezeTitleLocked': {
            en: 'Locked on {date} at {time}. New Square bookings still slot into gaps. Uncheck to clear layout pins and re-run auto-assign (manual per-appointment locks stay).',
            zh: '已于 {date} {time} 锁定。新的 Square 预约仍可填入空档。取消勾选将清除当日布局固定并重新自动排房（单个手动锁房保留）。',
        },
        'dayLayout.freezeTitleLockedFallback': {
            en: 'This day\'s auto-assigned rooms are pinned (lock time unavailable). New Square bookings still slot into gaps. Uncheck to clear layout pins and re-run auto-assign (manual per-appointment locks stay).',
            zh: '当日自动排房已固定（无法显示锁定时间）。新的 Square 预约仍可填入空档。取消勾选将清除布局固定并重新自动排房（单个手动锁房保留）。',
        },
        'dayLayout.unlockTitle': {
            en: 'Unlock this day’s appointments?',
            zh: '要解锁当日的预约房间固定吗？',
        },
        'dayLayout.unlockIntro': {
            en: 'Are you sure you want to unlock layout pins for the calendar day you are viewing? You can remove every pin, or only pins from a more recent lock so earlier pins stay pinned.',
            zh: '确定要解锁当前查看的这一天的布局固定吗？可以清除全部固定，也可以只清除较晚一次锁定产生的固定，较早锁定的房间仍保持固定。',
        },
        'dayLayout.unlockLoading': { en: 'Loading lock history…', zh: '正在加载锁定记录…' },
        'dayLayout.unlockEventsLabel': { en: 'Lock / unlock history for this day', zh: '当日锁定 / 解锁记录' },
        'dayLayout.unlockHowLegend': { en: 'How should rooms unlock?', zh: '如何解锁？' },
        'dayLayout.unlockScopeAll': {
            en: 'Remove every layout pin for this day (full unlock)',
            zh: '清除当日全部布局固定（完全解锁）',
        },
        'dayLayout.unlockScopePartial': {
            en: 'Remove only pins promoted at or after a chosen time',
            zh: '只清除「不早于所选时间」才固定的那一批房间',
        },
        'dayLayout.unlockWaveSelectLabel': {
            en: 'Remove pins promoted at or after',
            zh: '清除以下时间及之后固定的房间',
        },
        'dayLayout.unlockWaveHint': {
            en: 'Choose a later time (for example 9:40 AM) to drop only the newest wave of pins; an earlier wave (such as 9:20 AM) stays pinned. Times are from when each lock was applied.',
            zh: '选较晚的时间（例如 9:40）只会撤销那一次及之后的固定；较早一次（如 9:20）固定的房间会保留。时间为每次点击「锁定当日」时的时间。',
        },
        'dayLayout.unlockEmptyWaves': {
            en: 'No layout pins were found in the database for this day. If the calendar still looks locked, refresh after closing.',
            zh: '数据库里这一天没有布局固定记录。若界面仍显示已锁定，请关闭后刷新。',
        },
        'dayLayout.unlockCancel': { en: 'Cancel', zh: '取消' },
        'dayLayout.unlockConfirm': { en: 'Unlock', zh: '解锁' },
        'dayLayout.unlockRefresh': { en: 'Refresh calendar', zh: '刷新日历' },
        'dayLayout.unlockTimelineLock': { en: 'Locked — {time}', zh: '已锁定 — {time}' },
        'dayLayout.unlockTimelineUnlock': { en: 'Unlocked — {time}', zh: '已解锁 — {time}' },
        'dayLayout.unlockWaveOption': { en: '{time} ({count} appointments)', zh: '{time}（{count} 个预约）' },
        'dayLayout.unlockPickWave': { en: 'Pick a time from the list.', zh: '请从列表中选择一个时间。' },
        'btn.todayAppointments': { en: 'Day list', zh: '当日列表' },
        'btn.todayAppointmentsTitle': {
            en: 'View and export the selected day’s appointments (opens in Excel as UTF-8 CSV)',
            zh: '查看并导出所选日期的预约（UTF-8 CSV，可用 Excel 打开）',
        },
        'btn.newAppointments': { en: 'New Appointments', zh: '最新预约' },
        'btn.newAppointmentsTitle': {
            en: 'Square reservations sorted by when they were booked (newest first), with prepay / no-show hints',
            zh: '按 Square 预约创建时间排序（最新在前），含预付款/未到提示',
        },
        'todayAppts.title': { en: 'Appointments for this date', zh: '该日预约' },
        'todayAppts.titleDate': { en: 'Appointments — {date}', zh: '预约 — {date}' },
        'todayAppts.empty': {
            en: 'Load the calendar for this date first (Load / Refresh), then open this list again.',
            zh: '请先加载该日期的日历（加载 / 刷新），再打开此列表。',
        },
        'todayAppts.exportExcel': { en: 'Export for Excel (.csv)', zh: '导出为 Excel（.csv）' },
        'todayAppts.exportExcelTitle': {
            en: 'Download UTF-8 CSV with BOM (opens correctly in Excel)',
            zh: '下载带 BOM 的 UTF-8 CSV（在 Excel 中可正确显示中文）',
        },
        'todayAppts.pinLabel': {
            en: 'PIN (unlock past for detail)',
            zh: '密码（解锁已过预约以便编辑）',
        },
        'todayAppts.pinPlaceholder': { en: 'PIN', zh: '密码' },
        'todayAppts.pinApply': { en: 'Apply', zh: '确认' },
        'todayAppts.pinOk': {
            en: 'PIN accepted. Click Edit on a row, then change therapist, tip, or prepayment in the detail window.',
            zh: '密码正确。点击某一行的「编辑」，在详情中修改按摩师、小费或预付款。',
        },
        'todayAppts.pinBad': { en: 'Incorrect PIN.', zh: '密码错误。' },
        'todayAppts.colEdit': { en: 'Edit', zh: '编辑' },
        'todayAppts.edit': { en: 'Edit', zh: '编辑' },
        'todayAppts.colStart': { en: 'Start', zh: '开始' },
        'todayAppts.colEnd': { en: 'End', zh: '结束' },
        'todayAppts.colLength': { en: 'Length (min)', zh: '时长（分钟）' },
        'todayAppts.colRoom': { en: 'Room', zh: '房间' },
        'todayAppts.roomBookingShort': { en: 'booking', zh: '预约' },
        'todayAppts.roomBookingLine': { en: 'Couple booking room', zh: '双人预约房间' },
        'todayAppts.colCustomer': { en: 'Customer', zh: '客人' },
        'todayAppts.colRequested': { en: 'Requested masseuse', zh: '指定按摩师' },
        'todayAppts.colService': { en: 'Service (calendar)', zh: '项目（日历）' },
        'todayAppts.colAssigned': { en: 'Assigned therapists', zh: '已排按摩师' },
        'todayAppts.colNotes': { en: 'Notes', zh: '备注' },
        'todayAppts.noteSeller': { en: 'Seller', zh: '店员' },
        'todayAppts.noteCustomer': { en: 'Customer', zh: '客人' },
        'todayAppts.noteAddon': { en: 'Add-on', zh: '加项' },
        'history.resyncFromSquare': { en: 'Re-fetch this day from Square…', zh: '从 Square 重新拉取当日…' },
        'history.resyncTitle': {
            en: 'Slow: reloads bookings from Square and replaces the saved copy for this date. Use only for rare corrections.',
            zh: '较慢：从 Square 重新加载预约并覆盖本地存档。仅用于偶尔纠错。',
        },
        'history.resyncConfirm': {
            en: 'Reload this entire day from Square? This can take a moment and will replace the saved offline copy for this date.',
            zh: '确定从 Square 重新加载整天？可能需要片刻，并将覆盖该日的本地存档。',
        },
        'btn.undoRoom': { en: 'Undo room change', zh: '撤销换房' },
        'btn.undoRoomTitle': { en: 'Undo last room change for this day', zh: '撤销当天最近一次换房' },
        'view.byRoom': { en: 'By Room', zh: '按房间' },
        'view.byMasseuse': { en: 'By Masseuse', zh: '按按摩师' },
        'view.toggleTitle': { en: 'Toggle calendar view', zh: '切换日历视图' },
        'btn.checkinCheckout': { en: 'Check-In<br>Check-Out', zh: '到店<br>离店' },
        'btn.checkinCheckoutShort': { en: 'CI / CO', zh: '到/离' },
        'btn.checkinCheckoutTitle': { en: 'Show or hide check-in and checkout panels', zh: '显示或隐藏到店与离店面板' },
        'staff.staffToday': { en: 'Staff today', zh: '今日按摩师人数' },
        'staff.staffTodayLink': { en: 'Staff', zh: '今日按摩师人数' },
        'staff.staffTodayRest': { en: 'today', zh: '' },
        'staff.staffTodayAria': { en: 'Massage therapists scheduled today (for appointment capacity)', zh: '今日排班按摩师人数（用于可预约计算）' },
        'staff.facialSpecialistsToday': { en: 'Facial specialists today', zh: '今日面部护理师人数' },
        'staff.facialSpecialistsLink': { en: 'Facial specialists', zh: '今日面部护理师人数' },
        'staff.facialSpecialistsRest': { en: 'today', zh: '' },
        'staff.availTitleMassage': { en: 'Massage staff available today', zh: '今日在岗按摩师' },
        'staff.availTitleFacial': { en: 'Facial specialists available today', zh: '今日在岗面部护理师' },
        'staff.availHintNoRoster': {
            en: 'Load the calendar once (Load) to list therapists by name. You can still set the count with the number menu.',
            zh: '请先点击「加载」打开日历一次，以显示按摩师姓名。仍可用右侧数字调整人数。',
        },
        'staff.availApply': { en: 'Apply', zh: '应用' },
        'staff.pastDayLockedBanner': {
            en: 'This date is in the past — staffing turn order is locked.',
            zh: '该日期已过 — 排班顺序已锁定。',
        },
        'staff.pastDayUnlockBtn': { en: 'Unlock to edit', zh: '解锁编辑' },
        'staff.pastDayUnlockConfirm': {
            en: 'Are you sure you want to change staffing for a prior day? This updates the saved turn order for that date.',
            zh: '确定要修改已过日期的排班吗？将更新该日期的已保存上场顺序。',
        },
        'staff.availTurnPreviewTitle': { en: 'Turn order', zh: '上场顺序' },
        'staff.availTurnCountsPastTitle': { en: 'So far', zh: '已开始' },
        'staff.availTurnCountsFutureTitle': { en: 'Booked later', zh: '稍后预约' },
        'staff.availTurnCountsFutureLine1': { en: 'Booked', zh: '预约' },
        'staff.availTurnCountsFutureLine2': { en: 'Later', zh: '稍后' },
        'staff.availTurnNextLaterShort': { en: 'Next', zh: '下一' },
        'staff.availTurnNextLaterTitle': {
            en: 'Start time of the next appointment in the Booked later count (earliest future slot)',
            zh: '「稍后预约」中下一笔预约的开始时间（最早的未来时段）',
        },
        'staff.availTurnCountsAnyStaffTitle': { en: 'Any staff', zh: '任意技师' },
        'staff.availTurnCountsAnyStaffTitleHint': {
            en: 'Open “any staff” massage slots (Staff/empty) still to fill — count here is how many fall to this person in turn order, with couple = 2 slots.',
            zh: '仍为 Staff/空的「任意技师」按摩档位数；此列显示按上场顺序模拟分给该技师的数量（双人计两位）。',
        },
        'staff.availTurnTipAnyStaffEmpty': {
            en: 'No upcoming bookings in the “any staff” queue.',
            zh: '没有处于「任意技师」队列的后续预约。',
        },
        'staff.availTurnTipAnyStaffFacial': {
            en: 'This column applies to massage staffing only.',
            zh: '此列仅用于按摩排班。',
        },
        'staff.availTurnTipAnyStaffRosterEmpty': {
            en: 'No “any staff” slots assigned to this therapist in the current turn order (or none remain open on Staff/empty slots).',
            zh: '按当前上场顺序，没有可分给该技师的「任意技师」空档（或 Staff/空位已排满）。',
        },
        'staff.availTurnTipCoupleSlot2': {
            en: '2nd masseuse',
            zh: '第二位按摩师',
        },
        'staff.availTurnTipAnyStaffNoPool': {
            en: 'Check at least one massage therapist to preview how “any staff” slots are shared.',
            zh: '请至少勾选一位按摩师，以预览「任意技师」空档如何分配。',
        },
        'staff.availTurnTipEmpty': { en: 'No appointments in this category.', zh: '该类别暂无预约。' },
        'staff.availTurnTipColNum': { en: '#', zh: '#' },
        'staff.availTurnTipColTime': { en: 'Start–end', zh: '起止' },
        'staff.availTurnTipColService': { en: 'Service', zh: '项目' },
        'staff.availTurnTipColTip': { en: 'Tip', zh: '小费' },
        'staff.availTurnTipColCustomer': { en: 'Customer', zh: '客人' },
        'staff.availTurnTipByUsAria': { en: 'Booked by us', zh: '店内预约' },
        'staff.availTurnTipRequestedColTitle': { en: 'Customer requested this therapist', zh: '客人指定该按摩师' },
        'staff.availTurnTipRequestedColShort': { en: 'Req', zh: '指定' },
        'staff.availTurnTipRequestedAria': { en: 'Customer requested this therapist', zh: '客人指定该按摩师' },
        'staff.availTurnInputTitle': { en: 'Turn number', zh: '顺序号' },
        'staff.availTurnPreviewEmpty': { en: 'No one checked yet.', zh: '尚未勾选任何人。' },
        'staff.facialSpecialistsTodayAria': { en: 'Facial specialists scheduled today (for FS column capacity)', zh: '今日面部护理师人数（用于 FS 列可预约）' },
        'staff.masseusesToday': { en: 'Staff today', zh: '今日按摩师人数' },
        'staff.masseusesTodayAria': { en: 'Massage therapists scheduled today', zh: '今日排班按摩师人数' },
        'link.masseuseReport': { en: 'Masseuse report', zh: '按摩师报表' },
        'link.customersHoursReport': { en: 'Customers & hours', zh: '客户数与时长' },
        'link.serviceSummary': { en: 'Service summary', zh: '服务汇总' },
        'link.dailyGrid': { en: 'Daily grid', zh: '每日网格' },
        'link.dailyGridTitle': { en: 'Open daily grid sheet by masseuse (3×3)', zh: '按按摩师打开每日网格表（3×3）' },
        'link.servicesPay': { en: 'Services & Pay', zh: '服务与工资' },
        'link.checkinKiosk': { en: 'Check-in', zh: '客户登记' },
        'link.checkinKioskTitle': { en: 'Customer check-in kiosk', zh: '客户自助登记' },
        'link.glossary': { en: 'EN ↔ 中文 glossary', zh: '中英对照词汇表' },
        'link.glossaryTitle': { en: 'English–Chinese terms used on dashboard, check-in, and massage menu text', zh: '仪表板、到店与按摩菜单用语的中英对照' },
        'link.availabilityAudit': { en: 'Square vs rooms', zh: 'Square 与房间' },
        'link.availabilityAuditTitle': {
            en: 'Compare Square online booking slots to physical room rules for the selected day',
            zh: '对比所选日期 Square 线上可约时段与本系统物理房间规则',
        },
        'audit.modalTitle': { en: 'Square vs rooms audit', zh: 'Square 与房间对照' },
        'audit.intro': {
            en: 'Times in the tables are offered online in Square but have no matching physical room in this app — block those slots in Square or adjust staffing.',
            zh: '表格中的时间为 Square 线上可约但本应用无对应物理房 — 请在 Square 上占用该时段或调整排班。',
        },
        'audit.dateLabel': { en: 'Date', zh: '日期' },
        'audit.durationLabel': { en: 'Duration (min)', zh: '时长（分钟）' },
        'audit.runBtn': { en: 'Run audit', zh: '运行对照' },
        'audit.loading': { en: 'Loading…', zh: '加载中…' },
        'audit.summaryLabel': { en: 'Summary', zh: '摘要' },
        'audit.headingSingle': { en: 'Single (configured service)', zh: '单人（配置的服务）' },
        'audit.headingCouple': { en: 'Couple (configured service)', zh: '情侣/双人（配置的服务）' },
        'audit.variationId': { en: 'Variation ID', zh: '变体 ID' },
        'audit.resolved': { en: 'Resolved', zh: '解析方式' },
        'audit.squareStarts': { en: 'Square starts this day', zh: '当日 Square 可约起点数' },
        'audit.nextRoomLine': {
            en: 'Next free room (app rules): {time} (Rm {room})',
            zh: '下一空房（本应用规则）：{time}（{room} 号房）',
        },
        'audit.nextRoomNone': {
            en: 'No next room slot in range (by app rules for this duration).',
            zh: '时段内无下一空房（按本应用该时长规则）。',
        },
        'audit.noDiscrepancies': {
            en: 'No discrepancies: every Square start time has a matching room.',
            zh: '无差异：每个 Square 可约起点都有对应房间。',
        },
        'audit.colLocal': { en: 'Start (local)', zh: '开始（本地）' },
        'audit.colUtc': { en: 'Start (ISO)', zh: '开始（ISO）' },
        'audit.blockHint': {
            en: 'Block these times in Square Appointments (or reduce staff availability) so customers cannot book without a room.',
            zh: '请在 Square 预约中占用这些时间（或减少可约员工），避免客人在无房时可约。',
        },
        'audit.fetchFailed': { en: 'Could not load audit.', zh: '无法加载对照结果。' },
        'date.prevTitle': { en: 'Previous day', zh: '前一天' },
        'date.nextTitle': { en: 'Next day', zh: '后一天' },
        'date.jumpToday': { en: 'Today', zh: '今天' },
        'date.jumpTodayTitle': { en: 'Jump to today’s date and load the calendar', zh: '跳到今天的日期并加载日历' },
        'date.quickTabsAria': { en: 'Jump to today or the next three days', zh: '快捷日期：今天起往后三天' },
        'date.quickTabTodayTitle': { en: 'Go to today', zh: '转到今天' },
        'date.openPicker': { en: 'Pick', zh: '选日期' },
        'date.openPickerTitle': { en: 'Open the calendar date picker', zh: '打开日期选择器' },
        'date.calendarIconAria': { en: 'Open calendar', zh: '打开日历' },
        'calendar.enterFullscreen': { en: 'Full screen', zh: '全屏' },
        'calendar.enterFullscreenTitle': { en: 'Show the calendar using the whole screen', zh: '全屏显示日历' },
        'calendar.exitFullscreenTitle': { en: 'Exit full screen (or press Esc)', zh: '退出全屏（或按 Esc）' },
        'calendar.exitFullscreenAria': { en: 'Exit full screen', zh: '退出全屏' },
        'calendar.fullscreenNeedCalendar': { en: 'Load the calendar first.', zh: '请先加载日历。' },
        'calendar.fullscreenUnsupported': { en: 'Full screen is not supported in this browser.', zh: '此浏览器不支持全屏。' },
        'calendar.fullscreenError': { en: 'Could not enter full screen.', zh: '无法进入全屏。' },
        'date.hoverSummary': { en: 'Customers: {n} · Total: {t}', zh: '客人数：{n} · 总时长：{t}' },
        'noRooms.title': { en: 'Block time on Square (no room / limited rooms)', zh: '在 Square 上占用时段（无房 / 房间紧张）' },
        'noRooms.headerTitle': { en: 'Click to expand or collapse', zh: '点击展开或收起' },
        'loading': { en: 'Loading...', zh: '加载中…' },
        'unassigned.title': { en: '⚠️ Unassigned Bookings', zh: '⚠️ 未分配房间的预约' },
        'unassigned.suggestionsTitle': {
            en: 'Suggested fixes (least disruptive first)',
            zh: '建议处理顺序（优先少打扰客人）',
        },
        'unassigned.suggestionsShortLead': {
            en: 'Ideas (verify on calendar before changing Square):',
            zh: '可行思路（改 Square 前请在日历上核对）:',
        },
        'unassignedSug.assignDirect': {
            en: 'Assign {customer} to Rm {room} (no other booking changes).',
            zh: '将 {customer} 分到 {room} 号房（无需改动其他预约）。',
        },
        'unassignedSug.moveThenAssign': {
            en: 'Move {other} from Rm {fromRoom} → Rm {toRoom}, then assign {customer} to Rm {room} (one other room change).',
            zh: '先把 {other} 从 {fromRoom} 号房挪到 {toRoom} 号房，再把 {customer} 分到 {room} 号房（动一位客人的房间）。',
        },
        'unassignedSug.squareShift': {
            en: 'If {customer} can start at {span} in Square then Refresh, Rm {room} is open (only that booking’s time changes).',
            zh: '若在 Square 把 {customer} 改到 {span} 开始并刷新，{room} 号房该时段空（只动这一条预约时间）。',
        },
        'panel.checkins': { en: 'Check-In', zh: '到店' },
        'panel.checkouts': { en: 'Check-Out', zh: '离店' },
        'panel.minimize': { en: 'Minimize', zh: '最小化' },
        'panel.close': { en: 'Close', zh: '关闭' },
        'deskNote.panelPreviewLangAria': {
            en: 'Language for desk note previews when you hover notes',
            zh: '悬停查看前台备注时的显示语言',
        },
        'deskNote.langEnTitle': { en: 'Show desk note previews in English', zh: '备注预览显示为英文' },
        'deskNote.langZhTitle': { en: 'Show desk note previews in Chinese', zh: '备注预览显示为中文' },
        'newAppts.title': { en: 'New Appointments (Square)', zh: '最新预约（Square）' },
        'newAppts.mockBanner': {
            en: 'Demo data — configure Square in .env for live “booked at” order.',
            zh: '演示数据 — 在 .env 中配置 Square 后可看真实「预约创建」排序。',
        },
        'newAppts.limitLabel': { en: 'Show', zh: '显示' },
        'newAppts.limitSuffix': { en: 'rows', zh: '条' },
        'newAppts.refresh': { en: 'Refresh', zh: '刷新' },
        'newAppts.loading': { en: 'Loading…', zh: '加载中…' },
        'newAppts.error': { en: 'Could not load data.', zh: '无法加载数据。' },
        'newAppts.empty': { en: 'No bookings returned.', zh: '没有返回预约。' },
        'newAppts.colBooked': { en: 'Booked at', zh: '预约创建时间' },
        'newAppts.colApptTime': { en: 'Appointment', zh: '服务时段' },
        'newAppts.colCustomer': { en: 'Customer', zh: '客人' },
        'newAppts.colService': { en: 'Service', zh: '项目' },
        'newAppts.colTherapist': { en: 'Masseuse', zh: '按摩师' },
        'newAppts.colStatus': { en: 'Square status', zh: 'Square 状态' },
        'newAppts.colBookedBy': { en: 'Booked by', zh: '预约方' },
        'newAppts.colRisk': { en: 'Prepay / risk', zh: '预付/风险' },
        'newAppts.riskNoShow': {
            en: 'No-show on file (in loaded Square history)',
            zh: '记录中有未到（no-show，基于已拉取的 Square 数据）',
        },
        'newAppts.riskProfilePrefix': { en: 'Square profile:', zh: 'Square 资料：' },
        'newAppts.bookedByCustomer': { en: 'Customer', zh: '客人' },
        'newAppts.bookedByUs': { en: 'Us', zh: '店内' },
        'newAppts.statusNoshow': { en: 'NO_SHOW', zh: '未到' },
        'newAppts.exportExcel': { en: 'Export for Excel (.csv)', zh: '导出为 Excel（.csv）' },
        'newAppts.exportExcelTitle': {
            en: 'Download a UTF-8 CSV file that opens in Excel',
            zh: '下载 UTF-8 CSV，可用 Excel 打开',
        },
        'time.prevTitle': { en: 'Previous (30 min)', zh: '上一段（30 分钟）' },
        'time.nextTitle': { en: 'Next (30 min)', zh: '下一段（30 分钟）' },
        'time.nowBtn': { en: 'Now', zh: '现在' },
        'time.nowTitle': { en: 'Jump to current time (30-minute slot)', zh: '跳到当前时间（30 分钟时段）' },
        'time.syncCheckout': { en: 'Sync with checkout', zh: '与离店同步' },
        'time.syncCheckoutTitle': {
            en: 'When checked, changing the time here (dropdown, arrows, scroll wheel, or Now) or on Check-Out updates both panels. Uncheck to set each side independently.',
            zh: '勾选后，在此或「离店」侧更改时间（下拉、箭头、滚轮或「现在」）会同时更新两边。取消勾选可各自设置。',
        },
        'time.changeTitle': { en: 'Change time', zh: '更改时间' },
        'btn.nextAvailable': { en: 'Next available', zh: '下次空闲' },
        'btn.nextAvailableTitle': { en: 'When each masseuse is free', zh: '每位按摩师何时空闲' },
        'modal.appointmentTitle': { en: 'Appointment details', zh: '预约详情' },
        'modal.appointmentDragTitle': { en: 'Drag header to move this window', zh: '拖动标题栏可移动窗口' },
        'modal.nextAvailableTitle': { en: 'Next available', zh: '下次空闲' },
        'modal.nextAvailableIntro': { en: "At the selected check-in time, when each masseuse's current appointment ends:", zh: '在所选到店时间，每位按摩师当前预约结束时间：' },
        'modal.focusTitle': { en: 'Check-In Check-Out — Focus area', zh: '到店/离店 — 重点部位' },
        'focus.bodyAlt': { en: 'Body diagram: front, back, left and right views for selecting focus areas', zh: '身体示意图：正、背、左右侧，用于选择重点部位' },
        'focus.otherLabel': { en: 'Other / write-in:', zh: '其他 / 手写：' },
        'focus.otherPlaceholder': { en: 'e.g. jaw, glutes', zh: '例如：下颌、臀部' },
        'focus.sideLabel': { en: 'Side (if needed):', zh: '侧别（如需）：' },
        'focus.sideBoth': { en: 'Both / not specified', zh: '双侧 / 不指定' },
        'focus.sideLeft': { en: 'Left', zh: '左侧' },
        'focus.sideRight': { en: 'Right', zh: '右侧' },
        'btn.save': { en: 'Save', zh: '保存' },
        'btn.cancel': { en: 'Cancel', zh: '取消' },
        'zoom.label': { en: 'Zoom:', zh: '缩放：' },
        'zoom.outTitle': { en: 'Zoom out (see more)', zh: '缩小（看得更多）' },
        'zoom.inTitle': { en: 'Zoom in', zh: '放大' },
        'phoneCal.hint': {
            en: 'Narrow screen: Mobile List / Mobile Checkout cards, or full Mobile Grid.',
            zh: '窄屏：移动列表 / 移动离店卡片，或完整移动网格。',
        },
        'phoneCal.toggleAria': { en: 'Mobile calendar: List, Checkout, or Grid', zh: '移动日历：列表、离店或网格' },
        'phoneCal.list': { en: 'Mobile List', zh: '移动列表' },
        'phoneCal.checkout': { en: 'Mobile Checkout', zh: '移动离店' },
        'phoneCal.grid': { en: 'Mobile Grid', zh: '移动网格' },
        'phoneCal.details': { en: 'Details', zh: '详情' },
        'phoneCal.duration': { en: 'Length', zh: '时长' },
        'phoneCal.requestedAria': { en: 'Customer-requested masseuse', zh: '客人指定的按摩师' },
        'phoneCal.empty': { en: 'No appointments for this day.', zh: '当天没有预约。' },
        'phoneCal.room': { en: 'Room', zh: '房间' },
        'phoneCal.staff': { en: 'Staff', zh: '人员' },
        'phoneCal.voiceTest': { en: 'Test', zh: '测试' },
        'phoneCal.rowTitle': { en: 'Open full appointment details', zh: '打开预约详情' },
        'phoneCal.checkoutStartedParen': { en: '(started {time})', zh: '（开始 {time}）' },
        'phoneCal.squareMassLabel': { en: 'Square Mass:', zh: '方按摩:' },
        'desktopPhonePeek.summary': { en: 'Mobile List ▼', zh: '移动列表 ▼' },
        'desktopPhonePeek.menuAria': { en: 'Open mobile-style list or checkout in a movable window', zh: '在可移动窗口中打开移动版列表或离店' },
        'desktopPhonePeek.summaryTitle': {
            en: 'Open a movable Mobile Calendar window with the same list or checkout as on a small screen.',
            zh: '打开可拖动的「移动日历」窗口，显示与小屏相同的列表或离店界面。',
        },
        'desktopPhonePeek.panelTitle': { en: 'Mobile Calendar', zh: '移动日历' },
        'calendarScreenshot.capture': { en: 'Screenshot day', zh: '当日截图' },
        'calendarScreenshot.captureTitle': {
            en: 'Save a picture of the whole calendar for the day shown in the date picker',
            zh: '保存日期选择器所示当天的整页日历截图',
        },
        'calendarScreenshot.gallery': { en: 'Screenshots', zh: '截图库' },
        'calendarScreenshot.galleryTitle': { en: 'View saved calendar screenshots', zh: '查看已保存的日历截图' },
        'calendarScreenshot.modalTitle': { en: 'Calendar screenshots', zh: '日历截图' },
        'calendarScreenshot.modalIntro': {
            en: 'Each row shows which calendar day the grid captured, and when the screenshot was taken.',
            zh: '每一行显示截图对应的日历日期，以及截图保存的时间。',
        },
        'calendarScreenshot.loading': { en: 'Loading…', zh: '加载中…' },
        'calendarScreenshot.empty': {
            en: 'No screenshots saved yet. Use “Screenshot day” while the calendar is visible.',
            zh: '尚无截图。在日历可见时点击「当日截图」。',
        },
        'calendarScreenshot.errNoHtml2canvas': {
            en: 'Screenshot library not loaded. Refresh the page and try again.',
            zh: '截图库未加载，请刷新页面后再试。',
        },
        'calendarScreenshot.errNoCalendar': {
            en: 'Load the calendar first (pick a date and load).',
            zh: '请先加载日历（选择日期并加载）。',
        },
        'calendarScreenshot.errNoDate': { en: 'Pick a date in the date picker first.', zh: '请先在日期选择器中选择日期。' },
        'calendarScreenshot.saved': { en: 'Saved calendar screenshot for {date}.', zh: '已保存 {date} 的日历截图。' },
        'calendarScreenshot.errUpload': { en: 'Could not save screenshot.', zh: '无法保存截图。' },
        'calendarScreenshot.errLoadList': { en: 'Could not load screenshots.', zh: '无法加载截图列表。' },
        'calendarScreenshot.errDelete': { en: 'Could not delete screenshot.', zh: '无法删除截图。' },
        'calendarScreenshot.rowCalendarDay': { en: 'Calendar day: {day}', zh: '日历日期：{day}' },
        'calendarScreenshot.rowCapturedAt': { en: 'Screenshot taken: {when}', zh: '截图时间：{when}' },
        'calendarScreenshot.openFull': { en: 'Open full size', zh: '查看原图' },
        'calendarScreenshot.delete': { en: 'Delete', zh: '删除' },
        'calendarScreenshot.deleteConfirm': {
            en: 'Delete this screenshot from the server?',
            zh: '确定要从服务器删除这张截图吗？',
        },
        'lang.btnTitle': { en: 'Language: English — click for 中文', zh: '语言：英文 — 点击切换为中文' },
        'lang.btnTitleZh': { en: 'Language: 中文 — click for English + 中文 (bilingual)', zh: '语言：中文 — 点击切换为中英对照' },
        'lang.btnTitleBoth': { en: 'Language: English + 中文 — click to return to English', zh: '语言：中英对照 — 点击切换回英文' },
        'lang.btnLabelEn': { en: 'EN', zh: 'EN' },
        'lang.btnLabelZh': { en: '中文', zh: '中文' },
        'lang.btnLabelBoth': { en: 'EN·中文', zh: 'EN·中文' },
        'header.toolbarLinksHideTitle': { en: 'Close reports & tools menu', zh: '关闭报表与工具菜单' },
        'header.toolbarLinksShowTitle': { en: 'Open reports & tools menu (vertical list)', zh: '打开报表与工具菜单（竖向列表）' },
        'lanShare.menuBtn': { en: 'Phone / tablet link', zh: '手机/平板链接' },
        'lanShare.menuTitle': {
            en: 'Show a QR code and link to open this dashboard on another device on the same Wi‑Fi',
            zh: '显示二维码与同 Wi‑Fi 链接，便于在手机或平板上打开本仪表盘',
        },
        'lanShare.title': { en: 'Wi‑Fi dashboard link', zh: '局域网仪表盘链接' },
        'lanShare.intro': {
            en: 'Scan the QR code or copy a link. Use another phone or tablet on the same Wi‑Fi as this computer.',
            zh: '扫描二维码或复制下方链接。请让手机或平板连接与本电脑相同的 Wi‑Fi 后再打开。',
        },
        'lanShare.copy': { en: 'Copy link', zh: '复制链接' },
        'lanShare.share': { en: 'Share…', zh: '分享…' },
        'lanShare.qrAlt': {
            en: 'QR code to open this dashboard on this network',
            zh: '用于在本网络打开本仪表盘的二维码',
        },
        'lanShare.loadError': {
            en: 'Could not detect this computer’s Wi‑Fi address. Using this browser’s address instead.',
            zh: '无法检测本机在局域网中的地址，已改用当前浏览器地址。',
        },
        'lanShare.copyDone': { en: 'Link copied to clipboard.', zh: '链接已复制到剪贴板。' },
        'lanShare.copyFallback': { en: 'Copy this link:', zh: '请复制此链接：' },
        'lanShare.shareText': { en: 'Open the room dashboard', zh: '打开房间管理仪表盘' },
        // Dynamic / app.js keys
        'api.real': { en: '✓ Connected to Real Square API', zh: '✓ 已连接真实 Square API' },
        'api.mock': { en: '⚠ Using Mock Data (Square API not configured)', zh: '⚠ 使用模拟数据（未配置 Square）' },
        'error.selectDate': { en: 'Please select a date', zh: '请选择日期' },
        'day.loadingStatus': { en: 'Loading {date}…', zh: '正在加载 {date}…' },
        'day.loadingPriorGridHint': {
            en: 'The calendar below still shows the previous day until loading finishes.',
            zh: '下方的日历在完成加载前仍显示前一天。',
        },
        'loading.detailForDate': { en: 'Fetching schedule for {date}.', zh: '正在获取 {date} 的日程。' },
        'noBookings.title': { en: 'No bookings found for {date}', zh: '{date} 无预约' },
        'noBookings.hint': { en: 'This date has no appointments in Square. Try selecting a different date.', zh: '该日期在 Square 中没有预约，请换一天试试。' },
        'calendar.roomsAvailable': { en: 'Rooms available', zh: '可用房间' },
        'calendar.staffColTitle': { en: 'Staff', zh: '按摩师' },
        'calendar.staffBusyShort': { en: 'Busy', zh: '忙' },
        'calendar.staffAvailShort': { en: 'Avail', zh: '闲' },
        'calendar.staffCellTitle': { en: '{busy} busy · {avail} available (of {planned} today)', zh: '忙 {busy} · 可接 {avail}（今日排班 {planned} 人）' },
        'calendar.time': { en: 'Time', zh: '时间' },
        'calendar.rm': { en: 'Rm', zh: '房' },
        'calendar.roomGroupSingles': { en: 'Single rooms', zh: '单人房' },
        'calendar.roomGroupCouples': { en: 'Couples', zh: '双人房' },
        'calendar.couplesShort': { en: 'Couples', zh: '双人按摩' },
        'calendar.coupleDur60': { en: '60 Minutes', zh: '60分钟' },
        'calendar.coupleDur90': { en: '90 Minutes', zh: '90分钟' },
        'calendar.coupleDur120': { en: '120 Minutes', zh: '120分钟' },
        'calendar.backWalkBadge': { en: 'Bars', zh: '扶杆' },
        'calendar.roomGroupUnassigned': { en: 'Unassigned', zh: '未分房' },
        'calendar.order': { en: 'Order', zh: '顺序' },
        'calendar.todayCount': { en: 'today', zh: '今日' },
        'calendar.sessionsLine': { en: '{n} today', zh: '今日 {n} 次' },
        'calendar.unassigned': { en: 'UNASSIGNED', zh: '未分房' },
        'calendar.capacityColTitle': { en: 'Appointments Available', zh: '可预约' },
        'calendar.capacityBedsHint': { en: 'Beds', zh: '床位' },
        'calendar.bedsSummaryTitle': { en: '{occ} clients on beds, {free} free (max {max} for current room use)', zh: '床上客人 {occ}，空位 {free}（当前最多 {max}，视 5/6 房单人占用而定）' },
        'calendar.bedsSummary': { en: '{occ}/{max} · {free} free', zh: '{occ}/{max} · {free} 空' },
        'calendar.capacitySlotTimeHint': { en: 'Slot start {time}', zh: '时段开始 {time}' },
        'calendar.apptCapAriaZeroSingle': { en: 'No new single slots', zh: '无新的单人可约时段' },
        'calendar.apptCapAriaZeroCouple': { en: 'No new couple slots', zh: '无新的双人可约时段' },
        'calendar.apptCapRowTitle': {
            en: 'Next {min} min: up to {s} new single(s), {c} couple(s) (rooms + massage staff); {f} facial slot(s) free (0 if no massage staff free; else min of FS pool vs overlaps and free single rooms in that window).',
            zh: '未来 {min} 分：最多新接单人 {s}、双人 {c}（房间+按摩人力）；面护可接 {f}（无按摩人力时为 0；否则取面护师余量、同时进行面护数与时段内空闲单人房数的较小值）。',
        },
        'calendar.apptsAvailHint': {
            en: 'New appointments: rooms, massage staff, and facial capacity (facials also capped by free single rooms in that time window)',
            zh: '可接新单：房间、按摩人力与面部护理容量（面护同时受该时段内空闲单人房数量限制）',
        },
        'calendar.capacityFacialHint': { en: 'Facial', zh: '面护' },
        'calendar.apptCapAriaZeroFacial': { en: 'No facial capacity free', zh: '无面部护理空闲档' },
        'calendar.facialHintPoolHeader': {
            en: 'Facial specialist pool: {list}',
            zh: '今日勾选的面护师：{list}',
        },
        'calendar.facialHintPoolBusy': {
            en: '{name} has another appointment overlapping this window ({time}).',
            zh: '{name} 在该时段有其他预约（{time}），不能同时再接面护。',
        },
        'calendar.facialHintPoolBusyShort': {
            en: '{name} is not free in this window.',
            zh: '{name} 在该时段不可用。',
        },
        'calendar.facialHintPoolBusySynthetic': {
            en: '{name} is not free in this window (includes projected facial load from checked specialists).',
            zh: '{name} 在该时段不可用（含今日勾选面护师的预计面护占用）。',
        },
        'calendar.facialHintRequested': {
            en: '{name} is the customer’s requested therapist on a booking at {time} but is not the assigned masseuse.',
            zh: '{name} 是某预约在 {time} 的客户指定按摩师，但当前排班不是本人。',
        },
        'calendar.facialHintNoMassageStaff': {
            en: 'No massage staff free in this window, so new facial services are counted as 0.',
            zh: '该时段无空闲按摩人力，因此新接面护计为 0。',
        },
        'calendar.apptCapMin': { en: 'Minutes', zh: '分钟' },
        'calendar.apptCapMinShort': { en: 'Min', zh: '分' },
        'calendar.apptCapSingle': { en: 'Single', zh: '单人' },
        'calendar.apptCapCouple': { en: 'Couple', zh: '双人' },
        'calendar.collapseRoomsSidebar': { en: 'Hide Rooms available column', zh: '收起可用房间列' },
        'calendar.expandRoomsSidebar': { en: 'Show Rooms available column', zh: '展开可用房间列' },
        'calendar.collapseCapacitySidebar': { en: 'Hide Appointments Available column', zh: '收起可预约列' },
        'calendar.expandCapacitySidebar': { en: 'Show Appointments Available column', zh: '展开可预约列' },
        'calendar.slotStepQuartersOn': { en: '15 min rows', zh: '15 分钟行' },
        'calendar.slotStepQuartersOff': { en: '½ hr rows', zh: '半小时行' },
        'calendar.slotStepToggleTitle': { en: 'Calendar grid: show every 15 minutes, or only each half hour (less busy).', zh: '日历网格：每 15 分钟一行，或仅半小时一行（更简洁）。' },
        'calendar.roomLockedTitle': { en: 'Room locked (click to unlock)', zh: '房间已锁定（点击解锁）' },
        'calendar.roomUnlockedTitle': { en: 'Room unlocked', zh: '房间未锁定' },
        'next.couple': { en: 'Next couple room:', zh: '下一间双人房：' },
        'next.single': { en: 'Next Single Room:', zh: '下一间单人房：' },
        'next.coupleLine': { en: 'Next couple room: {time} (Rm {room})', zh: '下一间双人房：{time}（房间 {room}）' },
        'next.singleLine': { en: 'Next Single Room: {time} (Rm {room})', zh: '下一间单人房：{time}（房间 {room}）' },
        'facial.oneAt': { en: '1 facial at', zh: '1 次面部护理在' },
        'facial.oneLine': { en: '1 facial', zh: '1 次面部护理' },
        'facial.today': { en: 'Facials today:', zh: '今日面部护理：' },
        'facial.finishedTitle': { en: 'Finished — facial time ended', zh: '已结束 — 面部时段已过' },
        'facialSpecialist.shortLabel': { en: 'FS', zh: '面护' },
        'facialSpecialist.calendarTitle': { en: 'Facial Specialist for the facial portion — leave blank if the masseuse did both', zh: '面部护理师（只做面部部分）— 若按摩师全程服务可留空' },
        'summaries.phoneFoldSr': {
            en: 'Expand to show requested therapist list and facial schedule',
            zh: '展开查看客户指定按摩师与面部护理安排',
        },
        'summaries.phoneFoldLabel': { en: 'Req · Face', zh: '指定·面护' },
        'customerRequests.label': { en: 'Requested therapist (by customer):', zh: '客户指定按摩师：' },
        'customerRequests.inCustNotes': { en: '(in cust notes)', zh: '（客户备注）' },
        'customerRequests.inSellerNotes': { en: '(staff notes)', zh: '（员工备注）' },
        'customerRequests.byUs': { en: '📞', zh: '📞' },
        'customerRequests.collapseTitle': { en: 'Hide requested therapist list', zh: '收起指定按摩师列表' },
        'customerRequests.expandTitle': { en: 'Show requested therapist list', zh: '展开指定按摩师列表' },
        'customerRequests.finishedTitle': { en: 'Finished — service time ended', zh: '已结束 — 服务时段已过' },
        'customerRequests.currentTitle': { en: 'In progress now', zh: '进行中' },
        'order.masseuse': { en: 'Masseuse', zh: '按摩师' },
        'order.dragTitle': { en: 'Drag to reorder', zh: '拖动排序' },
        'order.pickTitle': { en: 'Pick therapist for order {n}', zh: '为顺序 {n} 选择按摩师' },
        'checkin.empty': { en: 'No appointments at this time.', zh: '此时段无到店预约。' },
        'checkin.staffPoolLabel': { en: 'Masseuse Pool:', zh: '按摩师候班：' },
        'checkin.therapistPlaceholder': { en: '—', zh: '—' },
        'checkin.addonBillTitle': {
            en: 'Retail / add-on: charge at checkout with the main massage. No separate check-in, checkout, or room.',
            zh: '零售/加项：与主按摩一起在离店时收款。无需单独到店/离店或房间。',
        },
        'checkin.addonMainRoomHint': { en: '(main massage)', zh: '（主按摩）' },
        'checkout.addonBillTitle': {
            en: 'Add-on billed with main appointment — use main row for tip/checkout.',
            zh: '加项与主预约一起结账 — 请使用主预约行填写小费/离店。',
        },
        'checkout.empty': { en: 'No checkouts at this time.', zh: '此时段无离店。' },
        'label.srm': { en: 'Masseuse', zh: '按摩师' },
        'label.srm1': { en: 'Masseuse 1', zh: '按摩师 1' },
        'label.srm2': { en: 'Masseuse 2', zh: '按摩师 2' },
        'label.pressure': { en: 'Pressure', zh: '力度' },
        'label.focus': { en: 'Focus', zh: '重点' },
        'label.focusN': { en: 'Focus ({n})', zh: '重点（{n}）' },
        'label.m1': { en: 'M1:', zh: '客1：' },
        'label.m2': { en: 'M2:', zh: '客2：' },
        'checkin.in': { en: 'In', zh: '到店' },
        'checkin.inTitle': { en: 'Checked in', zh: '已到店' },
        'checkin.split': { en: 'Split', zh: '分单' },
        'checkin.splitMinutesTitle': { en: 'Minutes for first masseuse (Masseuse 1 row); remainder for second; pay & tips prorate by time', zh: '第一位按摩师（上行 按摩师 1）分钟数；其余归第二位；工资与小费按时间比例' },
        'checkin.confirmTherapistChangeAfterStart': { en: 'This appointment has already started or the client has checked in. Change therapist anyway?', zh: '该预约已开始或客人已到店。仍要更换按摩师吗？' },
        'checkin.confirmOverrideRequestedMasseuse': { en: 'Change away from a customer-requested masseuse?', zh: '将更换掉客人指定的按摩师，确定吗？' },
        'checkin.confirmTherapistChangeAfterStartOrOverrideRequest': {
            en: 'This appointment has already started or the client has checked in, and you are changing away from a customer-requested masseuse. Continue anyway?',
            zh: '该预约已开始或客人已到店，且您将更换掉客人指定的按摩师。仍要继续吗？',
        },
        'checkout.out': { en: 'Out', zh: '离店' },
        'checkout.outTitle': { en: 'Checked out', zh: '已离店' },
        'checkout.tipPlaceholder': { en: 'Tip', zh: '小费' },
        'checkout.cash': { en: 'cash', zh: '现金' },
        'checkout.servicesPaidLabel': { en: 'Services paid', zh: '服务费已收' },
        'checkout.servicesPaidTitle': {
            en: 'Service charges already settled (card/cash/Square). Uncheck if you still need to collect service payment; leave checked to focus on tip only.',
            zh: '服务费用已结清（刷卡/现金/Square）。若仍需收服务费请取消勾选；勾选后前台可主要确认小费。',
        },
        'focus.openTitle': { en: 'Open focus popup', zh: '打开重点部位' },
        'focus.openAria': { en: 'Open focus area', zh: '打开重点部位' },
        'next.modal.selectFirst': { en: 'Select a date and time first.', zh: '请先选择日期和时间。' },
        'next.modal.noMasseuses': { en: 'No masseuses configured for this day.', zh: '今天没有配置按摩师。' },
        'next.modal.noRequestedRemaining': {
            en: 'No masseuses with customer-requested massages remaining from this time.',
            zh: '从该时间起，没有仍有点名预约的按摩师。',
        },
        'next.endsNow': { en: 'Appointment ends now', zh: '预约刚结束（现已空闲）' },
        'next.endsAt': { en: 'Appointment ends at', zh: '预约结束于' },
        'noRoom.msg': { en: 'Appointment(s) have no room (any service) — all rooms are booked. SMS and email sent to 917-378-7373 and melispatex@gmail.com with appointment details.', zh: '有预约尚未分房（任意服务）— 所有房间已满。已向 917-378-7373 与 melispatex@gmail.com 发送短信和邮件说明预约详情。' },
        'therapistOverlap.msg': {
            en: 'The same therapist is requested for more than one appointment at overlapping times. Resolve assignments or reschedule.',
            zh: '同一时段内有多条预约都指定了同一位按摩师，时间重叠。请调整排班或改期。',
        },
        'alert.cancelled': { en: 'Appointment cancelled:', zh: '预约已取消：' },
        'alert.rescheduled': { en: 'Appointment rescheduled:', zh: '预约已改期：' },
        'alert.at': { en: 'at', zh: '于' },
        'alert.from': { en: 'from', zh: '从' },
        'alert.to': { en: 'to', zh: '到' },
        'btn.dismiss': { en: 'Dismiss', zh: '关闭' },
        'right.toggleShow': { en: 'Show Hongxia & Hannah', zh: '显示 Hongxia 与 Hannah' },
        'right.toggleHide': { en: 'Hide Hongxia & Hannah', zh: '隐藏 Hongxia 与 Hannah' },
        'checkout.clearSplit': { en: 'Clear split', zh: '清除分单' },
        'checkout.clearSplitTitle': { en: 'Clear split', zh: '清除分单' },
        'checkout.minFirst': { en: 'Min (1st)', zh: '分钟（先）' },
        'checkout.minPlaceholder': { en: 'min', zh: '分' },
        'error.display': { en: '– error displaying', zh: '– 显示错误' },
        'word.appointment': { en: 'Appointment', zh: '预约' },
        'calendar.sliceCoupleMassage': { en: 'Couples massage · ', zh: '情侣按摩 · ' },
        'calendar.sliceFacialOne': { en: 'Facial (1 client) · ', zh: '面部护理（1位）· ' },
        'calendar.prepaymentWord': { en: 'prepayment', zh: '预付' },
        'calendar.badgeFirstVisitTitle': { en: 'First visit (1 visit in profile)', zh: '首次到店（档案 1 次）' },
        'calendar.badgeLoyaltyTitle': { en: 'Loyalty customer — {n} visits in profile', zh: '常客 — 档案 {n} 次到店' },
        'calendar.badgeNewTitle': { en: 'Booked in the last hour', zh: '近一小时内新预订' },
        'calendar.badge3sTitle': { en: '3 Senses', zh: '三感' },
        'calendar.badgeLuxuryTitle': { en: 'Luxury package', zh: '豪华套餐' },
        'calendar.badgeExclusiveTitle': { en: 'Exclusive', zh: '尊享' },
        'calendar.facialApptAria': { en: 'Facial appointment', zh: '面部护理预约' },
        'bookedBy.customerAnyMasseuse': { en: 'Booked by customer — any available masseuse', zh: '客人预订 — 任意空闲按摩师' },
        'bookedBy.customer': { en: 'Booked by customer', zh: '客人预订' },
        'bookedBy.masseuseOri': { en: 'Masseuse ORI:', zh: '指定按摩师：' },
        'calendar.blockTitle': { en: 'Double-click for full details. Drag to another column to reassign masseuse.', zh: '双击查看详情。拖到另一列可更换按摩师。' },
        'cupping.fireTitle': { en: 'Fire cupping', zh: '火罐' },
        'cupping.airTitle': { en: 'Air cupping', zh: '气罐' },
        'bianStone.title': { en: 'Bian stone massage', zh: '砭石按摩' },
        'calendar.painReliefOilTitle': {
            en: 'Pain relief oil add-on — charge at checkout (on Square booking).',
            zh: '舒缓精油加项 — 结账时另收费（Square 预约中已记录）。',
        },
        'detail.time': { en: 'Time', zh: '时间' },
        'detail.customer': { en: 'Customer', zh: '客人' },
        'detail.phone': { en: 'Phone', zh: '电话' },
        'detail.service': { en: 'Service', zh: '服务' },
        'detail.room': { en: 'Room', zh: '房间' },
        'detail.masseuse': { en: 'Masseuse', zh: '按摩师' },
        'detail.addonsCheckin': { en: 'Add-ons (check-in)', zh: '加项（到店）' },
        'detail.pressure': { en: 'Pressure', zh: '力度' },
        'detail.focusAreas': { en: 'Focus areas', zh: '重点部位' },
        'detail.checkinNote': { en: 'Check-in note', zh: '到店备注' },
        'detail.appointmentNotes': { en: 'Appointment notes', zh: '预约备注' },
        'detail.notesStaff': { en: 'Notes (staff)', zh: '备注（员工）' },
        'detail.notesCustomer': { en: 'Notes (customer)', zh: '备注（客人）' },
        'detail.originalSquare': { en: 'Original (Square)', zh: '原始（Square）' },
        'detail.masseuseOri': { en: 'Masseuse ORI', zh: '指定按摩师' },
        'detail.bookedBy': { en: 'Booked by', zh: '预订方' },
        'detail.tip': { en: 'Tip', zh: '小费' },
        'detail.adjustTime': { en: 'Adjust time', zh: '调整时长' },
        'detail.adjustTimeHint': { en: "If Square’s block is wrong, set minutes to add (+) or remove (−) from the calendar end only.", zh: '若 Square 时段不准，仅调整日历结束时间：增加（+）或减少（−）分钟。' },
        'detail.shorterThanSquare': { en: 'Shorter than Square', zh: '比 Square 短' },
        'detail.longerThanSquare': { en: 'Longer than Square', zh: '比 Square 长' },
        'detail.apply': { en: 'Apply', zh: '应用' },
        'detail.clear': { en: 'Clear', zh: '清除' },
        'detail.allocated': { en: 'Allocated', zh: '分配' },
        'detail.miniFacialDone': { en: 'Mini facial done', zh: '迷你面部已完成' },
        'detail.facialSpecialist1': { en: 'Facial Specialist 1', zh: '面部护理师 1' },
        'detail.facialSpecialist2': { en: 'Facial Specialist 2', zh: '面部护理师 2' },
        'detail.facialSpecialist': { en: 'Facial Specialist', zh: '面部护理师' },
        'detail.unlockToEdit': { en: 'Unlock to edit', zh: '解锁以编辑' },
        'detail.hideFromSchedule': { en: 'Hide from schedule', zh: '从日程隐藏' },
        'detail.markCancelled': { en: 'Mark cancelled / no-show', zh: '标记取消/未到店' },
        'detail.bookWithAny': { en: 'Book with any available', zh: '任意空闲按摩师' },
        'detail.bookedByUs': { en: 'Us', zh: '我方' },
        'detail.custAnyAvail': { en: 'Cust – Any Avail', zh: '客人—任意' },
        'detail.customerNamed': { en: 'Customer — {name}', zh: '客人 — {name}' },
        'detail.textSummaryZh': { en: 'Text summary to 917-378-7373', zh: '发短信摘要至 917-378-7373' },
        'detail.textSummaryEn': { en: 'Text English summary to 469-713-7856', zh: '发英文摘要至 469-713-7856' },
        'detail.splitFacial': { en: 'Split facial', zh: '拆分面部' },
        'detail.prepaidYes': { en: 'Yes', zh: '是' },
        'detail.prepaidNo': { en: 'No', zh: '否' },
        'detail.prepaidWithAmount': { en: 'Yes — ${amt}', zh: '是 — ${amt}' },
        'detail.tipMasseuseFs': { en: 'Masseuse {m} · Facial Specialist {f}', zh: '按摩师 {m} · 面部护理师 {f}' },
        'detail.durationAddSub': { en: 'Add or subtract minutes', zh: '增加或减少分钟' },
        'detail.facialSpecPlaceholder': { en: '-- (one person did massage + facial)', zh: '--（同一人按摩+面部）' },
        'detail.checkinShort': { en: 'Check-in', zh: '到店' },
        'modal.unlockPast': { en: 'Unlock to edit', zh: '解锁以编辑' },
        'detail.prepaymentDollar': { en: 'Prepayment $', zh: '预付款 $' },
        'detail.prepaymentTitle': {
            en: 'Recorded prepayment for this visit (saved here; set to 0 to clear and use Square again).',
            zh: '该次预约的预付款记录（本地保存；填 0 可清除并恢复使用 Square 数据）。',
        },
        'detail.tipDollar': { en: 'Tip $', zh: '小费 $' },
        'detail.tip2Dollar': { en: 'Tip 2 $', zh: '小费2 $' },
        'detail.splitTip': { en: 'Split tip', zh: '平分小费' },
    };

    /** English → 中文 for Square service / catalog lines (phrase table; unknown words stay English). */
    const PHRASE_PAIRS = [
        ['couples massage', '情侣按摩'], ['couple massage', '情侣按摩'], ['couple\'s massage', '情侣按摩'],
        ['side by side', '并排'], ['four hands massage', '四手联弹按摩'], ['four hands', '四手联弹'],
        ['3 senses spa experience', '三感水疗体验'], ['3 senses', '三感'], ['three senses', '三感'],
        ['deep tissue massage', '深层组织按摩'], ['deep tissue', '深层组织'], ['swedish massage', '瑞典式按摩'],
        ['hot stone massage', '热石按摩'], ['hot stone', '热石'], ['prenatal massage', '孕妇按摩'], ['pregnancy massage', '孕妇按摩'],
        ['sports massage', '运动按摩'], ['therapeutic massage', '理疗按摩'], ['thai massage', '泰式按摩'],
        ['lymphatic drainage', '淋巴引流'], ['foot reflexology', '足底反射'], ['reflexology', '反射疗法'],
        ['basic facial', '基础面部护理'], ['mini facial', '迷你面部护理'], ['classic facial', '经典面部'],
        ['facial with massage', '面部护理含按摩'], ['facial massage', '面部按摩'], ['anti-aging facial', '抗衰面部'],
        ['hydrating facial', '补水面部'], ['exfoliating facial', '去角质面部'], ['facial treatment', '面部护理'],
        ['luxury package', '豪华套餐'], ['luxury massage', '豪华按摩'], ['luxury facial', '豪华面部'],
        ['luxury couples', '豪华情侣'], ['exclusive massage', '尊享按摩'], ['exclusive package', '尊享套餐'],
        ['fire cupping', '火罐'], ['air cupping', '气罐'], ['cupping therapy', '拔罐疗法'], ['cupping', '拔罐'],
        ['aromatherapy massage', '芳香按摩'], ['aromatherapy', '芳香疗法'], ['pain relief oil', '舒缓精油'],
        ['essential oil', '精油'], ['cbd massage', 'CBD 按摩'], ['cbd oil', 'CBD 油'], ['hot oil massage', '热油按摩'],
        ['scalp massage', '头皮按摩'], ['neck and shoulder', '颈肩'], ['neck & shoulder', '颈肩'],
        ['back massage', '背部按摩'], ['full body massage', '全身按摩'], ['full body', '全身'],
        ['upper body', '上半身'], ['lower body', '下半身'], ['chair massage', '椅式按摩'],
        ['table shower', '水床冲洗'], ['body scrub', '身体磨砂'], ['body wrap', '身体裹敷'],
        ['add-on service', '加项服务'], ['add-on', '加项'], ['add on', '加项'], ['addon', '加项'],
        ['upgrade to', '升级为'], ['with massage', '含按摩'], ['with facial', '含面部'],
        ['one hour', '一小时'], ['two hour', '两小时'], ['half hour', '半小时'],
        ['per person', '每位'], ['each person', '每人'], ['for two', '双人'],
        ['single room', '单人房'], ['couples room', '情侣房'], ['deep pressure', '深度力度'],
        ['medium pressure', '中等力度'], ['light pressure', '轻柔力度'], ['extra time', '加时'],
        ['stone therapy', '石疗'], ['stretching', '拉伸'], ['stretch massage', '拉伸按摩'],
        ['waxing', '脱毛'], ['eyebrow', '眉毛'], ['series package', '疗程套餐'], ['gift card', '礼品卡'],
        ['membership', '会员'], ['intro offer', '体验价'], ['first visit', '首次'], ['repeat client', '回头客'],
        ['massage therapy', '按摩理疗'], ['massage service', '按摩服务'], ['massage', '按摩'],
        ['facial', '面部护理'], ['luxury', '豪华'], ['exclusive', '尊享'], ['deluxe', '豪华'],
        ['therapy', '理疗'], ['treatment', '护理'], ['session', '疗程'], ['minutes', '分钟'],
        ['minute', '分钟'], ['hours', '小时'], ['hour', '小时'], ['mins', '分钟'], ['min', '分钟'],
        ['and', '与'], ['with', '配'], ['plus', '加'], ['&', '与'],
        /* Square / catalog often uses “Couples” alone as the service category (after duration is localized separately). */
        ['couples', '情侣'], ['couple', '情侣'],
        /* Standalone menu words (e.g. customer-request / service lines: “Body 按摩”, “Scalp 理疗”, “三感 Special”) */
        ['scalp', '头皮'], ['body', '身体'], ['special', '特色'],
        /* Facial summary bar (get_day labels + hardcoded luxury mini) */
        ['relax package - basic facial w 60 min massage', '放松套餐 — 基础面部护理配60分钟按摩'],
        ['luxury mini (last 30 min)', '豪华迷你面部（最后30分钟）'],
        ['basic facial w 60 min massage', '基础面部护理配60分钟按摩'],
        ['relax package', '放松套餐'], ['custom facial', '定制面部护理'],
        ['last 30 min', '最后30分钟'], ['mini facial', '迷你面部护理'],
        ['luxury mini', '豪华迷你面部'], ['w 60 min massage', '配60分钟按摩'],
        ['package', '套餐'],
        /* Customer / staff free-form notes (Square) — .sort below orders by English length */
        ['high blood pressure', '高血压'], ['low blood pressure', '低血压'], ['blood thinner', '血液稀释剂'],
        ['special request', '特殊要求'], ['first time visit', '首次到店'], ['first time client', '首次到店客户'],
        ['first visit', '首次到店'], ['thank you so much', '非常感谢'], ['thank you', '谢谢'], ['thanks', '谢谢'],
        ['please', '请'], ['prefer', '希望'], ['would prefer', '更希望'], ['would like', '希望'],
        ['do not massage', '请勿按摩'], ['do not use', '请勿使用'], ["don't want", '不想'], ["doesn't want", '不想'],
        ['no talking', '请勿聊天'], ['quiet please', '请保持安静'], ['keep quiet', '请保持安静'],
        ['light conversation', '可闲聊'], ['more pressure', '更重力度'], ['less pressure', '更轻力度'],
        ['harder pressure', '更重力度'], ['softer pressure', '更轻力度'], ['extra attention', '多加注意'],
        ['focus on', '重点'], ['more time on', '多花时间按'], ['muscle tension', '肌肉紧张'], ['tight muscles', '肌肉紧绷'],
        ['running late', '路上迟到'], ['running early', '提早到'], ['arriving late', '会晚到'], ['arriving early', '会早到'],
        ['check in early', '提前到店'], ['sensitive skin', '敏感肌'], ['recent surgery', '近期手术'],
        ['take medication', '在服药'], ['cancer treatment', '癌症治疗'], ['massage contraindication', '按摩禁忌'],
        ['doctor note', '医生备注'], ['mobility issue', '行动不便'], ['hearing impaired', '听力不便'],
        ['vision impaired', '视力不便'], ['bruise easily', '易淤青'], ['unscented oil', '无香精油'],
        ['lavender oil', '薰衣草精油'], ['lower lights', '调暗灯光'], ['face down', '俯卧'], ['face up', '仰卧'],
        ['side lying', '侧卧'],         ['celebrating birthday', '庆祝生日'], ['birthday surprise', '生日惊喜'],
        ['bridal party', '婚前派对'], ['reschedule', '改期'],
        ['allergic to', '过敏：'], ['allergy', '过敏'], ['allergic', '过敏'], ['pregnant', '怀孕'], ['pregnancy', '孕期'],
        ['injury', '受伤'], ['injured', '受伤'], ['painful', '疼痛'], ['pain in', '疼痛在'], ['knots', '结节'],
        ['anniversary', '纪念日'], ['honeymoon', '蜜月'], ['unable to', '无法'], ['wheelchair', '轮椅'],
        ['diabetes', '糖尿病'], ['fever', '发烧'], ['contagious', '传染性'], ['pacemaker', '起搏器'],
        ['neck pain', '颈部疼痛'], ['back pain', '背部疼痛'], ['shoulder pain', '肩部疼痛'],
        ['lower back pain', '下背部疼痛'], ['sciatica', '坐骨神经痛'], ['migraine', '偏头痛'],
        ['headache', '头痛'], ['stiff neck', '颈部僵硬'], ['sore muscles', '肌肉酸痛'],
        ['relaxation', '放松'], ['stress relief', '减压'], ['tension', '紧张'], ['stiffness', '僵硬'],
        ['appointment', '预约'], ['confirmation', '确认'], ['reminder', '提醒'], ['voicemail', '语音留言'],
        ['call back', '回电'], ['text me', '请发短信'], ['call me', '请致电'], ['do not call', '请勿致电'],
        ['leave message', '请留言'], ['husband', '先生'], ['wife', '太太'],
        ['partner', '伴侣'], ['mother', '母亲'], ['father', '父亲'], ['daughter', '女儿'],
        ['surprise', '惊喜'], ['celebrating', '庆祝'], ['occasion', '场合'],
    ].sort(function (a, b) { return b[0].length - a[0].length; });

    /**
     * Extra Chinese → English for staff/customer Square notes (longest match first with PHRASE_PAIRS reverse).
     * Covers common front-desk phrasing; free-form Chinese may still appear untranslated.
     */
    var NOTES_ZH_TO_EN_EXTRA = [
        ['（方便结账才输入', ' (for checkout convenience, enter '],
        ['不能按卡上金额计算', 'Do not calculate from the amount on the card'],
        ['双人按摩收款时收客人', 'For couples massage, when charging, collect from the guest '],
        ['按摩师请注意，', 'Massage therapists please note: '],
        ['按摩师请注意', 'Massage therapists please note: '],
        ['客人购买时', 'When the customer booked / paid — '],
        ['提示：', 'Note: '],
        ['提示:', 'Note: '],
        ['一个小时', 'one hour'],
        ['双人按摩', 'couples massage'],
        ['收款时', ' when taking payment '],
        ['按卡上金额', 'the amount on the card'],
        ['按卡上', 'on the card '],
        ['礼品卡', 'gift card'],
        ['会员卡', 'membership card'],
        ['结账', 'checkout'],
        ['金额', 'amount'],
    ];
    var NOTES_ZH_TO_EN = PHRASE_PAIRS.map(function (p) { return [p[1], p[0]]; })
        .filter(function (x) { return x[0] && String(x[0]).length >= 2; })
        .concat(NOTES_ZH_TO_EN_EXTRA);
    NOTES_ZH_TO_EN.sort(function (a, b) { return String(b[0]).length - String(a[0]).length; });

    /**
     * Best-effort Chinese → English for appointment notes when UI is English (or bilingual block).
     * @param {string} s
     */
    function notesToEnglish(s) {
        if (!s || typeof s !== 'string') return '';
        if (!/[\u3000-\u9fff\uf900-\ufaff]/.test(s)) return s;
        var parts = s.split(/\n{2,}/);
        return parts.map(function (block) {
            var t = block;
            for (var i = 0; i < NOTES_ZH_TO_EN.length; i++) {
                var zh = NOTES_ZH_TO_EN[i][0];
                var en = NOTES_ZH_TO_EN[i][1];
                if (!zh) continue;
                t = t.split(zh).join(en);
            }
            t = t.replace(/，/g, ', ').replace(/。/g, '. ').replace(/（/g, '(').replace(/）/g, ')');
            t = t.replace(/[ \t\r\f\v]+/g, ' ').trim();
            return t;
        }).filter(Boolean).join('\n\n');
    }

    const FOCUS_ZH = {
        'Lower back': '下背部',
        'Upper back': '上背部',
        'Back': '背部（整体）',
        'Neck': '颈部',
        'Shoulders': '肩部',
        'Traps': '斜方肌',
        'Feet': '足部',
        'Calves': '小腿',
        'Hamstrings': '腘绳肌',
        'Legs': '腿部（整体）',
        'Left': '左侧',
        'Right': '右侧',
        'Hips': '髋部',
        'IT band': '髂胫束',
        'Arms': '手臂',
        'Hands': '手部',
        'Glutes': '臀部',
        'Quads': '股四头肌',
        'Chest': '胸部',
        'Jaw/TMJ': '下颌/TMJ',
        'Scalp': '头皮',
    };

    const PRESSURE_ZH = {
        '': '—', 'deep': '深度', 'deep/med': '深/中', 'med': '中等', 'med/light': '中/轻', 'light': '轻柔',
    };

    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /** Replace whole English keys (sorted longest first) with Chinese; skips empty keys. */
    function applyZhMapByWordBoundary(t, map) {
        const keys = Object.keys(map).filter(function (k) { return k && k.length > 0; })
            .sort(function (a, b) { return b.length - a.length; });
        for (let i = 0; i < keys.length; i++) {
            const en = keys[i];
            const zh = map[en];
            const re = new RegExp('\\b' + escapeRegExp(en) + '\\b', 'gi');
            t = t.replace(re, zh);
        }
        return t;
    }

    /** Turn catalog English into Chinese using phrase replacements + duration tokens. */
    function spaEnglishToChinese(s) {
        if (!s || typeof s !== 'string') return '';
        let t = s.replace(/\s+/g, ' ').trim();
        if (!t) return '';
        t = t.replace(/\b(\d+(?:\.\d+)?)\s*(hr|hrs|hour|hours)\b/gi, function (_, n) {
            const num = parseFloat(n);
            if (num === 1) return '1小时';
            return num + '小时';
        });
        t = t.replace(/\b(\d+)\s*(min|mins|minute|minutes)\b/gi, function (_, n) {
            return n + '分钟';
        });
        for (let i = 0; i < PHRASE_PAIRS.length; i++) {
            const en = PHRASE_PAIRS[i][0];
            const zh = PHRASE_PAIRS[i][1];
            const re = new RegExp('\\b' + escapeRegExp(en) + '\\b', 'gi');
            t = t.replace(re, zh);
        }
        t = applyZhMapByWordBoundary(t, FOCUS_ZH);
        t = applyZhMapByWordBoundary(t, PRESSURE_ZH);
        return t;
    }

    /**
     * Localize Square catalog text (service names, descriptions) for UI. Customer / therapist names are not passed here.
     * @param {string|null|undefined} en
     */
    function catalogLine(en) {
        const raw = en == null ? '' : String(en);
        const mode = getMode();
        if (mode === 'en' || !raw.trim()) return raw;
        const zh = spaEnglishToChinese(raw);
        if (mode === 'zh') return zh || raw;
        const enTrim = raw.trim();
        if (!zh || zh.toLowerCase() === enTrim.toLowerCase()) return raw;
        return enTrim + ' \u00A0' + zh;
    }

    function formatDurationMinutes(minutes) {
        const m = Number(minutes);
        if (!Number.isFinite(m) || m < 0) return '';
        const mode = getMode();
        function enFmt() {
            if (m < 60) return m + ' min';
            const h = Math.floor(m / 60);
            const mm = m % 60;
            return mm ? h + 'h ' + mm + 'm' : h + 'h';
        }
        function zhFmt() {
            if (m < 60) return m + '分钟';
            const h = Math.floor(m / 60);
            const mm = m % 60;
            if (mm === 0) return h + '小时';
            return h + '小时' + mm + '分';
        }
        if (mode === 'en') return enFmt();
        if (mode === 'zh') return zhFmt();
        const a = enFmt();
        const b = zhFmt();
        if (a === b) return a;
        return a + ' \u00A0' + b;
    }

    function t(key, fallback) {
        const row = STRINGS[key];
        if (!row) return fallback != null ? fallback : key;
        return format(row);
    }

    function tHtml(key, fallback) {
        const row = STRINGS[key];
        if (!row) return fallback != null ? fallback : key;
        return formatHtml(row);
    }

    /** Interpolate {name} in formatted string */
    function tParams(key, vars, fallback) {
        let s = t(key, fallback);
        if (vars) {
            Object.keys(vars).forEach(k => {
                s = s.split('{' + k + '}').join(String(vars[k]));
            });
        }
        return s;
    }

    function focusAreaLabel(enName) {
        const zh = FOCUS_ZH[enName];
        const row = { en: enName, zh: zh || enName };
        return format(row);
    }

    function focusAreaZh(enName) {
        const n = (enName || '').trim();
        if (!n) return '';
        if (FOCUS_ZH[n]) return FOCUS_ZH[n];
        const found = Object.keys(FOCUS_ZH).find(function (k) { return k.toLowerCase() === n.toLowerCase(); });
        if (found) return FOCUS_ZH[found];
        return spaEnglishToChinese(n);
    }

    function pressureDisplayZh(value) {
        const v = value == null ? '' : String(value).trim();
        if (PRESSURE_ZH.hasOwnProperty(v)) return PRESSURE_ZH[v];
        const low = v.toLowerCase();
        if (low === 'medium') return PRESSURE_ZH.med || v;
        if (low === 'deep/medium' || low === 'deep / medium') return PRESSURE_ZH['deep/med'] || v;
        if (low === 'medium/light' || low === 'medium / light') return PRESSURE_ZH['med/light'] || v;
        return spaEnglishToChinese(v);
    }

    function pressureLabel(value) {
        const v = value == null ? '' : String(value);
        const zh = PRESSURE_ZH.hasOwnProperty(v) ? PRESSURE_ZH[v] : v;
        const en = v === '' ? '—' : v;
        if (getMode() === 'zh') return zh;
        if (getMode() === 'both' && zh && zh !== en) return en + ' \u00A0' + zh;
        return en;
    }

    function applyStaticI18n() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            const key = el.getAttribute('data-i18n');
            if (!key) return;
            const row = STRINGS[key];
            if (row) el.textContent = format(row);
        });
        document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
            const key = el.getAttribute('data-i18n-html');
            if (!key) return;
            const row = STRINGS[key];
            if (row) el.innerHTML = formatHtml(row);
        });
        document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
            const key = el.getAttribute('data-i18n-title');
            if (!key) return;
            const row = STRINGS[key];
            if (row) el.setAttribute('title', format(row));
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            const key = el.getAttribute('data-i18n-placeholder');
            if (!key) return;
            const row = STRINGS[key];
            if (row) el.setAttribute('placeholder', format(row));
        });
        document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
            const key = el.getAttribute('data-i18n-aria');
            if (!key) return;
            const row = STRINGS[key];
            if (row) el.setAttribute('aria-label', format(row));
        });
        document.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
            const key = el.getAttribute('data-i18n-alt');
            if (!key) return;
            const row = STRINGS[key];
            if (row) el.setAttribute('alt', format(row));
        });

        const docTitleRow = STRINGS['doc.title'];
        if (docTitleRow) {
            document.title = format(docTitleRow);
        }

        const langBtn = document.getElementById('langToggleBtn');
        if (langBtn) updateLangButtonFace(langBtn);

        const mode = getMode();
        document.documentElement.lang = mode === 'en' ? 'en' : 'zh-Hans';
    }

    function updateLangButtonFace(btn) {
        const mode = getMode();
        btn.classList.remove('lang-mode-en', 'lang-mode-zh', 'lang-mode-both');
        btn.classList.add(mode === 'en' ? 'lang-mode-en' : mode === 'zh' ? 'lang-mode-zh' : 'lang-mode-both');
        if (mode === 'en') {
            btn.textContent = STRINGS['lang.btnLabelEn'].en;
            btn.title = format(STRINGS['lang.btnTitle']);
        } else if (mode === 'zh') {
            btn.textContent = STRINGS['lang.btnLabelZh'].zh;
            btn.title = format(STRINGS['lang.btnTitleZh']);
        } else {
            btn.textContent = format({ en: 'EN·中文', zh: 'EN·中文' });
            btn.title = format(STRINGS['lang.btnTitleBoth']);
        }
        btn.setAttribute('aria-label', btn.title);
    }

    function initLangToggle() {
        const btn = document.getElementById('langToggleBtn');
        if (!btn || btn.dataset.i18nBound) return;
        btn.dataset.i18nBound = '1';
        btn.addEventListener('click', function () {
            cycleMode();
            applyStaticI18n();
            if (typeof window.momApplyLanguage === 'function') {
                window.momApplyLanguage();
            }
        });
    }

    /** For glossary_en_zh.html: UI strings, catalog phrases, focus & pressure maps. */
    function exportGlossaryData() {
        const uiRows = Object.keys(STRINGS).sort().map(function (k) {
            const r = STRINGS[k];
            return { key: k, en: r.en, zh: r.zh };
        });
        const phraseRows = PHRASE_PAIRS.slice().sort(function (a, b) {
            return a[0].localeCompare(b[0], 'en', { sensitivity: 'base' });
        });
        const focusRows = Object.keys(FOCUS_ZH).sort(function (a, b) {
            return a.localeCompare(b);
        }).map(function (en) {
            return { en: en, zh: FOCUS_ZH[en] };
        });
        const pressureRows = Object.keys(PRESSURE_ZH).sort(function (a, b) {
            if (a === '') return -1;
            if (b === '') return 1;
            return a.localeCompare(b);
        }).map(function (en) {
            return { en: en === '' ? '(not set)' : en, zh: PRESSURE_ZH[en] };
        });
        return { uiRows: uiRows, phraseRows: phraseRows, focusRows: focusRows, pressureRows: pressureRows };
    }

    window.MOM_I18N = {
        getMode: getMode,
        setMode: setMode,
        cycleMode: cycleMode,
        t: t,
        tHtml: tHtml,
        tParams: tParams,
        focusAreaLabel: focusAreaLabel,
        pressureLabel: pressureLabel,
        catalogLine: catalogLine,
        /** Always Chinese (for SMS / summaries), regardless of UI mode. */
        catalogLineZh: spaEnglishToChinese,
        /** Chinese (or mixed) Square notes → English for EN UI and tooltips. */
        notesToEnglish: notesToEnglish,
        focusAreaZh: focusAreaZh,
        pressureDisplayZh: pressureDisplayZh,
        formatDurationMinutes: formatDurationMinutes,
        applyStaticI18n: applyStaticI18n,
        exportGlossaryData: exportGlossaryData,
    };

    function boot() {
        initLangToggle();
        applyStaticI18n();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
