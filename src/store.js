// Small on-disk store for the portal session and the license cache.
// Files are written with owner-only permissions; the license key never goes to logs.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function homeDir() {
  return process.env.DYNAMSOFT_LICENSE_HOME || join(homedir(), ".dynamsoft-license-mcp");
}

export function ensureHome() {
  const dir = homeDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function filePath(name) {
  return join(homeDir(), name);
}

export function readJson(name, fallback = null) {
  const file = filePath(name);
  if (!existsSync(file)) return fallback;
  try {
    // Files edited by hand on Windows often carry a UTF-8 BOM.
    const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function writeJson(name, value) {
  const dir = ensureHome();
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort on Windows */ }
  return file;
}

export function removeFile(name) {
  try { rmSync(filePath(name), { force: true }); } catch { /* ignore */ }
}

export const SESSION_FILE = "session.json";
export const LICENSE_FILE = "licenses.json";
