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
    "你正在执行 grobot 内置 `/init`。",
    "目标：为当前项目生成项目级 `AGENTS.md`，这是用户可编辑的项目协作规范。",
    "",
    "硬性约束：",
    `- 必须创建文件：${input.targetPath}`,
    `- 项目根目录：${input.projectRoot}`,
    `- 当前工作目录：${input.workDir}`,
    "- 不要创建或修改 `CLAUDE.md`。",
    "- 不要创建或修改 `SYSTEM.md` 或 `SOUL.md`；`SYSTEM.md` 是产品内置系统提示词，不是项目文件。",
    "- 不要生成 Trellis 文件，也不要把 Trellis 描述为 grobot 用户需要使用的功能。",
    "- `AGENTS.md` 应描述项目结构、构建/测试命令、代码风格、验证要求、安全配置注意事项，以及 agent-specific instructions。",
    "- 内容应简洁、可执行、面向这个仓库；如果某些命令无法确认，写明需要用当前仓库脚本核验，不要编造。",
    "- 必须实际写入文件，不要只在聊天中展示内容。",
    "",
    "建议结构：",
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
    title: "AGENTS.md 已存在",
    sections: [{
      rows: [{
        title: "已跳过 /init，避免覆盖。",
        detailLines: [`路径 ${targetPath}`],
      }],
    }],
  });
}

export function buildAgentsInitStartedSurface(targetPath: string): string {
  return renderInfoPanel({
    title: "正在生成项目指令",
    sections: [{
      rows: [{
        title: "目标文件已确认。",
        detailLines: [`路径 ${targetPath}`],
      }],
    }],
  });
}
