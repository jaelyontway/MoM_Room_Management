# 需求文档（Proposal）— MoM Room Management (Jaelyn / mark-v)

> 本文档由现有代码**反向整理**而成（brownfield 项目补文档），代表系统当前实际行为。
> 以后新功能先改本文档，再走 设计 → 任务 → 编码 流程。
> 状态标记：✅ 已实现　🚧 部分实现/有已知问题　❓ 待确认（见文末"待确认问题"）

---

## 1. 项目目标

客人在 **Square** 预约按摩。本系统**不替代 Square 约客**，核心目标：

> 给每个 Square 预约**自动分配物理房间**（房间 0–6，含情侣合并房 `02D`），
> 在浏览器日历上展示，前台/经理可以手动改房间，并支撑店内日常运营
> （签到、小费、技师排班表、工资报表、无房告警、语音预约）。

**两个真相源：**

| 系统 | 负责 |
|------|------|
| Square | 预约本身（谁、几点、哪个技师、什么服务） |
| 本系统 + SQLite | 房间分配结果 + 前台覆盖信息（小费/签到/技师改派等） |

## 2. 使用者与场景

| 角色 | 场景 |
|------|------|
| 前台（front desk） | 开机看当天日历、确认房间、客人签到、记小费/压力偏好/备注 |
| 经理 | 手动改房间/技师、锁定当日房间布局、看报表、维护工资费率 |
| 按摩师 | 看排班表（scheduling sheet）、轮转顺序（turn order） |

## 3. 功能需求（当前范围）

### 3.1 核心主线：日历 + 自动分房 ✅

- 从 Square 拉某天全部预约（无凭据时用 mock 数据，页面照常可用）
- 自动分房规则：
  - 情侣优先级：5 → 6 → `02D`（0+2 合并）
  - 单人优先级：1 → 3 → 4 → 2 → 0 → 6 → 5
  - 经理手改（`assigned_by='manager'`）永不被自动覆盖
  - `02D` 同时占用房间 0 和 2
  - back-walking 的预约限定特定房间 is only avaliable in 1, 3, 4
  - 分不出 → 标 `UNASSIGNED`，附修复建议（换房/挪邻居/微调时间）
- 手改房间支持撤销（undo）、当日布局冻结（day-layout freeze）、房间锁

### 3.2 前台运营 ✅
- Checkin, 当前时间已经到达预约的客人mark 对号，没到就错号
- Checkout, 当前时间已经结束预约的客人mark他们付的小费
- 覆盖信息：小费（含 facial/luxury 分摊）、压力偏好、focus areas、技师改派（slot 1/2）、时长调整、双 SRM 时间拆分、情侣 02D 单 facial 拆分、预付款
- 客户前台备注历史、客户最近预约查询、最新新建预约列表
- 取消/no-show 隐藏

### 3.3 排班与工资 ✅

- 按摩师排班表（masseuse scheduling sheet），含技能列表、当日轮转顺序（turn order）
- 服务工资费率目录（可编辑、CSV 导入导出）
- 报表：每日工资/小费汇总、客户人数/工时（含快照冻结）

### 3.4 通知与外围 ✅

- 预约无房间时发短信（Twilio）+ 邮件（SMTP），带冷却时间防重发
- 语音预约（解析语音文本 → 写入 Square 新预约）
- 日历截图存档、技师名单（roster）动态添加/忽略
- Square 可用性审计（SearchAvailability 与房间占用对比）

### 3.5 情侣按摩第二技师自动挡位 🚧（新需求，2026-08-11 确认）

**目标：完全代替人工。** 当前人工流程：发现有人 book couple massage → 在 Square Appointments 上找同一时段有空的按摩师 → 给她创建一个同时长的 personal event，事件名写客人的 first name。

自动化需求：

- 系统自动发现新的情侣按摩预约（轮询 Square，店内服务器无公网地址，不用 webhook）
- 自动挑选该时段空闲的第二技师
- 自动在 Square 里为第二技师**挡住该时段**，并带上客人 first name 标识
- 主预约取消/改期时，自动取消/重建挡位
- 主预约与挡位的对应关系**必须持久化到 SQLite**（老程序存内存、重启即丢，是已知缺陷）
- 挡位带统一标记（如备注前缀 `AUTO-BLOCK:`），可识别、可批量清理，防止递归处理

**技术约束**：Square API（2026-07 版）不支持创建 personal event，只有两条路线：

| 方案 | 做法 | 效果 | 代价 |
|------|------|------|------|
| A（推荐） | Bookings API 创建占位预约（老程序思路，修复缺陷重做） | Square 日历上显示为一个预约，备注含客人名 | 无额外配置 |
| B | 写入技师绑定的 Google Calendar，Square 同步为 personal event | 和人工做的完全一样 | 每个技师要配 Google 日历 + 授权 |

**2026-08-11 决策：选方案 A**，附加要求：挡位必须与真客人预约一眼可区分
→ 挡位统一挂在占位客户 **"AUTO BLOCK"** 名下（Square 日历格子直接显示 AUTO BLOCK），
真客人 first name 写在预约备注（`AUTO-BLOCK: John`）。本系统日历自动隐藏该占位客户，不占房、不计人数。

**当前状态**：已实现（`app/couple_autoblock.py`，默认 dry-run 只报告不写入），
真实 Square 数据验证通过。切换真实写入的步骤见 `doc/tasks/m10-couple-autoblock.md` 阶段 4。
老的独立程序（根目录 `main.py`/`webhook_handler.py`/`booking_sync.py`/`polling_mode.py`）在新功能上线并验证后归档。

### 3.6 部署与运维 ✅

- Windows 本机 `start_server_jaelyn.bat` 启动（8001 端口，局域网手机可访问）✅
- Docker 方案**暂缓采用**（2026-08-11 决策）。`Dockerfile` / `docker-compose.yml` / `.dockerignore` 保留在仓库中备用，将来需要时按 `doc/tasks/m9-devops.md` 的暂缓任务启用

## 4. 非功能需求

- 无 Square 凭据也能启动（mock 数据），方便演示与开发
- 数据库为单文件 SQLite（`room_assignments.db`），迁移在启动时自动执行
- 前端纯 HTML/JS（无构建步骤），手机浏览器可用
- 界面中英双语（i18n.js）

## 5. 明确不做（Out of scope）

- 不替代 Square 的预约创建/收款主流程（语音预约除外）
- 不做多店/多地点
- 不做用户登录权限系统（店内局域网使用，2026-08-11 已确认不需要）
- 暂不采用 Docker 部署（2026-08-11 已确认，配置文件保留备用）

## 6. 已知问题（来自代码审查）

- `static/checkin.html` 引用的 `checkin.js` 文件缺失
- `app/database.py` 文件开头内容重复（双 `Base` 定义风险）
- `app/room_assigner.py` 运行日志偶报"Room 5 空闲却标 UNASSIGNED"的 BUG 警告
- `static/app.js` 有 TODO：technician 解锁应走独立 API

## 7. 已确认决策（2026-08-11 产品主人答复）

1. **只维护 Jaelyn**：所有开发在 `MoM_Room_Jaelyn` 进行，最终推送到 GitHub 的 `mark-v` 分支。精简版不再投入。
2. **不需要登录/权限**。
3. **根目录调试脚本归档**：已移入 `debugging/root_scripts/`，保持根目录干净。
4. **Docker 暂缓**：配置文件保留备用，日常仍用 `start_server_jaelyn.bat`。

## 8. 待确认问题（剩余）

1. ~~老 webhook 线还要吗？~~ → **已升级为正式需求**（见 3.5 节）：目前靠人工在 Square 上给第二技师建 personal event，要求完全自动化。老程序在新功能上线后归档。
2. 3.5 节的实现方案选 A（占位预约，推荐）还是 B（Google Calendar 同步 personal event）？
