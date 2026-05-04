import { runTerminalLinePrompt } from "../../tui/components/prompt-input/controller";
import {
  buildAgentsInitExistsSurface,
  buildAgentsInitPrompt,
  buildAgentsInitStartedSurface,
  projectAgentsFileExists,
  resolveProjectAgentsPath,
} from "./init-project-instructions";
import {
  buildSkillCreatorPrompt,
  buildSkillCreatorStartedSurface,
  buildSkillCreatorSurface,
} from "./skill-surfaces";
import type {
  CreateRunStartInteractiveModeInput,
  InteractiveModeBindingPatch,
} from "./contract";

export function createInteractiveCommandRuntimes(
  input: CreateRunStartInteractiveModeInput,
  shouldMarkFailure: (code: number) => boolean,
): Pick<
  InteractiveModeBindingPatch,
  "promptSkillCreatorRequirement" | "runSkillCreator" | "runInitProjectInstructions"
> {
  const promptSkillCreatorRequirement = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<string | undefined> => {
    const requirementInput = await withInputPaused(() =>
      runTerminalLinePrompt({
        prompt: "技能需求> ",
      }),
    );
    if (requirementInput.kind === "cancelled") {
      input.output.writeStdout(
        buildSkillCreatorSurface({
          title: "已取消 skill 创建",
        }),
      );
      return undefined;
    }
    const requirement = requirementInput.value.trim();
    if (!requirement) {
      input.output.writeStdout(
        buildSkillCreatorSurface({
          title: "需求为空，已取消 skill 创建",
        }),
      );
      return undefined;
    }
    return requirement;
  };

  const runSkillCreator = async (requirement: string, options?: {
    writeStderr?: (message: string) => void;
  }): Promise<void> => {
    const normalizedRequirement = requirement.trim();
    if (!normalizedRequirement) {
      input.output.writeStdout(
        buildSkillCreatorSurface({
          title: "需要提供技能需求",
          details: ["用法: /skill-creator [需求]"],
        }),
      );
      return;
    }
    input.output.writeStdout(
      buildSkillCreatorStartedSurface(normalizedRequirement),
    );
    const prompt = buildSkillCreatorPrompt({
      requirement: normalizedRequirement,
      projectRoot: input.projectRoot,
      homeDir: input.homeDir,
    });
    const code = await input.executeTurn(prompt, true, {
      writeStderr: options?.writeStderr,
    });
    if (shouldMarkFailure(code)) {
      input.runtimeState.markFailureObserved();
    }
  };

  const runInitProjectInstructions = async (options?: {
    writeStderr?: (message: string) => void;
  }): Promise<void> => {
    const targetPath = resolveProjectAgentsPath(input.projectRoot);
    if (projectAgentsFileExists(targetPath)) {
      input.output.writeStdout(buildAgentsInitExistsSurface(targetPath));
      return;
    }
    input.output.writeStdout(buildAgentsInitStartedSurface(targetPath));
    const prompt = buildAgentsInitPrompt({
      targetPath,
      projectRoot: input.projectRoot,
      workDir: input.workDir,
    });
    const code = await input.executeTurn(prompt, true, {
      writeStderr: options?.writeStderr,
    });
    if (shouldMarkFailure(code)) {
      input.runtimeState.markFailureObserved();
    }
  };

  return {
    promptSkillCreatorRequirement,
    runSkillCreator,
    runInitProjectInstructions,
  };
}
