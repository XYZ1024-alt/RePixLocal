import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const HOST = "127.0.0.1";
const PORT = 1420;
const BASE_URL = `http://${HOST}:${PORT}`;
const SERVER_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 1_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const CLIENT_WARMUP_TIMEOUT_MS = 60_000;

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const viteEntry = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const playwrightBin = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.exe" : "playwright"
);

async function main() {
  let server = null;
  try {
    if (!(await isServerReady())) {
      server = startVite();
      await waitForServer(server);
    }
    await warmClient();
    process.exitCode = await runPlaywright(process.argv.slice(2));
  } finally {
    if (server) {
      await stopProcess(server);
    }
  }
}

async function warmClient() {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.route(
      /https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
      (route) => route.abort()
    );
    await page.goto(BASE_URL, {
      timeout: CLIENT_WARMUP_TIMEOUT_MS,
      waitUntil: "domcontentloaded"
    });
    await page.locator('script[type="module"][src^="/ui/src/main.tsx"]').waitFor({
      state: "attached",
      timeout: CLIENT_WARMUP_TIMEOUT_MS
    });
    await page.locator("main").waitFor({
      state: "visible",
      timeout: CLIENT_WARMUP_TIMEOUT_MS
    });
    await page.getByText("RePix", { exact: true }).first().waitFor({
      state: "visible",
      timeout: CLIENT_WARMUP_TIMEOUT_MS
    });
    console.log("[vite] client module graph warmed");
  } finally {
    await browser.close();
  }
}

function startVite() {
  const child = spawn(process.execPath, [viteEntry, "--host", HOST], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
  return child;
}

async function waitForServer(child) {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isServerReady()) return;
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before ${BASE_URL} was ready`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${BASE_URL}`);
}

async function isServerReady() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      resolve(ready);
    };
    const request = http.get(BASE_URL, (response) => {
      response.resume();
      finish((response.statusCode ?? 500) < 500);
    });
    request.on("error", () => finish(false));
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy();
      finish(false);
    });
  });
}

async function runPlaywright(args) {
  const child = spawn(playwrightBin, ["test", ...args], {
    cwd: projectRoot,
    stdio: "inherit"
  });
  const [code] = await once(child, "exit");
  return typeof code === "number" ? code : 1;
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), delay(SHUTDOWN_TIMEOUT_MS)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([once(child, "exit"), delay(SHUTDOWN_TIMEOUT_MS)]);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
