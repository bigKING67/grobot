import { existsSync, readdirSync, statSync } from "node:fs";
import { measureDisplayWidth } from "../../tui/terminal/display-width";
import { compactSingleLine } from "../session/history";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
import { trimTrailingSlashes } from "./path-utils";

interface SkillDirectoryStatus {
  path: string;
  exists: boolean;
  skillCount: number;
  invalidDirectoryCount: number;
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readSkillDirectoryStatus(path: string): SkillDirectoryStatus {
  if (!existsSync(path) || !safeIsDirectory(path)) {
    return {
      path,
      exists: false,
      skillCount: 0,
      invalidDirectoryCount: 0,
    };
  }
  let skillCount = 0;
  let invalidDirectoryCount = 0;
  for (const entry of readdirSync(path)) {
    const entryPath = `${trimTrailingSlashes(path)}/${entry}`;
    if (!safeIsDirectory(entryPath)) {
      continue;
    }
    const skillPath = `${entryPath}/SKILL.md`;
    if (existsSync(skillPath)) {
      skillCount += 1;
    } else {
      invalidDirectoryCount += 1;
    }
  }
  return {
    path,
    exists: true,
    skillCount,
    invalidDirectoryCount,
  };
}

export function buildSkillsStatusSurface(input: {
  homeDir: string;
  projectRoot: string;
}): string {
  const projectSkillsDir = `${trimTrailingSlashes(input.projectRoot)}/.grobot/skills`;
  const globalSkillsDir = `${trimTrailingSlashes(input.homeDir)}/skills`;
  const projectStatus = readSkillDirectoryStatus(projectSkillsDir);
  const globalStatus = readSkillDirectoryStatus(globalSkillsDir);
  const widestLine = Math.max(
    measureDisplayWidth(`directory ${projectSkillsDir}`),
    measureDisplayWidth(`directory ${globalSkillsDir}`),
    measureDisplayWidth(`skills ${String(projectStatus.skillCount)} · invalid directories ${String(projectStatus.invalidDirectoryCount)}`),
    measureDisplayWidth(`skills ${String(globalStatus.skillCount)} · invalid directories ${String(globalStatus.invalidDirectoryCount)}`),
  );
  return renderInfoPanel({
    title: "Skills",
    subtitle: "Project and global skill directories",
    sections: [
      {
        rows: [
          {
            title: `Project · ${projectStatus.exists ? "available" : "not found"}`,
            detailLines: [
              `directory ${projectStatus.path}`,
              `skills ${String(projectStatus.skillCount)} · invalid directories ${String(projectStatus.invalidDirectoryCount)}`,
            ],
          },
          {
            title: `Global · ${globalStatus.exists ? "available" : "not found"}`,
            detailLines: [
              `directory ${globalStatus.path}`,
              `skills ${String(globalStatus.skillCount)} · invalid directories ${String(globalStatus.invalidDirectoryCount)}`,
            ],
          },
        ],
      },
    ],
    footerLines: [
      "Use /skill-creator <requirement> to create or update skills",
      "Use /commands to manage reusable local command templates",
    ],
    terminalColumns: Math.max(96, widestLine + 10),
  });
}

export function buildSkillCreatorSurface(input: {
  title: string;
  details?: readonly string[];
}): string {
  const details = (input.details ?? [])
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0);
  const [primary, ...detailLines] = details;
  return renderInfoPanel({
    title: input.title,
    sections: [{
      rows: [{
        title: primary ?? "No details",
        detailLines,
      }],
    }],
  });
}

export function buildSkillCreatorPrompt(input: {
  requirement: string;
  projectRoot: string;
  homeDir: string;
}): string {
  const requirement = input.requirement.trim();
  const projectSkillsDir = `${trimTrailingSlashes(input.projectRoot)}/.grobot/skills`;
  const globalSkillsDir = `${trimTrailingSlashes(input.homeDir)}/skills`;
  return [
    "You are now running the built-in `skill-creator` task.",
    "Follow these constraints:",
    "- Prefer creating or updating the project skill directory: `./.grobot/skills`.",
    `- Absolute path reference: ${projectSkillsDir}`,
    `- Global built-in skill directory: ${globalSkillsDir}/skill-creator`,
    "- If requirements are incomplete, ask the minimum necessary clarification before producing an executable skill.",
    "- Output a skill file structure and content that can be used directly.",
    "",
    "User request:",
    requirement,
  ].join("\n");
}

export function buildSkillCreatorStartedSurface(requirement: string): string {
  return buildSkillCreatorSurface({
    title: "Generating skill",
    details: [compactSingleLine(requirement, 120)],
  });
}
