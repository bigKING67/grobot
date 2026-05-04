import {
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveHandlers,
} from "../../start/session-interactive";

export interface SlashCommandExecutionInput {
  userInput: string;
  controls: SessionInteractiveControls;
  handlers: SessionInteractiveHandlers;
}

export interface SlashCommandSpec {
  id: string;
  matches(userInput: string): boolean;
  execute(input: SlashCommandExecutionInput): Promise<SessionInteractiveAction>;
  helpLines?: readonly string[];
}

export interface SlashCommandSuggestion {
  command: string;
  description: string;
}
