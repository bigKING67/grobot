export type OptionValue = string | boolean;

export interface ParsedArgs {
  command: string;
  options: Record<string, OptionValue>;
  positionals: string[];
}

export function usage(): string {
  return [
    "Grobot",
    "本地交互 agent；直接运行 `grobot` 进入 TUI。",
    "",
    "命令",
    "  • grobot",
    "    ⎿  进入本地交互 TUI",
    "  • grobot status",
    "    ⎿  查看可操作摘要；加 --json 输出完整机器快照；加 --probe 测试模型通道",
    "  • grobot init --project",
    "    ⎿  初始化当前项目配置；--global 初始化全局配置",
    "  • grobot gc --dry-run",
    "    ⎿  预览会话、计划和运行缓存清理；确认后用 --apply",
    "  • grobot serve",
    "    ⎿  启动本地管理服务",
    "",
    "常用选项",
    "  • status",
    "    ⎿  --project --work-dir --config --provider --model --probe --json",
    "  • gc",
    "    ⎿  --scope global|project|all --retention-days --keep-recent-sessions --apply --json",
    "  • serve",
    "    ⎿  --bind --management-token --config-read-policy --session-backend --redis-url",
    "",
    "会话恢复",
    "  • grobot --resume <session-id|query>",
    "    ⎿  启动时恢复匹配会话；--resume-last 直接取最近可恢复会话",
    "  • grobot --rewind [checkpoint-id|query]",
    "    ⎿  启动时回到检查点；--rewind-mode both|conversation|code|summarize 控制恢复范围",
    "",
    "更多",
    "  • 交互内输入 /help 查看 TUI 命令",
    "  • start 子命令保留给平台会话入口；本机交互优先直接运行 grobot",
  ].join("\n");
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, OptionValue> = {};
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      index += 1;
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex >= 0) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      options[key] = value;
      index += 1;
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      options[key] = next;
      index += 2;
      continue;
    }
    options[key] = true;
    index += 1;
  }

  const command = positionals[0] ?? "";
  return {
    command,
    options,
    positionals: positionals.slice(1),
  };
}

export function readOptionString(options: Record<string, OptionValue>, key: string): string | undefined {
  const value = options[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

export function readOptionStringAny(options: Record<string, OptionValue>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readOptionString(options, key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function hasFlag(options: Record<string, OptionValue>, key: string): boolean {
  const value = options[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "false" || normalized === "off" || normalized === "0" || normalized === "no") {
      return false;
    }
    return normalized.length > 0;
  }
  return false;
}

function isTruthyString(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function validateHardCutExecutionOptions(options: Record<string, OptionValue>): string[] {
  const errors: string[] = [];
  if (hasFlag(options, "legacy-python-cli")) {
    errors.push("--legacy-python-cli is removed in TS+Rust hard-cut mode");
  }
  if (isTruthyString(process.env.GROBOT_LEGACY_PYTHON)) {
    errors.push("GROBOT_LEGACY_PYTHON is no longer supported");
  }

  const gatewayRaw = readOptionString(options, "gateway-impl");
  if (gatewayRaw) {
    const gatewayValue = gatewayRaw.trim().toLowerCase();
    if (gatewayValue === "python") {
      errors.push("--gateway-impl=python is no longer supported");
    } else if (gatewayValue !== "ts") {
      errors.push(`invalid --gateway-impl value: ${gatewayRaw}`);
    }
  }

  const runtimeRaw = readOptionString(options, "runtime-impl");
  if (runtimeRaw) {
    const runtimeValue = runtimeRaw.trim().toLowerCase();
    if (runtimeValue === "python") {
      errors.push("--runtime-impl=python is no longer supported");
    } else if (runtimeValue !== "rust") {
      errors.push(`invalid --runtime-impl value: ${runtimeRaw}`);
    }
  }

  return errors;
}
