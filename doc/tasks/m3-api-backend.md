# M3 API 后端 — 任务清单

## 已完成

- [x] `GET /api/day` 一天数据组装（含 fast 模式）
- [x] 房间改派 / 撤销 / 解锁 / 当日布局冻结系列接口
- [x] 覆盖信息全套接口（技师/小费/压力/focus/时长/拆分/预付款…）
- [x] 签到接口 + kiosk 查询
- [x] 排班（turn order）、工资网格、服务费率 CRUD + CSV 导入导出
- [x] 报表接口（daily-summary、customers-hours 含快照）
- [x] 语音预约、日历截图、roster、可用性审计、LAN 分享

## 待办

- [ ] `app/main.py` 已超 4000 行，按端点分组拆成 APIRouter 子模块（day / overrides / checkin / reports / services / misc）
- [ ] 技师解锁改为独立 API（对应 `static/app.js` 中 TODO）
