# 修复服务器问题

## 问题
- `/api/status` 返回 404
- 显示使用 Mock Data

## 原因
服务器可能运行的是旧版本代码，或者有多个服务器实例冲突。

## 解决步骤

### 1. 完全停止所有服务器
在 PowerShell 中运行：
```powershell
Get-Process python | Where-Object {$_.Path -like "*python*"} | Stop-Process -Force
```

或者手动：
- 找到所有运行 `python run.py` 的终端窗口
- 在每个窗口中按 `Ctrl+C`
- 如果不行，关闭终端窗口

### 2. 确认端口已释放
```bash
netstat -ano | findstr :8000
```
应该没有输出（或只有 TIME_WAIT 状态）

### 3. 重新启动服务器
打开**新的**终端窗口，运行：
```bash
python run.py
```

### 4. 查看启动日志
应该看到：
```
INFO:app.main:============================================================
INFO:app.main:Square API: CONNECTED (Using Real API)
INFO:app.main:============================================================
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### 5. 测试
在另一个终端运行：
```bash
python test_server_status.py
```

应该看到：
```
Status Code: 200
Response: {'using_real_api': True, ...}
```

### 6. 访问浏览器
- http://127.0.0.1:8000/api/status
- http://127.0.0.1:8000

应该显示 "✓ Connected to Real Square API"

## 如果还是不行

1. 检查 `.env` 文件是否存在且正确
2. 运行 `python verify_server_config.py` 确认配置
3. 查看服务器启动日志中的错误信息

