# 快速手动操作指南

## 🚀 最简单的方法（3步）

### 1️⃣ 停止所有服务器
在 PowerShell 中运行：
```powershell
Get-Process python | Stop-Process -Force
```

### 2️⃣ 启动服务器
```bash
python run_fresh.py
```

### 3️⃣ 打开浏览器
访问: **http://127.0.0.1:8001**

---

## 📋 详细步骤

### 步骤 1: 打开 PowerShell 或终端
- 按 `Win + X`，选择 "Windows PowerShell" 或 "终端"

### 步骤 2: 进入项目目录
```bash
cd C:\Users\jaely\square-bookings-sync
```

### 步骤 3: 停止所有 Python 进程
```powershell
Get-Process python | Stop-Process -Force
```

### 步骤 4: 启动服务器
```bash
python run_fresh.py
```

你会看到：
```
============================================================
Starting server with fresh imports...
============================================================

Registered routes: 8
  /api/status
[OK] /api/status route is registered!

============================================================
Starting server on http://127.0.0.1:8001
```

### 步骤 5: 测试（在另一个终端窗口）
```bash
python test_port_8001.py
```

或者直接在浏览器访问：
- http://127.0.0.1:8001/api/status
- http://127.0.0.1:8001

---

## ✅ 验证成功

如果看到以下内容，说明成功：

**浏览器中** (`http://127.0.0.1:8001/api/status`):
```json
{
  "using_real_api": true,
  "square_configured": true,
  "message": "Using real Square API",
  "environment": "production"
}
```

**页面顶部**:
- ✅ "Connected to Real Square API" (绿色)

---

## ❌ 如果还是显示 Mock Data

1. **检查 `.env` 文件**
   - 确保文件在项目根目录
   - 确保包含正确的 credentials

2. **查看服务器日志**
   - 应该看到: `Square API: CONNECTED (Using Real API)`
   - 如果看到: `Square API: NOT CONFIGURED`，说明配置有问题

3. **运行验证**
   ```bash
   python verify_server_config.py
   ```

---

## 🛑 停止服务器

在运行服务器的终端窗口按 `Ctrl + C`

---

## 💡 提示

- 服务器运行在 **端口 8001**（不是 8000）
- 如果 8001 也被占用，可以修改 `run_fresh.py` 中的端口号
- 保持服务器窗口打开，关闭窗口会停止服务器

