use crate::models::engine::TurnExecuteInput;

pub trait ModelExecutor {
    fn generate_assistant_message(&self, input: &TurnExecuteInput) -> String;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct EchoModelExecutor;

impl ModelExecutor for EchoModelExecutor {
    fn generate_assistant_message(&self, input: &TurnExecuteInput) -> String {
        format!(
            "[rust-runtime] {} (ctx:{})",
            input.user_message,
            input.context_lines.len()
        )
    }
}
