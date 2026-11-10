// License key helpers: masking, offline structure decoding, expiry math.
// DLS2 keys are `DLS2` + base64(JSON) and carry no expiry, so expiry always comes
// from the portal response. Legacy keys (`t0...`, used by DWT) carry no payload.

const DLS2_PREFIX = "DLS2";

export function maskKey(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  if (key.length <= 14) return `${key.slice(0, 3)}…(${key.length} chars)`;
  return `${key.slice(0, 8)}…${key.slice(-4)} (${key.length} chars)`;
}

function maskValue(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length <= 8) return `${"*".repeat(value.length)}`;
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

export function decodeKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    return { format: "unknown", valid: false, reason: "empty key" };
  }
  if (!key.startsWith(DLS2_PREFIX)) {
    return {
      format: "compact",
      valid: true,
      note: "This key does not use the DLS envelope, so it carries no readable payload offline. Validity and coverage come from the portal or the SDK, not from the prefix."
    };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(key.slice(DLS2_PREFIX.length), "base64").toString("utf8"));
  } catch {
    return { format: "dls2", valid: false, reason: "cannot decode DLS2 payload" };
  }
  let serverHost = null;
  try { serverHost = payload.mainServerURL ? new URL(payload.mainServerURL).host : null; } catch { /* ignore */ }
  return {
    format: "dls2",
    valid: true,
    organizationId: payload.organizationID ?? null,
    handshakeCode: maskValue(payload.handshakeCode),
    licenseServer: serverHost,
    standbyServer: (() => {
      try { return payload.standbyServerURL ? new URL(payload.standbyServerURL).host : null; } catch { return null; }
    })(),
    note: "DLS2 payload carries no expiry; the expiry below (when present) comes from the portal."
  };
}

// The portal returns .NET-style timestamps with 7 fractional digits, which
// Date.parse rejects on some engines.
export function parsePortalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const normalized = String(value).replace(/(\.\d{3})\d+/, "$1");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

export function isExpired(date, skewDays = 0) {
  if (!date) return false;
  return date.getTime() - skewDays * 86400000 <= Date.now();
}

export function summarize({ licenseKey, expirationDate, productLabel, packageLabel, obtainedAt, source, requestNth }) {
  const decoded = decodeKey(licenseKey);
  const expiry = parsePortalDate(expirationDate);
  return {
    product: productLabel ?? null,
    package: packageLabel ?? null,
    licenseKeyMasked: maskKey(licenseKey),
    expirationDate: expiry ? expiry.toISOString() : null,
    daysRemaining: daysUntil(expiry),
    expired: isExpired(expiry),
    obtainedAt: obtainedAt ?? null,
    source: source ?? null,
    requestCount: requestNth ?? null,
    keyFormat: decoded.format,
    organizationId: decoded.organizationId ?? null,
    handshakeCode: decoded.handshakeCode ?? null,
    licenseServer: decoded.licenseServer ?? null
  };
}
