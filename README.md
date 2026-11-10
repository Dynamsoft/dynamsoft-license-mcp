# dynamsoft-license-mcp

An MCP server that gets a working **Dynamsoft trial license key** for your agent, and tells it
how to wire that key into the app it is generating.

It signs in to the Dynamsoft customer portal with the user's own Google account, asks the
portal for a trial key, and caches the result locally. The key never appears in chat (only a
masked form does) and never has to be pasted anywhere by hand.

## Why this exists

Coding agents write Dynamsoft integration code all day and then hit the same wall: the code
needs a license key before it will run. Today that means leaving the editor, filling in a web
form, waiting for an email, and pasting a key back into a conversation or a source file.

This server closes that loop:

- **One call** returns a key for the product and edition the code actually targets.
- **The key stays out of the transcript** — tools return a masked preview alongside the value,
  and the bundled guidance puts the real key in an environment variable.
- **It never burns quota needlessly** — a cached key or an existing key on the account is
  reused before a new trial request is spent.

## Requirements

| Requirement | Notes |
| --- | --- |
| Node.js **22+** | Uses the built-in `WebSocket` to talk to the browser. Node 18/20 exit with a message. |
| Chrome or Edge | Auto-detected; override with `CHROME_PATH`. |
| A Google account | One that may sign in to the Dynamsoft customer portal. Signing in creates or reuses the customer account for that identity. |

## Install

Add it to any stdio MCP client (Claude Code, Cursor, Codex, Copilot CLI, DeepSeek Harness…):

```json
{
  "mcpServers": {
    "dynamsoft-license": {
      "command": "npx",
      "args": ["-y", "dynamsoft-license-mcp"]
    }
  }
}
```

For **DeepSeek Harness**, add an `mcp-client` row and raise the tool timeout above the sign-in
wait — see [docs/dsh.md](docs/dsh.md).

## Tools

| Tool | Input | Output |
| --- | --- | --- |
| `get_trial_license` | `product`, `package`, `wait_ms`, `force_refresh` | The key plus its expiry, masked form, source (`cache` / `portal-list` / `portal-request`), and a reminder to keep it in private config. |
| `get_license_guide` | `product`, `platform`, `framework` | The exact initialization call for that platform, the environment variable to use, and the suggested edition. Code only, no key. |
| `describe_license` | `license_key` (optional) | Masked preview, key format, organization id, license server, expiry. Never the full key. |
| `get_trial_page_url` | `product`, `package` | The official trial page, for users who would rather apply by hand. |

The whole tool surface is about 3 KB (~760 tokens) of context, so it is cheap to keep loaded.

## First run

1. Call `get_trial_license`. With no saved session the server launches your Chrome on the
   portal's Google sign-in page and waits.
2. Sign in. The window closes as soon as the portal has set its session cookies.
3. The call returns the key.

If you take longer than the wait window (`wait_ms`, 45 s by default), the call returns
`status: "login_required"` with the URL and leaves the browser open. Call it again once you
are signed in — the session is already captured, so there is no second sign-in.

```json
{
  "status": "ok",
  "product": "dcv",
  "package": "cross-platform",
  "licenseKey": "DLS2…",
  "licenseKeyMasked": "DLS2abCd…Wx9z (292 chars)",
  "expirationDate": "2026-12-10T15:59:59.999Z",
  "source": "portal-request",
  "summary": { "daysRemaining": 30, "keyFormat": "dls2", "organizationId": "…" }
}
```

Every later call for the same product and edition is served from the local cache.

## Quota behaviour

The portal allows only a small number of trial requests per account and product, and asks
survey questions after the second. The server is therefore strictly lazy:

| Order | Step | Cost |
| --- | --- | --- |
| 1 | Local cache (`licenses.json`) | free, offline |
| 2 | Portal license list (`GetCompanyRecordList`) | **free**, read-only |
| 3 | Portal trial request (`RequestFromWeb`) | one request |
| 4 | Google sign-in | only when there is no usable session |

Only step 3 consumes quota. `force_refresh` is the only way to reach it while a valid key
already exists, so leave it alone unless the key is genuinely wrong.

## How the sign-in works

The portal's OAuth entry point is `GET /api-common/Api/User/Login/Google?callback=<url>`, and
it refuses any callback that is not on `www.dynamsoft.com` — a local redirect cannot receive
the token. The session it creates lives in `HttpOnly` cookies on the portal domain, which no
separate process can read either. So the only workable path is to drive a real browser and
read the cookies over the DevTools protocol.

That is deliberately done with **zero dependencies**:

- The installed Chrome/Edge is launched with a dedicated profile and `--remote-debugging-port=0`.
- The server connects with Node's built-in `WebSocket` and reads cookies via `Storage.getCookies`.
- No Playwright/Puppeteer, so there is no browser download and — importantly — no
  `--enable-automation` flag, which is the usual reason Google rejects a sign-in as an
  insecure browser.

With the cookies in hand the server calls the portal's own APIs, the same ones its website
uses:

| Endpoint | Purpose |
| --- | --- |
| `POST /api-common/Api/User/Info` | Account email and company id. |
| `POST /api-portal/Api/Trial/GetCompanyRecordList` | Existing keys for a product/edition (read-only). |
| `POST /api-portal/Api/Trial/RequestFromWeb` | Issue the trial key. |

The session is stored locally, so the browser is only needed the first time.

> These are the website's internal endpoints, not a documented public API. A portal change can
> break this server; `get_trial_page_url` is the permanent fallback.

## Products and editions

| `product` | Product |
| --- | --- |
| `dcv` (default) | Dynamsoft Capture Vision (barcode + document + MRZ capabilities) |
| `dbr` | Dynamsoft Barcode Reader |
| `dwt` | Dynamic Web TWAIN |
| `ddv` | Dynamsoft Document Viewer |
| `mrz` | MRZ Scanner |
| `mds` | Mobile Document Scanner |
| `mwc` | Mobile Web Capture |
| `dwt-ddv` | Web TWAIN + Document Viewer bundle |

| `package` | Edition |
| --- | --- |
| `cross-platform` (default) | Any platform |
| `web` | Web / JavaScript |
| `mobile` | Android / iOS |
| `desktop` | Server / desktop (Python, .NET, Java, C++, Node.js) |

The **edition** is the part that matters: the runtime enforces it, and a `desktop` key in a browser
fails with `[License] License mismatch: Browser requested`. Pick the edition that matches where the
code runs — `web` for a browser app, `mobile` for a phone app, `desktop` for a script or service, and
`cross-platform` when one key has to serve several.

The **product** argument mainly decides which portal record the request is filed under. One key
covers the Dynamsoft products: a key already cached for one product is reused for another when the
edition matches (reported as `source: "cache-shared"`), so asking for `dwt` after `dcv` returns the
same key without spending a trial request.

## Data stored locally

Under `~/.dynamsoft-license-mcp/` (override with `DYNAMSOFT_LICENSE_HOME`):

| File | Contents |
| --- | --- |
| `session.json` | Portal cookies plus account email/company. Owner-only permissions. |
| `licenses.json` | Keys per product/edition with expiry. Owner-only permissions. |
| `browser-profile/` | The Chrome profile used for sign-in (keeps the Google session). |

Delete that directory to sign out completely.

## Privacy and security

- The key is never written to logs and never included in an error message.
- Tool responses carry both the key and a masked form; the bundled skill guidance tells the
  agent to show only the masked form.
- Files are created with owner-only permissions (`0600`).
- No credentials are collected in chat: the sign-in happens in a real browser window that the
  server does not read beyond the cookies it needs.
- Signing in provisions a real Dynamsoft account for that Google identity, on that account
  holder's behalf. Use it with their consent.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No Chrome or Edge found` | Install one, or set `CHROME_PATH` to the executable. |
| Sign-in page says the browser is not secure | Retry; this server does not use automation flags. If it persists, sign in through the portal in your normal browser and use `get_trial_page_url`. |
| `status: "login_required"`, `reason: "timeout"` | Sign in, then call again; the session survives. |
| `status: "login_required"`, `reason: "browser_closed"` | The window was closed before sign-in finished. Call again to reopen it. |
| `session_end` / session expired | Call again; the next call reopens the sign-in page. |
| Trial request rejected | The account has hit the request limit for that product. Use an existing key, or the manual page. |
| Corporate TLS interception | Set `NODE_EXTRA_CA_CERTS` to your root CA bundle. |
| Headless server / CI | Not supported: there is no browser to sign in with. Pre-provision a key instead. |

## Development

```bash
npm install
npm test           # stdio smoke test, no network, no sign-in
npm run test:live  # real portal calls; needs a saved session, never prints a key
```

| Path | Role |
| --- | --- |
| `src/index.js` | stdio entry point, browser cleanup on exit |
| `src/server.js` | MCP tool definitions |
| `src/acquire.js` | cache → portal list → portal request → sign-in policy |
| `src/portal.js` | portal API calls |
| `src/session.js` | session reuse and sign-in orchestration |
| `src/browser.js` | Chrome discovery, CDP client, cookie reading |
| `src/license.js` | masking, `DLS2` decoding, expiry math |
| `src/guides.js` | per-platform initialization snippets |
| `src/catalog.js` | product/edition identifiers and portal URLs |

## License

MIT.
