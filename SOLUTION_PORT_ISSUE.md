# 解决方案：端口8000被占用

## 问题
有多个旧服务器进程占用端口8000，无法正常停止。

## 解决方案（按优先级）

### 方案 1: 使用不同端口（最快）

编辑 `run_fresh.py`，将端口改为 8001：

```python
uvicorn.run(
    app,
    host="127.0.0.1",
    port=8001,  # 改为 8001
    log_level="info"
)
```

然后运行：
```bash
python run_fresh.py
```

访问: http://127.0.0.1:8001/api/status

### 方案 2: 重启计算机（最彻底）

重启后所有进程会被清除，然后运行：
```bash
python run_fresh.py
```

### 方案 3: 使用任务管理器

1. 按 `Ctrl+Shift+Esc` 打开任务管理器
2. 找到所有 `python.exe` 进程
3. 右键 → 结束任务
4. 然后运行 `python run_fresh.py`

### 方案 4: 使用不同的启动方式

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --no-reload
```

## 验证

运行后，测试：
```bash
python final_test.py
```

或者访问浏览器：
- http://127.0.0.1:8001/api/status

应该返回：
```json
{
  "using_real_api": true,
  "square_configured": true,
  "message": "Using real Square API",
  "environment": "production"
}
```

