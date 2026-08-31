# M2 分房引擎 — 任务清单

## 已完成

- [x] 情侣/单人优先级分房算法（`RoomAssigner.assign_rooms`）
- [x] 02D 合并房占用 0+2；情侣 facial 拆分释放 Rm0（`room_occupancy.py`）
- [x] 经理手改保护、冲突修复与重平衡
- [x] 背走（back-walking bar）房间限定
- [x] 无房修复建议（`unassigned_suggestions.py`）

## 已完成（续）

- [x] 为 `assign_rooms` 核心场景补 pytest 单元测试（单人、情侣、02D、锁定、冲突）——见 `tests/test_room_assigner.py`（18 用例 + 1 个 strict xfail 记录已知缺口：单人无重平衡）

## 已完成（求解器重构，2026-08）

- [x] 房间/优先级/2 秒容差统一收口到 `app/room_constants.py`（`room_assigner` / `unassigned_suggestions` / `room_occupancy` 共用）
- [x] 新增 `app/room_solver.py`：纯 CP-SAT 全天求解（无 DB），有可行方案必找到
- [x] `RoomAssigner.assign_rooms` 重写为「规则层 → 求解器 → 落库」，删除贪心 + 重平衡 + 冲突清理 + 事后修复四段补丁（约 900 行）
- [x] "Room 5 free but UNASSIGNED" 类 bug 在结构上不再可能（整天原子求解，无多阶段状态漂移）；2 秒容差回归用例：`test_two_second_clock_skew_does_not_block_back_to_back`
- [x] 求解器超出旧算法的场景已转为正式用例：`test_back_walker_gets_bar_room_via_swap`（旧贪心对单人无重平衡，会漏掉可行换房）

## 待办

- [ ] 生产观察一周：留意日志中的 "Physical overlap"（安全网告警，正常只在经理双改半途出现）与 UNASSIGNED 原因文本是否易读
