pub fn execute_turn(input: TurnExecuteInput) -> Result<TurnExecuteOutput, TurnExecuteFailure> {
    let orchestrator = TurnOrchestrator::new(OpenAiCompatibleModelExecutor, LocalToolExecutor);
    orchestrator.execute_turn(input)
}

pub fn execute_turn_with_event_sink(
    input: TurnExecuteInput,
    event_sink: &mut dyn RuntimeEventSink,
) -> Result<TurnExecuteOutput, TurnExecuteFailure> {
    let orchestrator = TurnOrchestrator::new(OpenAiCompatibleModelExecutor, LocalToolExecutor);
    orchestrator.execute_turn_with_event_sink(input, event_sink)
}
