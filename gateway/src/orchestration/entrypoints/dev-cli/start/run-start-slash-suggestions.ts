import {
  listSlashCommandSuggestions,
  type SlashCommandSuggestion,
} from "../commands/slash/registry";
import {
  listRunStartUserCommandSuggestions,
  type RunStartUserCommandSuggestion,
} from "./run-start-user-commands";

export interface RunStartSlashSuggestion {
  command: string;
  description: string;
  source: "builtin" | "user";
}

interface ListRunStartSlashSuggestionsInput {
  homeDir: string;
  userInput: string;
  pendingAskCount?: number;
  maxItems?: number;
}

const ROOT_SLASH_PRIMARY_BUILTIN_COMMANDS = new Set<string>([
  "sessions",
  "resume",
  "rewind",
  "commands",
  "skill-creator",
  "ask",
  "model",
  "plan",
  "status",
  "help",
  "exit",
]);

const PENDING_ASK_PRIORITY_SUGGESTIONS: readonly RunStartSlashSuggestion[] = [
  {
    command: "/ask menu",
    description: "Open ask-user action menu for current pending question",
    source: "builtin",
  },
  {
    command: "/ask answer <text>",
    description: "Answer current pending question directly",
    source: "builtin",
  },
  {
    command: "/ask cancel",
    description: "Dismiss current pending question",
    source: "builtin",
  },
  {
    command: "/ask park",
    description: "Park current question and switch to next pending one",
    source: "builtin",
  },
  {
    command: "/ask clear",
    description: "Clear all pending ask-user questions",
    source: "builtin",
  },
];

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function startsWithSlashToken(value: string): boolean {
  return value.trimStart().startsWith("/");
}

function isRootSlashQuery(value: string): boolean {
  return value.trim() === "/";
}

function matchesSuggestionQuery(queryRaw: string, suggestionCommandRaw: string): boolean {
  const query = normalizeForMatch(queryRaw);
  if (!query || query === "/") {
    return true;
  }
  const suggestionCommand = normalizeForMatch(suggestionCommandRaw);
  if (suggestionCommand.startsWith(query)) {
    return true;
  }
  const queryWithoutTrailingSpace = queryRaw.trimStart().toLowerCase().replace(/\s+$/g, "");
  if (queryWithoutTrailingSpace.length > 0 && suggestionCommand.startsWith(queryWithoutTrailingSpace)) {
    return true;
  }
  const queryHead = query.split(/\s+/, 1)[0] ?? "";
  const suggestionHead = suggestionCommand.split(/\s+/, 1)[0] ?? "";
  if (!queryHead || !suggestionHead) {
    return false;
  }
  return suggestionHead.startsWith(queryHead);
}

function toBuiltinSuggestion(item: SlashCommandSuggestion): RunStartSlashSuggestion {
  return {
    command: item.command,
    description: item.description,
    source: "builtin",
  };
}

function toUserSuggestion(item: RunStartUserCommandSuggestion): RunStartSlashSuggestion {
  return {
    command: item.command,
    description: item.enabled ? item.description : `${item.description} (disabled)`,
    source: "user",
  };
}

export function listRunStartSlashSuggestions(
  input: ListRunStartSlashSuggestionsInput,
): RunStartSlashSuggestion[] {
  if (!startsWithSlashToken(input.userInput)) {
    return [];
  }
  const maxItems = typeof input.maxItems === "number" && input.maxItems > 0
    ? Math.floor(input.maxItems)
    : 8;
  const query = input.userInput.trimStart();
  const isRootSlash = isRootSlashQuery(query);
  const hasPendingAsk = typeof input.pendingAskCount === "number" && input.pendingAskCount > 0;
  const suggestions: RunStartSlashSuggestion[] = [];
  const seen = new Set<string>();

  const appendSuggestion = (item: RunStartSlashSuggestion): void => {
    const commandHead = (item.command.trim().split(/\s+/, 1)[0] ?? "").replace(/^\//, "").toLowerCase();
    if (
      isRootSlash
      && item.source === "builtin"
      && !ROOT_SLASH_PRIMARY_BUILTIN_COMMANDS.has(commandHead)
    ) {
      return;
    }
    if (!matchesSuggestionQuery(query, item.command)) {
      return;
    }
    if (seen.has(item.command)) {
      return;
    }
    seen.add(item.command);
    suggestions.push(item);
  };

  if (hasPendingAsk) {
    for (const entry of PENDING_ASK_PRIORITY_SUGGESTIONS) {
      appendSuggestion(entry);
    }
  }

  const builtin = listSlashCommandSuggestions();
  for (const entry of builtin) {
    appendSuggestion(toBuiltinSuggestion(entry));
  }

  const userCommands = listRunStartUserCommandSuggestions(input.homeDir);
  for (const entry of userCommands) {
    appendSuggestion(toUserSuggestion(entry));
  }

  if (suggestions.length <= maxItems) {
    return suggestions;
  }
  return suggestions.slice(0, maxItems);
}
