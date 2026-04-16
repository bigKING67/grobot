#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function shouldSkipInjection() {
  return process.env.CODEX_NON_INTERACTIVE === "1";
}

function readFile(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function runScript(scriptPath) {
  try {
    const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
    const result = spawnSync("python3", ["-W", "ignore", scriptPath], {
      cwd: path.resolve(path.dirname(scriptPath), "..", ".."),
      env,
      encoding: "utf8",
      timeout: 5_000,
    });
    if (result.status === 0) {
      return result.stdout || "No context available";
    }
    return "No context available";
  } catch {
    return "No context available";
  }
}

function normalizeTaskRef(taskRef) {
  let normalized = String(taskRef || "").trim();
  if (!normalized) {
    return "";
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  normalized = normalized.replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  if (normalized.startsWith("tasks/")) {
    return `.trellis/${normalized}`;
  }

  return normalized;
}

function resolveTaskDir(trellisDir, taskRef) {
  const normalized = normalizeTaskRef(taskRef);
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  if (normalized.startsWith(".trellis/")) {
    return path.resolve(path.dirname(trellisDir), normalized);
  }
  return path.resolve(trellisDir, "tasks", normalized);
}

function getTaskStatus(trellisDir) {
  const currentTaskFile = path.join(trellisDir, ".current-task");
  if (!fs.existsSync(currentTaskFile)) {
    return "Status: NO ACTIVE TASK\nNext: Describe what you want to work on";
  }

  const rawTaskRef = readFile(currentTaskFile).trim();
  const taskRef = normalizeTaskRef(rawTaskRef);
  if (!taskRef) {
    return "Status: NO ACTIVE TASK\nNext: Describe what you want to work on";
  }

  const taskDir = resolveTaskDir(trellisDir, taskRef);
  if (!fs.existsSync(taskDir) || !fs.statSync(taskDir).isDirectory()) {
    return `Status: STALE POINTER\nTask: ${taskRef}\nNext: Task directory not found. Run: python3 ./.trellis/scripts/task.py finish`;
  }

  const taskJsonPath = path.join(taskDir, "task.json");
  let taskData = {};
  if (fs.existsSync(taskJsonPath)) {
    try {
      const raw = readFile(taskJsonPath, "{}");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        taskData = parsed;
      }
    } catch {
      taskData = {};
    }
  }

  const taskTitle = typeof taskData.title === "string" ? taskData.title : taskRef;
  const taskStatus = typeof taskData.status === "string" ? taskData.status : "unknown";

  if (taskStatus === "completed") {
    return `Status: COMPLETED\nTask: ${taskTitle}\nNext: Archive with \`python3 ./.trellis/scripts/task.py archive ${path.basename(taskDir)}\` or start a new task`;
  }

  const contextFiles = ["implement.jsonl", "check.jsonl", "spec.jsonl"];
  let hasContext = false;
  for (const jsonlName of contextFiles) {
    const jsonlPath = path.join(taskDir, jsonlName);
    if (!fs.existsSync(jsonlPath)) {
      continue;
    }
    try {
      if (fs.statSync(jsonlPath).size > 0) {
        hasContext = true;
        break;
      }
    } catch {
      // ignore fs errors
    }
  }

  const hasPrd = fs.existsSync(path.join(taskDir, "prd.md"));
  if (!hasPrd) {
    return `Status: NOT READY\nTask: ${taskTitle}\nMissing: prd.md not created\nNext: Write PRD, then research -> init-context -> start`;
  }
  if (!hasContext) {
    return `Status: NOT READY\nTask: ${taskTitle}\nMissing: Context not configured (no jsonl files)\nNext: Complete Phase 2 (research -> init-context -> start) before implementing`;
  }
  return `Status: READY\nTask: ${taskTitle}\nNext: Continue with implement or check`;
}

function buildWorkflowToc(workflowPath) {
  const content = readFile(workflowPath);
  if (!content) {
    return "No workflow.md found";
  }

  const tocLines = [
    "# Development Workflow - Section Index",
    "Full guide: .trellis/workflow.md  (read on demand)",
    "",
  ];
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      tocLines.push(line);
    }
  }
  tocLines.push("");
  tocLines.push("To read a section: use the Read tool on .trellis/workflow.md");
  return tocLines.join("\n");
}

function appendGuidelines(parts, specDir) {
  if (!fs.existsSync(specDir) || !fs.statSync(specDir).isDirectory()) {
    return;
  }

  const subEntries = fs
    .readdirSync(specDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const sub of subEntries) {
    const subPath = path.join(specDir, sub.name);
    if (sub.name === "guides") {
      const indexFile = path.join(subPath, "index.md");
      if (fs.existsSync(indexFile)) {
        parts.push(`## ${sub.name}\n`);
        parts.push(readFile(indexFile));
        parts.push("\n\n");
      }
      continue;
    }

    const indexFile = path.join(subPath, "index.md");
    if (fs.existsSync(indexFile)) {
      parts.push(`## ${sub.name}\n`);
      parts.push(readFile(indexFile));
      parts.push("\n\n");
      continue;
    }

    const nestedEntries = fs
      .readdirSync(subPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const nested of nestedEntries) {
      const nestedIndex = path.join(subPath, nested.name, "index.md");
      if (!fs.existsSync(nestedIndex)) {
        continue;
      }
      parts.push(`## ${sub.name}/${nested.name}\n`);
      parts.push(readFile(nestedIndex));
      parts.push("\n\n");
    }
  }
}

function parseHookInputCwd() {
  try {
    const rawStdin = fs.readFileSync(0, "utf8");
    if (!rawStdin.trim()) {
      return path.resolve(".");
    }
    const payload = JSON.parse(rawStdin);
    if (payload && typeof payload.cwd === "string" && payload.cwd.trim()) {
      return path.resolve(payload.cwd.trim());
    }
    return path.resolve(".");
  } catch {
    return path.resolve(".");
  }
}

function main() {
  if (shouldSkipInjection()) {
    process.exit(0);
  }

  const projectDir = parseHookInputCwd();
  const trellisDir = path.join(projectDir, ".trellis");
  const parts = [];

  parts.push("<session-context>\n");
  parts.push("You are starting a new session in a Trellis-managed project.\n");
  parts.push("Read and follow all instructions below carefully.\n");
  parts.push("</session-context>\n\n");

  parts.push("<current-state>\n");
  parts.push(runScript(path.join(trellisDir, "scripts", "get_context.py")));
  parts.push("\n</current-state>\n\n");

  parts.push("<workflow>\n");
  parts.push(buildWorkflowToc(path.join(trellisDir, "workflow.md")));
  parts.push("\n</workflow>\n\n");

  parts.push("<guidelines>\n");
  parts.push(
    "**Note**: The guidelines below are index files - they list available guideline documents and their locations.\n",
  );
  parts.push(
    "During actual development, you MUST read the specific guideline files listed in each index's Pre-Development Checklist.\n\n",
  );
  appendGuidelines(parts, path.join(trellisDir, "spec"));
  parts.push("</guidelines>\n\n");

  parts.push(`<task-status>\n${getTaskStatus(trellisDir)}\n</task-status>\n\n`);

  parts.push("<ready>\n");
  parts.push(
    "Context loaded. Workflow index, project state, and guidelines are already injected above - do NOT re-read them.\n",
  );
  parts.push("Wait for the user's first message, then handle it following the workflow guide.\n");
  parts.push("If there is an active task, ask whether to continue it.\n");
  parts.push("</ready>");

  const context = parts.join("");
  const payload = {
    suppressOutput: true,
    systemMessage: `Trellis context injected (${context.length} chars)`,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main();
