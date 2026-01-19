# 房间分配系统使用指南

## 📋 概述

这个房间分配系统是一个独立的**管理工具**，用于为 Square 预约自动分配房间，并提供可视化界面让 manager 手动调整。

**重要**：这个系统**不会修改 Square 的预约数据**，只是在你自己的数据库中记录房间分配信息。

## 🎯 功能特性

- ✅ 自动从 Square 拉取预约数据
- ✅ 自动识别 single/couple 预约类型
- ✅ 智能房间分配算法（按优先级）
- ✅ 可视化房间日历视图
- ✅ 冲突检测和提示
- ✅ 手动调整房间分配
- ✅ 持久化存储（SQLite）

## 🚀 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置环境变量

确保你的 `.env` 文件包含 Square API 凭证（与现有系统共用）：

```env
SQUARE_ACCESS_TOKEN=你的访问令牌
SQUARE_LOCATION_ID=你的位置ID
SQUARE_ENVIRONMENT=sandbox  # 或 production
```

### 3. 启动 Dashboard

```bash
python run_room_dashboard.py
```

### 4. 打开浏览器

访问：`http://localhost:5001`

## 📖 使用说明

### 查看预约和房间分配

1. 在页面顶部选择日期
2. 点击"加载预约"按钮
3. 系统会自动：
   - 从 Square 拉取当天的所有预约
   - 识别 single/couple 类型
   - 自动分配房间
   - 显示在房间列视图中

### 房间分配规则

**单人预约 (single)** 优先级：
1. 房间 1, 3, 4（优先）
2. 房间 5, 6
3. 房间 0, 2

**双人预约 (couple)** 优先级：
1. 房间 5, 6（优先）
2. 房间 0+2 合并（02D）

**约束条件**：
- 同一时间一个房间只能有一个预约
- 房间 0+2 合并时，两个房间必须同时空出

### 手动调整房间

1. 点击任意预约块
2. 在弹出的对话框中选择新房间
3. 点击"保存"

**注意**：手动调整的房间分配会被保存，不会被自动算法覆盖。

### 查看冲突

如果某个预约无法分配房间，会在页面顶部显示红色警告框，包含：
- 预约时间
- 客户信息
- 无法分配的原因

## 🏗️ 系统架构

```
Square API (只读)
    ↓
Room Assignment Module (自动分房算法)
    ↓
SQLite Database (存储房间分配)
    ↓
Flask API (提供接口)
    ↓
Web Dashboard (可视化界面)
```

## 📁 文件说明

- `database.py` - 数据库操作（SQLite）
- `room_assignment.py` - 房间分配算法
- `room_api.py` - Flask API 接口
- `run_room_dashboard.py` - 启动脚本
- `static/index.html` - 前端 Dashboard
- `room_assignments.db` - SQLite 数据库文件（自动创建）

## 🔌 API 接口

### GET /api/bookings?date=YYYY-MM-DD

获取指定日期的预约和房间分配。

**响应示例**：
```json
{
  "date": "2026-01-06",
  "bookings": [
    {
      "id": "booking_id",
      "start_at": "2026-01-06T10:00:00Z",
      "end_dt": "2026-01-06T11:00:00Z",
      "service_name": "Massage",
      "customer_name": "John Doe",
      "therapist_id": "therapist_id",
      "type": "single",
      "room": "1",
      "assigned_by": "auto"
    }
  ],
  "count": 10
}
```

### PUT /api/assignments/<booking_id>

手动更新房间分配。

**请求体**：
```json
{
  "room": "3"
}
```

### GET /api/rooms/available?type=single

获取可用房间列表（根据预约类型）。

## ⚙️ 配置说明

系统使用与现有 Square Bookings Sync 相同的配置：

- `COUPLES_MASSAGE_SERVICE_NAME_PATTERN` - 用于识别 couple 预约的关键词（默认：`couple`）

## 🔄 与现有系统的关系

- **现有系统** (`booking_sync.py`)：自动为 couple massage 创建第二个 therapist 的 blocked time
- **新系统** (`room_assignment.py`)：为所有预约分配房间号

两个系统**可以同时运行**，互不干扰：
- 现有系统：运行 `python polling_mode.py` 或 `python main.py`
- 新系统：运行 `python run_room_dashboard.py`

## 🐛 故障排除

### 无法加载预约

1. 检查 `.env` 文件中的 Square API 凭证
2. 确认 `SQUARE_ENVIRONMENT` 设置正确（sandbox/production）
3. 查看日志文件 `room_assignment.log`

### 房间分配不合理

1. 检查预约类型识别是否正确（查看 `type` 字段）
2. 手动调整不合理的分配
3. 算法会记住手动调整，不会覆盖

### 数据库错误

如果数据库文件损坏，可以删除 `room_assignments.db` 文件，系统会自动重新创建。

## 📝 注意事项

1. **数据持久化**：房间分配保存在本地 SQLite 数据库中，删除数据库文件会丢失所有手动调整
2. **自动刷新**：每次加载预约时，系统会重新运行自动分配算法，但会保留所有手动调整
3. **时区**：确保服务器时区设置正确，否则时间显示可能不准确
4. **性能**：大量预约（>100）时，加载可能需要几秒钟

## 🎨 自定义

### 修改房间优先级

编辑 `room_assignment.py` 中的：
```python
SINGLE_ROOMS_PRIORITY = ['1', '3', '4', '5', '6', '0', '2']
COUPLE_ROOMS_PRIORITY = ['5', '6', '02D']
```

### 修改端口

编辑 `run_room_dashboard.py` 中的：
```python
run_room_api_server(port=5001)  # 改为你想要的端口
```

## 📞 支持

如有问题，请查看：
- 日志文件：`room_assignment.log`
- Square API 文档
- 现有系统的 README.md


