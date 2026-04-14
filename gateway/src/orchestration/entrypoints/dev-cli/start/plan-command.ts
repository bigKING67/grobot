export type ParsedPlanCommand =
  | { kind: "enter"; goal: string }
  | { kind: "status" }
  | { kind: "show" }
  | { kind: "options" }
  | { kind: "apply"; extra: string }
  | { kind: "discard" }
  | { kind: "invalid"; reason: string };

export type ParsedPlanQuickReply =
  | { kind: "option"; value: 1 | 2 | 3 | 4 }
  | { kind: "none"; note: string }
  | { kind: "text"; note: string }
  | { kind: "empty" };

export function parsePlanCommand(inputRaw: string): ParsedPlanCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/plan")) {
    return { kind: "invalid", reason: "command must start with /plan" };
  }
  const rest = input.slice("/plan".length).trim();
  if (!rest) {
    return { kind: "invalid", reason: "usage: /plan <goal>|status|show|options|apply|discard" };
  }

  const firstSpace = rest.indexOf(" ");
  const head = (firstSpace >= 0 ? rest.slice(0, firstSpace) : rest).trim().toLowerCase();
  const tail = (firstSpace >= 0 ? rest.slice(firstSpace + 1) : "").trim();

  if (head === "status") {
    return { kind: "status" };
  }
  if (head === "show") {
    return { kind: "show" };
  }
  if (head === "options") {
    return { kind: "options" };
  }
  if (head === "apply") {
    return { kind: "apply", extra: tail };
  }
  if (head === "discard") {
    return { kind: "discard" };
  }

  return { kind: "enter", goal: rest };
}

export function parsePlanQuickReply(inputRaw: string): ParsedPlanQuickReply {
  const input = inputRaw.trim();
  if (!input) {
    return { kind: "empty" };
  }
  if (input === "1") {
    return { kind: "option", value: 1 };
  }
  if (input === "2") {
    return { kind: "option", value: 2 };
  }
  if (input === "3") {
    return { kind: "option", value: 3 };
  }
  if (input === "4") {
    return { kind: "option", value: 4 };
  }
  const noneMatch = /^none(?:\s+of\s+these)?\s*[:：]?\s*(.*)$/i.exec(input);
  if (noneMatch) {
    const note = (noneMatch[1] ?? "").trim();
    return { kind: "none", note };
  }
  return { kind: "text", note: input };
}
