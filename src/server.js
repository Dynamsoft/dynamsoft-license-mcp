import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { acquireLicense } from "./acquire.js";
import { PACKAGE_NAMES, PRODUCT_NAMES, trialPageUrl, normalizeProduct, normalizePackage } from "./catalog.js";
import { decodeKey, maskKey, parsePortalDate, summarize } from "./license.js";
import { buildLicenseGuide, normalizePlatform, packageForPlatform, PLATFORMS } from "./guides.js";
import { LICENSE_FILE, readJson } from "./store.js";

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function createServer({ version }) {
  const server = new McpServer(
    {
      name: "dynamsoft-license-mcp",
      version,
      description: "Provisions Dynamsoft trial license keys through the customer portal Google sign-in and explains how to wire them into each SDK."
    },
    {
      instructions: [
        "Use get_trial_license when the user needs a Dynamsoft license key to run generated code.",
        "If it returns status=login_required, ask the user to finish the Google sign-in in the browser window that just opened, then call it again (the session is reused).",
        "Never print a full license key in chat: show licenseKeyMasked instead, and write the key into configuration or an environment variable."
      ].join("\n")
    }
  );

  server.registerTool(
    "get_trial_license",
    {
      title: "Get Dynamsoft trial license key",
      description: [
        "Get a Dynamsoft trial license key for a product and edition.",
        "Reuses a cached key, then any key already on the account, and only then spends a new trial request.",
        "With no saved portal session it opens the Dynamsoft Google sign-in in the browser and returns status=login_required until the user finishes; call it again afterwards."
      ].join(" "),
      inputSchema: {
        product: z.enum(PRODUCT_NAMES).optional().describe("Product. Default dcv."),
        package: z.enum(PACKAGE_NAMES).optional().describe("Edition. Default cross-platform; pick web/mobile/desktop to match the app."),
        wait_ms: z.number().int().min(0).max(240000).optional().describe("How long to wait for the sign-in before returning login_required. Default 45000."),
        force_refresh: z.boolean().optional().describe("Ignore caches and ask the portal again. Consumes a trial request.")
      }
    },
    async ({ product, package: packageName, wait_ms, force_refresh }) => {
      try {
        return textResult(await acquireLicense({
          product,
          package: packageName,
          waitMs: wait_ms ?? 45000,
          forceRefresh: force_refresh ?? false
        }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_license_guide",
    {
      title: "License key wiring guide",
      description: "How to wire a Dynamsoft license key into an app for a platform: environment variable plus the exact initialization call. Use it before writing license setup code.",
      inputSchema: {
        product: z.enum(PRODUCT_NAMES).describe("Product the key is for."),
        platform: z.enum(PLATFORMS).describe("Target platform."),
        framework: z.string().optional().describe("Optional framework hint, e.g. react, vue, next, expo.")
      }
    },
    async ({ product, platform, framework }) => {
      try {
        const resolved = normalizePlatform(platform);
        const productKey = normalizeProduct(product);
        const suggestedPackage = packageForPlatform(resolved);
        const guide = buildLicenseGuide({ product: productKey, platform: resolved });
        return textResult([
          guide,
          "",
          `Suggested edition for this platform: **${suggestedPackage}**.`,
          framework ? `Framework hint: ${framework} — initialize once at module load, before creating any capture component.` : "",
          "",
          `Trial page (manual): ${trialPageUrl(productKey, suggestedPackage)}`
        ].filter(Boolean).join("\n"));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "describe_license",
    {
      title: "Describe a license key",
      description: "Masked preview, format, organization and expiry of a license key. Never returns the full key. Defaults to the most recently acquired key.",
      inputSchema: {
        license_key: z.string().optional().describe("Key to inspect. Omit to use the last acquired key.")
      }
    },
    async ({ license_key }) => {
      try {
        let entry = null;
        if (license_key) {
          entry = { licenseKey: license_key };
        } else {
          const cache = readJson(LICENSE_FILE, {});
          const entries = Object.values(cache).filter((value) => value?.licenseKey);
          entries.sort((a, b) => new Date(b.obtainedAt ?? 0).getTime() - new Date(a.obtainedAt ?? 0).getTime());
          const latest = entries[0];
          if (!latest) {
            return textResult("No key has been acquired yet. Call get_trial_license first, or pass license_key.");
          }
          entry = latest;
        }
        const decoded = decodeKey(entry.licenseKey);
        const expiry = parsePortalDate(entry.expirationDate);
        return textResult({
          licenseKeyMasked: maskKey(entry.licenseKey),
          keyLength: entry.licenseKey.length,
          keyFormat: decoded.format,
          organizationId: decoded.organizationId ?? null,
          handshakeCode: decoded.handshakeCode ?? null,
          licenseServer: decoded.licenseServer ?? null,
          expirationDate: expiry ? expiry.toISOString() : null,
          product: entry.product ?? null,
          edition: entry.package ?? null,
          obtainedAt: entry.obtainedAt ?? null,
          source: entry.source ?? null,
          note: decoded.note ?? null
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_trial_page_url",
    {
      title: "Manual trial application URL",
      description: "Official Dynamsoft trial-license page for a product and edition, for users who prefer applying manually instead of signing in from this server.",
      inputSchema: {
        product: z.enum(PRODUCT_NAMES).optional(),
        package: z.enum(PACKAGE_NAMES).optional()
      }
    },
    async ({ product, package: packageName }) => {
      try {
        const productKey = normalizeProduct(product ?? "dcv");
        const resolvedPackage = normalizePackage(packageName, productKey);
        return textResult({
          url: trialPageUrl(productKey, resolvedPackage),
          product: productKey,
          package: resolvedPackage,
          note: "Open this page and sign in there to get the key by email; nothing is stored by this server."
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}

export { summarize };
