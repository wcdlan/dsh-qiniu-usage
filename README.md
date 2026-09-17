# dsh-qiniu-usage

A [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI plugin that shows
**Qiniu Cloud (七牛云) token usage per model for a given API key**, plus the
**account's resource-pack utilisation**, as a section in the settings page.

> **Status: M0 (scaffold) complete.** The signing layer is done and tested against
> the official fixed vector; the panel is a placeholder. Milestones M1–M5 (usage
> normalisation, resource packs, UI, credentials form) are tracked in
> [`DESIGN.md`](./DESIGN.md) — read it before contributing; it is the authoritative
> design document.

## What it will show

| Goal | Source |
|---|---|
| Per-model token usage (input / output / total) for a chosen key, today or a past day | `GET https://api.qnaigc.com/v3/stat/usage` |
| Resource-pack utilisation: this month's capacity / used / remaining per billing item, plus each pack's used amount and expiry | `https://api.qiniu.com/billing-api/v1/respack/*` |
| AK/SK entry, update and removal from the GUI — secrets never reach the browser | DSH credential store (`ctx.credentials`) |

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
npm test           # vitest
```

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
