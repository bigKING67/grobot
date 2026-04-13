interface RunStartMessageModeInput {
  message: string;
  executeTurn(userInput: string, interactiveMode: boolean): Promise<number>;
  markFailureObserved(): void;
  handoffAutoOnExit: boolean;
  writeAutoExitHandoffIfNeeded(): void;
}

export async function runStartMessageMode(input: RunStartMessageModeInput): Promise<number> {
  const code = await input.executeTurn(input.message, false);
  if (code !== 0) {
    input.markFailureObserved();
  }
  if (input.handoffAutoOnExit) {
    input.writeAutoExitHandoffIfNeeded();
  }
  return code;
}
