# 房间分配系统 - 快速开始

## 🚀 3 步启动

### 1. 安装依赖（如果还没安装）

```bash
pip install -r requirements.txt
```

### 2. 启动系统

```bash
python run_room_dashboard.py
```

### 3. 打开浏览器

访问：**http://localhost:5001**

## ✅ 完成！

现在你可以：
- 选择日期查看预约
- 查看自动分配的房间
- 点击预约手动调整房间
- 查看未分配房间的冲突

## 📋 系统功能

### 自动功能
- ✅ 从 Square 拉取预约
- ✅ 识别 single/couple 类型
- ✅ 自动分配房间（按优先级）
- ✅ 保存到数据库

### 手动功能
- ✅ 点击预约更改房间
- ✅ 手动调整会被保存（不会被自动覆盖）
- ✅ 查看冲突列表

## 🎯 房间分配规则

**单人预约** → 优先：1, 3, 4 → 其次：5, 6 → 最后：0, 2

**双人预约** → 优先：5, 6 → 其次：0+2 合并

## ⚠️ 注意事项

1. **不修改 Square**：这个系统只读取 Square 数据，不修改预约
2. **数据存储**：房间分配保存在本地 `room_assignments.db`
3. **端口**：默认使用 5001 端口（避免与现有 webhook 服务器冲突）

## 🐛 遇到问题？

1. 检查 `.env` 文件中的 Square API 凭证
2. 查看日志：`room_assignment.log`
3. 运行测试：`python test_room_system.py`

## 📖 详细文档

查看 [ROOM_ASSIGNMENT_GUIDE.md](ROOM_ASSIGNMENT_GUIDE.md) 获取完整使用说明。


