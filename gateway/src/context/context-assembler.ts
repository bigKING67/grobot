import { TurnContextAssembler } from "../orchestrator/agent-loop";
import { TurnRequest } from "../types";

export class SimpleContextAssembler implements TurnContextAssembler {
  private readonly staticFacts: string[];

  public constructor(staticFacts: string[] = []) {
    this.staticFacts = staticFacts;
  }

  public async assemble(turn: TurnRequest): Promise<string[]> {
    const messageFingerprint = `user:${turn.userMessage.slice(0, 128)}`;
    return [
      ...this.staticFacts,
      `session:${turn.sessionKey}`,
      `project:${turn.metadata.projectId}`,
      messageFingerprint,
    ];
  }
}
