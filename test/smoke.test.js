// Stdio smoke test: drives the MCP server the way a client does.
// Exercises tools/list and the tools that do not require a portal session.
import { spawn } from "node:child_process";
import { join } from "node:path";

const entry = join(import.meta.dirname, "..", "src", "index.js");
const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });

let buffer = "";
const pending = new Map();
const events = [];

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    events.push(message);
    const waiter = message.id !== undefined ? pending.get(message.id) : undefined;
    if (waiter) { pending.delete(message.id); waiter(message); }
  }
});

const stderr = [];
child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

let nextId = 0;
function request(method, params = {}, timeoutMs = 20000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, timeoutMs);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1.0.0" }
  });
  check("initialize", init.result?.serverInfo?.name === "dynamsoft-license-mcp", init.result?.serverInfo?.version);
  notify("notifications/initialized");

  const list = await request("tools/list", {});
  const names = (list.result?.tools ?? []).map((tool) => tool.name).sort();
  check("tools/list returns 4 tools", names.length === 4, names.join(", "));
  const payloadSize = JSON.stringify(list.result).length;
  check("tools/list payload is small", payloadSize < 6000, `${payloadSize} chars (~${Math.round(payloadSize / 4)} tokens)`);

  const url = await request("tools/call", { name: "get_trial_page_url", arguments: { product: "dbr", package: "web" } });
  const urlText = url.result?.content?.[0]?.text ?? "";
  check("get_trial_page_url", urlText.includes("product=dbr") && urlText.includes("package=web"));

  const guide = await request("tools/call", { name: "get_license_guide", arguments: { product: "dcv", platform: "python" } });
  const guideText = guide.result?.content?.[0]?.text ?? "";
  check("get_license_guide python", guideText.includes("init_license") && guideText.includes("DYNAMSOFT_LICENSE_KEY"),
    guideText.split("\n")[0]);

  const webGuide = await request("tools/call", { name: "get_license_guide", arguments: { product: "ddv", platform: "web" } });
  check("get_license_guide ddv", (webGuide.result?.content?.[0]?.text ?? "").includes("Core.license"));

  const bad = await request("tools/call", { name: "get_trial_page_url", arguments: { product: "nope" } });
  check("unknown product is rejected", bad.result?.isError === true || bad.error !== undefined,
    (bad.result?.content?.[0]?.text ?? bad.error?.message ?? "").slice(0, 80));

  const describe = await request("tools/call", { name: "describe_license", arguments: {} });
  const describeText = describe.result?.content?.[0]?.text ?? "";
  check("describe_license handles empty state", describeText.length > 0, describeText.slice(0, 60));

  // A synthetic DLS2 key must be masked and decoded, never echoed whole.
  const synthetic = "DLS2" + Buffer.from(JSON.stringify({
    handshakeCode: "123456789-TESTTEST", mainServerURL: "https://mdls.dynamsoft.com/", organizationID: "123456789"
  })).toString("base64");
  const described = await request("tools/call", { name: "describe_license", arguments: { license_key: synthetic } });
  const describedText = described.result?.content?.[0]?.text ?? "";
  check("describe_license masks the key", describedText.includes("…") && !describedText.includes(synthetic));
  check("describe_license decodes DLS2", describedText.includes("\"keyFormat\": \"dls2\""), "");
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
