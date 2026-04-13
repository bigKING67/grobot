import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface, Interface } from "node:readline";
import { removeTrailingSlashes } from "../services/runtime-paths";

const HANDOFF_FILENAME = "HANDOFF.md";

function dirname(path: string): string {
  const normalized = removeTrailingSlashes(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function questionAsync(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (value) => {
      resolve(value);
    });
  });
}

export function buildHandoffPath(projectRoot: string): string {
  return `${projectRoot}/${HANDOFF_FILENAME}`;
}

export function writeHandoffFile(path: string, content: string): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function runSessionInputLoop(
  handler: (input: string) => Promise<"continue" | "break">,
  prompt = "grobot> ",
): Promise<void> {
  if (!process.stdin.isTTY) {
    let stdinContent = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      stdinContent += String(chunk);
    }
    const lines = stdinContent.split(/\r?\n/);
    for (const line of lines) {
      const action = await handler(line);
      if (action === "break") {
        break;
      }
    }
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let sawSigint = false;
  rl.on("SIGINT", () => {
    sawSigint = true;
    rl.close();
  });
  while (true) {
    let rawInput = "";
    try {
      rawInput = await questionAsync(rl, prompt);
    } catch {
      break;
    }
    if (sawSigint) {
      process.stdout.write("Interrupted\n");
      break;
    }
    const action = await handler(rawInput);
    if (action === "break") {
      break;
    }
  }
  rl.close();
}
