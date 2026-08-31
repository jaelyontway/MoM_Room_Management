# M9 配置与运维 — 任务清单

## 已完成

- [x] `.env` + `config.py` 集中配置，`env.example` 模板
- [x] 本机启动脚本 `start_server_jaelyn.bat`（8001，局域网可访问）
- [x] `Dockerfile` / `docker-compose.yml` / `.dockerignore`（restart、healthcheck、资源、日志四类 policy）

## 待办

### Docker 落地（⏸ 暂缓 — 2026-08-11 决策"先不用 docker"，配置文件保留备用）

- [ ] ~~安装 Docker Desktop（WSL2 后端，开机自启）~~
- [ ] ~~`docker compose up -d --build` 首次构建并验证 `/api/status` healthy~~
- [ ] ~~验证重启策略：杀掉容器进程 / 重启电脑后服务自动恢复~~

### 工程化工具接入（Vibe Coding 基础设施）

- [ ] 引入 `pyproject.toml`（uv 或 pip 均可），锁定依赖版本
- [ ] 接入 ruff（先只开基础规则，存量代码用 `--fix` 渐进清理）
- [ ] 接入 pytest：从 `debugging/root_scripts/` 挑出仍有价值的 `test_*.py` 迁到 `tests/` 改造为正式用例
- [ ] 接入 mypy（先对 `app/room_assigner.py`、`app/room_occupancy.py` 等核心纯逻辑模块启用）

### 仓库整理

- [x] 根目录 51 个 `check_*/test_*/debug_*/verify_*` 等脚本归档到 `debugging/root_scripts/`（2026-08-11 完成）
- [ ] 老 webhook 线四文件（`main.py`、`webhook_handler.py`、`booking_sync.py`、`polling_mode.py`）去留待确认（proposal.md 第 8 节）
- [ ] 变更整理后提交并推送到 GitHub `mark-v` 分支（发布口径：只维护 Jaelyn）
