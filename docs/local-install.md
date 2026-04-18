# Grobot 本机安装（与 claude/codex 风格一致）

## 目标

- 数据目录固定在 `~/.grobot`（配置与持久状态）。
- 可执行命令 `grobot` 放到 PATH 里的 bin 目录（推荐 `~/.local/bin`）。
- 使用体验与 `claude` / `codex` 一致：进入任意项目目录后直接输入 `grobot`。
- 安装脚本自动补齐全局骨架（幂等，不覆盖已有配置）。

## 首次安装（推荐）

```bash
cd /Users/gaoqian/Documents/sixseven/workman/groland/grobot
bash scripts/install-local.sh --bin-dir "$HOME/.local/bin" --no-profile

# 当前 shell 立即生效
export PATH="$HOME/.local/bin:$PATH"

# 验证
which grobot
grobot --help
```

说明：

- `--no-profile` 不会改你的 `~/.zshrc` / `~/.bashrc`，适合你自己管理 PATH。
- 如果你希望安装脚本自动写 profile，可以去掉 `--no-profile`。
- 安装时会自动补齐 `~/.grobot`（或 `GROBOT_HOME` / `--home`）：
  - 文件：`config.toml`、`config.toml.example`、`mcp/servers.toml`
  - 目录：`hooks/skills/memory/wiki/mcp/rules/plans/experience/sessions`
- 该补齐逻辑是幂等的：已有文件不会被覆盖，已有目录不会重建。
- TS dev CLI 编译缓存默认写入系统缓存目录（macOS: `~/Library/Caches/grobot/ts-dev-cli`），不再暴露在 `~/.grobot/cache/ts-dev-cli`。
- 重新执行安装脚本时，会尝试迁移旧的 `~/.grobot/cache/ts-dev-cli`。
- 安装时会自动迁移 legacy 会话目录：`~/.grobot/session/* -> ~/.grobot/sessions/*`（同名目标存在时跳过该条）。

## 启动方式

### 本地终端（推荐）

```bash
cd /path/to/your/project
grobot
```

### IM/Bridge 入口（`start`）

`start` 已是 IM-only，必须显式带平台/会话上下文：

```bash
grobot start \
  --platform feishu \
  --session-scope dm \
  --session-subject <open_id_or_user_id> \
  --project <project-name> \
  --work-dir "$(pwd)"
```

如果直接在本地执行 `grobot start` 且没带上下文，会返回 `exit code 2` 并提示改用裸命令 `grobot`。

## 初始化与清理

```bash
# 仅初始化全局目录（等价安装脚本的 bootstrap-only）
grobot init --global

# 初始化当前项目的 .grobot 骨架
grobot init --project

# 查看清理候选（默认 dry-run）
grobot gc --json

# 执行清理
grobot gc --apply
```

`gc` 策略优先级：`CLI 参数 > config.toml[storage.cleanup] > 默认值`。

## 更新

```bash
cd /Users/gaoqian/Documents/sixseven/workman/groland/grobot
git pull
bash scripts/install-local.sh --bin-dir "$HOME/.local/bin" --no-profile
```

说明：`install-local.sh` 会覆盖软链接到当前仓库路径；仓库目录变化后建议重跑一次安装命令。

## 卸载

```bash
cd /Users/gaoqian/Documents/sixseven/workman/groland/grobot
bash scripts/uninstall-local.sh --bin-dir "$HOME/.local/bin"
```

## 可选：沿用历史目录

如果你要继续用 `~/.grobot/bin`：

```bash
bash scripts/install-local.sh --bin-dir "$HOME/.grobot/bin"
bash scripts/uninstall-local.sh --bin-dir "$HOME/.grobot/bin"
```

## 进阶参数

```bash
# 指定全局 home（默认 ~/.grobot）
bash scripts/install-local.sh --home "$HOME/.grobot"

# 明确跳过全局骨架补齐（不推荐）
bash scripts/install-local.sh --no-home-bootstrap

# 仅补齐全局骨架，不安装 grobot 命令
bash scripts/install-local.sh --bootstrap-only
```
