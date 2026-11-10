// Customer-portal API client.
// Every call carries the portal cookies plus the DynamsoftToken/DynamsoftUser headers
// the portal website itself sends with its own requests.

import { PORTAL } from "./catalog.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

export class PortalAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "PortalAuthError";
  }
}

export class PortalError extends Error {
  constructor(message, { code, endpoint } = {}) {
    super(message);
    this.name = "PortalError";
    this.code = code;
    this.endpoint = endpoint;
  }
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function cookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function headersFor(session, refererPath = "/customer/license/trialLicense/") {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: PORTAL,
    referer: `${PORTAL}${refererPath}`,
    "user-agent": USER_AGENT,
    cookie: cookieHeader(session.cookies),
    DynamsoftToken: safeDecode(session.token),
    DynamsoftUser: safeDecode(session.user)
  };
}

async function callPortal(path, body, session) {
  const response = await fetch(`${PORTAL}${path}`, {
    method: "POST",
    headers: headersFor(session),
    body: JSON.stringify(body ?? {})
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PortalError(`Unexpected non-JSON response from ${path} (HTTP ${response.status}).`, { endpoint: path });
  }
  if (json.code === -1 || json.code === -2) {
    throw new PortalAuthError(json.msg || "Your portal session has ended. Please sign in again.");
  }
  if (json.code !== 0) {
    throw new PortalError(json.msg || `Portal returned code ${json.code}.`, { code: json.code, endpoint: path });
  }
  return json;
}

export async function fetchUserInfo(session) {
  const json = await callPortal("/api-common/Api/User/Info", {}, session);
  const data = json.data || {};
  return {
    email: data.email || "",
    userId: data.userId ?? null,
    companyId: data.briefCompanys?.[0]?.companyId ?? null,
    companyName: data.briefCompanys?.[0]?.companyName ?? null,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null
  };
}

/**
 * Read-only: licenses the account already holds for this product/package.
 * The portal uses this on page load, so calling it never consumes a trial request.
 */
export async function listLicenses(session, target) {
  const json = await callPortal("/api-portal/Api/Trial/GetCompanyRecordList", {
    CompanyId: session.companyId ?? null,
    Email: session.email ?? "",
    ProductId: target.productId,
    SolutionId: target.solutionId,
    EditionId: target.packageId
  }, session);
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map((row) => ({
    licenseKey: row.licenseKey,
    expiryDate: row.expiryDate ?? row.expirationDate ?? null,
    validStartTime: row.validStartTime ?? null,
    product: row.product ?? null,
    productId: row.productId ?? null,
    solutionId: row.solutionId ?? null,
    editionId: row.editionId ?? null,
    requestNth: row.requestNth ?? null,
    majorVersion: row.majorVersion ?? null,
    licenseId: row.licenseId ?? null
  }));
}

/**
 * Create (or re-issue) the trial license. This is the quota-bearing call:
 * the portal allows a small number of requests per account/product.
 */
export async function requestLicense(session, target) {
  const json = await callPortal("/api-portal/Api/Trial/RequestFromWeb", {
    CompanyId: session.companyId ?? 0,
    Email: session.email ?? "",
    ProductId: target.productId,
    SolutionId: target.solutionId,
    PackageId: target.packageId,
    Referer: `${PORTAL}/customer/license/trialLicense/`,
    RequestSource: 8
  }, session);
  const data = json.data || {};
  return {
    licenseKey: data.licenseKey ?? null,
    expirationDate: data.expirationDate ?? null,
    requestCount: data.requestCount ?? null,
    isSendEmail: data.isSendEmail ?? null,
    productAuthId: data.productAuthId ?? null,
    ifExistingKey: data.ifExistingKey ?? null
  };
}
