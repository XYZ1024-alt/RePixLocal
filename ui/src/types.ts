export type ViewKey = "dashboard" | "wizard" | "console" | "library" | "settings";

export type TaskStatus = "draft" | "running" | "completed" | "failed" | "canceled";

export type Task = {
  id: string;
  title: string;
  source_path: string;
  status: TaskStatus;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PipelineRun = {
  id: string;
  task_id: string;
  status: string;
  current_stage?: string;
  error?: string;
  started_at?: string;
  finished_at?: string;
};

export type Asset = {
  id: string;
  task_id: string;
  run_id?: string;
  asset_type: string;
  path: string;
  mime_type?: string;
  scene_index?: number;
  created_at: string;
};

export type AppLog = {
  id: string;
  task_id?: string;
  run_id?: string;
  level: string;
  message: string;
  created_at: string;
};

export type DashboardSummary = {
  total_tasks: number;
  running_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  canceled_tasks: number;
  asset_count: number;
  latest_tasks: Task[];
};

export type ToolCheck = {
  name: string;
  found: boolean;
  path?: string;
  error?: string;
};

export type Settings = {
  workspace_root: string;
  ffmpeg_path?: string;
  ffprobe_path?: string;
};

export type CreateTaskPayload = {
  title: string;
  source_path: string;
  config_json: Record<string, unknown>;
};

export type ProviderCredentialPayload = {
  provider: string;
  label: string;
  api_key: string;
  base_url: string;
  model: string;
};
