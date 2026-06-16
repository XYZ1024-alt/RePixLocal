import { invoke } from "@tauri-apps/api/core";
import type {
  AppLog,
  Asset,
  CreateTaskPayload,
  DashboardSummary,
  PipelineRun,
  ProviderCredentialPayload,
  Settings,
  Task,
  ToolCheck
} from "./types";

export async function getDashboardSummary() {
  return invoke<DashboardSummary>("get_dashboard_summary");
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

export async function cancelTask(taskId: string) {
  return invoke<void>("cancel_task", { taskId });
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

export async function checkFfmpeg() {
  return invoke<ToolCheck[]>("check_ffmpeg");
}

export async function saveProviderCredential(input: ProviderCredentialPayload) {
  return invoke<void>("save_provider_credential", { input });
}
