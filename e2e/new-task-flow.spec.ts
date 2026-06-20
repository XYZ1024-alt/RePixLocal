import { expect, test, type Page } from "@playwright/test";

test("creates a mocked video task and opens the completed run", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("main").getByRole("button", { name: "New Task" }).click();
  await expect(page.getByRole("heading", { name: "Create New Task" })).toBeVisible();

  await page.getByText("or click to browse").click();
  await expect(page.getByText("source.mp4")).toBeVisible();
  await expect(page.getByLabel("Task title")).toHaveValue("source");

  await page.getByRole("button", { name: "Create & Run" }).click();

  await expect(page.getByRole("heading", { name: "source" })).toBeVisible();
  await expect(page.getByText("COMPLETED").first()).toBeVisible();
  await expect(page.getByText("Run completed. The final video")).toBeVisible();
  await expect(page.getByText("Task Assets")).toBeVisible();
  await expect(page.getByText("final.mp4")).toBeVisible();
});

async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("LOCALE", "en");

    type Callback = (data: unknown) => void;
    type InvokeArgs = Record<string, unknown> | undefined;
    type TauriInternals = {
      callbacks: Map<number, Callback>;
      convertFileSrc: (filePath: string, protocol?: string) => string;
      invoke: (cmd: string, args?: InvokeArgs, options?: unknown) => Promise<unknown>;
      runCallback: (id: number, data: unknown) => void;
      transformCallback: (callback: Callback, once?: boolean) => number;
      unregisterCallback: (id: number) => void;
    };
    type EventInternals = {
      unregisterListener: (event: string, id: number) => void;
    };
    type MockWindow = Window &
      typeof globalThis & {
        __TAURI_EVENT_PLUGIN_INTERNALS__: EventInternals;
        __TAURI_INTERNALS__: TauriInternals;
      };

    const mockWindow = window as MockWindow;
    const callbacks = new Map<number, Callback>();
    const eventListeners = new Map<string, Set<number>>();
    let nextCallbackId = 1;
    let createdTaskTitle = "";

    const now = "2026-06-20T12:00:00.000Z";
    const taskId = "task-e2e-1";
    const runId = "run-e2e-1";

    function transformCallback(callback: Callback, once = false) {
      const id = nextCallbackId;
      nextCallbackId += 1;
      callbacks.set(id, (data: unknown) => {
        if (once) callbacks.delete(id);
        callback(data);
      });
      return id;
    }

    function unregisterCallback(id: number) {
      callbacks.delete(id);
      for (const listeners of eventListeners.values()) {
        listeners.delete(id);
      }
    }

    function runCallback(id: number, data: unknown) {
      const callback = callbacks.get(id);
      if (!callback) {
        throw new Error(`Unknown Tauri callback id: ${id}`);
      }
      callback(data);
    }

    function listenToEvent(args: InvokeArgs) {
      const event = String(args?.event ?? "");
      const handler = Number(args?.handler);
      if (!event || !Number.isFinite(handler)) {
        throw new Error("Invalid Tauri event listen payload");
      }
      const listeners = eventListeners.get(event) ?? new Set<number>();
      listeners.add(handler);
      eventListeners.set(event, listeners);
      return handler;
    }

    function unlistenFromEvent(args: InvokeArgs) {
      const event = String(args?.event ?? "");
      const id = Number(args?.eventId);
      eventListeners.get(event)?.delete(id);
      unregisterCallback(id);
      return null;
    }

    function emitEvent(args: InvokeArgs) {
      const event = String(args?.event ?? "");
      const listeners = eventListeners.get(event) ?? new Set<number>();
      for (const id of listeners) {
        runCallback(id, { event, payload: args?.payload });
      }
      return null;
    }

    function dashboardData() {
      const hasTask = createdTaskTitle.length > 0;
      return {
        stats: {
          total_tasks: hasTask ? 1 : 0,
          running: 0,
          completed: hasTask ? 1 : 0,
          success_rate: hasTask ? 100 : 0,
          assets_ready: hasTask ? 1 : 0
        },
        status_count: hasTask ? { COMPLETED: 1 } : {},
        trend: [],
        queue: [],
        usage: []
      };
    }

    function runDetail() {
      return {
        id: runId,
        task_id: taskId,
        task_title: createdTaskTitle,
        status: "COMPLETED",
        current_stage: "FINAL_RENDER",
        started_at: now,
        finished_at: now,
        created_at: now,
        stages: [
          { stage_type: "TRANSCRIPT_EXTRACTION", status: "COMPLETED", order_index: 0 },
          { stage_type: "SCRIPT_REWRITE", status: "COMPLETED", order_index: 1 },
          { stage_type: "STORYBOARD_GENERATION", status: "COMPLETED", order_index: 2 },
          { stage_type: "TTS_SYNTHESIS", status: "COMPLETED", order_index: 3 },
          { stage_type: "SEGMENT_GENERATION", status: "COMPLETED", order_index: 4 },
          { stage_type: "FINAL_RENDER", status: "COMPLETED", order_index: 5 }
        ],
        logs: [{ ts: "12:00:00", level: "INFO", message: "Mock run completed" }]
      };
    }

    function assets() {
      return [
        {
          id: "asset-final-video",
          task_id: taskId,
          run_id: runId,
          asset_type: "final_video",
          path: "C:\\repix-e2e\\tasks\\task-e2e-1\\final\\final.mp4",
          mime_type: "video/mp4",
          status: "ready",
          created_at: now
        }
      ];
    }

    async function invoke(cmd: string, args?: InvokeArgs) {
      switch (cmd) {
        case "plugin:event|listen":
          return listenToEvent(args);
        case "plugin:event|unlisten":
          return unlistenFromEvent(args);
        case "plugin:event|emit":
          return emitEvent(args);
        case "get_settings":
          return {
            workspace_root: "C:\\repix-e2e",
            asr_model: "base",
            mock_providers: true,
            whisper_model_dir: "C:\\repix-e2e\\models\\whisper"
          };
        case "get_dashboard_data":
          return dashboardData();
        case "ensure_whisper_model":
        case "get_whisper_model_status":
          return {
            model_name: "base",
            downloaded: true,
            path: "C:\\repix-e2e\\models\\whisper\\ggml-base.bin"
          };
        case "check_ffmpeg":
          return [
            { name: "ffmpeg", found: true, path: "bundled", bundled: true },
            { name: "ffprobe", found: true, path: "bundled", bundled: true },
            { name: "whisper", found: true, path: "bundled", bundled: true }
          ];
        case "pick_video_file":
          return {
            path: "C:\\repix-e2e\\source.mp4",
            name: "source.mp4",
            size_bytes: 1_048_576
          };
        case "create_task": {
          const input = args?.input as { title?: string } | undefined;
          createdTaskTitle = input?.title?.trim() || "source";
          return {
            id: taskId,
            title: createdTaskTitle,
            source_path: "C:\\repix-e2e\\source.mp4",
            task_type: "replicate",
            status: "completed",
            config_json: {},
            created_at: now,
            updated_at: now
          };
        }
        case "submit_task":
          return { run_id: runId };
        case "get_latest_run":
          return {
            id: runId,
            task_id: taskId,
            status: "COMPLETED",
            current_stage: "FINAL_RENDER",
            created_at: now
          };
        case "get_run":
          return runDetail();
        case "get_run_costs":
          return { total_cost_usd: 0, incomplete: false, providers: [] };
        case "list_assets":
          return assets();
        case "reveal_asset":
          return null;
        default:
          throw new Error(`Unhandled Tauri command in E2E mock: ${cmd}`);
      }
    }

    mockWindow.__TAURI_INTERNALS__ = {
      callbacks,
      convertFileSrc: (filePath: string) => `asset://mock/${encodeURIComponent(filePath)}`,
      invoke,
      runCallback,
      transformCallback,
      unregisterCallback
    };
    mockWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => unregisterCallback(id)
    };
  });
}
