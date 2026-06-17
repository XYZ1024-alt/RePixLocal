import { invoke } from "@tauri-apps/api/core";
import type {
  AppLog,
  Asset,
  CostSummary,
  CreateTaskPayload,
  DashboardData,
  DashboardSummary,
  PipelineRun,
  PipelineStage,
  ProviderCredentialPayload,
  ProviderCredentialView,
  PickedVideoFile,
  ProviderModelOption,
  RunDetail,
  RunListItem,
  Settings,
  SubmitTaskResponse,
  Task,
  ToolCheck
} from "./types";

export async function getDashboardSummary() {
  return invoke<DashboardSummary>("get_dashboard_summary");
}

export async function getDashboardData() {
  return invoke<DashboardData>("get_dashboard_data");
}

export async function listTasks() {
  return invoke<Task[]>("list_tasks");
}

export async function createTask(input: CreateTaskPayload) {
  return invoke<Task>("create_task", { input });
}

export async function startTask(taskId: string) {
  return invoke<PipelineRun>("start_task", { taskId });
}

export async function submitTask(taskId: string) {
  return invoke<SubmitTaskResponse>("submit_task", { taskId });
}

export async function cancelTask(taskId: string) {
  return invoke<void>("cancel_task", { taskId });
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

export async function listLogs(taskId: string) {
  return invoke<AppLog[]>("list_logs", { taskId });
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

export async function saveProviderCredential(input: ProviderCredentialPayload) {
  return invoke<void>("save_provider_credential", { input });
}

export async function listProviderCredentials() {
  return invoke<ProviderCredentialView[]>("list_provider_credentials");
}

export async function listProviderModels(provider: string) {
  return invoke<ProviderModelOption[]>("list_provider_models", { provider });
}

export async function listRunStages(runId: string) {
  return invoke<PipelineStage[]>("list_run_stages", { runId });
}

export async function listAllAssets(taskId?: string) {
  return invoke<Asset[]>("list_all_assets", { taskId: taskId ?? null });
}

export async function pickVideoFile() {
  return invoke<PickedVideoFile | null>("pick_video_file");
}