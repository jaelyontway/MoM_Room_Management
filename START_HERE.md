# 🚀 从这里开始 - 手动启动服务器

## 最简单的 3 步操作

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

## 📝 详细说明

### 打开终端
1. 按 `Win + R`
2. 输入 `powershell` 或 `cmd`
3. 按 Enter

### 进入项目目录
```bash
cd C:\Users\jaely\square-bookings-sync
```

### 停止旧服务器
```powershell
Get-Process python | Stop-Process -Force
```

### 启动新服务器
```bash
python run_fresh.py
```

你会看到类似这样的输出：
```
============================================================
Starting server with fresh imports...
============================================================

Registered routes: 8
  /api/status
[OK] /api/status route is registered!

============================================================
Starting server on http://127.0.0.1:8001
Press Ctrl+C to stop
============================================================

INFO:     Uvicorn running on http://127.0.0.1:8001
INFO:app.main:Square API: CONNECTED (Using Real API)
```

### 测试服务器
打开浏览器，访问：
- **状态**: http://127.0.0.1:8001/api/status
- **主页**: http://127.0.0.1:8001

---

## ✅ 成功标志

访问 http://127.0.0.1:8001/api/status 应该看到：
```json
{
  "using_real_api": true,
  "square_configured": true,
  "message": "Using real Square API",
  "environment": "production"
}
```

页面应该显示：**"✓ Connected to Real Square API"**（绿色）

---

## 🛑 停止服务器

在运行服务器的终端窗口按 `Ctrl + C`

---

## ❓ 常见问题

**Q: 端口被占用怎么办？**
A: 服务器已经配置为使用端口 8001，应该不会有冲突。

**Q: 还是显示 Mock Data？**
A: 检查 `.env` 文件，确保 credentials 正确。

**Q: 如何查看日志？**
A: 查看运行 `python run_fresh.py` 的终端窗口。

---

## 📚 更多帮助

- 详细步骤: 查看 `MANUAL_STEPS.md`
- 快速指南: 查看 `QUICK_MANUAL_GUIDE.md`
- 使用 PowerShell 脚本: 运行 `.\quick_start.ps1`

