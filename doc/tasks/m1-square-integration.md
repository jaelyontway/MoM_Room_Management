# M1 Square 集成 — 任务清单

## 已完成

- [x] Square SDK 客户端封装（`square_client.py`）
- [x] 预约富化：客名/服务/小费建议/到访次数/备注（`app/square_service.py`）
- [x] 补充预约/客户 ID 合并（解决 List Bookings 漏掉周期性预约）
- [x] mock 数据实现，无凭据可运行（`app/mock_square.py`）
- [x] 语音预约服务解析、最新预约报表

## 待办

- [ ] 清理 `[CATALOG DEBUG]` 大量调试日志（改为可开关的 debug 级别）
- [ ] `square_client.py`（35k 行级大文件）评估是否拆分
