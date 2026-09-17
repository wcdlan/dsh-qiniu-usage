# dsh-qiniu-usage

A [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI plugin that shows
**Qiniu Cloud (七牛云) token usage per model for a given API key**, plus the
**account's resource-pack utilisation**, as a section in the settings page.

> **Status: M0–M4 complete; M5 (end-to-end verification with a real account) pending.**
> Signing, usage normalisation, resource packs, the settings panel and the credential
> form are all implemented and covered by 238 tests. What has *not* been done is a run
> against a real Qiniu account — the smoke script below is the tool for that.
> [`DESIGN.md`](./DESIGN.md) is the authoritative design document; read it before
> contributing.

## What it will show

| Goal | Source |
|---|---|
| Per-model token usage (input / output / total) for a chosen key, today or a past day | `GET https://api.qnaigc.com/v3/stat/usage` |
| Resource-pack utilisation: this month's capacity / used / remaining per billing item, plus each pack's used amount and expiry | `https://api.qiniu.com/billing-api/v1/respack/*` |
| AK/SK entry, update and removal from the GUI — secrets never reach the browser | DSH credential store (`ctx.credentials`) |
| A floating button on the chat page that expands a usage/resource-pack popover | same host routes, fetched only while the popover is open |

## Install

```bash
dsh plugin --profile web add link:/path/to/dsh-qiniu-usage
```

`dsh plugin add` detects the `dsh.bundle.patch` declaration in this package and
automatically adds it to the profile's `dsh.profile.bundles` — there is no manual
patch-layer editing step. Then:

- host-half changes → restart `dsh web`
- client-half changes → rebuild, then refresh the page

## Configure

The plugin reads credentials **by reference name** (a POSIX environment-variable
name), never by value:

| Setting | Default | Meaning |
|---|---|---|
| `accessKeyRef` | `QINIU_ACCESS_KEY` | name of the env var / credential-store entry holding the AccessKey |
| `secretKeyRef` | `QINIU_SECRET_KEY` | same, for the SecretKey |
| `apiKeys[]` | `[]` | optional per-key `sk-`/`tk-` tokens for precise single-key queries |
| `timezone` | `Asia/Shanghai` | upstream only accepts IANA names (`Local` is rejected) |
| `pollIntervalSec` | `0` | `0` means manual refresh only |
| `floatingButton` | `true` | show the floating chat-page button; turn it off to keep the panel settings-only |

Two ways to supply the values:

1. **Environment** — export `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY` (see
   [`.env.example`](./.env.example)). These sources are read-only, so the GUI form
   is greyed out and reports `source: env`.
2. **The GUI credential form** (M4) — writes into the DSH credential store.

### Why AK/SK is required

The resource-pack (finance) API only accepts Qiniu **management credentials**
(AK/SK); an `sk-` bearer token cannot read it. So AK/SK is mandatory and the
`apiKeys[]` bearer tokens are an optional precision enhancement, not the main path.

## Develop

```bash
npm install
npm run build      # lib/index.js, lib/client.js, lib/types/**
npm run check      # tsc --noEmit
npm test           # vitest (275 tests)
```

To iterate on the panel's layout, render it to HTML and screenshot it, rather than
guessing at CSS:

```bash
node scripts/preview.mjs
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir="$PWD/.tmp/chrome-profile" --virtual-time-budget=2500 \
  --force-device-scale-factor=2 --window-size=820,1500 \
  --screenshot="$PWD/.tmp/shot.png" "file://$PWD/.tmp/preview.html?w=820&diag=1"
```

`node scripts/preview.mjs` writes two documents: `.tmp/preview.html` (the settings
panel) and `.tmp/preview-floating.html` (the chat-page popover over sample chat
content).

`?w=<px>` sets the simulated panel width (use this rather than `--window-size` for
narrow widths — Chrome clamps its window to ~500px and merely crops the shot, which
looks like an overflow bug but is not). `?diag=1` lists any element wider than the
panel, for locating whatever breaks the layout.

The build produces two artifacts with different contracts:

- `lib/index.js` — host half, self-contained ESM (no external `require`).
- `lib/client.js` — browser half, must be a self-contained
  `window.__ModuleLoader__.load({ id, factory })` bundle with `react` as the only
  external. `scripts/build.mjs` asserts this contract after every build, so a
  format drift fails the build rather than the browser.

## Security

- The browser never receives AK/SK: the client bundle has no credential-reading
  path (asserted in `test/bundle.test.ts`).
- Host routes are loopback-fenced and answer `cache-control: no-store`.
- AK is rendered as its first four characters in logs; **SK is never logged**.

## Documentation

- [`DESIGN.md`](./DESIGN.md) — full design: upstream API facts, signature traps,
  route contract, data model, caching/rate-limiting, milestones, risk register.
- [`NOTICE`](./NOTICE) — attribution for adapted family-shared sources.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

## Smoke test against a real account

```bash
export QINIU_ACCESS_KEY=...
export QINIU_SECRET_KEY=...
node scripts/smoke.mjs                 # yesterday by default
node scripts/smoke.mjs --day today
node scripts/smoke.mjs --key 我的测试Key
node scripts/smoke.mjs --json          # raw payload
```

The script reads credentials **only from the environment** and never writes them
anywhere. It prints the normalised usage and resource-pack snapshot. Exit codes:
`0` success, `1` upstream/data failure, `2` missing credentials.

This is also the fastest way to verify upstream behaviour: with deliberately fake
credentials it demonstrates that the usage API reports authentication failure as
**HTTP 200 + `{"status":false,"error":"UNAUTHENTICATED"}`** rather than a 401 —
which is why the error classifier keys off the code text as well as the HTTP status.

## Known limitations

- **Zero-usage keys cannot be enumerated.** The upstream usage response only lists
  keys that had usage in the queried window, so a key with no usage on that day is
  invisible; register it under `apiKeys[]` in the settings to make it selectable.
- **`api_key` query filtering is not used.** The parameter's semantics are
  undocumented, so key selection is done by fetching the whole account and filtering
  locally.
- **Today's data is delayed.** The upstream documents this; the panel pins a standing
  warning and shows the data watermark. Query *yesterday* or an explicit date for
  trustworthy totals.
- **Per-key filtering is unavailable for today.** Measured against the real API: for
  the current day the upstream has not attributed usage to individual keys yet and
  returns a single `api_key: "unknown"` aggregate group. The key roster therefore comes
  from a "last 30 days, up to yesterday" window (the dropdown still shows real key
  names), and selecting a key while viewing today says plainly that the figures are
  account-wide. Query *yesterday* or earlier for per-key detail.
- **Lifetime vs month-to-date scope.** A pack's `used_amount` is lifetime cumulative
  while `month-overview`'s `month_used` is month-to-date; the panel labels both.
- **Billing permission.** The finance API needs an AK with billing/IAM financial
  permission. Without it the resource-pack card shows a targeted hint and the usage
  half keeps working.
