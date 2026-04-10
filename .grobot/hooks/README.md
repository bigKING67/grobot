# Grobot Hooks

支持事件：
- `user-prompt-submit`
- `before-tool-use`
- `after-tool-use`

目录结构：
- `hooks/user-prompt-submit/`
- `hooks/before-tool-use/`
- `hooks/after-tool-use/`

脚本要求：
- 放在对应事件目录下
- 需要可执行权限（`chmod +x`）
- 通过 STDIN 接收 JSON payload

环境变量：
- `GROBOT_HOOK_EVENT`
- `GROBOT_HOOK_WORK_DIR`
- `GROBOT_HOOK_TIMEOUT_SECS`

快速上手：
- 生成样例脚本：`grobot init --project --hooks-samples`
- 运行体检：`grobot hooks doctor --work-dir "$(pwd)"`
