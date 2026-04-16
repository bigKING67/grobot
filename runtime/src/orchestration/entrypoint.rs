pub fn execute_turn(input: TurnExecuteInput) -> Result<TurnExecuteOutput, TurnExecuteFailure> {
    let orchestrator = TurnOrchestrator::new(OpenAiCompatibleModelExecutor, LocalToolExecutor);
    orchestrator.execute_turn(input)
}
