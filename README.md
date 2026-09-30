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

It renders as a **「七牛云用量」 section in Settings** and as a **glance card below
the left session list**. The plugin is **read-only against Qiniu** — it never
creates, modifies or bills anything. The UI ships in Chinese and English and
follows the host theme.

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/settings.png">
    <img src="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/settings-light.png" width="520" alt="Settings → 七牛云用量">
  </picture>
  <br>
  <sub><b>Settings → 七牛云用量</b> · credentials, key roster, auto-refresh</sub>
</div>

<div align="center">
  <table>
    <tr>
      <td align="center" valign="top">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/details-model.png">
          <img src="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/details-model-light.png" height="440" alt="Details · model usage">
        </picture>
        <br>
        <sub><b>Details · model usage</b><br>date / key filters, per-model input / output / total</sub>
      </td>
      <td width="28">&nbsp;</td>
      <td align="center" valign="top">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/details-respack.png">
          <img src="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/details-respack-light.png" height="440" alt="Details · resource packs">
        </picture>
        <br>
        <sub><b>Details · resource packs</b><br>month-to-date utilisation, per-pack detail</sub>
      </td>
    </tr>
  </table>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/sidebar-card.png">
    <img src="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/sidebar-card-light.png" width="400" alt="Sidebar glance card">
  </picture>
  <br>
  <sub><b>Sidebar glance card</b> · one line collapsed, the three largest models plus
  <b>Details</b> / <b>Refresh</b> expanded</sub>
</div>

## Requirements

| | |
|---|---|
| DSH | `>= 0.1.5-rc.1` (`dsh --version`), on a profile that boots the Web app — usually `web` |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Qiniu | An **AccessKey / SecretKey** pair. A `sk-` token alone is not enough: the resource-pack (finance) API only accepts management credentials, and that AK needs billing/IAM financial permission. Without it the resource-pack cards show a targeted hint while the usage half keeps working. |

## Install

The package is **not published to npm** — install it from a local checkout.
`lib/` is gitignored, so build it first:

```bash
cd /path/to/dsh-qiniu-usage
npm install && npm run build
dsh plugin --profile web add link:$PWD
dsh web
```

Open **Settings → 七牛云用量**. That is the whole install.

`dsh plugin` is a thin `pnpm` forwarder running inside the profile directory. It
records the dependency in `$DSH_HOME/profiles/web/package.json` and, because the
package declares `dsh.bundle.patch`, appends the package name to
`dsh.profile.bundles` automatically — no manual patch-layer editing, and the web
app is **not** rebuilt (the shell serves `exports["./client"]` at
`/plugins/<id>/client.js`).

<details>
<summary>Other install sources, updating, uninstalling</summary>

```bash
# copy instead of symlink (live edits no longer picked up)
dsh plugin --profile web add file:/path/to/dsh-qiniu-usage

# a packed tarball
cd /path/to/dsh-qiniu-usage && npm run build && npm pack
dsh plugin --profile web add /path/to/dsh-qiniu-usage-<version>.tgz

# update
cd /path/to/dsh-qiniu-usage && git pull && npm install && npm run build && dsh web

# uninstall
dsh plugin --profile web remove dsh-qiniu-usage
```

A `git+…` install arrives **without `lib/`** and the package has no `prepare`
script, so it will not load — build it yourself and `add link:$PWD` instead.

To install without the CLI, add the dependency to
`$DSH_HOME/profiles/web/package.json` and append the package name (matching its
`name` field, not the path or git URL) to `dsh.profile.bundles`, then run
`dsh plugin --profile web install`.

Uninstalling drops the dependency and the bundle entry, but credentials you saved
through the GUI live in the DSH credential store and are **not** removed. Clear
them in **Settings → 七牛云用量 → 凭据** first if you want them gone.

With a `link:` install the profile keeps pointing at the same checkout. Restart
`dsh web` after **host-half** changes; after **client-half** changes a rebuild
plus a page refresh is enough.

</details>

## Configure

### Credentials

The plugin reads credentials **by reference name** — a POSIX environment-variable
name — never by value. Two ways to supply them:

**A. Environment variables (read-only).** Export them in the environment that
launches `dsh`:

```bash
export QINIU_ACCESS_KEY=...
export QINIU_SECRET_KEY=...
dsh web
```

DSH does **not** read a `.env` file automatically — see [`.env.example`](./.env.example)
for the variable names. Environment-backed entries can only be read, so the GUI
form is greyed out and reports `来源：环境变量 QINIU_ACCESS_KEY · 只读`.

**B. The GUI credential form.** In **Settings → 七牛云用量 → 凭据**, type the AK
and SK and save; they land in the DSH credential store, and rotating a key takes
effect on the next request — **no restart**. The form shows the *reference names*
(read-only) above the *value* inputs, because that is the actual split: the config
holds the name, the store holds the value.

### Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. When off, no routes are registered and no upstream request is ever made. |
| `accessKeyRef` | `QINIU_ACCESS_KEY` | **Name** of the store entry holding the AccessKey |
| `secretKeyRef` | `QINIU_SECRET_KEY` | Same, for the SecretKey |
| `timezone` | `Asia/Shanghai` | Upstream accepts IANA names only (`Local` is rejected) |
| `pollIntervalSec` | `5` | Client auto-refresh interval in seconds; `0` = manual refresh only |
| `sidebarCard` | `true` | Show the glance card at the sidebar foot; off keeps the panel settings-only |

Everything has a default, so an empty config is valid. The rest (`apiKeys[]`,
`defaultDay`, `defaultKey`, the cache TTLs, the API base URLs) is documented in
[`DESIGN.md`](./DESIGN.md) §10.1.

Edit these through the profile's plugin config, like any other DSH plugin setting.
`pollIntervalSec` and `sidebarCard` are picked up live; the rest apply on the next
`dsh web` boot.

## Usage

The settings page holds **configuration only** — the 凭据 form, a display-only key
roster (**name / masked / today's status**, which doubles as "does this AK/SK work
and which keys can it see"), and the auto-refresh interval.

The **sidebar glance card** sits at the foot of the left column (it hides itself
when the sidebar collapses to the 56px rail). Collapsed it is one line — icon,
title, today's total; expanded it shows the three largest models plus a
「其余 N 个模型合计」 line, with **Details** and **Refresh** buttons.

**Details** opens a centred dialog with two tabbed sections:

- **Model usage** — date (today / yesterday) and key (all keys combined / a single
  key) filters plus the per-model input / output / total table.
- **Resource packs** — month-to-date utilisation per billing item plus per-pack
  detail.

The card title follows those filters: switch to yesterday and it reads 昨日用量,
filter a key and it appends the key name — card and dialog share one store, so the
number on the card can never mean something other than what it says. The expanded
state is remembered per browser (`localStorage`, key
`dsh-qiniu-usage:sidebar-card:expanded`).

## Security & privacy

- **Credentials never reach the browser.** AK/SK exist only in the host process;
  the routes only ever return `{ configured, source, writable }`, a shape with no
  slot for a value.
- **Loopback-fenced routes.** Every route checks the socket, host and origin,
  ignores `X-Forwarded-For`, and responds with `cache-control: no-store`.
- **Redacted logs.** The AccessKey appears as its first four characters; the
  **SecretKey is never logged**. Credentials are written only through the DSH
  credential store, never to the plugin's own config file.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| The 「七牛云用量」 section does not appear | The bundle is not in `dsh.profile.bundles`. Check that `dsh plugin --profile web add …` succeeded, then restart `dsh web`. |
| `Cannot find module …/lib/index.js` on boot | `lib/` was never built. Run `npm install && npm run build` in the checkout. |
| `cannot get property "webServer" without inject` | Two copies of the plugin mounted at once. Keep a single entry in `dsh.profile.bundles`. |
| Panel loads but every figure is an auth error | Credentials missing or wrong. Check the 凭据 card for `configured` / `source`. |
| Resource-pack cards error, usage is fine | The AK lacks billing/IAM financial permission. |
| Key list is empty | The roster could not be fetched: credentials missing or invalid, or the AK has no usage-query permission. |
| No glance card in the sidebar | `sidebarCard` is `false`, or the sidebar is collapsed to the 56px rail. |
| The Details dialog is covered by another overlay | The dialog uses `z-index: 60`; a host overlay above that covers it. |

## Known limitations

- **Per-key filtering is unavailable for today.** Upstream has not attributed the
  current day's usage to individual keys yet and returns a single
  `api_key: "unknown"` aggregate group. The key roster therefore comes from a
  "last 30 days, up to yesterday" window, and selecting a key while viewing today
  says plainly that the figures are account-wide. Query **yesterday or earlier**
  for per-key numbers.
- **Today's data is delayed.** The panel pins a standing warning and shows the data
  watermark.
- **Zero-usage keys cannot be enumerated.** The upstream usage response only lists
  keys that had usage in the queried window.
- **Lifetime vs month-to-date scope.** A pack's `used_amount` is lifetime
  cumulative while `month-overview`'s `month_used` is month-to-date; the panel
  labels both.
- **The sidebar card depends on shell class names.** The plugin injects its
  container straight into the shell's `footArea` (substring-matched on
  `[class*=sidebarCol]` / `[class*=footArea]` / `[class*=settingsArea]`), because
  the foot's only extension seat (`sidebar.footer.action`) is a flex row that cannot
  host a block. If the shell renames those classes the card has no seat (no error; a
  body-level observer waits for one to appear).
- **Not yet verified against a real account.** Every upstream fact in this plugin
  comes from documentation and fixtures. If something is off with real data,
  `scripts/smoke.mjs` is the tool that shows it.

## Development

```bash
npm install
npm run build      # lib/index.js, lib/client.js, lib/types/**
npm run check      # tsc --noEmit
npm test           # vitest
```

The build emits two artifacts with different contracts, asserted by
`scripts/build.mjs` before either is written:

- `lib/index.js` — host half, self-contained ESM; the only import is `node:crypto`.
- `lib/client.js` — browser half, a self-contained
  `window.__ModuleLoader__.load({ id, factory })` bundle with `react` as the only
  external.

`src/qiniu/respack.ts` looks pure but reaches `node:crypto` through `sign.ts`, so
the client half may only take *values* from `react`, `src/client/**` and
`src/qiniu/usage.ts` — one bad value import breaks the whole client bundle.
Type-only imports are fine.

`node scripts/preview.mjs` renders the panel to HTML (`--theme dark|light`,
`?w=<px>`), `node scripts/screenshots.mjs` regenerates the images in this README,
and `node scripts/smoke.mjs` prints a normalised snapshot using AK/SK from the
environment only. `smoke.mjs` is also the fastest way to verify upstream
behaviour: with deliberately fake credentials it shows that the usage API reports
authentication failure as **HTTP 200 + `{"status":false,"error":"UNAUTHENTICATED"}`**
rather than a 401 — which is why the error classifier keys off the code text as
well as the HTTP status.

[`DESIGN.md`](./DESIGN.md) is the full design record — upstream API facts, signing
traps, route contract, data model, caching, and a log of the real problems hit
during implementation. Read it before contributing.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE) for attribution.
