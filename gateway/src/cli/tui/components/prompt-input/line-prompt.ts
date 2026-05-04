import * as readlineModule from "node:readline";
import { type MenuInputStream, type TerminalLinePromptResult } from "./contract";

export async function runTerminalLinePrompt(input: {
  prompt: string;
}): Promise<TerminalLinePromptResult> {
  if (!process.stdin.isTTY) {
    return { kind: "cancelled" };
  }
  const stdin = process.stdin as unknown as MenuInputStream;
  stdin.setEncoding?.("utf8");
  stdin.resume?.();
  return await new Promise<TerminalLinePromptResult>((resolve) => {
    const rl = readlineModule.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    let settled = false;
    const finish = (result: TerminalLinePromptResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      resolve(result);
    };
    rl.on("SIGINT", () => {
      process.stdout.write("\n");
      finish({ kind: "cancelled" });
    });
    rl.question(input.prompt, (answer) => {
      finish({
        kind: "submitted",
        value: String(answer ?? ""),
      });
    });
  });
}
