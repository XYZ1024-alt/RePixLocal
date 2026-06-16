use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEvent {
    pub task_id: String,
    pub level: String,
    pub message: String,
}
