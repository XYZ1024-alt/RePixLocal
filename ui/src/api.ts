import { invoke } from "@tauri-apps/api/core";
import type {
  Asset,
  CostSummary,
  CreateTaskPayload,
  DashboardData,
  DeepSeekBalance,
  PipelineRun,
  DashscopeCredentialPayload,
  DashscopeCredentialView,
  ProviderCredentialPayload,
  ProviderCredentialView,
  PickedImageFile,
  PickedVideoFile,
  ProviderBalance,
  ProviderModelOption,
  RunDetail,
  RunListItem,
  Settings,
  SubmitTaskResponse,
  Task,
  ToolCheck,
  WhisperModelStatus
} from "./types";

export async function getDashboardData() {
  return invoke<DashboardData>("get_dashboard_data");
}

export async function getDeepSeekBalance() {
  return invoke<DeepSeekBalance>("get_deepseek_balance");
}

export async function getProviderBalances() {
  return invoke<ProviderBalance[]>("get_provider_balances");
}

export async function listTasks() {
  return invoke<Task[]>("list_tasks");
}

export async function createTask(input: CreateTaskPayload) {
  return invoke<Task>("create_task", { input });
}

export async function submitTask(taskId: string) {
  return invoke<SubmitTaskResponse>("submit_task", { taskId });
}

export async function cancelTask(taskId: string) {
  return invoke<void>("cancel_task", { taskId });
}

export async function resumeTask(taskId: string) {
  return invoke<SubmitTaskResponse>("submit_task", { taskId });
}

export async function listRuns(limit = 100) {
  return invoke<RunListItem[]>("list_runs", { limit });
}

export async function getRun(runId: string) {
  return invoke<RunDetail | null>("get_run", { runId });
}

export async function getRunCosts(runId: string) {
  return invoke<CostSummary>("get_run_costs", { runId });
}

export async function listAssets(taskId: string) {
  return invoke<Asset[]>("list_assets", { taskId });
}

export async function revealAsset(path: string) {
  return invoke<void>("reveal_asset", { path });
}

export async function getLatestRun(taskId: string) {
  return invoke<PipelineRun | null>("get_latest_run", { taskId });
}

export async function getSettings() {
  return invoke<Settings>("get_settings");
}

export async function updateSettings(input: Settings) {
  return invoke<Settings>("update_settings", { input });
}

export async function checkFfmpeg() {
  return invoke<ToolCheck[]>("check_ffmpeg");
}

export async function ensureWhisperModel(model?: string) {
  return invoke<WhisperModelStatus>("ensure_whisper_model", { model: model ?? null });
}

export async function getWhisperModelStatus(model?: string) {
  return invoke<WhisperModelStatus>("get_whisper_model_status", { model: model ?? null });
}

export async function saveProviderCredential(input: ProviderCredentialPayload) {
  return invoke<void>("save_provider_credential", { input });
}

export async function listProviderCredentials() {
  return invoke<ProviderCredentialView[]>("list_provider_credentials");
}

export async function listDashscopeCredentials() {
  return invoke<DashscopeCredentialView>("list_dashscope_credentials");
}

export async function saveDashscopeCredential(input: DashscopeCredentialPayload) {
  return invoke<void>("save_dashscope_credential", { input });
}

export async function listProviderModels(provider: string) {
  return invoke<ProviderModelOption[]>("list_provider_models", { provider });
}

export async function listAllAssets(taskId?: string) {
  return invoke<Asset[]>("list_all_assets", { taskId: taskId ?? null });
}

export async function pickVideoFile() {
  return invoke<PickedVideoFile | null>("pick_video_file");
}

export async function pickImageFiles() {
  return invoke<PickedImageFile[]>("pick_image_files");
}
