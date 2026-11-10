# DeepSeek Harness (DSH) integration

DSH composes a **profile** from **bundles**; a bundle is an npm package whose
`package.json` declares `dsh.bundle.patch`, pointing at a YAML patch layer of loader rows.
Skills are a separate mechanism: a filesystem provider scans skill roots for `SKILL.md`.

This server covers the MCP half. Skills live in `dynamsoft-skills` (see the plan doc §3.2).

## 1. Wire the MCP server (profile patch)

Add to `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: mcp-dynamsoft-license
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: dynamsoft
    transport: stdio
    command: npx
    args: ['-y', 'dynamsoft-license-mcp']
    # The default 60s is too short for an interactive Google sign-in.
    toolCallTimeoutMs: 180000
```

Tools then appear as `mcp__dynamsoft__get_trial_license`,
`mcp__dynamsoft__get_license_guide`, `mcp__dynamsoft__describe_license`,
`mcp__dynamsoft__get_trial_page_url`.

`serverName` must match `[A-Za-z0-9_-]{1,32}` and be unique in the scope.

## 2. Ship it as a bundle

A distributable DSH plugin is a package with a patch layer:

```json
{
  "name": "@dynamsoft/dsh-plugin",
  "version": "1.0.0",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "files": ["cordis.patch.yml", "skills", "package.json"]
}
```

```yaml
# cordis.patch.yml
- id: dynamsoft-mcp-license
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: dynamsoft
    transport: stdio
    command: npx
    args: ['-y', 'dynamsoft-license-mcp']
    toolCallTimeoutMs: 180000

- id: dynamsoft-skills
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    providerName: dynamsoft
    includeDefaultRoots: true
    bundledSkillDir: <absolute path to this package's skills dir>
```

`bundledSkillDir` is passed through `resolve()`, so it must be an absolute path (or one
relative to the harness cwd). Two ways to satisfy that, pick one after testing:

1. `!!js` expression in the patch (the loader allows `!!js` in profile patches — verify it
   also works in a bundle patch before relying on it).
2. A `postinstall` script in the package that links `skills/*` into `$DSH_HOME/skills`
   (rank 400), which needs no path expression at all.

## 3. Skill roots DSH scans

| Rank | Source | Path |
| --- | --- | --- |
| 100 | project-dsh | `<projectRoot>/.dsh/skills` |
| 200 | project-agents | `<projectRoot>/.agents/skills` |
| 300 | custom | `customSkillDirs` |
| 400 | user-dsh | `<DSH_HOME>/skills` |
| 500 | user-agents | `~/.agents/skills` |
| 600 | bundled | `bundledSkillDir` |

A skill is `<name>/SKILL.md` (directories are not scanned recursively) or a flat
`<name>.md`. Frontmatter requires `name` and `description`; DSH additionally understands
`whenToUse`, `metadata`, `disable-model-invocation`, and `user-invocable`.

**Portable frontmatter rule:** ship only `name` + `description` (+ `metadata`) so the same
`SKILL.md` works unchanged in Claude Code, Cursor, Codex and DSH. Put the "when to use"
wording inside the description instead of a DSH-only key.

## 4. Plugin market index

DSH's Discover page and the `plugin_market` tool read a JSON index (format 1). Validate it in
CI with `parseMarketIndex` from `@deepseek-ai/dsh-plugin-market-index`:

```js
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
parseMarketIndex(json, 'https://skills.dynamsoft.com/dsh-index.json')
```

Install targets are `name@version` (npm) or a commit-pinned `git+https` URL with an optional
`path:`.

## Caveats

- The sign-in opens a browser window on the machine running the harness. That is fine for a
  desktop profile; it is meaningless for a headless one.
- `get_trial_license` blocks up to `wait_ms` (default 45s, max 240s). Keep
  `toolCallTimeoutMs` above it.
- The portal allows roughly three trial requests per account/product; the server reuses a
  cached key or the account's existing key first, so repeated calls cost nothing.
