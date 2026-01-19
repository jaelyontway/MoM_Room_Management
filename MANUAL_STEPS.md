# 手动操作步骤 - 启动服务器

## 步骤 1: 停止所有服务器

### 方法 A: 使用 PowerShell（推荐）
打开 PowerShell，运行：
```powershell
Get-Process python | Stop-Process -Force
```

### 方法 B: 使用任务管理器
1. 按 `Ctrl + Shift + Esc` 打开任务管理器
2. 找到所有 `python.exe` 进程
3. 右键点击 → 结束任务
4. 重复直到所有 Python 进程都被关闭

### 方法 C: 如果服务器在终端运行
- 找到运行 `python run.py` 或 `python run_fresh.py` 的终端窗口
- 按 `Ctrl + C` 停止服务器

---

## 步骤 2: 等待端口释放（可选但推荐）

等待 5-10 秒让端口完全释放。

---

## 步骤 3: 清理缓存（可选）

在 PowerShell 中运行：
```powershell
Get-ChildItem -Path . -Recurse -Filter "__pycache__" | Remove-Item -Recurse -Force
Get-ChildItem -Path . -Recurse -Filter "*.pyc" | Remove-Item -Force
```

或者运行：
```bash
python clean_restart.py
```

---

## 步骤 4: 启动服务器

### 选项 A: 使用端口 8001（推荐，避免冲突）
```bash
python run_fresh.py
```

服务器会在端口 **8001** 启动。

### 选项 B: 使用端口 8000（如果端口已释放）
```bash
python run.py
```

或者：
```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-reload
```

---

## 步骤 5: 查看启动日志

启动后，你应该看到：
```
INFO:app.main:============================================================
INFO:app.main:Square API: CONNECTED (Using Real API)
INFO:app.main:============================================================
INFO:     Uvicorn running on http://127.0.0.1:8001
```

如果看到 `Square API: NOT CONFIGURED`，说明 `.env` 文件有问题。

---

## 步骤 6: 测试服务器

### 方法 A: 使用浏览器
打开浏览器，访问：
- **状态页面**: http://127.0.0.1:8001/api/status
- **主页面**: http://127.0.0.1:8001
- **API 文档**: http://127.0.0.1:8001/docs

### 方法 B: 使用命令行
```bash
python test_port_8001.py
```

或者：
```bash
python final_test.py
```

---

## 步骤 7: 验证结果

访问 http://127.0.0.1:8001/api/status 应该返回：
```json
{
  "using_real_api": true,
  "square_configured": true,
  "message": "Using real Square API",
  "environment": "production"
}
```

如果返回 `using_real_api: false`，检查：
1. `.env` 文件是否存在
2. `.env` 文件中的 credentials 是否正确
3. 服务器启动日志中的错误信息

---

## 快速命令总结

```powershell
# 1. 停止所有服务器
Get-Process python | Stop-Process -Force

# 2. 等待几秒
Start-Sleep -Seconds 5

# 3. 启动服务器（端口 8001）
python run_fresh.py

# 4. 在另一个终端测试
python test_port_8001.py
```

---

## 如果遇到问题

### 端口被占用
- 使用端口 8001（已配置好）
- 或重启计算机清除所有进程

### 显示 Mock Data
- 检查 `.env` 文件
- 查看服务器启动日志
- 运行 `python verify_server_config.py`

### 路由 404 错误
- 确保使用最新代码
- 删除所有 `__pycache__` 文件夹
- 重启服务器

