import { TurnContextAssembler } from "../../orchestration/orchestrator/agent-loop";
import { TurnRequest } from "../types";
import { buildContextLines } from "../../tools/context";

export class SimpleContextAssembler implements TurnContextAssembler {
  private readonly staticFacts: string[];

  public constructor(staticFacts: string[] = []) {
    this.staticFacts = staticFacts;
  }

  public async assemble(turn: TurnRequest): Promise<string[]> {
    return buildContextLines({
      turn,
      staticFacts: this.staticFacts,
    });
  }
}
