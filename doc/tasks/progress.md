# 总体进度（Progress）

> 每个模块一个任务文件，见本目录。模块内全部任务完成才勾选。
> 新功能流程：改 `doc/proposal.md` → 更新设计 → 在对应模块任务文件加最小任务 → 逐条实现。
> **整理屎山 / 重构**不要写进本文件。走 `doc/optimization-procedure.md` 和 `doc/optimize/progress.md`。

- [x] M1 Square 集成（`m1-square-integration.md`）
- [ ] M2 分房引擎（`m2-room-engine.md`）— 有已知 BUG 待修
- [x] M3 API 后端（`m3-api-backend.md`）
- [ ] M4 数据持久层（`m4-persistence.md`）— database.py 重复代码待清理
- [x] M5 前端-日历仪表盘（`m5-frontend-dashboard.md`）
- [x] M6 前端-排班与报表（`m6-frontend-sheet-reports.md`）
- [ ] M7 前端-辅助页面（`m7-frontend-misc.md`）— checkin.js 缺失
- [x] M8 通知（`m8-notifications.md`）
- [ ] M9 配置与运维（`m9-devops.md`）— Docker 暂缓；工程化工具未接入
- [ ] M10 情侣第二技师自动挡位（`m10-couple-autoblock.md`）— 已实现并 dry-run 验证；待试运行数日后开真实写入

## 待确认（阻塞项，见 proposal.md 第 8 节）

- [x] 精简版仓库是否继续维护 → 只维护 Jaelyn，最终推 GitHub `mark-v`
- [x] 是否需要登录/权限 → 不需要
- [x] webhook 老逻辑去留 → 升级为 M10 新需求（自动化替代人工挡位）；老程序在 M10 上线后归档
- [x] M10 实现方案 → 选定 A（占位预约），要求挡位与真客人可区分（挂 "AUTO BLOCK" 占位客户）
- [x] 根目录调试脚本归档 → 已完成（`debugging/root_scripts/`，51 个文件）
- [x] Docker 方案是否确定采用 → 暂缓，配置保留备用
