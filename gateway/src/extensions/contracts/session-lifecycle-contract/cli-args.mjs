import { SESSION_SCOPE_DM } from "./constants.mjs";

function parseOptionToken(token) {
  if (!token.startsWith("--")) {
    return null;
  }
  const body = token.slice(2);
  const eqIndex = body.indexOf("=");
  if (eqIndex < 0) {
    return { key: body, valueInline: null };
  }
  return {
    key: body.slice(0, eqIndex),
    valueInline: body.slice(eqIndex + 1),
  };
}

export function parseCliArgv(argvTokens) {
  const tokens = argvTokens.filter((item) => typeof item === "string");
  const command = tokens[0] ?? "";
  const parsed = {
    command,
    session_scope: SESSION_SCOPE_DM,
    session_subject: null,
    memory_command: null,
    kind: null,
    scope: null,
    include_restricted: false,
    include_secret: false,
    dry_run: false,
  };
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (command === "memory" && !token.startsWith("--") && parsed.memory_command === null) {
      parsed.memory_command = token.toLowerCase();
      index += 1;
      continue;
    }
    const option = parseOptionToken(token);
    if (option === null) {
      index += 1;
      continue;
    }
    const optionKey = option.key;
    const consumesValue = !["include-restricted", "include-secret", "dry-run", "apply"].includes(optionKey);
    let optionValue = option.valueInline;
    if (consumesValue && optionValue === null) {
      optionValue = tokens[index + 1] ?? "";
      index += 1;
    }
    if (optionKey === "session-scope" && optionValue) {
      parsed.session_scope = optionValue;
    } else if (optionKey === "session-subject" && optionValue) {
      parsed.session_subject = optionValue;
    } else if (optionKey === "kind" && optionValue) {
      parsed.kind = optionValue;
    } else if (optionKey === "scope" && optionValue) {
      parsed.scope = optionValue;
    } else if (optionKey === "include-restricted") {
      parsed.include_restricted = true;
    } else if (optionKey === "include-secret") {
      parsed.include_secret = true;
      parsed.include_restricted = true;
    } else if (optionKey === "dry-run") {
      parsed.dry_run = true;
    }
    index += 1;
  }
  return parsed;
}
