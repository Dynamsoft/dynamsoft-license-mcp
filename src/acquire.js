// The provisioning policy: prefer what we already have, then what the account already
// holds, and only then spend one of the portal's limited trial requests.
//
// 1. local cache (instant, offline)
// 2. portal license list (read-only, never consumes a request)
// 3. portal request endpoint (consumes one of the account's trial requests)
// 4. interactive Google sign-in (only when there is no usable session)

import { licenseTarget, trialPageUrl, normalizeProduct, normalizePackage } from "./catalog.js";
import { listLicenses, requestLicense, PortalAuthError } from "./portal.js";
import { ensureSession, clearSession } from "./session.js";
import { isExpired, parsePortalDate, maskKey, summarize } from "./license.js";
import { LICENSE_FILE, readJson, writeJson } from "./store.js";

const CACHE_SKEW_DAYS = 1;

function cacheKey(product, packageName) {
  return `${product}:${packageName}`;
}

function readCache() {
  return readJson(LICENSE_FILE, {});
}

function readCached(target) {
  const cache = readCache();
  const direct = cache[cacheKey(target.product, target.package)];
  if (direct?.licenseKey && !isExpired(parsePortalDate(direct.expirationDate), CACHE_SKEW_DAYS)) {
    return { ...direct, source: "cache" };
  }
  // One license key covers the Dynamsoft products, so a key already cached for another
  // product is reusable when its edition matches (or is cross-platform).
  for (const [key, entry] of Object.entries(cache)) {
    if (!entry?.licenseKey) continue;
    const [, pkg] = key.split(":");
    if (pkg !== target.package && pkg !== "cross-platform") continue;
    if (isExpired(parsePortalDate(entry.expirationDate), CACHE_SKEW_DAYS)) continue;
    return { ...entry, product: target.product, package: target.package, source: "cache-shared" };
  }
  return null;
}

function saveCache(target, record) {
  const cache = readCache();
  cache[cacheKey(target.product, target.package)] = record;
  writeJson(LICENSE_FILE, cache);
}

function pickUsable(rows) {
  return rows
    .filter((row) => row.licenseKey)
    .map((row) => ({ ...row, expiry: parsePortalDate(row.expiryDate) }))
    .filter((row) => !isExpired(row.expiry, CACHE_SKEW_DAYS))
    .sort((a, b) => (b.expiry?.getTime() ?? 0) - (a.expiry?.getTime() ?? 0))[0] ?? null;
}

function okResult(target, entry) {
  return {
    status: "ok",
    product: target.product,
    productLabel: target.productLabel,
    package: target.package,
    packageLabel: target.packageLabel,
    licenseKey: entry.licenseKey,
    licenseKeyMasked: maskKey(entry.licenseKey),
    expirationDate: entry.expirationDate,
    source: entry.source,
    obtainedAt: entry.obtainedAt ?? null,
    summary: summarize({ ...entry, productLabel: target.productLabel, packageLabel: target.packageLabel }),
    reminder: "Write the key into private configuration (env var or local settings). Show only the masked value in chat."
  };
}

function loginRequired(target, sessionResult) {
  const manualUrl = trialPageUrl(target.product, target.package);
  return {
    status: "login_required",
    reason: sessionResult.reason ?? "manual",
    product: target.product,
    productLabel: target.productLabel,
    package: target.package,
    packageLabel: target.packageLabel,
    loginUrl: sessionResult.loginUrl,
    manualUrl,
    nextStep: "A browser window was opened on the Dynamsoft Google sign-in page. Ask the user to finish signing in, then call get_trial_license again — the session is reused, no second sign-in. If they prefer not to sign in, give them manualUrl."
  };
}

export async function acquireLicense({ product = "dcv", package: packageName, waitMs = 45000, forceRefresh = false } = {}) {
  const productKey = normalizeProduct(product);
  const resolvedPackage = normalizePackage(packageName, productKey);
  const target = licenseTarget(productKey, resolvedPackage);

  if (!forceRefresh) {
    const cached = readCached(target);
    if (cached) {
      if (cached.source === "cache-shared") saveCache(target, cached);
      return okResult(target, cached);
    }
  }

  const sessionResult = await ensureSession({ waitMs, product: productKey, packageName: resolvedPackage });
  if (sessionResult.status !== "ok") {
    return loginRequired(target, sessionResult);
  }

  const session = sessionResult.session;
  try {
    if (!forceRefresh) {
      const rows = await listLicenses(session, target);
      const existing = pickUsable(rows);
      if (existing) {
        const entry = {
          licenseKey: existing.licenseKey,
          expirationDate: existing.expiryDate,
          requestNth: existing.requestNth,
          obtainedAt: new Date().toISOString(),
          source: "portal-list",
          product: productKey,
          package: resolvedPackage,
          productLabel: existing.product ?? target.productLabel,
          editionLabel: target.packageLabel
        };
        saveCache(target, entry);
        return okResult(target, entry);
      }
    }

    const created = await requestLicense(session, target);
    if (!created.licenseKey) {
      return {
        status: created.isSendEmail ? "email_sent" : "unavailable",
        message: created.isSendEmail
          ? `The portal sent the key to ${session.email} instead of returning it. Check the inbox, or call get_trial_license again after opening the portal page.`
          : "The portal returned no license key.",
        product: target.product,
        package: target.package,
        manualUrl: trialPageUrl(target.product, target.package),
        requestCount: created.requestCount
      };
    }
    const entry = {
      licenseKey: created.licenseKey,
      expirationDate: created.expirationDate,
      requestNth: created.requestCount,
      obtainedAt: new Date().toISOString(),
      source: "portal-request",
      product: productKey,
      package: resolvedPackage,
      productLabel: target.productLabel,
      editionLabel: target.packageLabel
    };
    saveCache(target, entry);
    return okResult(target, entry);
  } catch (error) {
    if (error instanceof PortalAuthError) {
      clearSession();
      return {
        ...loginRequired(target, { reason: "session_expired" }),
        message: "The saved portal session expired. The next call opens the sign-in page again."
      };
    }
    throw error;
  }
}
