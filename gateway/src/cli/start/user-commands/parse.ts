import {
  RESERVED_SLASH_COMMAND_NAMES,
  USER_COMMAND_NAME_PATTERN,
  type NormalizedCommandNameResult,
} from "./contract";

export function nowIsoUtc(): string {
  return new Date().toISOString();
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCommandName(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateCommandName(nameRaw: string): string | undefined {
  const name = normalizeCommandName(nameRaw);
  if (!USER_COMMAND_NAME_PATTERN.test(name)) {
    return "Invalid command name. Allowed pattern: [a-z][a-z0-9_-], length 1-32.";
  }
  if (RESERVED_SLASH_COMMAND_NAMES.has(name)) {
    return `Command name \`/${name}\` conflicts with a built-in command and cannot be used for user commands.`;
  }
  return undefined;
}

export function normalizeAndValidateCommandName(nameRaw: string): NormalizedCommandNameResult {
  const name = normalizeCommandName(nameRaw);
  const error = validateCommandName(name);
  if (error) {
    return { ok: false, error };
  }
  return { ok: true, name };
}

export function splitFirstToken(input: string): {
  head: string;
  tail: string;
} {
  const normalized = input.trim();
  if (!normalized) {
    return { head: "", tail: "" };
  }
  const firstSpace = normalized.indexOf(" ");
  if (firstSpace < 0) {
    return { head: normalized, tail: "" };
  }
  return {
    head: normalized.slice(0, firstSpace).trim(),
    tail: normalized.slice(firstSpace + 1).trim(),
  };
}

export function parseSlashInvocation(userInput: string): {
  name: string;
  args: string;
} | undefined {
  const trimmed = userInput.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const body = trimmed.slice(1).trim();
  if (!body) {
    return undefined;
  }
  const firstSpace = body.indexOf(" ");
  const commandNameRaw = firstSpace < 0 ? body : body.slice(0, firstSpace);
  const args = firstSpace < 0 ? "" : body.slice(firstSpace + 1).trim();
  const name = normalizeCommandName(commandNameRaw);
  if (!name) {
    return undefined;
  }
  return { name, args };
}

export function normalizeCommandsAliasInput(userInput: string): string | undefined {
  const trimmed = userInput.trim();
  if (/^\/commands(?:\s|$)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\/(?:create|new)\s+commands(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^\/(?:create|new)\s+commands/i, "").trim();
    return rest.length > 0 ? `/commands ${rest}` : "/commands";
  }
  if (/^\/(?:create|new)\s+command(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^\/(?:create|new)\s+command/i, "").trim();
    return rest.length > 0 ? `/commands new ${rest}` : "/commands new";
  }
  return undefined;
}

export function applyCommandPromptTemplate(prompt: string, args: string): string {
  if (prompt.includes("{{args}}")) {
    return prompt.split("{{args}}").join(args);
  }
  if (!args) {
    return prompt;
  }
  return `${prompt}\n\n${args}`;
}
