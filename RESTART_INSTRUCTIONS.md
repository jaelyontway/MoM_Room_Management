# 重启服务器 - 快速指南

## 方法 1: 使用 PowerShell 脚本（推荐）

在 PowerShell 中运行：
```powershell
.\restart_server.ps1
```

这会：
1. ✅ 停止所有占用 8000 端口的进程
2. ✅ 清理 Python 缓存
3. ✅ 验证配置
4. ✅ 启动新服务器
5. ✅ 测试服务器状态

## 方法 2: 使用 Python 脚本

```bash
python restart_server.py
```

## 方法 3: 手动重启

### 步骤 1: 停止服务器
找到运行 `python run.py` 的终端窗口，按 `Ctrl+C`

或者停止所有 Python 进程：
```powershell
Get-Process python | Stop-Process -Force
```

### 步骤 2: 清理缓存（可选）
```bash
# 删除缓存
rmdir /s /q app\__pycache__
rmdir /s /q __pycache__
```

### 步骤 3: 重新启动
```bash
python run.py
```

### 步骤 4: 验证
访问: http://127.0.0.1:8000/api/status

应该看到：
```json
{
  "using_real_api": true,
  "square_configured": true,
  "message": "Using real Square API",
  "environment": "production"
}
```

## 如果还是显示 Mock Data

1. **检查 `.env` 文件**
   - 确保文件在项目根目录
   - 确保包含正确的 production credentials

2. **查看服务器启动日志**
   - 应该看到: `Square API: CONNECTED (Using Real API)`
   - 如果看到: `Square API: NOT CONFIGURED`，说明配置有问题

3. **运行配置验证**
   ```bash
   python verify_server_config.py
   ```

4. **测试 API 连接**
   ```bash
   python test_square_connection.py
   ```

## 快速检查清单

- [ ] `.env` 文件存在且正确
- [ ] 服务器启动日志显示 "CONNECTED"
- [ ] `/api/status` 返回 `using_real_api: true`
- [ ] 浏览器显示 "✓ Connected to Real Square API"

