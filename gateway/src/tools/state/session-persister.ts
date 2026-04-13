import { TurnExecutionReport } from "../../models/types";

export class InMemorySessionPersister {
  private readonly reports: TurnExecutionReport[] = [];

  public async persist(report: TurnExecutionReport): Promise<void> {
    this.reports.push(report);
  }

  public listReports(): TurnExecutionReport[] {
    return [...this.reports];
  }
}
