# dsh-qiniu-usage

English | [中文](README.zh.md)

A [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI plugin for
[Qiniu Cloud (七牛云)](https://www.qiniu.com/). It answers two questions without
leaving the browser:

- **How much did each model cost me today?** — per-model token usage (input /
  output / total), for one API key or the whole account, for today, yesterday or
  any past date.
- **How much resource-pack quota is left this month?** — per-billing-item
  capacity / used / remaining, plus per-pack used amount and expiry date.

It renders as a **「七牛云用量」 section in Settings**, and as a **draggable
floating button** on the chat page for an at-a-glance number. It is **read-only
against Qiniu** — it never creates, modifies or bills anything.

```
┌ 七牛云用量 ────────────────────────────  ⟳ 刷新   12:04:31 ┐
│ 账号 [默认账号]   Key [我的测试Key ▾]   日期 [今天 ▾]        │
│ ⚠ 当天数据可能有延迟（上游水位 12:00）                       │
├ 今日各模型用量 ─────────────────────────────────────────────┤
│ ▇▇▇▇▇▇▇▇▇▇ deepseek-v4-pro   输入 1.24M  输出 0.31M  1.55M  │
│ ▇▇▇▇       qwen-max          输入 0.42M  输出 0.11M  0.53M  │
│ 合计 2.08M tokens · 4 个模型                                │
├ 资源包利用情况（本月）──────────────────────────────────────┤
│ AI大模型融合资源包 / 中国大陆   ▇▇▇▇▇▇▇░░░  68%             │
│   当月可用 100 GB  已用 68 GB  剩余 32 GB                    │
└─────────────────────────────────────────────────────────────┘
```

## Status

| | |
|---|---|
| Implemented | Signing, usage normalisation, resource packs, the settings panel, the credential form, the floating button |
| Tests | 338 passing across 14 files (`npm test`) |
| Not yet done | **End-to-end run against a real Qiniu account** — every upstream fact in this plugin comes from documentation and fixtures. If something is off with real data, [`scripts/smoke.mjs`](#verify-against-a-real-account) is the tool that shows it. |

The UI ships in Chinese and English and follows the host theme.

## Requirements

| | |
|---|---|
| DSH | `>= 0.1.5-rc.1` (`dsh --version`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Profile | any profile that boots the Web app — usually `web` |
| Qiniu | An **AccessKey / SecretKey** pair. A `sk-` token alone is not enough: the resource-pack (finance) API only accepts management credentials. |

## Install

This package is **not published to npm** — install it from a local checkout.
[`dsh plugin`](https://github.com/deepseek-ai/deepseek-harness) is a thin `pnpm`
forwarder that runs inside the profile directory, then reconciles the profile's
bundle list automatically.

### 1. Build the plugin

The runtime artifacts live in `lib/`, which is **not committed to git**:

```bash
cd /path/to/dsh-qiniu-usage
npm install
npm run build          # → lib/index.js, lib/client.js, lib/types/**
```

`npm test` is optional but cheap (~1 s) — run it if you want to confirm the
checkout is healthy before wiring it into your GUI.

### 2. Register it with your profile

```bash
dsh plugin --profile web add link:/path/to/dsh-qiniu-usage
```

That is the whole install. Behind the scenes:

1. `pnpm add` records the dependency in `$DSH_HOME/profiles/web/package.json`.
2. The CLI sees that the package declares `dsh.bundle.patch`
   (`./cordis.patch.yml`) and **automatically appends it to
   `dsh.profile.bundles`** — there is no manual patch-layer editing step.
3. On the next boot, the Web shell discovers the package's `dsh.client`
   declaration and serves `exports["./client"]` at `/plugins/<id>/client.js`.
   **The web app is not rebuilt.**

### 3. Restart

```bash
dsh web          # or: dsh --profile web
```

Open **Settings → 七牛云用量**. If the section is missing, see
[Troubleshooting](#troubleshooting).

### Other install sources

`add` accepts anything `pnpm` does, and the bundle list is reconciled against the
**real installed package name** in every case:

```bash
# local checkout — symlink, live edits are picked up after a rebuild (recommended)
dsh plugin --profile web add link:/path/to/dsh-qiniu-usage

# copy instead of symlink (no live edits)
dsh plugin --profile web add file:/path/to/dsh-qiniu-usage

# a packed tarball — build it first, then pack
cd /path/to/dsh-qiniu-usage && npm run build && npm pack
dsh plugin --profile web add /path/to/dsh-qiniu-usage-<version>.tgz

# straight from the git remote (⚠ lib/ is gitignored — see below)
dsh plugin --profile web add git+https://git.nagioa.cn/EntropyCrop/dsh-qiniu-usage.git
```

> ⚠ **A git install arrives without `lib/`.** The repository commits `src/` only,
> and the package has no `prepare` script, so `pnpm` installs a package whose
> `main` (`lib/index.js`) does not exist — the plugin will not load. Build it
> yourself first:
>
> ```bash
> git clone https://git.nagioa.cn/EntropyCrop/dsh-qiniu-usage.git ~/dsh-qiniu-usage
> cd ~/dsh-qiniu-usage && npm install && npm run build
> dsh plugin --profile web add link:$PWD
> ```
>
> A tarball from `npm pack` is fine because `npm run build` ran before packing.

### Manual install (no CLI)

If you would rather edit files: add the dependency to
`$DSH_HOME/profiles/web/package.json` and append the package name to
`dsh.profile.bundles`, then run `dsh plugin --profile web install`.

<details>
<summary>What the profile manifest should look like</summary>

```jsonc
{
  "dependencies": {
    "dsh-qiniu-usage": "link:/path/to/dsh-qiniu-usage"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        // … other bundles …
        "dsh-qiniu-usage"
      ],
      "patchReload": "live"
    }
  }
}
```

The bundle name must match the package's `name` field — not the path or the git
URL.

</details>

### Updating an installed plugin

```bash
cd /path/to/dsh-qiniu-usage
git pull && npm install && npm run build
dsh web          # restart
```

With a `link:` install the profile keeps pointing at the same checkout, so there
is nothing to re-add. Restart `dsh web` after **host-half** changes; after
**client-half** changes a rebuild plus a page refresh is enough.

### Uninstall

```bash
dsh plugin --profile web remove dsh-qiniu-usage
```

The CLI drops the dependency and removes it from `dsh.profile.bundles`.
Credentials you saved through the GUI live in the DSH credential store and are
**not** removed — clear them in **Settings → 七牛云用量 → 凭据** first if you want
them gone.

## Configure

The plugin reads credentials **by reference name** — a POSIX environment-variable
name — never by value:

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. When off, no routes are registered and no upstream request is ever made. |
| `accessKeyRef` | `QINIU_ACCESS_KEY` | **Name** of the store entry holding the AccessKey |
| `secretKeyRef` | `QINIU_SECRET_KEY` | Same, for the SecretKey |
| `apiKeys[]` | `[]` | Optional per-key `{ label, tokenRef }` entries for precise single-key queries |
| `defaultKey` | `""` | Key label selected on open; empty = all keys (account total) |
| `defaultDay` | `today` | Initial date scope: `today` / `yesterday` / `YYYY-MM-DD` |
| `timezone` | `Asia/Shanghai` | Upstream accepts IANA names only (`Local` is rejected) |
| `usageBaseUrl` | `https://api.qnaigc.com` | Model-usage API base |
| `financeBaseUrl` | `https://api.qiniu.com` | Resource-pack / finance API base |
| `todayTtlSec` | `60` | Cache TTL (s) for today's hourly data; `10`–`600` |
| `dashboardTtlSec` | `600` | Cache TTL (s) for past days and resource packs; `60`–`3600` |
| `pollIntervalSec` | `0` | Client poll interval in seconds; `0` = manual refresh only |
| `floatingButton` | `true` | Show the chat-page floating button; off keeps the panel settings-only |

Everything has a default, so an empty config is valid.

The panel itself exposes the key/date selectors, refresh and the credential form.
The remaining keys are edited the same way as any other DSH plugin setting —
through the profile's plugin config (for example an id-targeted row in
`$DSH_HOME/profiles/web/cordis.patch.yml`). `pollIntervalSec` and
`floatingButton` are picked up live; the rest apply on the next `dsh web` boot.

### Provide the credentials — two ways

**A. Environment variables (read-only).** Export them in the environment that
launches `dsh`:

```bash
export QINIU_ACCESS_KEY=...
export QINIU_SECRET_KEY=...
dsh web
```

Note that DSH does **not** read a `.env` file automatically — see
[`.env.example`](./.env.example) for the variable names, then export them or pass
them to your shell. Environment-backed entries can only be read, so the GUI form
is greyed out and reports `来源：环境变量 QINIU_ACCESS_KEY · 只读`.

**B. The GUI credential form.** In **Settings → 七牛云用量 → 凭据**, type the AK
and SK and save; they land in the DSH credential store and the plugin resolves
them on every upstream call, so **rotating a key takes effect on the next
request — no restart**. The form shows the *reference names* (read-only) above
the *value* inputs, because that is the actual split: the config holds the name,
the store holds the value.

### Why an AK/SK pair is required

The resource-pack (finance) API accepts Qiniu **management credentials** only — an
`sk-` bearer token cannot read it. So AK/SK is mandatory and `apiKeys[]` is an
optional precision enhancement for single-key queries, not the main path. The
finance API additionally needs an AK with billing/IAM financial permission;
without it the resource-pack cards show a targeted hint while the usage half
keeps working.

## Usage

Once credentials resolve, the settings section shows:

- **A key selector** — every key that had usage in the last 30 days (up to
  yesterday), plus an "all keys" aggregate.
- **A date selector** — today / yesterday / a specific date.
- **今日各模型用量** — per-model input / output / total tokens, with a total row.
  Large tables collapse behind a "more" toggle.
- **资源包利用情况（本月）** — month-to-date utilisation per billing item.
- **逐包明细** — per-pack used amount, quantity and expiry, on a **lifetime**
  basis. The two resource-pack cards are deliberately separate: their "used"
  figures are different quantities, and mixing them in one card reads wrong.
- **凭据** — the credential form.
- **告警** — shown only when there is something to warn about.

The **floating button** (top-right of the chat page, including the new-session
page) shows today's usage and this month's remaining pack quota. Click to expand
a summary; click again, press <kbd>Esc</kbd> or click outside to close. It is
**draggable**, and its position is remembered **per browser** (`localStorage`).
It only fetches while expanded — collapsed, it makes **zero background requests**.
Turn it off with `floatingButton: false`.

Both the panel and the button poll only while mounted: closing the settings page
or the popover stops the traffic.

## Security & privacy

- **Credentials never reach the browser.** AK/SK exist only in the host process.
  The client bundle contains no credential-reading path at all — asserted by
  `test/bundle.test.ts`. The routes only ever return
  `{ configured, source, writable }`, a shape with no slot for a value.
- **Loopback-fenced routes.** Every route checks the socket, host and origin, and
  ignores `X-Forwarded-For`; responses carry `cache-control: no-store`.
- **Redacted logs.** The AccessKey appears as its first four characters. The
  **SecretKey is never logged**.
- **No disk writes for credentials.** The plugin writes only through the DSH
  credential store, never to its own config file.
- **Bounded errors.** Upstream error text is truncated and stripped of anything
  credential-shaped before it reaches the UI.

## Development

```bash
npm install
npm run build      # lib/index.js, lib/client.js, lib/types/**
npm run check      # tsc --noEmit
npm test           # vitest — 338 tests
```

The build produces two artifacts with different contracts, both asserted by
`scripts/build.mjs` after every build — a format drift fails the build rather
than the browser:

- `lib/index.js` — host half, self-contained ESM. No external `require`; the only
  import is `node:crypto`.
- `lib/client.js` — browser half, a self-contained
  `window.__ModuleLoader__.load({ id, factory })` bundle with `react` as the only
  external.

### Seeing the panel without a browser

Iterate on layout by rendering it to HTML and screenshotting it instead of
guessing at CSS:

```bash
node scripts/preview.mjs
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir="$PWD/.tmp/chrome-profile" --virtual-time-budget=2500 \
  --force-device-scale-factor=2 --window-size=820,1500 \
  --screenshot="$PWD/.tmp/shot.png" "file://$PWD/.tmp/preview.html?w=820&diag=1"
```

`preview.mjs` writes three documents: `.tmp/preview.html` (the settings panel),
`.tmp/preview-keyed.html` (a key selected while today's data is still
unattributed) and `.tmp/preview-floating.html` (the chat-page popover over sample
chat content).

`?w=<px>` sets the simulated panel width — use it rather than `--window-size` for
narrow widths, because Chrome clamps its window to ~500px and merely crops the
shot, which looks like an overflow bug but is not. `?diag=1` lists any element
wider than the panel, for locating whatever breaks the layout.

### Verify against a real account

```bash
export QINIU_ACCESS_KEY=...
export QINIU_SECRET_KEY=...
node scripts/smoke.mjs                 # yesterday by default
node scripts/smoke.mjs --day today
node scripts/smoke.mjs --key 我的测试Key
node scripts/smoke.mjs --json          # raw payload
```

The script reads credentials **only from the environment** and never writes them
anywhere. It runs the TypeScript sources directly (Node 24), so it does not need
`lib/` to be built. It prints the normalised usage and resource-pack snapshot.
Exit codes: `0` success, `1` upstream/data failure, `2` missing credentials.

It is also the fastest way to verify upstream behaviour: with deliberately fake
credentials it demonstrates that the usage API reports authentication failure as
**HTTP 200 + `{"status":false,"error":"UNAUTHENTICATED"}`** rather than a 401 —
which is why the error classifier keys off the code text as well as the HTTP
status.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| The 「七牛云用量」 section does not appear | The bundle is not in `dsh.profile.bundles`. Check `dsh plugin --profile web add …` succeeded, then restart `dsh web`. |
| `Cannot find module …/lib/index.js` on boot | `lib/` was never built (typical after a git install). Run `npm install && npm run build` in the checkout. |
| `cannot get property "webServer" without inject` | Two copies of the plugin mounted at once. Keep a single entry in `dsh.profile.bundles`; a per-process `mountOnce` guard makes the second mount a no-op, but the duplicate should still be removed. |
| The panel says the host half is not enabled | `enabled` is `false` in the plugin config. |
| Panel loads but every figure is an auth error | Credentials missing or wrong. Check the 凭据 card for `configured` / `source`. |
| Credential form is greyed out | The ref resolves from a read-only source (environment variable). Unset it and restart to make the form writable. |
| Resource-pack cards error, usage is fine | The AK lacks billing/IAM financial permission. |
| Selected key shows account-wide figures for today | Expected — see the first two limitations below. Query **yesterday or earlier**. |

## Known limitations

- **Zero-usage keys cannot be enumerated.** The upstream usage response only lists
  keys that had usage in the queried window, so a key with no usage on that day is
  invisible; register it under `apiKeys[]` in the settings to make it selectable.
- **Per-key filtering is unavailable for today.** Measured against the real API:
  for the current day the upstream has not attributed usage to individual keys yet
  and returns a single `api_key: "unknown"` aggregate group. The key roster
  therefore comes from a "last 30 days, up to yesterday" window (the dropdown still
  shows real key names), and selecting a key while viewing today says plainly that
  the figures are account-wide.
- **Today's data is delayed.** The upstream documents this; the panel pins a
  standing warning and shows the data watermark. Query *yesterday* or an explicit
  date for trustworthy totals.
- **`api_key` query filtering is not used.** The parameter's semantics are
  undocumented, so key selection is done by fetching the whole account and
  filtering locally.
- **Lifetime vs month-to-date scope.** A pack's `used_amount` is lifetime
  cumulative while `month-overview`'s `month_used` is month-to-date; the panel
  labels both.
- **Floating-button z-index.** The popover is appended to `document.body` with
  `z-index: 40`. A host overlay with a lower index would be covered; a higher one
  covers the popover.
- **Billing permission.** The finance API needs an AK with billing/IAM financial
  permission. Without it the resource-pack card shows a targeted hint and the usage
  half keeps working.

## Documentation

- [`DESIGN.md`](./DESIGN.md) — the full design record: upstream API facts, signing
  traps, route contract, data model, caching and rate-limiting, milestones, risk
  register, and a log of the real problems hit during implementation. Read it
  before contributing.
- [`NOTICE`](./NOTICE) — attribution for adapted family-shared sources.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
