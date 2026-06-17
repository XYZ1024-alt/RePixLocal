export type ViewKey =
  | "dashboard"
  | "wizard"
  | "console"
  | "console-detail"
  | "library"
  | "settings";

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
  created_at?: string;
};

export type StageStatus = "pending" | "running" | "completed" | "failed" | "canceled";

export type PipelineStage = {
  id: string;
  run_id: string;
  stage_type: string;
  status: StageStatus;
  error?: string;
  order_index?: number;
  started_at?: string;
  finished_at?: string;
};

export type AssetStatus = "pending" | "generating" | "ready" | "failed";

export type Asset = {
  id: string;
  task_id: string;
  run_id?: string;
  asset_type: string;
  path: string;
  mime_type?: string;
  scene_index?: number;
  status?: AssetStatus;
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
  draft_tasks: number;
  videos_today: number;
  asset_count: number;
  latest_tasks: Task[];
};

export type DashboardStats = {
  total_tasks: number;
  running: number;
  completed: number;
  success_rate: number;
  assets_ready: number;
};

export type TrendPoint = {
  date: string;
  value: number;
};

export type QueueItem = {
  id: string;
  title: string;
  status: string;
  current_stage: string | null;
  progress: number;
};

export type UsageItem = {
  provider: string;
  calls: number;
  quantity: number;
  cost_usd: number;
};

export type DashboardData = {
  stats: DashboardStats;
  status_count: Record<string, number>;
  trend: TrendPoint[];
  queue: QueueItem[];
  usage: UsageItem[];
};

export type RunListItem = {
  id: string;
  task_id: string;
  title: string;
  status: string;
  current_stage: string | null;
  created_at: string;
};

export type RunDetailLog = {
  ts: string;
  level: string;
  message: string;
};

export type RunDetailStage = {
  stage_type: string;
  status: string;
  error?: string;
  order_index: number;
};

export type RunDetail = {
  id: string;
  task_id: string;
  task_title: string;
  status: string;
  current_stage: string | null;
  error?: string;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
  stages: RunDetailStage[];
  logs: RunDetailLog[];
};

export type ProviderCostSummary = {
  provider: string;
  calls: number;
  failed_calls: number;
  quantity: number;
  unit: string;
  cost_usd: number;
  unknown_cost_count: number;
};

export type CostSummary = {
  total_cost_usd: number;
  incomplete: boolean;
  providers: ProviderCostSummary[];
};

export type SubmitTaskResponse = {
  run_id: string;
};

export type ProviderModelOption = {
  id: string;
  name: string;
};

export type ProviderCredentialConfig = {
  base_url?: string;
  model?: string;
};

export type ProviderCredentialView = {
  provider: string;
  masked_key: string;
  config: ProviderCredentialConfig | null;
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
  asr_model?: string;
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

export type PipelineEvent =
  | { event: "run"; run_id: string; task_id: string; status: string }
  | { event: "stage"; run_id: string; stage: string; status: string }
  | {
      event: "log";
      run_id: string;
      task_id?: string;
      level: string;
      message: string;
    };