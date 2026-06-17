import type { Task } from "../types";

export function TaskPicker(props: {
  tasks: Task[];
  selectedTaskId: string;
  onSelectTask: (taskId: string) => void;
}) {
  if (props.tasks.length === 0) {
    return <p className="empty-state">No tasks available</p>;
  }

  return (
    <label className="task-picker">
      Task
      <select value={props.selectedTaskId} onChange={(event) => props.onSelectTask(event.target.value)}>
        {props.tasks.map((task) => (
          <option key={task.id} value={task.id}>
            {task.title} ({task.status})
          </option>
        ))}
      </select>
    </label>
  );
}