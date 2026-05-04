import { runInputChromeChecks } from "./start-input-keybinding-contract/chrome-contract";
import { runInputKeybindingChecks } from "./start-input-keybinding-contract/input-contract";
import { runMenuKeybindingChecks } from "./start-input-keybinding-contract/menu-contract";
import { runPromptSlotChecks } from "./start-input-keybinding-contract/prompt-slot-contract";
import { runSuggestionKeybindingChecks } from "./start-input-keybinding-contract/suggestion-contract";

async function main(): Promise<void> {
  const payload = {
    ...runMenuKeybindingChecks(),
    ...runSuggestionKeybindingChecks(),
    ...runInputKeybindingChecks(),
    ...runInputChromeChecks(),
    ...runPromptSlotChecks(),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
