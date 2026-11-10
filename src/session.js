// Interactive sign-in orchestration: reuse the saved portal session when it still
// works, otherwise open the real browser on the portal's Google sign-in page and
// read the resulting cookies over CDP.

import { launchBrowser, readPortalCookies, sleep } from "./browser.js";
import { loginUrl, trialPageUrl } from "./catalog.js";
import { fetchUserInfo } from "./portal.js";
import { readJson, removeFile, writeJson, SESSION_FILE } from "./store.js";

let browserHandle = null;

export function getBrowser() {
  return browserHandle;
}

export async function closeBrowser() {
  const handle = browserHandle;
  browserHandle = null;
  if (handle) await handle.close().catch(() => {});
}

export function loadSession() {
  const session = readJson(SESSION_FILE);
  if (!session || !Array.isArray(session.cookies) || !session.token || !session.user) return null;
  return session;
}

export function saveSession(session) {
  const record = { ...session, savedAt: new Date().toISOString() };
  writeJson(SESSION_FILE, record);
  return record;
}

export function clearSession() {
  browserHandle = null;
  removeFile(SESSION_FILE);
}

function sessionFromCookies({ portal, token, user }) {
  return {
    cookies: portal.map(({ name, value, domain, path, expires }) => ({ name, value, domain, path, expires })),
    token: token.value,
    user: user.value,
    email: "",
    companyId: null,
    companyName: null
  };
}

async function withUserInfo(session) {
  const info = await fetchUserInfo(session);
  return {
    ...session,
    email: info.email || session.email || "",
    companyId: info.companyId ?? session.companyId ?? null,
    companyName: info.companyName ?? session.companyName ?? null
  };
}

/**
 * Returns { status: "ok", session } or { status: "login_required", loginUrl, reason }.
 * The browser is intentionally left open on login_required so the caller can retry
 * without relaunching it.
 */
export async function ensureSession({ waitMs = 45000, product = "dcv", packageName = "cross-platform" } = {}) {
  const existing = loadSession();
  if (existing) {
    try {
      const session = await withUserInfo(existing);
      saveSession(session);
      return { status: "ok", session, reused: true };
    } catch {
      clearSession();
    }
  }

  const login = loginUrl(trialPageUrl(product, packageName));

  let launchedHere = false;
  if (!browserHandle || browserHandle.hasExited()) {
    browserHandle = await launchBrowser({ url: login });
    launchedHere = true;
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!browserHandle || browserHandle.hasExited()) {
      browserHandle = null;
      return { status: "login_required", loginUrl: login, reason: "browser_closed" };
    }
    const cookies = await readPortalCookies(browserHandle.cdp).catch(() => null);
    if (cookies?.token && cookies?.user) {
      const candidate = sessionFromCookies(cookies);
      try {
        const session = await withUserInfo(candidate);
        saveSession(session);
        // Cookies are persisted in session.json now, so the window has done its job.
        if (launchedHere) await closeBrowser();
        return { status: "ok", session, reused: false };
      } catch {
        // Cookies landed but the portal session is not ready yet; keep polling.
      }
    }
    await sleep(1000);
  }

  return { status: "login_required", loginUrl: login, reason: "timeout" };
}
