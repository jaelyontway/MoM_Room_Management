# 详细设计（Detailed Design）— MoM Room Management (Jaelyn)

> 依据：`doc/high-level-design.md` 的模块划分（M1–M9）。
> 记录各模块的实现细节：关键类/函数、数据表、接口。改代码前先对照本文档。

---

## M1 Square 集成

| 文件 | 关键符号 | 说明 |
|------|----------|------|
| `app/square_service.py` | `SquareService.get_bookings_for_date` / `get_bookings_by_local_date_range` | 拉预约并富化（客名、服务名、小费建议、到访次数、备注） |
| | `get_booking_type` | 判断单人/情侣 |
| | `resolve_voice_service`、`list_newest_booked_appointments_report` | 语音预约服务解析；最新预约报表 |
| `square_client.py` | `SquareBookingsClient` | 官方 SDK 封装，底层 HTTP；含补充预约/客户 ID 合并（`SQUARE_SUPPLEMENT_*`） |
| `app/mock_square.py` | `MockSquareService` | 与真实 service 同签名的假数据实现 |

**约定**：M3 启动时按 `Config` 是否有凭据选择真实/mock service；上层不感知差异。

## M2 分房引擎

| 文件 | 关键符号 | 说明 |
|------|----------|------|
| `app/room_assigner.py` | `RoomAssigner.assign_rooms` | 主算法：按优先级占坑，尊重 manager 锁 |
| | 常量 `COUPLE_PRIORITY`（5→6→02D）、`SINGLE_PRIORITY`（1→3→4→2→0→6→5） | 业务规则所在 |
| | `booking_requires_back_walking_bar_room` | 背走服务限定房间 |
| `app/room_occupancy.py` | `physical_busy_segments_ts` | 物理占用区间（02D→0+2；情侣 facial+massage 拆分时 facial 段释放 Rm0） |
| `app/unassigned_suggestions.py` | `compute_unassigned_fix_suggestions` | 无房修复建议：空房 / 挪一个邻居 / 微调时间 |

**已知问题**：日志偶报 "Room 5 free but UNASSIGNED"（`CRITICAL BUG` 日志）；`unassigned_suggestions` 内复制了一份房间优先级列表，与 assigner 需人工保持同步。

## M3 API 后端

- `app/main.py`：FastAPI 入口，约 60 个端点。核心组装函数 `build_day_response_for_date`。
- `app/schemas.py`：Pydantic 模型（`Event`、`DayResponse`、各 Update/Request/Response）。
- 端点分组：
  - 日历主线：`GET /api/day`、`PUT /api/room`、`POST /api/room/undo`、day-layout-freeze 系列
  - 覆盖信息：`PUT /api/therapist|pressure|focus-area|tip|booking/*`
  - 签到：`POST /api/check-in`、`GET /api/check-in/lookup`、addon-note
  - 排班/工资：`/api/therapist-order`、`/api/day/grid`、`/api/services*`、`/api/appt-records*`、`/api/sheet-skills`
  - 报表：`/api/reports/daily-summary`、`/api/reports/customers-hours`
  - 其他：`/api/status`、`/api/voice-book`、`/api/roster*`、`/api/availability-audit`、`/api/calendar-screenshots*`、`/api/lan-share`

## M4 数据持久层

`app/models.py` 主要表：

| 表 | 用途 |
|----|------|
| `room_assignments` | 预约 → 房间（含 `assigned_by` auto/manager） |
| `room_assignment_undo` | 房间改动撤销快照（JSON） |
| `booking_overrides` | 技师改派、小费、签到时间、facial、时长等一切前台覆盖 |
| `service_pay_rates` | 服务工资费率 |
| `therapist_day_orders` | 当日轮转顺序 |
| `customer_last_pressure` / `customer_last_partner` | 客户偏好记忆 |
| `customer_desk_notes` | 前台备注历史 |
| `no_room_notification_sent` | 告警去重 |
| `customer_hours_daily_snapshots` | 报表快照冻结 |
| `calendar_screenshots` | 截图元数据 |

- `app/database.py`：engine/session/`init_db` + 启动时 SQLite 迁移（加列、复合主键）。**已知问题：文件开头内容重复。**
- `app/roster_store.py`：`roster_overrides.json` 读写（技师白名单动态增删）。
- 另有 JSON 侧存储：`sheet_skills.json`、`appt records/`（排班表存档）。

## M5–M7 前端

| 页面 | JS | 调用的主要 API |
|------|-----|----------------|
| `index.html`（主日历） | `app.js`（大） | `/api/day` + 几乎全部覆盖/房间/签到接口 |
| `masseuse_scheduling_sheet.html` | 同名 `.js` | `/api/day?fast=1`、`/api/appt-records/*`、`/api/sheet-skills`、`/api/tip` |
| `grid.html` | 内嵌 | `/api/day/grid` |
| `services.html` | 内嵌 | `/api/services` + 导入导出 |
| `reports.html` / `customers_hours_report.html` | 内嵌 | `/api/reports/*` |
| `checkin.html` | `checkin.js` **（缺失）** | `/api/check-in*` |
| `voice_book.html` | 内嵌 | `/api/voice-book` |

规则文档：`static/docs/sheet_rules.md`、`calendar_appt_rules.md`、`sheet_assign_logic_explained.md`（排班表业务规则的权威描述）。

## M8 通知

- `app/notifications.py`：`send_no_room_notifications` → Twilio SMS + SMTP 邮件。
- 冷却由 M3 用 `no_room_notification_sent` 表控制（`NO_ROOM_ALERT_COOLDOWN_MINUTES`）。

## M9 配置与运维

- `config.py`：全部环境变量集中在 `Config` 类；`.env` 由 `python-dotenv` 加载，模板 `env.example`。
- 本机启动：`start_server_jaelyn.bat`（uvicorn --reload，端口 8001）。
- Docker：`Dockerfile`（python:3.12-slim）+ `docker-compose.yml`：
  - `restart: unless-stopped`（重启策略）
  - healthcheck 打 `/api/status`（30s 间隔，3 次失败标 unhealthy）
  - 资源上限 1 CPU / 512MB；日志轮转 10MB×3
  - 数据库文件 volume 挂载在容器外
