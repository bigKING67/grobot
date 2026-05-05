import { existsSync } from "node:fs";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
import { trimTrailingSlashes } from "./path-utils";

export function resolveProjectAgentsPath(projectRoot: string): string {
  return `${trimTrailingSlashes(projectRoot)}/AGENTS.md`;
}

export function projectAgentsFileExists(targetPath: string): boolean {
  return existsSync(targetPath);
}

export function buildAgentsInitPrompt(input: {
  targetPath: string;
  projectRoot: string;
  workDir: string;
}): string {
  return [
    "You are executing grobot built-in `/init`.",
    "Goal: generate a project-level `AGENTS.md` for the current project. This is a user-editable collaboration guide.",
    "",
    "Hard constraints:",
    `- Must create file: ${input.targetPath}`,
    `- Project root: ${input.projectRoot}`,
    `- Current working directory: ${input.workDir}`,
    "- Do not create or modify `CLAUDE.md`.",
    "- Do not create or modify `SYSTEM.md` or `SOUL.md`; `SYSTEM.md` is the product built-in system prompt, not a project file.",
    "- Do not generate Trellis files or describe Trellis as something grobot users must use.",
    "- `AGENTS.md` should describe project structure, build/test commands, coding style, verification requirements, security/config notes, and agent-specific instructions.",
    "- Keep content concise, executable, and specific to this repository; if commands cannot be confirmed, say they need repository-script verification instead of inventing them.",
    "- Actually write the file; do not only show content in chat.",
    "",
    "Suggested structure:",
    "# Repository Guidelines",
    "## Project Structure",
    "## Build, Test, and Development Commands",
    "## Coding Style and Naming",
    "## Testing and Verification",
    "## Security and Configuration",
    "## Agent-Specific Instructions",
  ].join("\n");
}

export function buildAgentsInitExistsSurface(targetPath: string): string {
  return renderInfoPanel({
    title: "AGENTS.md already exists",
    sections: [{
      rows: [{
        title: "/init skipped to avoid overwrite.",
        detailLines: [`path ${targetPath}`],
      }],
    }],
  });
}

export function buildAgentsInitStartedSurface(targetPath: string): string {
  return renderInfoPanel({
    title: "Generating project instructions",
    sections: [{
      rows: [{
        title: "Target file confirmed.",
        detailLines: [`path ${targetPath}`],
      }],
    }],
  });
}
