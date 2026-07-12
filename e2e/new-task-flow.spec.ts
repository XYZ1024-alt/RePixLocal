import { expect, test, type Page } from "@playwright/test";

type MockWhisperStatus = {
  bytes_done?: number;
  bytes_total?: number | null;
  downloaded: boolean;
  downloading: boolean;
  error?: string | null;
};

type E2eControls = {
  dashboardMode: "auto" | "empty" | "running" | "completed";
  failListAssets: boolean;
  failListRuns: boolean;
  listRunsCalls: number;
  listRunsDelayMs: number;
  whisperActiveModel: string | null;
  whisperCheckResults: boolean[];
  whisperDownloaded: boolean;
  whisperEnsureCalls: number;
  whisperEnsureDelayMs: number;
  whisperEnsureFails: boolean;
  whisperEnsureSuccesses: string[];
  whisperEvents: Array<"check" | "ensure-error" | "ensure-start" | "ensure-success">;
  whisperSettledCheckDelayMs: number;
  whisperStatusByModel: Record<string, MockWhisperStatus>;
  whisperStatusDelayMsByModel: Record<string, number>;
  whisperStatusEvents: string[];
  whisperStatusFailuresRemaining: number;
};

const MOCK_RETRY_DELAY_MS = 500;

test("creates a mocked video task and opens the completed run", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("main").getByRole("button", { name: "New Task" }).click();
  await expect(page.getByRole("heading", { name: "Create New Task" })).toBeVisible();

  await page.getByText("or click to browse").click();
  await expect(page.getByText("source.mp4")).toBeVisible();
  await expect(page.getByLabel("Task title")).toHaveValue("source");

  await page.getByRole("button", { name: "Create & Run" }).click();

  await expect(
    page.getByRole("button", { name: "Done - redirecting...", exact: true })
  ).toBeDisabled();

  await expect(page.getByRole("heading", { name: "source" })).toBeVisible();
  await expect(page.getByText("COMPLETED").first()).toBeVisible();
  await expect(page.getByText("Run completed. The final video")).toBeVisible();
  await expect(page.getByText("Task Assets")).toBeVisible();
  await expect(page.getByText("final.mp4")).toBeVisible();
});

test("shows run list load and refresh failures without unhandled rejections", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installTauriMock(page);
  await page.goto("/");
  await setMockControls(page, { failListRuns: true });

  await page.getByRole("button", { name: "Console", exact: true }).click();
  await expect(page.getByText("Unable to load pipeline runs.")).toBeVisible();
  await expect(page.getByText("Submit a task from the Wizard")).not.toBeVisible();

  await setMockControls(page, { failListRuns: false });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Submit a task from the Wizard")).toBeVisible();

  await setMockControls(page, { failListRuns: true });
  const refreshWarning = page.getByRole("alert");
  await expect(refreshWarning).toContainText(
    "Refresh failed. Showing the last successful result: run list unavailable",
    { timeout: 7000 }
  );
  await expect(page.getByText("Submit a task from the Wizard")).toBeVisible();
  await setMockControls(page, {
    failListRuns: false,
    listRunsDelayMs: MOCK_RETRY_DELAY_MS
  });
  const callsBeforeRetry = (await getMockControls(page)).listRunsCalls;
  await refreshWarning.getByRole("button", { name: "Retry", exact: true }).click();
  await expect
    .poll(async () => (await getMockControls(page)).listRunsCalls)
    .toBeGreaterThan(callsBeforeRetry);
  await expect(refreshWarning).toBeVisible();
  await expect(refreshWarning).not.toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("shows an asset library load failure and recovers on retry", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installTauriMock(page);
  await page.goto("/");
  await setMockControls(page, { failListAssets: true });

  await page.getByRole("button", { name: "Asset Library", exact: true }).click();
  await expect(page.getByText("Unable to load assets.")).toBeVisible();
  await expect(page.getByText("No assets yet.")).not.toBeVisible();

  await setMockControls(page, { failListAssets: false });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("No assets yet.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("refreshes dashboard on navigation and run events", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Console", exact: true }).click();
  await setMockControls(page, { dashboardMode: "running" });

  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(dashboardMetric(page, "Running")).toHaveText("1");
  await expect(dashboardMetric(page, "Completed")).toHaveText("0");
  await expect(page.getByRole("row").filter({ hasText: "Dashboard task" })).toContainText(
    "RUNNING"
  );

  await setMockControls(page, { dashboardMode: "completed" });
  await emitRunEvent(page, "COMPLETED");

  await expect(dashboardMetric(page, "Running")).toHaveText("0");
  await expect(dashboardMetric(page, "Completed")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Dashboard task" })).toContainText(
    "COMPLETED"
  );
});

test("rechecks tools after the background Whisper download settles", async ({ page }) => {
  await installTauriMock(page, {
    whisperDownloaded: false,
    whisperEnsureDelayMs: 200
  });
  await page.goto("/");

  await expect.poll(async () => (await getMockControls(page)).whisperEnsureCalls).toBe(1);
  await expect
    .poll(async () => (await getMockControls(page)).whisperCheckResults.at(-1))
    .toBe(true);

  const controls = await getMockControls(page);
  expect(controls.whisperEnsureCalls).toBe(1);
  expect(controls.whisperCheckResults[0]).toBe(false);
  expect(controls.whisperEvents.lastIndexOf("check")).toBeGreaterThan(
    controls.whisperEvents.indexOf("ensure-success")
  );
});

test("surfaces background Whisper failures and accepts a retry during the final check", async ({ page }) => {
  await installTauriMock(page, {
    whisperDownloaded: false,
    whisperEnsureDelayMs: 200,
    whisperEnsureFails: true,
    whisperSettledCheckDelayMs: 5_000
  });
  await page.goto("/");

  await expect(page.getByText("whisper download unavailable", { exact: false })).toBeVisible();
  await setMockControls(page, {
    whisperEnsureDelayMs: 0,
    whisperEnsureFails: false,
    whisperSettledCheckDelayMs: 0
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "System Settings", exact: true }).click();
  await page.getByRole("button", { name: "Re-check", exact: true }).click();

  await expect.poll(async () => (await getMockControls(page)).whisperEnsureCalls).toBe(2);
  await expect
    .poll(async () => (await getMockControls(page)).whisperEnsureSuccesses)
    .toEqual(["base"]);
  await expect
    .poll(async () => {
      const events = (await getMockControls(page)).whisperEvents;
      return events.lastIndexOf("check") > events.indexOf("ensure-error");
    })
    .toBe(true);
});

test("keeps a queued Whisper model when the settled model is requested again", async ({ page }) => {
  await installTauriMock(page, {
    whisperDownloaded: false,
    whisperEnsureDelayMs: 5_000,
    whisperSettledCheckDelayMs: 5_000
  });
  await page.goto("/");

  await expect.poll(async () => (await getMockControls(page)).whisperActiveModel).toBe("base");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "System Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Whisper Model", exact: true }).click();
  await page.getByRole("option", { name: "Small (balanced)", exact: true }).click();
  expect((await getMockControls(page)).whisperActiveModel).toBe("base");
  await page.getByRole("button", { name: "Re-check", exact: true }).click();

  await expect
    .poll(async () => (await getMockControls(page)).whisperEnsureSuccesses)
    .toEqual(["base"]);
  await expect
    .poll(async () => {
      const events = (await getMockControls(page)).whisperEvents;
      return events.lastIndexOf("check") > events.indexOf("ensure-success");
    })
    .toBe(true);
  await setMockControls(page, {
    whisperEnsureDelayMs: 0,
    whisperSettledCheckDelayMs: 0
  });
  await page.getByRole("combobox", { name: "Whisper Model", exact: true }).click();
  await page.getByRole("option", { name: "Base (recommended)", exact: true }).click();
  await page.getByRole("button", { name: "Re-check", exact: true }).click();

  await expect
    .poll(async () => (await getMockControls(page)).whisperEnsureSuccesses)
    .toEqual(["base", "small"]);
  expect((await getMockControls(page)).whisperEnsureCalls).toBe(2);
});

test("recovers Whisper status polling after a visible transient failure", async ({ page }) => {
  await installTauriMock(page, {
    whisperStatusByModel: {
      base: { downloaded: false, downloading: true, bytes_done: 1, bytes_total: 2 }
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "System Settings", exact: true }).click();
  await expect(page.getByText("Downloading Whisper model", { exact: false })).toBeVisible();

  await setMockControls(page, {
    whisperStatusDelayMsByModel: { base: 700 },
    whisperStatusEvents: [],
    whisperStatusFailuresRemaining: 1
  });
  await expect(
    page.getByText("whisper status temporarily unavailable", { exact: false })
  ).toBeVisible();
  await setMockControls(page, {
    whisperStatusByModel: {
      base: { downloaded: true, downloading: false }
    }
  });

  await expect
    .poll(async () => {
      const events = (await getMockControls(page)).whisperStatusEvents;
      return events.lastIndexOf("success:base") > events.indexOf("error:base");
    })
    .toBe(true);
  await expect(page.getByText("Model ready: ggml-base.bin", { exact: true })).toBeVisible();

  const events = (await getMockControls(page)).whisperStatusEvents;
  expect(maxConcurrentStatusRequests(events, "base")).toBe(1);
});

test("ignores a slow Whisper status response for the previous model", async ({ page }) => {
  await installTauriMock(page, {
    whisperStatusByModel: {
      base: { downloaded: true, downloading: false },
      small: { downloaded: true, downloading: false }
    },
    whisperStatusDelayMsByModel: { base: 2_000 }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "System Settings", exact: true }).click();
  await expect
    .poll(async () => (await getMockControls(page)).whisperStatusEvents.includes("start:base"))
    .toBe(true);

  await page.getByRole("combobox", { name: "Whisper Model", exact: true }).click();
  await page.getByRole("option", { name: "Small (balanced)", exact: true }).click();
  await expect(page.getByText("Model ready: ggml-small.bin", { exact: true })).toBeVisible();
  await setMockControls(page, {
    whisperStatusDelayMsByModel: { base: 2_000, small: 5_000 }
  });

  await expect
    .poll(async () => {
      const events = (await getMockControls(page)).whisperStatusEvents;
      const starts = events.filter((event) => event === "start:base").length;
      const finishes = events.filter(
        (event) => event === "success:base" || event === "error:base"
      ).length;
      return starts > 0 && starts === finishes;
    })
    .toBe(true);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  await expect(page.getByText("Model ready: ggml-small.bin", { exact: true })).toBeVisible();
  await expect(page.getByText("Model ready: ggml-base.bin", { exact: true })).toHaveCount(0);

  const baseStarts = (await getMockControls(page)).whisperStatusEvents.filter(
    (event) => event === "start:base"
  ).length;
  await page.waitForTimeout(1_200);
  expect(
    (await getMockControls(page)).whisperStatusEvents.filter(
      (event) => event === "start:base"
    )
  ).toHaveLength(baseStarts);
});

function dashboardMetric(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..").locator("span").nth(1);
}

function maxConcurrentStatusRequests(events: string[], model: string) {
  let active = 0;
  let maximum = 0;
  for (const event of events) {
    if (event === `start:${model}`) {
      active += 1;
      maximum = Math.max(maximum, active);
    } else if (event === `success:${model}` || event === `error:${model}`) {
      active = Math.max(0, active - 1);
    }
  }
  return maximum;
}

async function emitRunEvent(page: Page, status: string) {
  await page.evaluate(async (nextStatus) => {
    const internals = (
      window as Window & {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    await internals.invoke("plugin:event|emit", {
      event: "pipeline-event",
      payload: {
        event: "run",
        run_id: "run-dashboard-1",
        task_id: "task-dashboard-1",
        status: nextStatus
      }
    });
  }, status);
}

async function setMockControls(page: Page, updates: Partial<E2eControls>) {
  await page.evaluate((nextControls) => {
    const controls = (window as Window & { __REPIX_E2E__: E2eControls }).__REPIX_E2E__;
    Object.assign(controls, nextControls);
  }, updates);
}

async function getMockControls(page: Page) {
  return page.evaluate(
    () => (window as Window & { __REPIX_E2E__: E2eControls }).__REPIX_E2E__
  );
}

async function installTauriMock(page: Page, initialControls: Partial<E2eControls> = {}) {
  await page.addInitScript((initialControls: Partial<E2eControls>) => {
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
        __REPIX_E2E__: E2eControls;
        __TAURI_EVENT_PLUGIN_INTERNALS__: EventInternals;
        __TAURI_INTERNALS__: TauriInternals;
      };

    const mockWindow = window as MockWindow;
    const callbacks = new Map<number, Callback>();
    const eventListeners = new Map<string, Set<number>>();
    let nextCallbackId = 1;
    let createdTaskTitle = "";
    const controls: E2eControls = {
      dashboardMode: "auto",
      failListAssets: false,
      failListRuns: false,
      listRunsCalls: 0,
      listRunsDelayMs: 0,
      whisperActiveModel: null,
      whisperCheckResults: [],
      whisperDownloaded: true,
      whisperEnsureCalls: 0,
      whisperEnsureDelayMs: 0,
      whisperEnsureFails: false,
      whisperEnsureSuccesses: [],
      whisperEvents: [],
      whisperSettledCheckDelayMs: 0,
      whisperStatusByModel: {},
      whisperStatusDelayMsByModel: {},
      whisperStatusEvents: [],
      whisperStatusFailuresRemaining: 0,
      ...initialControls
    };

    const now = "2026-06-20T12:00:00.000Z";
    const submittedRefreshDelayMs = 250;
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
      const mode =
        controls.dashboardMode === "auto"
          ? createdTaskTitle
            ? "completed"
            : "empty"
          : controls.dashboardMode;
      const hasTask = mode !== "empty";
      const status = mode.toUpperCase();
      const title = createdTaskTitle || "Dashboard task";
      return {
        stats: {
          total_tasks: hasTask ? 1 : 0,
          running: mode === "running" ? 1 : 0,
          completed: mode === "completed" ? 1 : 0,
          success_rate: mode === "completed" ? 100 : 0,
          assets_ready: mode === "completed" ? 1 : 0
        },
        status_count: hasTask ? { [status]: 1 } : {},
        trend: [],
        queue: hasTask
          ? [
              {
                id: "run-dashboard-1",
                title,
                status,
                current_stage: mode === "completed" ? "FINAL_RENDER" : "SCRIPT_REWRITE",
                progress: mode === "completed" ? 100 : 50
              }
            ]
          : [],
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
        case "list_provider_credentials":
          return [];
        case "list_dashscope_credentials":
          return {
            masked_key: "",
            base_url: null,
            qwen_vl_model: null,
            tongyi_model: null,
            cosyvoice_model: null
          };
        case "get_dashboard_data":
          return dashboardData();
        case "list_runs":
          controls.listRunsCalls += 1;
          if (controls.failListRuns) {
            throw new Error("run list unavailable");
          }
          if (controls.listRunsDelayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, controls.listRunsDelayMs));
          }
          return [];
        case "list_all_assets":
          if (controls.failListAssets) {
            throw new Error("asset list unavailable");
          }
          return [];
        case "list_tasks":
          return [];
        case "get_deepseek_balance":
          return {
            is_available: true,
            checked_at: now,
            balance_infos: [
              {
                currency: "CNY",
                total_balance: "100.00",
                granted_balance: "20.00",
                topped_up_balance: "80.00"
              }
            ]
          };
        case "get_provider_balances":
          return [
            {
              provider: "DEEPSEEK",
              status: "available",
              checked_at: now,
              accounts: [
                {
                  currency: "CNY",
                  total_balance: "100.00",
                  granted_balance: "20.00",
                  topped_up_balance: "80.00"
                }
              ],
              message: null
            },
            {
              provider: "DASHSCOPE",
              status: "unsupported",
              checked_at: now,
              accounts: [],
              message: "DashScope model API key cannot query account balance"
            },
            {
              provider: "SEEDANCE",
              status: "unsupported",
              checked_at: now,
              accounts: [],
              message: "Seedance Ark API key cannot query account balance"
            }
          ];
        case "ensure_whisper_model": {
          const modelName = String(args?.model ?? "base");
          controls.whisperEnsureCalls += 1;
          if (controls.whisperActiveModel) {
            throw new Error(
              `whisper model download already in progress: ${controls.whisperActiveModel}`
            );
          }
          controls.whisperActiveModel = modelName;
          controls.whisperEvents.push("ensure-start");
          try {
            if (controls.whisperEnsureDelayMs > 0) {
              await new Promise((resolve) =>
                window.setTimeout(resolve, controls.whisperEnsureDelayMs)
              );
            }
            if (controls.whisperEnsureFails) {
              throw new Error("whisper download unavailable");
            }
            controls.whisperDownloaded = true;
            controls.whisperEnsureSuccesses.push(modelName);
            controls.whisperEvents.push("ensure-success");
            return {
              model_name: modelName,
              downloaded: true,
              path: `C:\\repix-e2e\\models\\whisper\\ggml-${modelName}.bin`
            };
          } catch (error) {
            controls.whisperEvents.push("ensure-error");
            throw error;
          } finally {
            controls.whisperActiveModel = null;
          }
        }
        case "get_whisper_model_status": {
          const modelName = String(args?.model ?? "base");
          controls.whisperStatusEvents.push(`start:${modelName}`);
          const delayMs = controls.whisperStatusDelayMsByModel[modelName] ?? 0;
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          if (controls.whisperStatusFailuresRemaining > 0) {
            controls.whisperStatusFailuresRemaining -= 1;
            controls.whisperStatusEvents.push(`error:${modelName}`);
            throw new Error("whisper status temporarily unavailable");
          }
          const status = controls.whisperStatusByModel[modelName];
          controls.whisperStatusEvents.push(`success:${modelName}`);
          return {
            model_name: modelName,
            downloaded: status?.downloaded ?? controls.whisperDownloaded,
            path: `C:\\repix-e2e\\models\\whisper\\ggml-${modelName}.bin`,
            downloading: status?.downloading ?? false,
            bytes_done: status?.bytes_done ?? 0,
            bytes_total: status?.bytes_total ?? null,
            error: status?.error ?? null
          };
        }
        case "check_ffmpeg":
          controls.whisperEvents.push("check");
          if (
            controls.whisperSettledCheckDelayMs > 0 &&
            controls.whisperEvents.some((event) =>
              event === "ensure-error" || event === "ensure-success"
            )
          ) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, controls.whisperSettledCheckDelayMs)
            );
          }
          if (createdTaskTitle) {
            await new Promise((resolve) => window.setTimeout(resolve, submittedRefreshDelayMs));
          }
          controls.whisperCheckResults.push(controls.whisperDownloaded);
          return [
            { name: "ffmpeg", found: true, path: "bundled", bundled: true },
            { name: "ffprobe", found: true, path: "bundled", bundled: true },
            {
              name: "whisper",
              found: controls.whisperDownloaded,
              path: "bundled",
              bundled: true,
              error: controls.whisperDownloaded ? null : "whisper model missing"
            }
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
    mockWindow.__REPIX_E2E__ = controls;
    mockWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => unregisterCallback(id)
    };
  }, initialControls);
}
