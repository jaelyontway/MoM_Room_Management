# 服务器显示 "Using Mock Data" 的解决方案

## 问题原因

如果页面显示 "⚠ Using Mock Data"，通常是因为：

1. **服务器在更新 `.env` 文件之前启动**
   - Square 服务在服务器启动时初始化
   - 如果 `.env` 在服务器启动后才更新，服务器仍使用旧配置

2. **需要重启服务器**

## 解决步骤

### 1. 停止当前服务器
在运行 `python run.py` 的终端中按 `Ctrl+C` 停止服务器

### 2. 验证配置
运行这个命令确认配置正确：
```bash
python verify_server_config.py
```

应该看到：
```
[OK] Square API client is initialized
- Status: READY TO USE REAL API
```

### 3. 重新启动服务器
```bash
python run.py
```

### 4. 查看启动日志
服务器启动时应该显示：
```
INFO:app.main:============================================================
INFO:app.main:Square API: CONNECTED (Using Real API)
INFO:app.main:============================================================
```

如果看到这个，说明配置正确！

### 5. 刷新浏览器页面
- 访问：http://127.0.0.1:8000/
- 页面顶部应该显示：**"✓ Connected to Real Square API"**（绿色）

## 验证方法

### 方法 1: 检查状态 API
访问：http://127.0.0.1:8000/api/status

应该返回：
```json
{
  "using_real_api": true,
  "square_configured": true,
  "message": "Using real Square API"
}
```

### 方法 2: 查看服务器日志
当访问一个日期时，日志应该显示：
```
INFO:app.main:[REAL API] Fetching Square bookings for 2026-01-06
INFO:app.main:[REAL API] Found X bookings from Square
```

而不是：
```
INFO:app.main:[MOCK DATA] Square API not configured...
```

## 如果仍然显示 Mock Data

1. **检查 `.env` 文件**：
   ```bash
   # 确认这些值存在且正确
   SQUARE_ACCESS_TOKEN=...
   SQUARE_LOCATION_ID=...
   SQUARE_ENVIRONMENT=production
   ```

2. **检查服务器日志**：
   启动时应该看到 "Square API: CONNECTED"

3. **清除浏览器缓存**：
   按 `Ctrl+F5` 强制刷新页面

4. **检查端口**：
   确保访问的是正确的服务器（端口 8000）

## 快速测试

运行这个命令测试配置：
```bash
python -c "from app.main import square_service; print('Using Real API:', square_service.client is not None)"
```

应该输出：`Using Real API: True`

