use crate::models::engine::TurnExecuteInput;

pub trait ToolExecutor {
    fn before_turn(&self, _input: &TurnExecuteInput) {}

    fn after_turn(&self, _input: &TurnExecuteInput) {}
}

#[derive(Debug, Default, Clone, Copy)]
pub struct NoopToolExecutor;

impl ToolExecutor for NoopToolExecutor {}
