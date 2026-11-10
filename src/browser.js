// Zero-dependency Chrome automation: launch the user's own browser with a dedicated
// profile, then talk to it over the DevTools protocol using Node's built-in WebSocket.
// We deliberately avoid Playwright/Puppeteer: no browser download, no `--enable-automation`
// fingerprint, which is what keeps the Google sign-in from being flagged as automation.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
      } catch {
        return;
      }
      const waiter = message.id === undefined ? undefined : this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(`${message.error.message}${message.error.data ? ` (${message.error.data})` : ""}`));
      } else {
        waiter.resolve(message.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 30000).unref?.();
    });
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

export function findBrowser() {
  const candidates = [
    process.env.DYNAMSOFT_BROWSER_PATH,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : null,
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge"
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No Chrome or Edge found. Install one, or set CHROME_PATH to the browser executable.");
}

async function readDevToolsPort(profileDir, deadline, isAlive) {
  const file = join(profileDir, "DevToolsActivePort");
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error("The browser closed before sign-in completed.");
    if (existsSync(file)) {
      const [port, wsPath] = readFileSync(file, "utf8").trim().split("\n");
      if (port && wsPath) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
          if (res.ok) return { port: Number(port), wsPath: wsPath.trim() };
        } catch { /* endpoint not ready yet */ }
      }
    }
    await sleep(200);
  }
  throw new Error("The browser did not expose a debugging port in time.");
}

async function connect(port, wsPath) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", () => reject(new Error("websocket error")), { once: true });
      });
      return new CDP(ws);
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`Could not attach to the browser: ${lastError?.message}`);
}

// A crashed run can leave the profile locked or a stale DevToolsActivePort behind;
// both make the next launch hang without a usable endpoint.
async function clearStaleProfile(profileDir) {
  const portFile = join(profileDir, "DevToolsActivePort");
  if (existsSync(portFile)) {
    try {
      const [port, wsPath] = readFileSync(portFile, "utf8").trim().split("\n");
      const browser = await connect(Number(port), wsPath.trim());
      await browser.send("Browser.close").catch(() => {});
      browser.close();
      await sleep(500);
    } catch { /* stale file, fall through */ }
  }
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"]) {
    try { rmSync(join(profileDir, name), { force: true }); } catch { /* ignore */ }
  }
}

export function defaultProfileDir() {
  if (process.env.DYNAMSOFT_BROWSER_PROFILE) return process.env.DYNAMSOFT_BROWSER_PROFILE;
  return join(process.env.DYNAMSOFT_LICENSE_HOME || join(homedir(), ".dynamsoft-license-mcp"), "browser-profile");
}

/**
 * Launch the browser on `url` and return a handle that can read cookies and close it.
 */
export async function launchBrowser({ url, profileDir = defaultProfileDir(), timeoutMs = 30000 }) {
  mkdirSync(profileDir, { recursive: true });
  await clearStaleProfile(profileDir);

  const executable = findBrowser();
  const child = spawn(executable, [
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=Translate,MediaRouter",
    "--window-size=1024,768",
    url
  ], { stdio: "ignore" });

  let exited = false;
  child.on("exit", () => { exited = true; });

  const deadline = Date.now() + timeoutMs;
  const { port, wsPath } = await readDevToolsPort(profileDir, deadline, () => !exited);
  const cdp = await connect(port, wsPath);

  return {
    cdp,
    executable,
    async close() {
      await cdp.send("Browser.close", {}).catch(() => {});
      cdp.close();
      await sleep(300);
      try { child.kill(); } catch { /* already gone */ }
    },
    hasExited: () => exited
  };
}

/**
 * Read every cookie the browser holds for the portal domain.
 */
export async function readPortalCookies(cdp) {
  let cookies;
  try {
    ({ cookies } = await cdp.send("Storage.getCookies", {}));
  } catch {
    ({ cookies } = await cdp.send("Network.getAllCookies", {}));
  }
  const portal = (cookies || []).filter((cookie) => cookie.domain.includes("dynamsoft.com"));
  const token = portal.find((cookie) => cookie.name === "DynamsoftToken");
  const user = portal.find((cookie) => cookie.name === "DynamsoftUser");
  return { portal, token, user };
}

export { sleep };
