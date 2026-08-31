# M10 情侣第二技师自动挡位 — 任务清单

> 需求见 `doc/proposal.md` 3.5 节；概要设计见 `high-level-design.md` 第 6 节。
> 2026-08-11 已确认方案 A（占位预约），并要求挡位与真客人预约一眼可区分
> → 挡位挂在专用占位客户 "AUTO BLOCK" 名下，`seller_note` 写 `AUTO-BLOCK: <客人first name>`。

## 阶段 1：基础设施 ✅

- [x] 新表 `couple_second_blocks`（`app/models.py`，`init_db` 自动建表）
- [x] `config.py` 开关：`COUPLE_AUTOBLOCK_ENABLED`（默认开）、`COUPLE_AUTOBLOCK_DRY_RUN`（默认开=只报告不写入）、轮询间隔、向前看天数；`env.example` 已更新

## 阶段 2：核心逻辑（`app/couple_autoblock.py`）✅

- [x] 识别情侣按摩且尚无挡位记录的预约（复用 `get_booking_type`；Square 里已带两个技师的跳过）
- [x] 选第二技师（`get_available_team_member`，已修复新 SDK 对象兼容 + 查询失败的技师跳过）
- [x] 同一轮内已分配的技师不重复分给重叠时段（claimed 追踪）
- [x] 创建挡位：占位客户 "AUTO BLOCK" + `seller_note` 标记；带标记的预约跳过防递归
- [x] 映射持久化到 `couple_second_blocks`（替代老程序的内存字典）
- [x] 联动：主预约取消 → 取消挡位；改期 → 取消旧挡位重建
- [x] 孤儿清理：带标记但无活跃记录的挡位自动取消（仅真实模式）

## 阶段 3：接入与可见性

- [x] 8001 服务器启动时开后台轮询任务（asyncio，默认 5 分钟一轮）
- [x] `GET /api/couple-autoblock/status` 查看配置、最近轮询结果（含 dry-run 计划）与挡位列表
- [x] 占位客户 "auto block" 加入日历/人数统计排除名单（`config.py`）
- [ ] 日历前端可选：给挡位加"自动挡位"徽章展示（当前是直接隐藏）

## 阶段 4：验证与切换

- [x] 真实 Square 数据 dry-run 验证（2026-08-11：发现 5 个情侣按摩，计划正确，同时段不撞人）
- [ ] dry-run 跑 2–3 天，前台人工核对 `/api/couple-autoblock/status` 的计划是否合理
- [ ] 切换真实写入前：前台停止手工建 personal event（避免双重挡位）；已有的手工 personal event 手动清理
- [ ] `.env` 设 `COUPLE_AUTOBLOCK_DRY_RUN=false`，低峰时段验证创建/取消/改期联动
- [ ] 稳定后归档老程序四文件（根目录 `main.py`、`webhook_handler.py`、`booking_sync.py`、`polling_mode.py`）
