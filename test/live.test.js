// Live test: exercises the real portal path through the MCP server.
// Requires a saved portal session (run `node test/login.mjs` once first).
// It must never print a full license key.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const sessionFile = join(process.env.DYNAMSOFT_LICENSE_HOME || join(homedir(), ".dynamsoft-license-mcp"), "session.json");
if (!existsSync(sessionFile) && process.env.DYNAMSOFT_ALLOW_INTERACTIVE !== "1") {
  console.log(`SKIP  no portal session at ${sessionFile} Ã¢â‚¬â€ run the server and complete sign-in first`);
  console.log("      (set DYNAMSOFT_ALLOW_INTERACTIVE=1 to let the test open the sign-in window itself)");
  process.exit(0);
}

const entry = join(import.meta.dirname, "..", "src", "index.js");
const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });

let buffer = "";
const pending = new Map();
const stderr = [];
child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    const waiter = message.id !== undefined ? pending.get(message.id) : undefined;
    if (waiter) { pending.delete(message.id); waiter(message); }
  }
});

let nextId = 0;
function request(method, params = {}, timeoutMs = 120000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, timeoutMs);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` Ã¢â‚¬â€ ${detail}` : ""}`);
}

function callTool(name, args = {}) {
  return request("tools/call", { name, arguments: args });
}

try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "live", version: "1.0.0" }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const waitMs = Number(process.env.DYNAMSOFT_TEST_WAIT_MS ?? 0);
  const first = await callTool("get_trial_license", { product: "dcv", package: "cross-platform", wait_ms: waitMs }, waitMs + 60000);
  const firstText = first.result?.content?.[0]?.text ?? "";
  let firstJson = null;
  try { firstJson = JSON.parse(firstText); } catch { /* keep text */ }

  if (firstJson?.status === "login_required") {
    console.log(`SKIP  portal session expired Ã¢â‚¬â€ ${firstJson.loginUrl}`);
    process.exit(0);
  }

  check("status ok", firstJson?.status === "ok", firstJson?.status);
  check("key returned", typeof firstJson?.licenseKey === "string" && firstJson.licenseKey.startsWith("DLS2"),
    firstJson?.licenseKey ? `${firstJson.licenseKey.slice(0, 8)}Ã¢â‚¬Â¦(${firstJson.licenseKey.length})` : "none");
  check("masked form present", typeof firstJson?.licenseKeyMasked === "string" && !firstJson.licenseKeyMasked.includes(firstJson.licenseKey),
    firstJson?.licenseKeyMasked);
  check("expiry present", Boolean(firstJson?.expirationDate), firstJson?.expirationDate);
  check("source is a reuse path", ["cache", "cache-shared", "portal-list"].includes(firstJson?.source), firstJson?.source);

  const second = await callTool("get_trial_license", { product: "dcv", package: "cross-platform", wait_ms: 0 });
  const secondJson = JSON.parse(second.result?.content?.[0]?.text ?? "{}");
  check("second call served from cache", secondJson.source === "cache", secondJson.source);
  check("same key both times", secondJson.licenseKey === firstJson.licenseKey, "");

  const described = await callTool("describe_license", { license_key: firstJson.licenseKey });
  const describedText = described.result?.content?.[0]?.text ?? "";
  check("describe_license does not leak the key", !describedText.includes(firstJson.licenseKey));
  check("describe_license reports dls2", describedText.includes("\"keyFormat\": \"dls2\""), "");
} catch (error) {
  check("unexpected failure", false, error.message);
} finally {
  child.stdin.end();
  child.kill();
  if (stderr.length) console.log("\n--- server stderr ---\n" + stderr.join("").trim());
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}
