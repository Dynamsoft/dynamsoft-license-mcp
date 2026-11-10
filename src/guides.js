// Per-platform license wiring. Every snippet here was checked against the official
// Dynamsoft SDK samples (init call site verified 2026-11-10); the key itself is always a
// placeholder or an environment variable, never the real value.

const ENV_VAR = "DYNAMSOFT_LICENSE_KEY";

const PLATFORM_ALIASES = {
  web: "web", javascript: "web", js: "web", typescript: "web", ts: "web", browser: "web",
  react: "web", vue: "web", angular: "web", html: "web",
  android: "android", kotlin: "android", java_android: "android",
  ios: "ios", swift: "ios", "objective-c": "ios", objc: "ios",
  flutter: "flutter", dart: "flutter",
  "react-native": "react-native", rn: "react-native", expo: "react-native",
  maui: "maui", dotnet_mobile: "maui",
  python: "python", py: "python",
  dotnet: "dotnet", csharp: "dotnet", "c#": "dotnet", net: "dotnet", windows: "dotnet",
  java: "java", jvm: "java",
  cpp: "cpp", "c++": "cpp", c: "cpp",
  nodejs: "nodejs", node: "nodejs"
};

export const PLATFORMS = [...new Set(Object.values(PLATFORM_ALIASES))];

export function normalizePlatform(value) {
  const raw = String(value || "").trim().toLowerCase();
  const platform = PLATFORM_ALIASES[raw];
  if (!platform) {
    throw new Error(`Unknown platform "${value}". Use one of: ${PLATFORMS.join(", ")}.`);
  }
  return platform;
}

const WEB_DCV = `npm i dynamsoft-capture-vision-bundle

// main.js — initialize once, before creating the router
import { LicenseManager } from "dynamsoft-capture-vision-bundle";

const key = import.meta.env.VITE_DYNAMSOFT_LICENSE_KEY; // never hardcode
await LicenseManager.initLicense(key);`;

const WEB_DBR = `npm i dynamsoft-barcode-reader-bundle

import { LicenseManager } from "dynamsoft-barcode-reader-bundle";

await LicenseManager.initLicense(process.env.DYNAMSOFT_LICENSE_KEY);`;

const WEB_DDV = `npm i dynamsoft-document-viewer

import Dynamsoft from "dynamsoft-document-viewer";

Dynamsoft.DDV.Core.license = window.DYNAMSOFT_LICENSE_KEY; // inject at build time
await Dynamsoft.DDV.Core.init();`;

const WEB_DWT = `<!-- Dynamic Web TWAIN uses a ProductKey (t0...), not a license key -->
<script src="/dwt/dynamsoft.webtwain.min.js"></script>
<script>
  Dynamsoft.DWT.ProductKey = window.DYNAMSOFT_PRODUCT_KEY; // older builds: Dynamsoft.WebTwainEnv.ProductKey
  Dynamsoft.DWT.ResourcesPath = "/dwt";
</script>`;

const ANDROID = `// Kotlin — Application.onCreate() or before the first scanner instance
import com.dynamsoft.license.LicenseManager

LicenseManager.initLicense(BuildConfig.DYNAMSOFT_LICENSE_KEY) { isSuccess, error ->
    if (!isSuccess) Log.e("Dynamsoft", "License failed: \${error.message}")
}`;

const IOS = `// Swift — AppDelegate / before the first scanner instance
import DynamsoftLicense

LicenseManager.initLicense(AppConfig.licenseKey, verificationDelegate: nil)`;

const FLUTTER = `// Dart — pass the key to the plugin; the native layer calls LicenseManager.initLicense
// flutter_barcode_sdk / dynamsoft_capture_vision_flutter
await BarcodeScanner.initLicense(licenseKey);`;

const REACT_NATIVE = `// TS — pass the key to the native module once at startup
await DynamsoftBarcodeReader.initLicense(licenseKey);`;

const PYTHON = `from dynamsoft_capture_vision_bundle import LicenseManager

error_code, error_message = LicenseManager.init_license(os.environ["DYNAMSOFT_LICENSE_KEY"])
if error_code != 0:
    raise RuntimeError(f"License failed: {error_message}")`;

const DOTNET = `using Dynamsoft.License;

// Program.cs / App startup, before creating any capture component
LicenseManager.InitLicense(Environment.GetEnvironmentVariable("DYNAMSOFT_LICENSE_KEY")!);`;

const JAVA = `import com.dynamsoft.license.LicenseManager;

// static initializer or the service constructor
LicenseManager.initLicense(System.getenv("DYNAMSOFT_LICENSE_KEY"));`;

const CPP = `#include "DynamsoftLicenseManager.h"

char error[512] = {0};
int ret = CLicenseManager::InitLicense(key.c_str(), error, sizeof(error));
if (ret != 0) {
    std::cerr << "License failed: " << error << std::endl;
}`;

const NODEJS = `// dynamsoft-capture-vision-for-node
import { LicenseManager } from "dynamsoft-capture-vision-for-node";

const [errorCode, errorMessage] = LicenseManager.initLicense(process.env.DYNAMSOFT_LICENSE_KEY);`;

const SNIPPETS = {
  web: {
    dcv: { code: WEB_DCV, note: "DCV bundle. For Vite/Next, expose the key through a public env var, not a .env commit." },
    dbr: { code: WEB_DBR, note: "DBR bundle exports the same LicenseManager class as DCV." },
    mrz: { code: WEB_DCV, note: "The MRZ Scanner web bundle re-exports LicenseManager; initialize before creating the scanner." },
    mds: { code: WEB_DCV, note: "The Document Scanner web bundle re-exports LicenseManager; initialize before creating the scanner." },
    ddv: { code: WEB_DDV, note: "DDV uses a Core.license property plus Core.init(), not LicenseManager." },
    dwt: { code: WEB_DWT, note: "DWT is licensed with a ProductKey (keys start with t0), and the same key must be set in the DWT service config on the host." },
    mwc: { code: WEB_DCV, note: "Mobile Web Capture uses a solution key; initialize before creating the capture view." }
  },
  android: { dcv: { code: ANDROID }, dbr: { code: ANDROID }, mrz: { code: ANDROID }, mds: { code: ANDROID } },
  ios: { dcv: { code: IOS }, dbr: { code: IOS }, mrz: { code: IOS }, mds: { code: IOS } },
  flutter: { dcv: { code: FLUTTER }, dbr: { code: FLUTTER }, mrz: { code: FLUTTER }, mds: { code: FLUTTER } },
  "react-native": { dcv: { code: REACT_NATIVE }, dbr: { code: REACT_NATIVE }, mrz: { code: REACT_NATIVE }, mds: { code: REACT_NATIVE } },
  maui: { dcv: { code: DOTNET }, dbr: { code: DOTNET }, mrz: { code: DOTNET }, mds: { code: DOTNET } },
  python: { dcv: { code: PYTHON }, dbr: { code: PYTHON }, mrz: { code: PYTHON }, mds: { code: PYTHON } },
  dotnet: { dcv: { code: DOTNET }, dbr: { code: DOTNET }, mrz: { code: DOTNET }, mds: { code: DOTNET } },
  java: { dcv: { code: JAVA }, dbr: { code: JAVA }, mrz: { code: JAVA }, mds: { code: JAVA } },
  cpp: { dcv: { code: CPP }, dbr: { code: CPP }, mrz: { code: CPP }, mds: { code: CPP } },
  nodejs: { dcv: { code: NODEJS }, dbr: { code: NODEJS }, mrz: { code: NODEJS }, mds: { code: NODEJS } }
};

const PACKAGE_FOR_PLATFORM = {
  web: "web", android: "mobile", ios: "mobile", flutter: "mobile", "react-native": "mobile",
  maui: "mobile", python: "desktop", dotnet: "desktop", java: "desktop", cpp: "desktop", nodejs: "desktop"
};

export function packageForPlatform(platform) {
  return PACKAGE_FOR_PLATFORM[normalizePlatform(platform)] ?? "cross-platform";
}

const FENCE_LANGUAGE = {
  web: "javascript", android: "kotlin", ios: "swift", flutter: "dart",
  "react-native": "typescript", maui: "csharp", python: "python",
  dotnet: "csharp", java: "java", cpp: "cpp", nodejs: "javascript"
};

export function buildLicenseGuide({ product, platform }) {
  const entry = SNIPPETS[platform]?.[product];
  if (!entry) {
    return [
      `No wiring snippet is recorded for ${product} on ${platform}.`,
      "",
      `Use the ${product} license manager on that platform, keep the key in \`${ENV_VAR}\`,`,
      "and initialize once at startup before creating any capture component."
    ].join("\n");
  }
  const lines = [
    `### ${product.toUpperCase()} · ${platform}`,
    "",
    "**Keep the key out of source.** Export it as an environment variable (or a CI/mobile secret), never commit it:",
    "",
    "```bash",
    `export ${ENV_VAR}="..."   # web: inject it at build time, do not ship it in a public repo`,
    "```",
    "",
    "**Initialize once at startup, before any capture/scan call:**",
    "",
    "```" + (platform === "web" && product === "dwt" ? "html" : FENCE_LANGUAGE[platform] ?? "text"),
    entry.code,
    "```"
  ];
  if (entry.note) lines.push("", `> ${entry.note}`);
  return lines.join("\n");
}

export { ENV_VAR };
