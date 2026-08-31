# 优化流程（Brownfield Vibe Coding）

> 这不是「从头建工程」。本仓库已经在跑店：Square 日历、分房、排班表、报表。
> 从头流程里的 `uv init` / 先写 proposal 在这里会毁掉可运行的系统。
> **优化 = 先冻住行为，再一块一块搬结构，每一步都能开店。**

对照「从头 Basic Procedure」：

| 从头 | 本仓库优化 |
|------|------------|
| `uv init` 空项目 | 在现有工程上加门禁（pytest / ruff / mypy），不推倒重来 |
| 先写需求再写代码 | 需求文档已有（`doc/proposal.md` = 当前行为说明书）。优化先写「不变什么 / 改什么」 |
| 按模块从零实现 | 按模块 **抽离 / 测 / 替换**（绞杀者迁移），禁止新开第二套并行系统 |
| 人工可以不参与实现 | 人工只做两件事：回答提问、在店里点一次确认。编码/测试由主 agent + 子 agent |

现有文档职责（不要混）：

| 文件 | 职责 |
|------|------|
| `doc/proposal.md` 等 | **当前系统**做什么（功能真相） |
| `doc/optimize/` | **优化轨道**：目标结构、迁移任务、本流程的进度 |
| `static/docs/sheet_rules.md` | 排班表业务规则（优化 M6 时的验收标准） |

不明确的地方：**不要猜**。停下来提问。

---

## O0 — 工程化地基（对应「Uv init + mypy/ruff/pytest」）

**目标：** 让以后每一刀重构都有自动闸门，而不是靠人眼。

**输入：** 当前仓库（pip + `requirements.txt` + 少量 `tests/`）。

**输出：**

- `pyproject.toml`（可继续 pip；uv 作为可选加速，不强制换包管理器除非你确认）
- ruff / mypy / pytest 能在本机一条命令跑完
- `doc/optimize/baseline.md`：第一次跑的失败清单（允许红，但必须记录）

**步骤：**

1. **先问你：** 是否现在引入 uv？还是先留 pip，只加 ruff/mypy？
2. 加工具，**不要**第一次就把全仓库 mypy 调成零错误——先对纯逻辑开严（`app/room_assigner.py`、`app/room_occupancy.py`），对其余 `ignore_errors` 或分目录收紧。
3. ruff 先基础规则 + `--fix` 只碰本次改到的文件，禁止「全仓库格式化大爆炸」。
4. pytest 保持 `tests/` 为唯一正式测试入口。根目录 / `debugging/` 脚本不是测试。
5. 门禁命令（实现阶段每任务结束必须跑）：
   - `pytest`
   - `ruff check`（本次改动路径）
   - `mypy`（本次改动的已纳入模块）

---

## O1 — 现状盘点 + 行为冻结（从头流程没有、优化必须有）

**目标：** 在动结构之前，把「现在到底怎么跑」锁成测试和文档。没有冻结就重构 = 换一种方式写屎山。

**输入：**

- 代码
- `doc/proposal.md`、`doc/high-level-design.md`、`doc/detailed-design.md`
- `static/docs/sheet_rules.md`（排班）

**输出：**

- `doc/optimize/inventory.md`（屎山地图：文件、行数、职责、风险）
- 特性测试（characterization）：**不测理想行为，测当前行为**
- 一份「禁止在本阶段改产品行为」的声明

**步骤：**

1. 按模块列出热点（见文末附录 A，先用它，再更新）。
2. 每个即将动的模块，先补最小测试：
   - Python：pytest，用今天的真实规则当断言（例如分房优先级、02D 占 0+2）。
   - 排班表 JS：不要在 3800 行 IIFE 里直接测。先把 `buildSheetAssignments` 抽成可导入函数，或把规则迁到 Python 再让 JS 调 API。抽之前必须有「同一组预约 → 同一张表」的金样例（用今天的 Arti/Tina/Casey 这种真实日）。
3. 金样例来源优先：`appt records/`、`/api/day?fast=1` 的某一天 dump、`static/docs/sheet_rules.md` 的 walkthrough。
4. **这一阶段代码只允许加测试和极小的可测试缝（export 函数）。禁止改分配结果。**
5. 有冲突（文档说 A、代码做 B）→ **提问**，不要自行「修正确」。

---

## O2 — 优化需求（对应「Communicate with AI / proposal」）

**目标：** 写清楚这次优化要达到什么，以及明确不做什么。

**输入：** O1 的 inventory + 冻结测试；`doc/proposal.md`。

**输出：** `doc/optimize/proposal.md`

**步骤（必须提问，禁止猜）：** 用问答确认下面每一条，写进 proposal 后再设计。

1. 成功标准：是「文件变短、可测、ruff/mypy 绿」，还是也包括产品行为修正？
2. 第一波范围：全仓库，还是先一块？（建议默认先 **M6 排班表** + **M3 `app/main.py` 拆路由**，因为最大、最容易再堆。）
3. 前端是否允许上构建工具（bundler/TS）？还是必须继续「改 JS 刷新即用」？
4. 排班分配逻辑最终放哪：继续浏览器 JS，还是迁到后端 Python（pytest 能直接锁规则）？
5. 行为冲突时听谁的：`sheet_rules.md`、店里口头、还是当前线上结果？
6. 优化期间店还要天天用：每次合并必须可回滚；是否需要 feature flag？

模板（`doc/optimize/proposal.md` 必须有）：

```text
目标：……
不变（冻结）：……
可变（允许修的产品 bug）：……
非目标（这次不做）：……
第一波模块：……
验收：pytest + ruff + mypy；店内点一次日历 + 排班表
```

---

## O3 — 目标架构（对应「概要设计」）

**目标：** 画出优化**完成后**的模块边界。不是再描述现状。

**输入：** `doc/optimize/proposal.md` + 现有 `doc/high-level-design.md`。

**输出：** `doc/optimize/high-level-design.md`

**步骤：**

1. 保留 M1–M10 编号，避免两套语言。每个模块写：**现状文件 → 目标文件**。
2. 识别该拆的巨石（见附录 A）。原则：
   - 一个文件只做一层（路由 / 领域规则 / 外部 IO）
   - 业务规则不进 HTML/onclick，也不进 4000 行 IIFE
   - Square / SQLite / 浏览器 UI 继续三个真相源，不要合并
3. 画迁移关系：旧符号谁调用新符号，什么时候删旧文件。
4. 不明确（例如「排班逻辑是否出 JS」）→ 提问，不要在 HLD 里默认。

---

## O4 — 迁移详细设计（对应「详细设计」）

**目标：** 写清「怎么搬」：接口、兼容层、删除条件。

**输入：** `doc/optimize/proposal.md`、`doc/optimize/high-level-design.md`、`doc/detailed-design.md`。

**输出：** `doc/optimize/detailed-design.md`

**步骤：** 每个巨石一节，必须包含：

| 项 | 写什么 |
|----|--------|
| 旧入口 | 现在谁调用 |
| 新入口 | 函数/路由/模块名 |
| 兼容 | 旧名字是否暂时 re-export |
| 测试 | 先有哪几个 pytest / 金样例 |
| 删除条件 | 什么绿了才能删旧代码 |
| 回滚 | 出问题怎么撤 |

禁止：「重写 app.js」。必须写成可合并的切片，例如「从 `app/main.py` 抽出 `/api/sheet-*` 到 `app/routers/sheet.py`，行为字节级兼容」。

---

## O5 — 划分最小任务（对应「划分任务」）

**目标：** 每个任务 = 一个子 agent 能独立完成 + 测试绿 + 店还能开。

**输入：** `doc/optimize/proposal.md`、`doc/optimize/detailed-design.md`。

**输出：**

- `doc/optimize/tasks/<module-id>.md`（O0 工具、M2、M3、M6…）
- `doc/optimize/progress.md`（模块级 checklist）

**步骤：**

1. 任务粒度：大约 1–3 小时能合，且只碰声明过的文件。
2. 每个子任务格式：

```markdown
- [ ] T12 从 scheduling sheet 抽出 buildSheetAssignments
      验收：金样例 2026-08-17 Arti→Tina+Casey；pytest 或 node 测试绿；页面 Refresh 结果不变
      禁止：顺手改 turn 规则 / 顺手改日历
```

3. 依赖写清楚：O0 → O1 冻结 → 才能拆 M6；拆 `main.py` 前先有 API 契约测试。
4. `progress.md` 只勾选「该模块全部子任务完成」。
5. **新功能不要写进优化任务。** 新功能走原来的 `doc/proposal.md` → `doc/tasks/m*.md`。优化轨道只搬家/加测试/修 proposal 里点名允许的 bug。

建议第一波任务文件（确认范围后可删减）：

| 文件 | 内容 |
|------|------|
| `o0-tooling.md` | pyproject、ruff、mypy 分层、pytest 一条命令 |
| `o1-freeze.md` | 金样例、分房 characterization、排班金样例 |
| `m3-split-routers.md` | `app/main.py` 按域拆 router |
| `m6-sheet-engine.md` | 排班分配逻辑可测化 |
| `m4-database-dedupe.md` | `database.py` 重复内容 |
| `m2-room-engine.md` | 优先级单一数据源、UNASSIGNED 已知 bug（仅当 O2 允许改行为） |

---

## O6 — 生成主 agent prompt（对应「生成 prompt.md」）

**目标：** 一份人可以丢进新对话、主 agent 能自闭环执行的说明。

**输入：** `doc/optimize/` 下全部文档。

**输出：** `doc/optimize/prompt.md`

**步骤：**

1. 写明角色：主 agent 只调度、验收、更新 `progress.md`；不直接改业务巨石。
2. 写明子 agent：一次只领一个未完成 checklist 项。
3. 写明门禁：pytest / ruff / mypy；前端相关必须说明如何手工点（或给 Playwright/浏览器步骤）。
4. 写明禁令：无测试不重构；不扩范围；不猜需求；文档与代码冲突就停。
5. 仍有含糊 → 提问，不要生成「看起来完整」的 prompt。

起始稿见 `doc/optimize/prompt.md`（执行 O2 问答之后再改一版）。

---

## O7 — 执行循环（主 agent + 子 agent，默认无人工写代码）

```text
主 agent
  ├─ 读 doc/optimize/progress.md，找下一个未勾选任务
  ├─ 开子 agent：只给该任务的 目标/输入/输出/验收/禁止
  ├─ 子 agent：改代码 + 补测试 + 跑门禁
  ├─ 主 agent：审查 diff 是否越界；越界则打回
  ├─ 勾选任务；更新 progress.md
  └─ 重复直到第一波完成或遇到必须提问的阻塞
```

**子 agent 完成定义（Definition of Done）：**

1. 只改任务声明的文件（或任务里写明的新文件）
2. 有测试覆盖这次搬走的行为
3. `pytest` 绿
4. 对改动文件 `ruff check` 绿
5. 若文件已纳入 mypy，mypy 绿
6. 不更新产品行为，除非该任务明确写了允许的 bug 编号
7. 在任务 md 里勾选，并写一行「做了什么」

**主 agent 禁止：** 一次开多个改同一巨石的子 agent；禁止「顺便把 app.js 也整理了」。

**人工介入点（只有这些）：**

- O2 问答
- 文档 vs 店里实际不一致
- 子 agent 连续两次门禁失败
- 第一波结束后：打开日历 + 排班表点一天

---

## 和「从头流程」逐步对照（给主 agent 用）

```text
从头：建项目 → 需求 → 概要设计 → 详细设计 → 拆任务 → prompt → 实现
优化：O0 门禁 → O1 冻结 → O2 优化需求 → O3 目标架构 → O4 迁移设计 → O5 拆任务 → O6 prompt → O7 实现
```

每一步仍然是同一套卡片：**目标 / 输入 / 输出 / 步骤**。缺输入就停，提问。

---

## 附录 A — 当前屎山地图（O1 起点，2026-08-17 行数）

| 优先级 | 文件 | 约行数 | 问题 | 优化方向 |
|--------|------|--------|------|----------|
| P0 | `static/app.js` | 14883 | 日历+签到+小费+房间+i18n 全堆一起 | 按页面功能切文件，规则不进 DOM 操作 |
| P0 | `app/main.py` | 4560 | ~60 个端点一个文件 | `app/routers/` 按域拆，main 只组装 app |
| P0 | `static/masseuse_scheduling_sheet.js` | 3792 | 分配+渲染+存档+技能一个 IIFE | 分配引擎单独可测；UI 只渲染 |
| P1 | `app/square_service.py` | 1787 | 富化逻辑过厚 | 拉取 / 映射 / 备注解析分开 |
| P1 | `square_client.py` + 根目录老 `main.py` 等 | — | 新旧两套 Square/webhook | 按 proposal：Jaelyn 为主，老线归档 |
| P1 | `app/database.py` | 287 | 文件开头重复 | 去重，迁移函数单点 |
| P2 | `app/room_assigner.py` vs `unassigned_suggestions.py` | — | 房间优先级复制两份 | 单一常量来源 |
| P2 | 测试 | `tests/` 几乎只有分房 | 排班/API 无自动网 | O1 补金样例 |

**先做 P0 里你点名最痛的那一块**（最近是排班表），不要从 app.js 1.4 万行开刀。

---

## 附录 B — 明确禁止

- 新开 `MoM_Room_Clean` 第二仓库然后「慢慢切」
- 无金样例就改 `buildSheetAssignments` / 分房优先级
- 全仓库一次性 ruff format / mypy strict
- 优化任务里夹带新功能（语音、新报表、新规则）
- 把 `debugging/` 脚本当正式测试
- 猜店里规则；与 `sheet_rules.md` 或 proposal 冲突时提问
