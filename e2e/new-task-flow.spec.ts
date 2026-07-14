import { expect, test, type Page } from "@playwright/test";

type MockWhisperStatus = {
  bytes_done?: number;
  bytes_total?: number | null;
  downloaded: boolean;
  downloading: boolean;
  error?: string | null;
};

type MockSettings = {
  workspace_root: string;
  ffmpeg_path?: string;
  ffprobe_path?: string;
  asr_model?: string;
  mock_providers?: boolean;
  whisper_bin?: string;
  whisper_model_dir?: string;
};

type MockTask = {
  id: string;
  title: string;
  source_path: string;
  task_type: "replicate" | "image_to_video";
  status: "draft" | "running" | "completed" | "failed" | "canceled";
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type MockRun = {
  id: string;
  task_id: string;
  title: string;
  status: string;
  current_stage: string | null;
  created_at: string;
};

type MockAsset = {
  id: string;
  task_id: string;
  run_id?: string;
  asset_type: string;
  path: string;
  mime_type?: string;
  scene_index?: number;
  status?: "pending" | "generating" | "ready" | "failed";
  created_at: string;
};

type MockProviderCredential = {
  provider: string;
  masked_key: string;
  key_decrypt_failed?: boolean;
  config: { base_url?: string; model?: string } | null;
};

type MockDashscopeCredential = {
  masked_key: string;
  key_decrypt_failed?: boolean;
  keys_mismatch?: boolean;
  base_url?: string | null;
  qwen_vl_model?: string | null;
  tongyi_model?: string | null;
  cosyvoice_model?: string | null;
};

type MockProviderModelRequest = {
  provider: string;
  credentials: { api_key: string; base_url: string } | null;
};

type MockProviderModel = {
  id: string;
  name: string;
  video_capabilities?: {
    resolutions: string[];
    default_resolution: string;
  };
};

type E2eControls = {
  assetRows: MockAsset[];
  callCounts: Record<string, number>;
  cosyvoiceModel: "cosyvoice-v3-flash" | "cosyvoice-v3-plus" | null;
  createdTaskInputs: Array<Record<string, unknown>>;
  dashscopeCredential: MockDashscopeCredential | null;
  dashboardMode: "auto" | "empty" | "running" | "completed";
  failListDashscopeCredentials: boolean;
  failListAssets: boolean;
  failListRuns: boolean;
  listRunsCalls: number;
  listRunsDelayMs: number;
  providerCredentials: MockProviderCredential[];
  providerModelRequests: MockProviderModelRequest[];
  providerModelResults: Record<string, MockProviderModel[]>;
  revealedAssetPaths: string[];
  savedDashscopeInputs: Array<Record<string, unknown>>;
  savedProviderInputs: Array<Record<string, unknown>>;
  settings: MockSettings;
  submitTaskError: string | null;
  taskRows: MockTask[];
  runRows: MockRun[];
  toolChecks: Array<{
    name: string;
    found: boolean;
    path?: string;
    error?: string;
    bundled?: boolean;
  }> | null;
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
const MOCK_NOW = "2026-06-20T12:00:00.000Z";

function createMockTask(
  id: string,
  title: string,
  status: MockTask["status"],
  updatedAt = MOCK_NOW
): MockTask {
  return {
    id,
    title,
    source_path: `C:\\repix-e2e\\${id}.mp4`,
    task_type: "replicate",
    status,
    config_json: {},
    created_at: updatedAt,
    updated_at: updatedAt
  };
}

function createMockRun(
  id: string,
  taskId: string,
  title: string,
  status: string,
  createdAt: string,
  currentStage: string | null = null
): MockRun {
  return {
    id,
    task_id: taskId,
    title,
    status,
    current_stage: currentStage,
    created_at: createdAt
  };
}

test("creates a mocked video task and opens the completed run", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByTestId("global-new-task").click();
  await expect(page.getByRole("heading", { name: "Create New Task" })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Subtitle position", exact: true })
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Choose local video", exact: false }).click();
  await expect(page.getByText("source.mp4")).toBeVisible();
  await expect(page.getByLabel("Task title")).toHaveValue("source");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Configure output", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Review and run", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create & Run" }).click();

  await expect(page.getByRole("heading", { name: "source" })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Final output", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Assets", exact: true }).click();
  await expect(page.getByText("final.mp4")).toBeVisible();
  const controls = await getMockControls(page);
  expect(controls.createdTaskInputs.at(-1)?.config_json).toMatchObject({
    narrativeSource: "auto",
    videoProvider: "SEEDANCE",
    videoModel: "seedance-mock-1",
    resolution: "720p"
  });
});

test("updates resolution options when the video model changes", async ({ page }) => {
  await installTauriMock(page, {
    providerModelResults: {
      SEEDANCE: [
        {
          id: "seedance-lite",
          name: "Seedance Lite",
          video_capabilities: {
            resolutions: ["480p", "720p"],
            default_resolution: "720p"
          }
        },
        {
          id: "seedance-ultra",
          name: "Seedance Ultra",
          video_capabilities: {
            resolutions: ["1080p"],
            default_resolution: "1080p"
          }
        }
      ]
    }
  });
  await page.goto("/");
  await openWizardConfig(page);

  const videoModel = page.getByRole("combobox", { name: "Video model", exact: true });
  const resolution = page.getByRole("combobox", { name: "Resolution", exact: true });
  await expect(videoModel).toContainText("Seedance Lite");
  await expect(resolution).toContainText("720p");
  await resolution.click();
  await expect(page.getByRole("option", { name: "480p", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "1080p", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await videoModel.click();
  await page.getByRole("option", { name: "Seedance Ultra", exact: true }).click();
  await expect(resolution).toContainText("1080p");
  await resolution.click();
  await expect(page.getByRole("option", { name: "1080p", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "720p", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create & Run", exact: true }).click();
  const controls = await getMockControls(page);
  expect(controls.createdTaskInputs.at(-1)?.config_json).toMatchObject({
    videoProvider: "SEEDANCE",
    videoModel: "seedance-ultra",
    resolution: "1080p"
  });
});

test("submits the selected narrative source from advanced options", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openWizardConfig(page);

  await page.getByRole("button", { name: "Advanced options", exact: true }).click();
  const narrativeSource = page.getByRole("combobox", {
    name: "Narrative source",
    exact: true
  });
  await expect(narrativeSource).toContainText("Auto detect");
  await narrativeSource.click();
  await page.getByRole("option", { name: "On-screen text", exact: true }).click();

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Narrative source", { exact: true })).toBeVisible();
  await expect(page.getByText("On-screen text", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create & Run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "source" })).toBeVisible();

  const controls = await getMockControls(page);
  const submitted = controls.createdTaskInputs.at(-1);
  expect(submitted?.config_json).toMatchObject({ narrativeSource: "on_screen_text" });
  expect(submitted?.config_json).not.toHaveProperty("audioSource");
});

test("hides the unsupported narrator voice for CosyVoice V3 Plus", async ({ page }) => {
  await installTauriMock(page, { cosyvoiceModel: "cosyvoice-v3-plus" });
  await page.goto("/");

  await openWizardConfig(page);
  await page.getByRole("combobox", { name: "Voice", exact: true }).click();

  await expect(page.getByRole("option", { name: "Female 1", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Male 1", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Narrator", exact: true })).toHaveCount(0);
});

test("shows the narrator voice for the default CosyVoice model", async ({ page }) => {
  await installTauriMock(page, { cosyvoiceModel: null });
  await page.goto("/");

  await openWizardConfig(page);
  await page.getByRole("combobox", { name: "Voice", exact: true }).click();

  await expect(page.getByRole("option", { name: "Narrator", exact: true })).toBeVisible();
});

test("keeps common voices available when CosyVoice settings fail to load", async ({ page }) => {
  await installTauriMock(page, { failListDashscopeCredentials: true });
  await page.goto("/");

  await page.getByTestId("global-new-task").click();
  const wizardAlert = page
    .getByRole("alert")
    .filter({ hasText: "Task submission failed" });
  await expect(wizardAlert).toBeVisible();
  await wizardAlert.getByText("Technical details", { exact: true }).click();
  await expect(
    wizardAlert.getByText("CosyVoice settings unavailable", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Choose local video", exact: false }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const voiceSelect = page.getByRole("combobox", { name: "Voice", exact: true });
  await expect(voiceSelect).toBeEnabled();
  await voiceSelect.click();
  await expect(page.getByRole("option", { name: "Female 1", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Male 1", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Narrator", exact: true })).toHaveCount(0);
});

test("shows run list load and refresh failures without unhandled rejections", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installTauriMock(page);
  await page.goto("/");
  await setMockControls(page, { failListRuns: true });

  await navigateFromSidebar(page, "Tasks");
  await expect(page.getByText("Unable to load tasks.")).toBeVisible();
  await expect(page.getByText("No tasks yet.", { exact: false })).not.toBeVisible();

  await setMockControls(page, { failListRuns: false });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("No tasks yet.", { exact: false })).toBeVisible();

  await setMockControls(page, { failListRuns: true });
  const refreshWarning = page.getByRole("status").filter({ hasText: "run list unavailable" });
  await expect(refreshWarning).toContainText(
    "Refresh failed. Showing data from",
    { timeout: 7000 }
  );
  await expect(page.getByText("No tasks yet.", { exact: false })).toBeVisible();
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

  await navigateFromSidebar(page, "Assets");
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
  await navigateFromSidebar(page, "Tasks");
  await setMockControls(page, { dashboardMode: "running" });

  await navigateFromSidebar(page, "Home");
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

test("keeps narrow layouts free of nested vertical overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installTauriMock(page, { dashboardMode: "running" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 600, height: 700 });
  const homeScrollers = await visibleVerticalScrollers(page);
  const rootOverflow = await page.evaluate(() => [
    getComputedStyle(document.documentElement).overflowY,
    getComputedStyle(document.body).overflowY,
    getComputedStyle(document.getElementById("root") as HTMLElement).overflowY
  ]);
  expect(rootOverflow).toEqual(["hidden", "hidden", "hidden"]);
  expect(homeScrollers).toHaveLength(1);
  expect(homeScrollers[0].right).toBe(600);

  await navigateFromSidebar(page, "Settings");
  const tabList = page.getByRole("tablist");
  const tabListMetrics = await tabList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight
  }));
  expect(tabListMetrics.overflowY).toBe("hidden");
  expect(tabListMetrics.scrollHeight).toBe(tabListMetrics.clientHeight);
  expect(await visibleVerticalScrollers(page)).toHaveLength(1);
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

  await expect(page.getByText("The action did not complete", { exact: true })).toBeVisible();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.getByText("whisper download unavailable", { exact: false })).toBeVisible();
  await setMockControls(page, {
    whisperEnsureDelayMs: 0,
    whisperEnsureFails: false,
    whisperSettledCheckDelayMs: 0
  });
  await navigateFromSidebar(page, "Settings");
  await page.getByRole("tab", { name: "Local Runtime", exact: true }).click();
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
  await navigateFromSidebar(page, "Settings");
  await page.getByRole("tab", { name: "Local Runtime", exact: true }).click();
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
  await navigateFromSidebar(page, "Settings");
  await page.getByRole("tab", { name: "Local Runtime", exact: true }).click();
  await expect(page.getByText("Downloading Whisper model", { exact: false })).toBeVisible();

  await setMockControls(page, {
    whisperStatusDelayMsByModel: { base: 700 },
    whisperStatusEvents: [],
    whisperStatusFailuresRemaining: 1
  });
  await expect(page.getByText("The action did not complete", { exact: true })).toBeVisible();
  await page.getByText("Technical details", { exact: true }).click();
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
  await navigateFromSidebar(page, "Settings");
  await page.getByRole("tab", { name: "Local Runtime", exact: true }).click();
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

test("persists light, dark, and system theme preferences", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await installTauriMock(page);
  await page.goto("/");
  await openAppearanceSettings(page);

  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await expectDocumentTheme(page, "dark", true);

  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await expectDocumentTheme(page, "light", false);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("radio", { name: "System", exact: true }).click();
  await expectDocumentTheme(page, "dark", true);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("repix-theme"))).toBe("system");

  await page.emulateMedia({ colorScheme: "light" });
  await expectDocumentTheme(page, "light", false);

  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page.reload();
  await expectDocumentTheme(page, "dark", true);
  expect(await page.evaluate(() => localStorage.getItem("repix-theme"))).toBe("dark");
});

test("syncs the document language and preserves it across reloads", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await openAppearanceSettings(page);

  const languagePicker = page.getByRole("radiogroup", { name: "Interface language" });
  await languagePicker.getByRole("radio").first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(await page.evaluate(() => localStorage.getItem("LOCALE"))).toBe("zh");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("button", { name: "首页", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("LOCALE"))).toBe("zh");
});

test("aggregates tasks by task id and filters the latest run status", async ({ page }) => {
  const alphaTask = createMockTask("task-alpha", "Alpha project", "completed", "2026-06-20T13:00:00.000Z");
  const attentionTask = createMockTask("task-fix", "Needs review", "draft", "2026-06-20T12:00:00.000Z");
  const completedTask = createMockTask("task-done", "Finished launch", "completed", "2026-06-20T11:00:00.000Z");
  await installTauriMock(page, {
    taskRows: [alphaTask, attentionTask, completedTask],
    runRows: [
      createMockRun("run-alpha-old", alphaTask.id, alphaTask.title, "COMPLETED", "2026-06-20T10:00:00.000Z", "FINAL_RENDER"),
      createMockRun("run-alpha-new", alphaTask.id, alphaTask.title, "RUNNING", "2026-06-20T12:30:00.000Z", "SCRIPT_REWRITE"),
      createMockRun("run-fix", attentionTask.id, attentionTask.title, "FAILED", "2026-06-20T11:30:00.000Z", "TTS_SYNTHESIS")
    ]
  });
  await page.goto("/");
  await navigateFromSidebar(page, "Tasks");

  const table = page.getByRole("table", { name: "Task list" });
  const alphaRow = table.getByRole("row").filter({ hasText: alphaTask.title });
  await expect(alphaRow).toHaveCount(1);
  await expect(alphaRow.getByRole("cell").nth(1)).toHaveText("Running");
  await expect(alphaRow.getByRole("cell").nth(3)).toHaveText("2");

  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await search.fill("alpha");
  await expect(alphaRow).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: attentionTask.title })).toHaveCount(0);
  await search.clear();

  await page.getByRole("radio", { name: "Running", exact: true }).click();
  await expect(alphaRow).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: completedTask.title })).toHaveCount(0);

  await page.getByRole("radio", { name: "Needs attention", exact: true }).click();
  await expect(table.getByRole("row").filter({ hasText: attentionTask.title })).toBeVisible();
  await expect(alphaRow).toHaveCount(0);

  await page.getByRole("radio", { name: "Completed", exact: true }).click();
  await expect(table.getByRole("row").filter({ hasText: completedTask.title })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: attentionTask.title })).toHaveCount(0);
});

test("opens the task center with the dashboard metric filter applied", async ({ page }) => {
  const runningTask = createMockTask("task-running", "Active campaign", "running");
  const completedTask = createMockTask("task-completed", "Archived campaign", "completed", "2026-06-19T12:00:00.000Z");
  await installTauriMock(page, {
    dashboardMode: "running",
    taskRows: [runningTask, completedTask],
    runRows: [
      createMockRun("run-running", runningTask.id, runningTask.title, "RUNNING", MOCK_NOW, "SEGMENT_GENERATION"),
      createMockRun("run-completed", completedTask.id, completedTask.title, "COMPLETED", "2026-06-19T12:00:00.000Z", "FINAL_RENDER")
    ]
  });
  await page.goto("/");

  await expect(dashboardMetric(page, "Running")).toHaveText("1");
  await page.getByText("Running", { exact: true }).click();

  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Running", exact: true })).toBeChecked();
  await expect(page.getByRole("row").filter({ hasText: runningTask.title })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: completedTask.title })).toHaveCount(0);
});

test("validates a missing source and focuses the first invalid field", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByTestId("global-new-task").click();

  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByText("Select a source video first.", { exact: true })).toBeVisible();
  await expect(page.getByText("Invalid input.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose local video", exact: true })).toBeFocused();
  await expect(page.getByText("Configure output", { exact: true })).toHaveCount(0);
});

test("keeps or discards a session draft when leaving the wizard", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByTestId("global-new-task").click();
  await page.getByLabel("Task title").fill("Session draft");
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("repix:wizard-draft")))
    .not.toBeNull();

  await navigateFromSidebar(page, "Home");
  await expect(page.getByRole("alertdialog", { name: "Leave the new task?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep and leave", exact: true }).click();
  await page.getByTestId("global-new-task").click();
  await expect(page.getByLabel("Task title")).toHaveValue("Session draft");

  await navigateFromSidebar(page, "Home");
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await page.getByTestId("global-new-task").click();
  await expect(page.getByLabel("Task title")).toHaveValue("");
  expect(await page.evaluate(() => sessionStorage.getItem("repix:wizard-draft"))).toBeNull();
});

test("shows submit errors without losing wizard context or fetching a fallback run", async ({ page }) => {
  await installTauriMock(page, {
    submitTaskError: "provider rejected request: quota exhausted"
  });
  await page.goto("/");
  await openWizardConfig(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create & Run", exact: true }).click();

  const errorAlert = page.getByRole("alert").filter({ hasText: "Task submission failed" });
  await expect(errorAlert).toBeVisible();
  await expect(page.getByText("Review and run", { exact: true })).toBeVisible();
  await errorAlert.getByText("Technical details", { exact: true }).click();
  await expect(errorAlert).toContainText("provider rejected request: quota exhausted");
  await expect(page.getByLabel("New task steps").getByRole("button").nth(2)).toHaveAttribute("aria-current", "step");

  const controls = await getMockControls(page);
  expect(controls.callCounts.create_task).toBe(1);
  expect(controls.callCounts.submit_task).toBe(1);
  expect(controls.callCounts.get_latest_run ?? 0).toBe(0);
});

test("reveals a selected asset in its folder", async ({ page }) => {
  const task = createMockTask("task-assets", "Asset campaign", "completed");
  const path = "C:\\repix-e2e\\tasks\\task-assets\\final\\delivery.mp4";
  await installTauriMock(page, {
    taskRows: [task],
    assetRows: [
      {
        id: "asset-delivery",
        task_id: task.id,
        run_id: "run-assets",
        asset_type: "final_video",
        path,
        mime_type: "video/mp4",
        status: "ready",
        created_at: MOCK_NOW
      }
    ]
  });
  await page.goto("/");
  await navigateFromSidebar(page, "Assets");

  await expect(page.getByText("delivery.mp4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open in folder", exact: true }).click();
  await expect.poll(async () => (await getMockControls(page)).revealedAssetPaths).toEqual([path]);
});

test("fetches provider models with current input without saving credentials", async ({ page }) => {
  await installTauriMock(page, {
    providerModelResults: {
      DEEPSEEK: [{ id: "deepseek-chat", name: "DeepSeek Chat" }]
    }
  });
  await page.goto("/");
  await navigateFromSidebar(page, "Settings");

  const providerForm = page.locator("form").filter({ has: page.locator("#DEEPSEEK-key") });
  await providerForm.locator("#DEEPSEEK-key").fill("current-unsaved-key");
  await providerForm.getByRole("button", { name: "Fetch Available Models", exact: true }).click();
  await expect(providerForm.getByText("Successfully fetched model list", { exact: true })).toBeVisible();

  await expect.poll(async () => (await getMockControls(page)).providerModelRequests).toEqual([
    {
      provider: "DEEPSEEK",
      credentials: { api_key: "current-unsaved-key", base_url: "" }
    }
  ]);
  const controls = await getMockControls(page);
  expect(controls.savedProviderInputs).toEqual([]);
  expect(controls.callCounts.save_provider_credential ?? 0).toBe(0);
});

test("requires provider credentials in real mode but not mock mode", async ({ page }) => {
  await installTauriMock(page, {
    providerCredentials: [],
    dashscopeCredential: {
      masked_key: "",
      qwen_vl_model: null,
      tongyi_model: null,
      cosyvoice_model: null
    }
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ready", exact: true })).toBeVisible();

  await navigateFromSidebar(page, "Settings");
  await page.getByRole("tab", { name: "Local Runtime", exact: true }).click();
  await page.getByLabel("Mock providers (offline demo)").uncheck();
  await page.getByRole("button", { name: "Save System Settings", exact: true }).click();

  await expect(page.getByRole("button", { name: "Attention Required", exact: true })).toBeVisible();
  await expect(page.getByText("Real services are enabled. Configure local tools and AI providers before running.", { exact: true })).toBeVisible();
  expect((await getMockControls(page)).settings.mock_providers).toBe(false);
});

async function openWizardConfig(page: Page) {
  await page.getByTestId("global-new-task").click();
  await page.getByRole("button", { name: "Choose local video", exact: false }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

async function openAppearanceSettings(page: Page) {
  await navigateFromSidebar(page, "Settings");
  await page.getByRole("tab", { name: "Appearance & Language", exact: true }).click();
}

async function navigateFromSidebar(page: Page, label: "Home" | "Tasks" | "Assets" | "Settings") {
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: label, exact: true })
    .click();
}

async function expectDocumentTheme(page: Page, theme: "light" | "dark", darkClass: boolean) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        colorScheme: document.documentElement.style.colorScheme,
        darkClass: document.documentElement.classList.contains("dark"),
        theme: document.documentElement.dataset.theme
      }))
    )
    .toEqual({ colorScheme: theme, darkClass, theme });
}

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

async function visibleVerticalScrollers(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("*")).flatMap((element) => {
      const style = getComputedStyle(element);
      if (element.scrollHeight <= element.clientHeight) return [];
      if (style.overflowY !== "auto" && style.overflowY !== "scroll") return [];
      const bounds = element.getBoundingClientRect();
      return [{
        className: element.className,
        clientHeight: element.clientHeight,
        right: Math.round(bounds.right),
        scrollHeight: element.scrollHeight,
        tagName: element.tagName
      }];
    })
  );
}

async function installTauriMock(page: Page, initialControls: Partial<E2eControls> = {}) {
  await page.addInitScript((initialControls: Partial<E2eControls>) => {
    if (localStorage.getItem("LOCALE") === null) {
      localStorage.setItem("LOCALE", "en");
    }

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
      assetRows: [],
      callCounts: {},
      cosyvoiceModel: "cosyvoice-v3-flash",
      createdTaskInputs: [],
      dashscopeCredential: null,
      dashboardMode: "auto",
      failListDashscopeCredentials: false,
      failListAssets: false,
      failListRuns: false,
      listRunsCalls: 0,
      listRunsDelayMs: 0,
      providerCredentials: [],
      providerModelRequests: [],
      providerModelResults: {
        SEEDANCE: [
          {
            id: "seedance-mock-1",
            name: "Seedance Mock 1",
            video_capabilities: {
              resolutions: ["480p", "720p"],
              default_resolution: "720p"
            }
          },
          {
            id: "seedance-mock-2",
            name: "Seedance Mock 2",
            video_capabilities: {
              resolutions: ["480p", "720p", "1080p"],
              default_resolution: "1080p"
            }
          }
        ]
      },
      revealedAssetPaths: [],
      runRows: [],
      savedDashscopeInputs: [],
      savedProviderInputs: [],
      settings: {
        workspace_root: "C:\\repix-e2e",
        asr_model: "base",
        mock_providers: true,
        whisper_model_dir: "C:\\repix-e2e\\models\\whisper"
      },
      submitTaskError: null,
      taskRows: [],
      toolChecks: null,
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
      controls.callCounts[cmd] = (controls.callCounts[cmd] ?? 0) + 1;
      switch (cmd) {
        case "plugin:event|listen":
          return listenToEvent(args);
        case "plugin:event|unlisten":
          return unlistenFromEvent(args);
        case "plugin:event|emit":
          return emitEvent(args);
        case "get_settings":
          return controls.settings;
        case "update_settings": {
          const input = args?.input as MockSettings;
          controls.settings = { ...controls.settings, ...input };
          return controls.settings;
        }
        case "list_provider_credentials":
          return controls.providerCredentials;
        case "list_dashscope_credentials":
          if (controls.failListDashscopeCredentials) {
            throw new Error("CosyVoice settings unavailable");
          }
          return controls.dashscopeCredential ?? {
            masked_key: "",
            base_url: null,
            qwen_vl_model: null,
            tongyi_model: null,
            cosyvoice_model: controls.cosyvoiceModel
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
          return createdTaskTitle
            ? [
                ...controls.runRows.filter((run) => run.task_id !== taskId),
                { id: runId, task_id: taskId, title: createdTaskTitle, status: "COMPLETED", current_stage: "FINAL_RENDER", created_at: now }
              ]
            : controls.runRows;
        case "list_all_assets":
          if (controls.failListAssets) {
            throw new Error("asset list unavailable");
          }
          return controls.assetRows;
        case "list_tasks":
          return createdTaskTitle
            ? [
                ...controls.taskRows.filter((task) => task.id !== taskId),
                { id: taskId, title: createdTaskTitle, source_path: "C:\\repix-e2e\\source.mp4", task_type: "replicate", status: "completed", config_json: {}, created_at: now, updated_at: now }
              ]
            : controls.taskRows;
        case "list_provider_models": {
          const provider = String(args?.provider ?? "");
          const credentials = (args?.credentials ?? null) as MockProviderModelRequest["credentials"];
          controls.providerModelRequests.push({ provider, credentials });
          return controls.providerModelResults[provider] ?? [];
        }
        case "save_provider_credential":
          controls.savedProviderInputs.push((args?.input ?? {}) as Record<string, unknown>);
          return null;
        case "save_dashscope_credential":
          controls.savedDashscopeInputs.push((args?.input ?? {}) as Record<string, unknown>);
          return null;
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
          return controls.toolChecks ?? [
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
          const input = args?.input as
            | { title?: string; config_json?: Record<string, unknown> }
            | undefined;
          controls.createdTaskInputs.push(JSON.parse(JSON.stringify(input ?? {})));
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
          if (controls.submitTaskError) {
            throw new Error(controls.submitTaskError);
          }
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
          controls.revealedAssetPaths.push(String(args?.path ?? ""));
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
