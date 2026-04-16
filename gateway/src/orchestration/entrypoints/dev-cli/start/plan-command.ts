export type ParsedPlanCommand =
  | { kind: "enter"; goal: string }
  | { kind: "status" }
  | { kind: "apply"; extra: string }
  | { kind: "cancel" }
  | { kind: "invalid"; reason: string };

export function parsePlanCommand(inputRaw: string): ParsedPlanCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/plan")) {
    return { kind: "invalid", reason: "command must start with /plan" };
  }
  const rest = input.slice("/plan".length).trim();
  if (!rest) {
    return {
      kind: "invalid",
      reason: "usage: /plan <goal> | /plan status | /plan apply [extra] | /plan cancel",
    };
  }

  const firstSpace = rest.indexOf(" ");
  const head = (firstSpace >= 0 ? rest.slice(0, firstSpace) : rest).trim().toLowerCase();
  const tail = (firstSpace >= 0 ? rest.slice(firstSpace + 1) : "").trim();

  if (head === "status") {
    return { kind: "status" };
  }
  if (head === "apply") {
    return { kind: "apply", extra: tail };
  }
  if (head === "cancel") {
    return { kind: "cancel" };
  }

  if (head === "show" || head === "options" || head === "discard") {
    return {
      kind: "invalid",
      reason: `unsupported plan command: ${head}. supported: /plan <goal> | /plan status | /plan apply [extra] | /plan cancel`,
    };
  }

  return { kind: "enter", goal: rest };
}
