# Grobot 本机安装（与 claude/codex 风格一致）

## 目标

- 数据目录固定在 `~/.grobot`（配置、会话、日志、缓存）。
- 可执行命令 `grobot` 放到 PATH 里的 bin 目录（推荐 `~/.local/bin`）。
- 使用体验与 `claude` / `codex` 一致：进入任意项目目录后直接输入 `grobot`。

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

## 可选：沿用历史默认目录

如果你要继续用 `~/.grobot/bin`：

```bash
bash scripts/install-local.sh
bash scripts/uninstall-local.sh
```
