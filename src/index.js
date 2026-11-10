#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";
import { closeBrowser } from "./session.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

if (Number(process.versions.node.split(".")[0]) < 22) {
  process.stderr.write(
    `dynamsoft-license-mcp needs Node 22 or newer (running ${process.version}) because it uses the built-in WebSocket.\n`
  );
  process.exit(1);
}

const server = createServer({ version: pkg.version });
const transport = new StdioServerTransport();

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeBrowser().catch(() => {});
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  process.stderr.write(`uncaught: ${error instanceof Error ? error.stack : String(error)}\n`);
  shutdown(1);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
});

await server.connect(transport);
transport.onclose = () => shutdown(0);

process.stderr.write(`dynamsoft-license-mcp v${pkg.version} ready (stdio)\n`);
