# M4 数据持久层 — 任务清单

## 已完成

- [x] 全部 ORM 表（见 detailed-design.md M4 表格）
- [x] 启动时自动迁移（加列、复合主键）
- [x] roster JSON 存储（`roster_overrides.json`）
- [x] 排班表存档（`appt records/`）与 `sheet_skills.json`

## 待办

- [ ] 清理 `app/database.py` 开头重复的 engine/Base 定义块
- [ ] `room_day_layout_freeze_meta/_events` 两个裸 SQL 表补 ORM 模型（或注明为何不做）
- [ ] 制定数据库备份策略（`room_assignments.db` 定期复制；Docker 化后确认 volume 备份方式）
