# 按摩师排班表：自动分配逻辑讲解（超细版）

你不是白痴。这段代码只是写得比较绕。  
文件位置：`static/masseuse_scheduling_sheet.js`  
主函数：`buildSheetAssignments`（大约从第 825 行开始）

本文用大白话 + 逐行解释，说明：**一天的预约，是怎么自动填到每个按摩师卡片上的。**

---

## 0. 先用生活例子理解

想象前台有一叠当天预约单，按**开始时间从早到晚**一张一张发：

1. 先看客人有没有点名要某个按摩师（requested）。
2. 有点名 → 直接给那个人（她忙也先记在她名下），然后“下一轮轮到谁”往下移一位。
3. 没点名（any available）→ 看谁这会儿有空、谁今天做得少、现在轮到谁。
4. 情侣套（couple）→ 同一时间要 **2 个人**，所以会分配两次。

表格上每个按摩师一张卡片（#1、#2、#3…），卡片里每一行是一个客人。

---

## 1. 开头的“技能名单”（第 11–14 行）

```javascript
const FACIAL_ONLY = ['Tina'];
const TRIGGER_ONLY = ['Casey', 'Cassey', 'May'];
```

| 行 | 意思 |
|----|------|
| `FACIAL_ONLY` | 面部 / 淋巴，默认只考虑 Tina |
| `TRIGGER_ONLY` | Trigger Point，默认只考虑 Casey / Cassey / May |

注意：日历上名字常常是 `Cassey T`，所以代码里同时写了 `Casey` 和 `Cassey`，避免拼写差一点就认不出来。

---

## 2. 小工具函数（分配前会用到）

### 2.1 时间有没有撞车（第 764–766 行）

```javascript
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
}
```

- 两个时间段有重叠 → 返回 `true`（这个人这会儿在忙）
- 例子：10:00–11:00 和 10:30–11:30 重叠；10:00–11:00 和 11:00–12:00 不重叠

### 2.2 这个预约要不要上表（第 768–770 行）

```javascript
function isSheetEvent(ev) {
    return !!(ev && String(ev.room || '') !== 'ADDON');
}
```

- 房间是 `ADDON`（加价小项）的不算正式按摩，不进排班表

### 2.3 排出今天卡片上的按摩师名单（第 772–797 行）`orderedRoster`

| 行号大致 | 代码在干什么 |
|---------|--------------|
| 773–774 | 拿日历的 `therapist_order`，按 order 数字排序 |
| 775–784 | 一个个把名字放进列表，重复的跳过 |
| 785–786 | 再补上 `therapists` 里可能漏掉的人 |
| 787–788 | 总卡片数 = 基础 9 张 + 你点的「+ Masseuse」 |
| 791–795 | 如果你在表上手改了按摩师名字，用你改的名字（权限更高） |
| 796 | 返回最终名单，例如：`['Cassey T', 'Jenny L', ...]` |

卡片 #1 = 名单第 0 个，#2 = 第 1 个，以此类推。

### 2.4 谁点名了谁（第 799–823 行）`requestMap`

把“客人点名要的按摩师”做成一张对照表：

- key = `booking_id`（预约编号）
- value = 被点名的按摩师名字列表

后面分配时，用预约编号一查，就知道有没有 requested。

---

## 3. 主函数开始：`buildSheetAssignments`（第 825–838 行）

```javascript
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
```

| 行 | 白话 |
|----|------|
| `roster` | 今天表上有哪些按摩师 |
| `slots` | 每人一张空卡片：`name` + 空的 `rows` |
| `extra` | 第 10 张及以后是你手动加的，可以滚动 |
| `reqByBid` | 点名对照表 |
| `slotCount` | 一共几张卡 |
| `events` | 当天预约：去掉 ADDON，按开始时间从早到晚排好 |

---

## 4. 主函数里面的小帮手（第 840–884 行）

### 4.1 `busyAt` — 这个人这会儿忙不忙

```javascript
function busyAt(slotIdx, start, end) {
    return slots[slotIdx].rows.some((r) => rangesOverlap(start, end, r._start, r._end));
}
```

看这张卡片上已经排好的客人，有没有时间和新预约撞车。

### 4.2 `countSoFar` — 这个人目前已经排了几个客人

```javascript
function countSoFar(slotIdx) {
    return slots[slotIdx].rows.length;
}
```

轮班时优先给“做得少”的人，尽量公平。

### 4.3 `findRosterIndex` — 名字对应第几张卡

```javascript
function findRosterIndex(name) {
    if (!name) return -1;
    for (let i = 0; i < slotCount; i++) {
        if (roster[i] && namesMatch(roster[i], name)) return i;
    }
    return -1;
}
```

- 找到 → 返回 0、1、2…
- 找不到 → `-1`

`namesMatch` 会把 `Casey` 和 `Cassey T` 当成同一个人（拼写差一点也能认）。

### 4.4 `findPreferredSkillIndexes` — 这个服务有没有技能限制

```javascript
function findPreferredSkillIndexes(ev) {
    if (needsFacialOrLymphatic(ev)) {
        return FACIAL_ONLY.map(findRosterIndex).filter((i) => i >= 0);
    }
    if (needsTriggerPoint(ev)) {
        return TRIGGER_ONLY.map(findRosterIndex).filter((i) => i >= 0);
    }
    return null;
}
```

- 面部/淋巴 → 只要 Tina 在表上，就优先她
- Trigger → 只要 Casey/Cassey/May
- 普通按摩 → `null`（没有技能限制）

### 4.5 `pushRow` — 真的把客人写进某张卡

```javascript
function pushRow(slotIdx, ev, tipSlot, requested, skillWarn) {
    ...
    slots[slotIdx].rows.push({
        nm: customerShort(ev.customer),  // 客人名（短名）
        rm: roomLabel(ev),               // 房间
        dur: formatDurCol(ev),           // 开始-结束时间
        price: priceDurationLabel(ev),   // 60 / 90 …
        tip: tipLabel(ev, tipSlot),      // 小费
        note: noteFromEvent(ev),         // 备注标签
        requested: !!requested,          // 是不是点名单
        ...
        _bid: ev.booking_id,             // 预约编号（内部用）
        _tipSlot: tipSlot,               // 情侣第二人用 tip 2
    });
}
```

这一步做完，表格上就会多出一行 NM / RM / Dur / Price / Tip / Note。

---

## 5. 最重要：轮到谁了？`turn`（第 886 行）

```javascript
let turn = 0;
```

- `turn = 0` 表示现在优先考虑卡片 #1
- 每成功分给一个人，就变成 `turn = (她的编号 + 1) % 总人数`
- 像发牌：发完 #1 就轮 #2，发完最后一个再回到 #1

**点名单也会推进 turn**（规则 17）：点名做完了，下一位 any-available 客人轮到下一个人。

---

## 6. 核心：`assignOne` 一次只分给一个人（第 888–969 行）

调用方式可以想成：

```text
assignOne(这个预约, 希望给谁, 小费槽位1或2, 要不要强制点名)
```

下面按代码顺序走。

### 第 889–891 行：读时间

```javascript
const start = parseIso(ev.start_at);
const end = parseIso(ev.display_end_at || ev.end_at);
if (!start || !end) return -1;
```

没有合法开始/结束时间 → 没法排，直接放弃。

### 第 893 行：有没有技能限制

```javascript
const skillIdxs = findPreferredSkillIndexes(ev);
```

### 第 895–908 行：如果是强制点名

```javascript
if (forceRequest) {
    let idx = findRosterIndex(preferredName);
    if (idx >= 0) {
        // 算不算技能不对口（只是警告，仍旧分给她）
        pushRow(idx, ev, tipSlot, true, warn);
        turn = (idx + 1) % Math.max(slotCount, 1);  // 点名也算一轮
        return idx;
    }
    // 表上找不到这个人 → 不强制了，往下走轮班逻辑
}
```

白话：

1. 客人点名 Jenny → 找到 Jenny 的卡片 → 写进去。
2. **不管她这会儿忙不忙**（点名优先）。
3. turn 移到 Jenny 的下一位。
4. 如果表上根本没有这个名字 → 当作普通单，走轮班。

### 第 910–925 行：做“有空候选人名单” pool

```javascript
let pool = [];
for (let i = 0; i < slotCount; i++) {
    if (!roster[i]) continue;                 // 空名字卡片跳过
    if (busyAt(i, start, end)) continue;      // 时间撞车跳过
    if (skillIdxs && ... indexOf(i) < 0) continue; // 技能不对跳过
    pool.push(i);
}
if (!pool.length) {
    // 技能的人都没空 → 放宽：只要有空就行
    ...
}
```

顺序：

1. 先找：有名字 + 有空 +（如有）技能符合  
2. 如果一个都没有 → 放宽技能，只要有空

### 第 927–933 行：日历上已经写了某人，且她有空

```javascript
let prefIdx = findRosterIndex(preferredName);
if (prefIdx >= 0 && pool.indexOf(prefIdx) >= 0) {
    pushRow(prefIdx, ...);
    turn = (prefIdx + 1) % ...;
    return prefIdx;
}
```

不是强制点名时，如果日历已经分给某人，且她这会儿有空，就优先跟日历走。

### 第 935–954 行：连一个有空的都没有

```javascript
if (!pool.length) {
    // 从 turn 开始转一圈，挑目前客人最少的那个
    // 仍然写进去（可能时间重叠，只是尽量公平）
}
```

极端情况：所有人都忙，也还是要分出去，分给做得最少的。

### 第 956–968 行：正常轮班（最常见）

```javascript
pool.sort((a, b) => {
    // 1) 谁目前客人更少，谁优先
    if (ca !== cb) return ca - cb;
    // 2) 一样少 → 谁离现在的 turn 更近，谁优先
    ...
});
const pick = pool[0];
pushRow(pick, ...);
turn = (pick + 1) % slotCount;
```

白话排序规则：

1. **先比数量**：做得少的优先  
2. **数量一样**：轮到谁就给谁（从当前 `turn` 往下数）  
3. 分完后，turn 变成下一个人

---

## 7. 对每个预约调用 `assignOne`（第 971–999 行）

### 第 971–975 行：判断这单是不是点名

```javascript
const isCouple = String(ev.type || '').toLowerCase() === 'couple';
const anyAvail = ev.original_any_available === true;
const reqNames = reqByBid.get(String(ev.booking_id || '')) || [];
const hasRequest = reqNames.length > 0 || anyAvail === false;
```

| 变量 | 意思 |
|------|------|
| `isCouple` | 是不是情侣双人 |
| `anyAvail === true` | Square 说“任意按摩师都行” |
| `reqNames` | 点名列表（可能空） |
| `hasRequest` | 有点名，**或者**明确不是 any available |

### 第 977–990 行：情侣单（要 2 个人）

```javascript
if (isCouple) {
    const t1 = (ev.therapist || '').trim();
    const t2 = (ev.therapist_2 || '').trim();
    if (hasRequest) {
        const r0 = reqNames[0] || t1;
        const r1 = reqNames[1] || t2;
        assignOne(ev, r0, 1, !!r0);   // 第一个人（常是点名）
        if (r1) assignOne(ev, r1, 2, ...);  // 第二个人
        else assignOne(ev, '', 2, false);   // 没有第二人名字 → 用轮班找搭档
    } else {
        assignOne(ev, t1, 1, false);
        assignOne(ev, t2, 2, false);
    }
}
```

重点：

- 情侣一定调用 **两次** `assignOne`（两行、两个按摩师）
- 只点了一个人时：那个人强制上，**另一个人按轮班**找
- 所以你可能看到：Natalie 没点 Casey，但 Casey 当了情侣的第二人 —— 这是轮班搭档，不是点名

### 第 991–998 行：单人单

```javascript
} else {
    const t1 = (ev.therapist || '').trim();
    if (hasRequest) {
        assignOne(ev, reqNames[0] || t1, 1, true);   // 强制点名
    } else {
        assignOne(ev, t1, 1, false);                  // 轮班 / 跟日历
    }
}
```

---

## 8. 收尾：每张卡按时间排好，补空行（第 1001–1019 行）

```javascript
for (const slot of slots) {
    slot.rows.sort((a, b) => a._start - b._start);  // 早的在上
    while (slot.rows.length < ROWS_PER) { ... }     // 补到 9 行空格
    slot.rows = slot.rows.slice(0, ROWS_PER);       // 最多 9 行
}
return slots;
```

然后页面拿这些 `slots` 画成你看到的表格。

---

## 9. 一张流程图（帮助记忆）

```text
当天预约（按开始时间排序）
        │
        ▼
   是情侣吗？ ──是──► 分配第 1 人，再分配第 2 人
        │
       否
        ▼
   有点名吗？ ──是──► 强制给被点名的人，turn 往下移
        │
       否
        ▼
   找出有空的人（先看技能，再放宽）
        │
        ▼
   优先：做得少的 → 平手则看轮到谁
        │
        ▼
   写进表格一行，turn = 下一位
```

---

## 10. 你改过表格之后呢？

自动分配算完以后，还有一层：

- 你在 NM 里点选换人、或改过格子 → 会 **钉住（pin）** 这一行
- 点 Refresh 时：没钉住的行会按上面逻辑重算；钉住的行尽量保留你的修改
- 每天整表还会存到硬盘文件夹 `appt records/日期.json`

想完全回到纯自动：点工具栏 **Clear local edits**，再 Load。

---

## 11. 对照例子（帮助对上号）

假设名单顺序：`#1 Cassey, #2 Jenny, #3 Lillian`，`turn` 从 0 开始。

1. **10:00 Eduardo 点名 Cassey**  
   → 强制给 #1 Cassey，`turn` 变成 1（下一位 Jenny）

2. **10:30 任意客人 A**  
   → Jenny 有空 → 给 Jenny，`turn` 变成 2

3. **11:00 情侣：点名 Jenny + 需要第二人**  
   → 第一人强制 Jenny；第二人在有空的人里按“少 + 轮班”选（可能是 Cassey 或 Lillian）

4. **面部给任意**  
   → pool 先只考虑 Tina；Tina 没空才放宽给别人

---

## 12. 相关文件

| 文件 | 作用 |
|------|------|
| `static/masseuse_scheduling_sheet.js` | 真正跑分配的代码（本文讲的就是它） |
| `static/masseuse_scheduling_sheet.html` | 表格页面 |
| `static/docs/sheet_rules.md` | 你写的业务规则 |
| `static/docs/sheet_assign_logic_explained.md` | 本文（逻辑讲解） |

如果你之后改了 `assignOne` / `buildSheetAssignments`，请同步更新这篇说明。
