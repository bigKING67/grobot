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
    measureDisplayWidth(`目录 ${projectSkillsDir}`),
    measureDisplayWidth(`目录 ${globalSkillsDir}`),
    measureDisplayWidth(`技能 ${String(projectStatus.skillCount)} 个 · 无效目录 ${String(projectStatus.invalidDirectoryCount)} 个`),
    measureDisplayWidth(`技能 ${String(globalStatus.skillCount)} 个 · 无效目录 ${String(globalStatus.invalidDirectoryCount)} 个`),
  );
  return renderInfoPanel({
    title: "技能",
    subtitle: "项目与全局技能目录",
    sections: [
      {
        rows: [
          {
            title: `项目 · ${projectStatus.exists ? "可用" : "未找到"}`,
            detailLines: [
              `目录 ${projectStatus.path}`,
              `技能 ${String(projectStatus.skillCount)} 个 · 无效目录 ${String(projectStatus.invalidDirectoryCount)} 个`,
            ],
          },
          {
            title: `全局 · ${globalStatus.exists ? "可用" : "未找到"}`,
            detailLines: [
              `目录 ${globalStatus.path}`,
              `技能 ${String(globalStatus.skillCount)} 个 · 无效目录 ${String(globalStatus.invalidDirectoryCount)} 个`,
            ],
          },
        ],
      },
    ],
    footerLines: [
      "使用 /skill-creator <需求> 创建或更新技能",
      "使用 /commands 管理可复用本地命令模板",
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
        title: primary ?? "无更多信息",
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
