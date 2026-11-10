// Product/edition catalog mirroring the customer portal's trial-license form.
// Source of truth: the portal's trialLicense.js productList + getEditionId()
// (verified 2026-11-10). Portal sends either ProductId or SolutionId, never both.

const PORTAL = "https://www.dynamsoft.com";
const TRIAL_PAGE_PATH = "/customer/license/trialLicense/";

export const PRODUCTS = {
  dcv: { label: "Dynamsoft Capture Vision", solutionId: 2, aliases: ["capture-vision", "capture vision", "cvr"] },
  dbr: { label: "Dynamsoft Barcode Reader", productId: 1000003, aliases: ["barcode-reader", "barcode reader", "barcode"] },
  dwt: { label: "Dynamic Web TWAIN", productId: 1000001, aliases: ["web-twain", "web twain", "twain"] },
  ddv: { label: "Dynamsoft Document Viewer", productId: 1000031, aliases: ["document-viewer", "document viewer", "viewer"] },
  mrz: { label: "Dynamsoft MRZ Scanner", solutionId: 3, aliases: ["mrz-scanner", "mrz scanner", "passport"] },
  mds: { label: "Dynamsoft Mobile Document Scanner", solutionId: 6, aliases: ["document-scanner", "mobile-document-scanner", "document scanner"] },
  mwc: { label: "Mobile Web Capture", solutionId: 1, aliases: ["mobile-web-capture"] },
  "dwt-ddv": { label: "Dynamic Web TWAIN and Document Viewer", solutionId: 4, aliases: ["dwt+ddv", "dwt-ddv"] }
};

export const PACKAGES = {
  "cross-platform": { label: "Cross-platform", id: 13, aliases: ["any", "all", "cross platform"] },
  web: { label: "Web / JavaScript", id: 6, aliases: ["js", "javascript", "browser", "typescript"] },
  mobile: { label: "Android / iOS", id: 8, aliases: ["android", "ios", "react-native", "flutter", "maui"] },
  desktop: { label: "Server / Desktop", id: -2, aliases: ["python", "dotnet", "java", "c++", "cpp", "nodejs", "desktop", "server"] }
};

export const PRODUCT_NAMES = Object.keys(PRODUCTS);
export const PACKAGE_NAMES = Object.keys(PACKAGES);

export function normalizeProduct(value = "dcv") {
  const raw = String(value || "").trim().toLowerCase();
  if (PRODUCTS[raw]) return raw;
  for (const [key, meta] of Object.entries(PRODUCTS)) {
    if (meta.aliases.includes(raw)) return key;
  }
  throw new Error(`Unknown product "${value}". Use one of: ${PRODUCT_NAMES.join(", ")}.`);
}

export function normalizePackage(value = "cross-platform", product = "dcv") {
  const raw = String(value || "").trim().toLowerCase();
  if (PACKAGES[raw]) return raw;
  for (const [key, meta] of Object.entries(PACKAGES)) {
    if (meta.aliases.includes(raw)) return key;
  }
  // A picked product implies an edition only for the web-only products.
  if (["dwt", "ddv", "mrz", "mds", "mwc", "dwt-ddv"].includes(product) && !raw) return "web";
  throw new Error(`Unknown package "${value}". Use one of: ${PACKAGE_NAMES.join(", ")}.`);
}

// Trial-license identifiers for a product/package pair, shaped the way the portal
// posts them: one of ProductId/SolutionId is null.
export function licenseTarget(product, packageName) {
  const p = PRODUCTS[product];
  const pkg = PACKAGES[packageName];
  return {
    product,
    productLabel: p.label,
    package: packageName,
    packageLabel: pkg.label,
    productId: p.productId ?? null,
    solutionId: p.solutionId ?? null,
    packageId: pkg.id
  };
}

export function trialPageUrl(product = "dcv", packageName = "cross-platform") {
  const url = new URL(TRIAL_PAGE_PATH, PORTAL);
  url.searchParams.set("product", product);
  url.searchParams.set("package", packageName);
  return url.toString();
}

export function loginUrl(callback = trialPageUrl()) {
  return `${PORTAL}/api-common/Api/User/Login/Google?callback=${encodeURIComponent(callback)}`;
}

export { PORTAL };
