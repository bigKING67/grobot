import { existsSync, readdirSync, statSync } from "node:fs";
import { compactSingleLine } from "../session-history";
import { terminalStyle } from "../../tui/theme/terminal-style";
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

function formatSkillDirectoryStatusLines(
  label: string,
  status: SkillDirectoryStatus,
): string[] {
  return [
    `${label}: ${status.exists ? "可用" : "未找到"}`,
    `  目录: ${status.path}`,
    `  Skills: ${String(status.skillCount)}`,
    `  无效目录: ${String(status.invalidDirectoryCount)}`,
  ];
}

export function buildSkillsStatusSurface(input: {
  homeDir: string;
  projectRoot: string;
}): string {
  const projectSkillsDir = `${trimTrailingSlashes(input.projectRoot)}/.grobot/skills`;
  const globalSkillsDir = `${trimTrailingSlashes(input.homeDir)}/skills`;
  const projectStatus = readSkillDirectoryStatus(projectSkillsDir);
  const globalStatus = readSkillDirectoryStatus(globalSkillsDir);
  return [
    "● Skills",
    ...formatSkillDirectoryStatusLines("项目", projectStatus).map(
      (line) => `  ${line}`,
    ),
    ...formatSkillDirectoryStatusLines("全局", globalStatus).map(
      (line) => `  ${line}`,
    ),
    "  提示: 使用 /skill-creator <需求> 创建或更新 skill",
    "  提示: 使用 /commands 管理可复用本地命令模板",
    "",
  ].join("\n");
}

export function buildSkillCreatorSurface(input: {
  title: string;
  details?: readonly string[];
}): string {
  const lines = [`${terminalStyle.accent("●")} ${input.title}`];
  for (const detail of input.details ?? []) {
    lines.push(`  ${terminalStyle.muted(detail)}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
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
    "你现在需要作为内置 `skill-creator` 执行技能创建任务。",
    "请按以下约束执行：",
    "- 优先创建或更新项目技能目录：`./.grobot/skills`。",
    `- 绝对路径参考：${projectSkillsDir}`,
    `- 全局内置技能目录：${globalSkillsDir}/skill-creator`,
    "- 若需求不完整，请先补齐最少必要澄清，再继续产出可执行技能。",
    "- 产出目标是可以直接落地使用的 skill 文件结构与内容。",
    "",
    "用户需求：",
    requirement,
  ].join("\n");
}

export function buildSkillCreatorStartedSurface(requirement: string): string {
  return buildSkillCreatorSurface({
    title: "正在生成技能",
    details: [compactSingleLine(requirement, 120)],
  });
}
