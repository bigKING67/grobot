export type ParsedPlanCommand =
  | { kind: "enter_mode" }
  | { kind: "open" }
  | { kind: "enter"; goal: string }
  | { kind: "invalid"; reason: string };

const PLAN_NATURAL_EXECUTION_PATTERNS: readonly RegExp[] = [
  /^implement(?:\s+the)?\s+plan[.!?]?$/i,
  /^execute(?:\s+the)?\s+plan[.!?]?$/i,
  /^start\s+(?:implementing|implementation)[.!?]?$/i,
  /^(?:确认[,，]?)?(?:开始|直接)(?:执行|实现)(?:这个|该)?(?:计划|方案)[。！？]?$/,
];

const PLAN_OPEN_ALIASES = new Set([
  "open",
]);

const REMOVED_PLAN_SUBCOMMANDS = new Set([
  "menu",
  "enter",
  "status",
  "benchmark",
  "check",
  "approve",
  "reject",
  "verify",
  "apply",
  "cancel",
]);

export function parsePlanCommand(inputRaw: string): ParsedPlanCommand {
  const input = inputRaw.trim();
  const planMatch = input.match(/^\/plan(?:\s+([\s\S]*))?$/);
  if (!planMatch) {
    return { kind: "invalid", reason: "命令必须以 /plan 开头" };
  }
  const rest = (planMatch[1] ?? "").trim();
  if (!rest) {
    return { kind: "enter_mode" };
  }

  const firstSpace = rest.indexOf(" ");
  const head = (firstSpace >= 0 ? rest.slice(0, firstSpace) : rest).trim().toLowerCase();
  const tail = (firstSpace >= 0 ? rest.slice(firstSpace + 1) : "").trim();

  if (PLAN_OPEN_ALIASES.has(head)) {
    if (tail.length > 0) {
      return { kind: "invalid", reason: "用法: /plan open" };
    }
    return { kind: "open" };
  }
  if (REMOVED_PLAN_SUBCOMMANDS.has(head)) {
    return {
      kind: "invalid",
      reason: "不支持该 /plan 子命令。请使用 /plan、/plan <目标> 或 /plan open",
    };
  }

  return { kind: "enter", goal: rest };
}

export function isNaturalPlanExecutionIntent(inputRaw: string): boolean {
  const input = inputRaw.trim();
  if (!input) {
    return false;
  }
  return PLAN_NATURAL_EXECUTION_PATTERNS.some((pattern) => pattern.test(input));
}
