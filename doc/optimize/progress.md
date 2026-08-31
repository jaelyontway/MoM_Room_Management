# 优化轨道进度

> 流程：`doc/optimization-procedure.md`
> 起始 prompt：`doc/optimize/prompt.md`
> 功能开发仍用 `doc/tasks/progress.md`，不要把新功能勾进这里。

## 阶段

- [ ] O0 工程化地基（ruff / mypy / pytest 一条命令；`pyproject.toml`）
- [ ] O1 现状盘点 + 行为冻结（inventory + 金样例测试）
- [ ] O2 优化需求确认（`doc/optimize/proposal.md`）— **先问答，禁止猜**
- [ ] O3 目标架构（`doc/optimize/high-level-design.md`）
- [ ] O4 迁移详细设计（`doc/optimize/detailed-design.md`）
- [ ] O5 最小任务拆分（`doc/optimize/tasks/*.md`）
- [ ] O6 更新本目录 `prompt.md` 为可执行版
- [ ] O7 按任务实现（每完成一个子任务再勾模块）

## O2 必须先回答（主 agent 未拿到答案不得往下）

- [ ] 成功标准：只整理结构，还是允许改产品行为？
- [ ] 第一波范围：M6 排班表 / M3 拆路由 / 全仓库 / 其他？
- [ ] 前端是否必须继续零构建（无 TS/bundler）？
- [ ] 排班分配逻辑最终放浏览器 JS 还是后端 Python？
- [ ] 规则冲突时听：`sheet_rules.md` / 店里口头 / 当前线上结果？
- [ ] 是否现在上 uv，还是先 pip + ruff/mypy？

## 模块任务（O5 之后才会有文件）

- [ ] `o0-tooling.md`
- [ ] `o1-freeze.md`
- [ ] （其余等 O2 确认范围后再列）
