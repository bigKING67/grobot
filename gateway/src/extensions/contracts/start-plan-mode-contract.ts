import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { runApprovalAndControlFlow } from "./start-plan-mode-contract/approval-flow";
import { runFailurePlanModeFlow } from "./start-plan-mode-contract/failure-flow";
import { runPrimaryPlanModeFlow } from "./start-plan-mode-contract/primary-flow";
import { runReviewContract } from "./start-plan-mode-contract/review-contract";

async function main(): Promise<void> {
  const workDir = resolve(
    process.cwd(),
    ".grobot-contract-temp",
    `plan-mode-${Date.now().toString(36)}-${Math.floor(Math.random() * 65_536).toString(16)}`,
  );
  mkdirSync(workDir, { recursive: true });
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalEditor = process.env.EDITOR;
  const originalVisual = process.env.VISUAL;
  process.env.EDITOR = "vim";
  delete process.env.VISUAL;
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });

  try {
    const payload = {
      ...runReviewContract(),
      ...(await runPrimaryPlanModeFlow(workDir)),
      ...(await runFailurePlanModeFlow(workDir)),
      ...(await runApprovalAndControlFlow(workDir)),
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalStdinIsTTY,
    });
    if (typeof originalEditor === "string") {
      process.env.EDITOR = originalEditor;
    } else {
      delete process.env.EDITOR;
    }
    if (typeof originalVisual === "string") {
      process.env.VISUAL = originalVisual;
    } else {
      delete process.env.VISUAL;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
}

void main();
