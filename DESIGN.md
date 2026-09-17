# dsh-qiniu-usage 设计文档

> DSH Web GUI 插件：在设置页展示**七牛云指定 API Key 当天的各模型 Token 用量**，以及**账号资源包的利用情况**。
>
> 状态：设计定稿（未开工）
> 目标仓库：`~/dsh-plugins/dsh-qiniu-usage`
> 目标 profile：`~/.dsh/profiles/web`

---

## 1. 目标与非目标

### 1.1 目标

| # | 需求 | 数据来源 |
|---|---|---|
| G1 | 查看**指定 Key 当天**的各模型 Token 用量（输入 / 输出 / 合计） | `GET https://api.qnaigc.com/v3/stat/usage` |
| G2 | 查看**账号资源包**的利用情况：当月各计费项可用/已用/剩余/利用率、逐包已用/总量与到期时间 | `https://api.qiniu.com/billing-api/v1/respack/*` |
| G3 | 在 GUI 里填写/更新/清除 AK/SK，密钥永不进入浏览器 | DSH 凭据库（`ctx.credentials`） |

### 1.2 非目标（本期明确不做）

- **不注册模型工具**：不暴露 `ctx.tools`，模型看不到这些数据，不占用系统提示词。
- 不做近 7/30 天趋势落盘。
- 不做费用预估 / 账单金额（`bill/*`、`bill/snapshot` 的金额字段）。
- 不做多账号切换（单账号，`accessKeyRef` 一组）。
- 不做资源包的购买/管理写操作，只读。

> 以上非目标里，"模型工具"与"趋势落盘"是将来最容易加的扩展点，架构上已预留位置（见 §4.2）。

---

## 2. 已确认的设计决策

| 决策项 | 结论 |
|---|---|
| 插件形态 | **仅 GUI 用量面板**（宿主半区 = 数据源 + 浏览器后端；无模型工具） |
| 鉴权 | **AK/SK 为主**（账号级：用量按 Key 分组 + 资源包），**可选 Bearer `sk-`** 用于精确查询单个 Key |
| 凭据存储 | **DSH 凭据库**，可在 GUI 内填写；config 只存引用名，界面只回显 `configured/writable/source` |
| 数据范围 | **今天 + 昨天 + 资源包月度/逐包**；不含趋势与费用 |
| 日期默认 | 今天（小时粒度，带数据延迟告警）；可切昨天（天粒度，完整值） |
| 轮询 | 默认**关闭**（纯手动刷新），可选开启 |

### 2.1 关键推论

**资源包接口只接受七牛管理凭证（AK/SK）**，`sk-` token 无法访问财务 API。因此：

1. AK/SK 是本插件的**必需**凭据，缺它则 G2 完全不可用。
2. AK/SK 模式下用量接口返回**账号下全部 Key**（按 `api_key` 分组，带 `name` 与掩码），所以"指定 Key"天然实现为"拉全账号 + 本地筛选"，而不是为每个 Key 单独配置 token。
3. Bearer 模式是**可选的精度增强**（用户恰好持有某个 `sk-`/`tk-` 时，可精确查该 Key），不是主路径。

---

## 3. 上游接口事实（已核对官方文档）

### 3.1 大模型 Token 用量接口

- 端点：`GET https://api.qnaigc.com/v3/stat/usage`
- 文档：<https://developer.qiniu.com/aitokenapi/13382/new-usage-api>

| Query | 必填 | 说明 |
|---|---|---|
| `granularity` | 是 | `day` 或 `hour`（兼容别名 `g`） |
| `start` | 是 | RFC3339；AK/SK 另兼容 `YYYY-MM-DD`（仅 `day`） |
| `end` | 是 | 同上 |
| `timezone` | 否 | IANA 时区名，默认 `Asia/Shanghai`；传 `Local` 或非法值返回 400 |
| `api_key` | 否 | 文档注明"一般无需传入"，**本设计不依赖它**（语义未验证） |

**时间范围限制**（仅 RFC3339 格式受约束）：`day` ≤ 31 天；`hour` ≤ 7 天。

**限流**：同一 IP **5 次/秒**。

**数据时效**：官方明确"当天数据可能存在延迟，建议查询昨天及之前的数据"。

**鉴权**：
- Bearer：`Authorization: Bearer sk-xxx`（`sk-` 正式 / `tk-` 临时）；只返回当前 Key 的用量。
- AK/SK：`Authorization: Qiniu <AccessKey>:<EncodedSign>`；返回账号下所有 Key，按 `api_key` 分组并带 `name`。

**统一外壳**：成功 `{ "status": true, "data": ... }`，失败 `{ "status": false, "error": "..." }`。

**三种 `data` 形态（必须全部兼容）**：

| # | 条件 | 结构 |
|---|---|---|
| 1 | Bearer 鉴权 | `data[] = models[]` |
| 2 | AK/SK + RFC3339 | `data[] = { api_key, name, models[] }` |
| 3 | AK/SK + `YYYY-MM-DD` | `data[] = models[]`，`items[].values[]`，**无 `categories` 层** |

形态 1/2 的 model 结构：

```jsonc
{
  "id": "model_name",
  "name": "模型显示名称",
  "items": [
    {
      "name": "输入 Token",
      "unit": "kToken",
      "total": 1000,
      "categories": [
        { "name": "输入 Token",
          "values": [ { "time": "2024-01-01T00:00:00Z", "value": 100 } ] }
      ]
    }
  ]
}
```

形态 3 的 item 结构（扁平）：

```jsonc
{ "name": "输入 Token", "unit": "kToken", "total": 1000,
  "values": [ { "value": 100, "time": "2024-01-01T00:00:00Z" } ] }
```

**错误码**：400 参数/时区/范围错误，500 上游。

**⚠ 实测修正（2026-09 用假凭据打真实上游）**：鉴权失败**不是 HTTP 401**，而是

```json
HTTP/1.1 200 OK
{ "status": false, "error": "UNAUTHENTICATED" }
```

也就是说**只看 HTTP 状态码会把鉴权失败误判成普通业务错误**，UI 就不会给出
"AK/SK 无效或已过期"的引导。因此实现上必须同时按 `error` 文本判定
（`UNAUTHENTICATED` / `UNAUTHORIZED` / `INVALID_CREDENTIALS` / `AUTHENTICATION_FAILED`），
并且**业务错误必须经同一个归一函数**，不能就地 `new Error` —— 否则会绕过判定。

同期实测：财务 API（`api.qiniu.com`）在凭据无效时确实回 **HTTP 401**（空 body），
与用量接口不同 —— 两个上游的错误形态真的不一致。

### 3.2 AK/SK 签名（管理凭证）

文档：<https://developer.qiniu.com/kodo/1201/access-token>

```
signingStr = METHOD + " " + path
           (+ "?" + query)                      // query 非空且不含 "?"
           + "\nHost: " + host
           (+ "\nContent-Type: " + contentType) // 仅当设置了该头
           (+ 按 key ASCII 排序的 X-Qiniu-* 头，key 首字母与 "-" 后字母大写)
           + "\n\n"
           (+ body)                             // 仅当有 body 且 Content-Type != application/octet-stream

sign  = HMAC-SHA1(signingStr, SecretKey)        // 二进制
encodedSign = urlsafe_base64(sign)              // + → -, / → _，保留 "="
Authorization = "Qiniu " + AccessKey + ":" + encodedSign
```

**单元测试固定向量**（来自官方文档，M0 的验收依据）：

```
AK = "MY_ACCESS_KEY", SK = "MY_SECRET_KEY"
METHOD = "POST"
path   = "/move/bmV3ZG9jczpmaW5kX21hbi50eHQ=/bmV3ZG9jczpmaW5kLm1hbi50eHQ="
host   = "rs.qiniu.com"
signingStr = "POST /move/bmV3ZG9jczpmaW5kX21hbi50eHQ=/bmV3ZG9jczpmaW5kLm1hbi50eHQ=\nHost: rs.qiniu.com\n\n"
期望 encodedSign = "1uLvuZM6l6oCzZFqkJ6oI4oFMVQ="
```

**三个易错点**：
1. `Host` 不含端口。
2. 签名用的 query 串必须与实际请求 URL 中的 query 串**逐字节一致**（`+08:00` 必须编码为 `%2B08:00`）→ 实现上 **query 串只构造一次**，签名与请求共用同一个字符串。
3. GET 请求**不设置 `Content-Type`**（对齐上述固定向量的形态）。

### 3.3 资源包接口

- 端点：`GET https://api.qiniu.com/billing-api/...`
- 文档：<https://developer.qiniu.com/af/10420/financial-external-api-documentation>
- 外壳：`{ "code": 0, "message": "Success", "data": ... }`，`code != 0` 为错误。

| 接口 | 用途 | 关键响应字段 |
|---|---|---|
| `/billing-api/v1/respack/month-overview?page=&page_size=` | **当月利用率主视图** | `item_name, zone_name, available_time, total_surplus, month_used, month_remain, respack_unit` |
| `/billing-api/v1/respack/list?status=&page=&page_size=` | 逐包明细 / 到期 | `respack_name, status(1未使用/2使用中/3已用完/4已过期), effective_start, effective_end, carry_over_policy(0按月可结转/1按月不可结转/2一次性), total_amount, used_amount, respack_unit, data_update_time, order_hash, po_id` |
| `/billing-api/v1/respack/detail?order_hash=&po_id=` | 单包下钻（按需） | `is_combo_item, description, deduct_details[{deduct_date, deduct_status, deduct_amount}], item_code` |
| `/billing-api/v1/respack/history-usage?month=YYYYmm` | 月度抵扣（本期仅预留） | `total_this_month, used_this_month, usable_this_month, combo_item_details[]` |
| `/billing-api/v2/bill/snapshot?date=YYYY-mm-ddT00:00:00` | 按量计费每日快照（本期**不做**，记为扩展点） | `respack_usage, package_usage, total_usage, usage_coefficient, usage_unit, item_money` |

**错误码映射**（用于 UI 文案）：

| code | 常量 | 用户可读提示 |
|---|---|---|
| 1000 | InvalidParameter | 请求参数不正确 |
| 1005 | QueryTimeExceeded | 请求的时间不正确 |
| 1009 | MonthOverviewGetFailed | 资源包当月概览获取失败 |
| 1010 | RespackOverviewGetFailed | 资源包列表获取失败 |
| 1011 | RespackDetailGetFailed | 资源包详情获取失败 |
| 1012 | HistoryUsageGetFailed | 资源包历史抵扣获取失败 |
| 1013 | GetBalanceOverviewFailed | 账户余额获取失败 |

**权限约束**：财务 API 要求 AK 具备**账单/财务权限**（IAM）。无权限时需要降级为"仅用量"模式并在 UI 上说明原因，而不是报一句"未知错误"。

**口径提醒**：按量计费账单每月 4 号出账，建议 5 号后再看上月；`respack/list` 的 `used_amount` 是**资源包生命周期累计**，而 `month-overview` 是**当月口径**，两者都展示时必须分别标注。

---

## 4. 架构

### 4.1 组件图

```
┌───────────────────── browser（永不接触 AK/SK） ─────────────────────┐
│ 设置 → 「七牛云用量」 settings.section (order 152)                   │
│  [Key ▾] [今天|昨天|日期 ▾] [⟳ 刷新]                                 │
│  ├ 今日各模型用量：条形 + 输入/输出/合计                              │
│  ├ 资源包利用情况：当月利用率进度条 + 逐包已用/到期                    │
│  └ 凭据：AK/SK 表单（提交后清空输入框，只回显 configured/writable）    │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ same-origin fetch，loopback-fenced，no-store
┌───────────────────────────▼──────── dsh-qiniu-usage · host half ────┐
│ routes.ts      6 条路由（§7）                                        │
│ service.ts     快照装配 + 内存缓存 + single-flight + ≥250ms 上游限速  │
│ credentials.ts resolve / describe / set / unset（脱敏，永不回传值）   │
│ qiniu/sign.ts  管理凭证签名                                          │
│ qiniu/http.ts  timeout / 退避重试 / 双外壳解析                        │
│ qiniu/usage.ts 3 形态 → UsageSnapshot                                │
│ qiniu/respack.ts month-overview / list / detail                      │
└──────┬────────────────────────────────────┬──────────────────────────┘
       │ Bearer sk-（可选，精确单 Key）      │ Qiniu <AK>:<sign>（主路径）
┌──────▼──────────────┐          ┌──────────▼──────────────────────┐
│ api.qnaigc.com      │          │ api.qiniu.com                   │
│ /v3/stat/usage      │          │ /billing-api/v1/respack/*       │
└─────────────────────┘          └─────────────────────────────────┘
```

### 4.2 双半区与注入策略

**单包、双半区**，遵循 DSH 官方 bundle 形态（与 `@linxin666/dsh-usage`、`dsh-feng-gu` 同构）：

**宿主半区**

```ts
export const name = 'dsh-qiniu-usage'
export const inject = ['webServer']            // 必需
export function apply(ctx, config) {
  ctx.inject(['credentials'], (c) => { /* 可选：凭据库 */ })
  ctx.inject(['settings'],    (c) => { /* 可选：设置命名空间热更新 */ })
  // webServer 注册路由；mountOnce 防重复挂载
}
```

- 缺 `credentials` → 降级为环境变量直读（`process.env[ref]`）。
- 缺 `settings` → 只用启动期 config，不支持热更新。
- 缺 `webServer`（headless profile）→ 整个插件静默空转，不报错。
- 用 `mountOnce` 模式（参考 `dsh-usage`）保证同名包只挂载一次。

将来要加模型工具时，只需在这里增加 `tools` 注入与 `ctx.tools.register(...)`，数据结构（§6）可直接复用。

**客户端半区**

```jsonc
// package.json
"exports": {
  ".":        { "default": "./lib/index.js" },
  "./client": { "default": "./lib/client.js" }
},
"dsh": {
  "engines": { "dsh": ">=0.1.5-rc.1" },
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    // 语义是「包名」，不是服务名：client-modules 拿每项去 graphRows.get(packageName)
    // 查图，查不到就静默跳过（dsh-client-modules/lib/client.js:265）。可省略。
    // 注意：没有 @deepseek-ai/dsh-client-ui-slots 这个包 —— slots 服务由
    // @deepseek-ai/dsh-client-ui-renderer 提供（它导出 SlotComponent 等类型）。
    "inject": [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-renderer"
    ]
  }
}
```

> **易错区分**：上面 `dsh.client.inject` 是**包名**；而 `src/client/index.ts` 里的 `export const inject = ['slots','locale','connection','settingsScope','remote']` 是 **cordis 服务名**。两者同名不同物，不要互相抄。

由 `@deepseek-ai/dsh-client-modules` 扫描已启用 Loader 条目，把 `exports["./client"]` 挂到 `/plugins/<pkg>/client.js`（多包共用 combo URL `/plugins/??<id>/client.js,…&rev=<hash>`），浏览器按需惰性加载。

`cordis.patch.yml`：

```yaml
- insert:
    - id: qiniu-usage
      name: dsh-qiniu-usage
```

**客户端绑定设置命名空间（必须带兼容回退）**：

```ts
// src/client/index.ts
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
const settingsScope = binder.bind<QiniuSettings>({ namespace: 'dsh-qiniu-usage' })
```

`webUiSettings` 是 `dsh-web-settings` 提供的 rc.6 兼容 binder，**该 group plugin 未安装时会缺失**（dsh-usage `src/client/index.ts` 同款回退）；直接假定 `ctx.settingsScope` 存在会在部分 profile 下崩。

### 4.3 运行时生命周期

- 客户端**轮询挂在组件挂载周期上**：设置页关闭 → 零请求（与 `dsh-usage` 一致）。
- 宿主缓存跨请求存活；插件卸载时清理定时器与路由 dispose。
- 配置热更新（`settings.installSection` 的 `setSource`）→ 重算缓存键、失效旧缓存。

---

## 5. 目录结构

```
dsh-qiniu-usage/
├── DESIGN.md                     # 本文档
├── README.md / README.zh.md
├── package.json                  # dsh.bundle.patch + dsh.client
├── cordis.patch.yml
├── tsconfig.json
├── tsdown.config.ts
├── src/
│   ├── index.ts                  # name / inject / Config / apply
│   ├── config.ts                 # schemastery Config + resolveConfig
│   ├── mount-once.ts             # 防重复挂载
│   ├── qiniu/
│   │   ├── sign.ts               # 管理凭证（含固定向量测试）
│   │   ├── http.ts               # timeout / 退避 / 双外壳解析
│   │   ├── usage.ts              # 3 形态 → UsageSnapshot
│   │   ├── respack.ts            # respack 客户端 + 归一
│   │   └── types.ts              # 原始响应类型（3 形态 + respack）
│   ├── service.ts                # QiniuUsageService：缓存 / single-flight / 限速 / 装配
│   ├── credentials.ts            # 凭据 describe/set/unset 封装
│   ├── routes.ts                 # 6 条路由 + loopback fence
│   ├── host/
│   │   ├── loopback.ts           # isLoopbackRequest（socket + Host + 同源）
│   │   └── http.ts               # writeJson 等
│   └── client/
│       ├── index.ts              # settings.section 注册
│       ├── UsageSection.tsx      # 主面板
│       ├── ModelUsageTable.tsx   # 各模型用量表 + 条形
│       ├── RespackBars.tsx       # 资源包利用率进度条
│       ├── KeyPicker.tsx
│       ├── DayPicker.tsx
│       ├── CredentialsForm.tsx
│       ├── usage-store.ts        # 客户端状态
│       └── locales.ts            # zh / en
└── test/
    ├── sign.test.ts              # 固定向量
    ├── usage-normalize.test.ts   # 3 形态 fixture
    ├── respack-normalize.test.ts
    └── fixtures/
```

---

## 6. 数据模型（规范化后）

```ts
/** 单个模型的用量 */
type UsageModel = {
  id: string
  name: string
  items: { name: string; unit: string; totalRaw: number; total: number }[]
  totalsByKind: {
    input: number
    output: number
    cachedInput?: number
    cachedWrite?: number
    other: number
  }
  total: number
}

/** 一次用量查询的结果 */
type UsageSnapshot = {
  source: 'bearer' | 'aksk'
  keyLabel: string          // "我的测试Key (sk-xx*****xx)" | "当前 Key"
  day: string               // Asia/Shanghai 的 YYYY-MM-DD
  granularity: 'day' | 'hour'
  range: { start: string; end: string; timezone: string }
  models: UsageModel[]      // 按 total 降序
  totals: { input: number; output: number; total: number }
  watermark?: string        // 小时粒度下最后一个有数据的时间桶 → "数据可能延迟"
  warnings: string[]
  fetchedAt: string
}

type RespackItem = {
  itemName: string
  zoneName: string
  availableTime: string
  unit: string
  monthCapacity: number     // total_surplus 当月可用总量（含结转）
  monthUsed: number
  monthRemain: number
  utilization: number       // monthUsed / monthCapacity，0..1
}

type RespackPack = {
  name: string
  unit: string
  status: 1 | 2 | 3 | 4
  effectiveStart: string
  effectiveEnd: string
  daysRemaining: number
  carryOverPolicy: 0 | 1 | 2
  totalAmount: number
  usedAmount: number
  utilization: number
  orderHash: string
  poId: number
  isCombo?: boolean
  description?: string
}

type RespackSnapshot = {
  items: RespackItem[]
  packages: RespackPack[]
  fetchedAt: string
  warnings: string[]
}

/** 路由 /overview 的载荷：两个数据源互相独立，失败隔离 */
type OverviewPayload = {
  ok: boolean
  usage: UsageSnapshot | null
  respack: RespackSnapshot | null
  errors: { source: 'usage' | 'respack'; code?: number | string; message: string }[]
  fetchedAt: string
}
```

### 6.1 归一规则

- **单位以响应里的 `unit` 字段为权威**。`kToken` → ×1000 得 token 数；表格同时保留 `*Raw` 便于与官方控制台对数。
- **计费项归类**：按 `items[].name` 关键字匹配 → 输入 / 输出 / cachedInput（缓存命中/读）/ cachedWrite（缓存写）/ other；未识别的进 `other` 并在 UI 上原样展示名称。
- **两种层级折叠**：形态 1/2 取 `items[].categories[].values[]`，形态 3 取 `items[].values[]`；只关心区间汇总时直接用 `items[].total`（更省事且与官方一致）。
- **模型排序**：按 `total` 降序。UI 默认全部展示，表格超过 20 行折叠为"其余 N 个模型合计"。

---

## 7. 路由契约

全部路由：

- 挂在 `ctx.webServer.register({ kind: 'exact', path, handler })`
- **loopback fence**：socket 地址是回环 + `Host` 是回环主机名 + `sec-fetch-site !== 'cross-site'` + `Origin` 与 Host 同源（**不信任** `X-Forwarded-For`）
- 响应头 `cache-control: no-store`、`content-type: application/json; charset=utf-8`
- POST 额外校验 `content-type: application/json`

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/dsh-qiniu-usage/overview?day=today\|yesterday\|YYYY-MM-DD&key=<label\|masked\|空>` | — | `OverviewPayload` |
| POST | `/api/dsh-qiniu-usage/refresh` | body 同 overview 的 query | 失效缓存后重跑，返回新 `OverviewPayload` |
| GET | `/api/dsh-qiniu-usage/keys?day=` | — | `{ keys: { label, masked, name?, hasUsage, hasToken }[] }` |
| GET | `/api/dsh-qiniu-usage/respack/detail?order_hash=&po_id=` | — | `{ ok, detail }` |
| GET | `/api/dsh-qiniu-usage/credentials` | — | `{ accessKey, secretKey, apiKeys[] }`，每项仅 `{ configured, source, writable }` |
| POST | `/api/dsh-qiniu-usage/credentials` | `{ ref, value? \| action: 'set'\|'unset' }` | 同 GET 的 describe 结果 |

### 7.1 `/keys` 的合并逻辑

Key 选择器的候选集合 = **并集**：

1. 最近一次 AK/SK 用量响应中出现的 Key（有 `name` + 掩码，`hasUsage=true`）
2. config 里用户登记的 `apiKeys[].label`（`hasUsage` 依当日响应判定，可能为 false）

每项标注 `hasToken`（是否配了 `sk-` token，可走 Bearer 精确查询）。

**已知边界**：当日**零用量**的 Key 不会出现在上游响应里，无法自动枚举 → 由用户在配置里登记名称，UI 显示"无用量"而非"不存在"。

---

## 8. 上游调用策略

### 8.1 日期与时区

| 选择 | `granularity` | 范围 | 说明 |
|---|---|---|---|
| 今天（默认） | `hour` | 今日 00:00:00+08:00 → 现在 | 拿细桶并计算水位线；UI 常驻"⚠ 当天数据可能有延迟" |
| 昨天 | `day` | 昨日 00:00 → 23:59:59+08:00 | 官方推荐的"完整可信"口径 |
| 指定日期 | `day` | 该日全天 | 未来可扩展为日历选择器 |

- `timezone` 固定 `Asia/Shanghai`（可在配置改）。
- 范围必须落在上游限制内：`day` ≤ 31 天、`hour` ≤ 7 天；本插件只查 1 天，天然满足。

### 8.2 缓存

| 缓存键 | TTL | 备注 |
|---|---|---|
| `usage:{keyLabel}:{day}:{granularity}` | 今天 60s / 历史日 10min | 上游 5 req/s，必须挡 |
| `respack:month` | 10min | 数据日更 |
| `respack:packages` | 30min | 数据日更 |
| `respack:detail:{orderHash}:{poId}` | 30min | 按需 |
| `keys:{day}` | 5min | 从用量响应派生，可与 usage 共用一次请求 |

- 手动刷新（`/refresh`）**跳过 TTL 强制重取**。
- 只缓存**聚合结果**，不缓存原始响应体，不落盘。
- 缓存上限（LRU，例如 200 条）防止长跑内存增长。

### 8.3 single-flight 与限速

- **single-flight**：相同缓存键的并发请求合并为一次上游调用，全部等待同一个 Promise。
- **全局限速**：所有上游请求经过一个串行队列，相邻请求间隔 ≥ 250ms（对应 5 req/s 并留余量）；用量与资源包共用该队列。
- `/overview` 内两个数据源**并发发起**（但受同一队列节流），失败互不影响。

### 8.4 HTTP 客户端

- 超时 10s（`AbortSignal.timeout`）。
- 重试：`429` / `5xx` 最多 2 次（500ms、1.5s + 抖动）；`400` / `401` **不重试**。
- `User-Agent: dsh-qiniu-usage/<version>`。
- 双外壳解析：`api.qnaigc.com` 判 `status`，`api.qiniu.com` 判 `code === 0`。
- 分页：`respack/list` 与 `month-overview` 默认 `page_size=20`，本插件显式传 `page_size=200` 并循环取页直到不足一页（上限 5 页防跑飞）。

### 8.5 错误处理

| 上游情况 | 用户可见文案 |
|---|---|
| 用量 401、用量 `UNAUTHENTICATED`、资源包 401 | "AK/SK 无效或已过期" |
| 资源包 `code=1013` 或 403 | "该 AK 没有账单权限：请在七牛控制台 IAM 授予财务权限，或仅查看用量" |
| 资源包 `1009/1010/1011/1012` | 对应"当月概览/资源包列表/详情/历史抵扣"获取失败 + 错误码 |
| 用量 400 | 回显上游 `error` 原文（时区/范围错误通常一眼可读） |
| 网络超时 / 5xx | "上游暂时不可用，已重试 N 次" + 上次成功时间 |
| 未配置 AK/SK | 空状态卡片 + "去配置"按钮，直接聚焦凭据表单 |

---

## 9. GUI 设计

### 9.1 位置与注册

```ts
ctx.slots.register({
  name: 'settings.section',
  id: 'qiniu-usage',
  order: 152,                              // 紧跟「使用统计」(151)
  label: () => ctx.locale.bind(NS)('qiniu.title'),
  locale: NS,
  inject: face,
}, QiniuUsageSection)
```

### 9.2 布局

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
│ 逐包：10TB 包年  ▇▇▇░ 31%  ·  剩余 128 天  ·  2026-07-01 到期│
└─────────────────────────────────────────────────────────────┘
```

### 9.3 交互与状态

- **Key 选择器**：数据来自 `/keys`；顶级选项"全部 Key（汇总）"。
- **日期选择器**：今天 / 昨天 / 具体日期。
- **刷新按钮**：走 `POST /refresh`，按钮进入 loading，完成后更新"12:04:31"。
- **凭据表单**：表头只读展示键名（`QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY`），下方才是值输入框（AK 明文、SK password）；提交后**立即清空输入框**，只显示 `已保存 · 来源：凭据库` 或 `来源：环境变量 QINIU_ACCESS_KEY · 只读`；AK/SK 各自带"清除"。详见 §10.2 的"ref 是键名，不是值"。
- **空状态**：未配置凭据 / 当日无用量 / 无资源包，各有独立文案与引导。
- **错误状态**：按 §8.5 分源展示，用量与资源包不互相遮蔽。
- **加载状态**：骨架屏；已有数据刷新时保留旧数据 + 顶部细进度条（避免闪空）。
- **i18n**：`locale.register(NS, { zh, en })`，默认跟随界面语言。
- **样式**：只用宿主主题 token（`--dsw-alias-*`），不引入 UI 库、不引 Tailwind，保持与现有设置页一致。

---

## 10. 配置与凭据

### 10.1 设置命名空间 `dsh-qiniu-usage`

```ts
const Config = z.object({
  enabled: z.boolean().default(true),

  // 凭据引用（不是值）
  accessKeyRef: z.string().default('QINIU_ACCESS_KEY'),
  secretKeyRef: z.string().default('QINIU_SECRET_KEY'),

  // 可选：用于 Bearer 精确查询单个 Key
  apiKeys: z.array(z.object({
    label: z.string(),
    tokenRef: z.string(),
  })).default([]),

  defaultKey: z.string().default(''),
  defaultDay: z.string().default('today'),

  usageBaseUrl: z.string().default('https://api.qnaigc.com'),
  financeBaseUrl: z.string().default('https://api.qiniu.com'),
  timezone: z.string().default('Asia/Shanghai'),

  todayTtlSec: z.number().min(10).max(600).default(60),
  dashboardTtlSec: z.number().min(60).max(3600).default(600),
  pollIntervalSec: z.number().min(0).max(3600).default(0),  // 0 = 纯手动刷新
})
```

通过 `settings.installSection(ctx, 'dsh-qiniu-usage', Config, config, { setSource })` 安装，`setSource` 触发热更新。

### 10.2 凭据读写

使用 `ctx.credentials`：

| 操作 | API | 说明 |
|---|---|---|
| 读值 | `await resolve(ref)` → `ResolvedCredential \| undefined`（`{ value, source }`） | 仅宿主内存中使用 |
| 查状态 | `await describe(ref)` → `CredentialInfo`（`{ configured, source?, writable }`） | **这是唯一允许回传浏览器的形状** |
| 写入 | `await set(ref, value)` | 当环境变量等只读源遮蔽该 ref 时**会拒绝** → UI 显示"来自环境变量，只读" |
| 清除 | `await unset(ref)` | 同上遮蔽规则 |

> 四个方法**全部返回 Promise**，路由 handler 必须 `await`。`CredentialInfo` 里没有任何能承载 value 的槽位，这正是它可以安全跨 Remote 线的原因。

**ref 是键名，不是值**（`CredentialRef` = brand 过的 POSIX 环境变量名，`credentialRef()` 的契约即 `QINIU_ACCESS_KEY` 这种形态）。所以 GUI 表单是**两层**语义：

- **键名**（`accessKeyRef` / `secretKeyRef`，来自 config，默认 `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY`）→ 表单上只读展示，不做成可编辑输入框；
- **值**（AK/SK 明文）→ 才是输入框，提交进 `set(ref, value)`。

文案不能写成裸的「AccessKey / SecretKey」，否则用户会以为输入框里的内容就是 AK 本身。

- 凭据在**每次上游调用时** `resolve` 一次，因此轮换密钥下一次请求即生效，无需重启。
- 缺 `credentials` 服务时，降级为 `process.env[ref]` 直读，此时 `writable=false`、UI 表单置灰。
- 不把 AK/SK 写入插件自己的配置文件，也不落盘。

---

## 11. 安全

1. **浏览器永不接触密钥**：AK/SK 只在宿主进程内存中出现；client bundle 里没有任何密钥读取路径；路由只回传 `describe()` 形状。
2. **loopback fence**：所有路由校验 socket 回环 + 回环 Host + 同源；不信任 `X-Forwarded-For`；`cache-control: no-store`。
3. **日志脱敏**：任何日志/错误信息中的 Key 统一渲染为 `sk-xx*****xx`；AK 只显示前 4 位；**绝不打印 SK**。
4. **错误透传有界**：上游错误信息透传前截断（≤ 300 字符）并剥离可能出现凭据的片段。
5. **磁盘零凭据**：本期不落盘；若将来加趋势快照，`$DSH_HOME/dsh-qiniu-usage/` 下只存聚合数值。
6. **写操作最小化**：`/credentials` 只写凭据库，不写任意路径；body 校验 ref 白名单（只允许 config 声明的 ref）。

---

## 12. 里程碑与验收

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **M0** | 脚手架：package.json / cordis.patch.yml / tsconfig / tsdown + `sign.ts` + 固定向量测试 | 签名器通过 §3.2 的固定向量；空插件能被 `dsh web` 加载不报错；`lib/client.js` 产出 `window.__ModuleLoader__.load` 形态（见 §13.1，形态已核实） |
| **M1** | `http.ts` + `usage.ts`（3 形态归一）+ `/overview` 的 usage 部分 + `/keys` | 三形态 fixture 归一结果一致；curl 路由返回真实当天数据；水位线与延迟告警正确 |
| **M2** | `respack.ts`（month-overview + list 分页 + detail）+ `/overview` 的 respack 部分 | 当月利用率、逐包已用/到期、下钻均可用；`1009`-`1013` 映射为可读提示 |
| **M3** | 客户端 `settings.section`：用量表 + 资源包进度条 + Key/日期选择器 + 刷新 | 面板可用；切 Key / 切日期 / 刷新都正确；关页后无请求 |
| **M4** | 凭据路由 + `CredentialsForm` + 缓存/single-flight/限速 + 错误态 + i18n | AK/SK 可在 GUI 填写并生效；环境变量只读场景正确；401/1013 文案正确 |
| **M5** | 真实账号联调 + 测试补全 + README | G1/G2 端到端通过；`pnpm test` 全绿 |

### 12.1 验证方式

- **单元测试**（vitest，不依赖外网）：签名固定向量、3 种用量响应形态、2 种资源包响应、错误码映射、缓存/single-flight 行为。
- **产物契约测试**（`test/bundle.test.ts`）：把"空插件能被 `dsh web` 加载"这条验收标准落到可在 CI 跑的断言上 —— 宿主产物必须导出 `name`/`inject`/`apply`/`Config`，客户端产物必须在受控 `vm` 上下文里注册 `__ModuleLoader__` 并交出 `apply`/`inject`，且源码里不得出现任何凭据读取路径。
- **联调脚本**：`scripts/smoke.mjs`，AK/SK 从环境变量读，打印归一后的快照；永不写入仓库。
- **安装流程**：
  ```bash
  dsh plugin --profile web add link:~/dsh-plugins/dsh-qiniu-usage
  ```
  已核对 CLI 实现（`lib/plugin-*.js`）：`dsh plugin add` 会检测依赖是否声明
  `dsh.bundle.patch`，**自动**把该包写进 profile 的 `dsh.profile.bundles`，
  **不需要**手工编辑 profile 的 patch 层。之后：
  - 宿主半区改动 → 重启 `dsh web`
  - 客户端半区改动 → 重新 `build` 后刷新页面
  - profile 的 `patchReload: live` 只对 patch 文件生效，宿主代码改动仍建议重启。

### 12.2 Definition of Done

- [ ] 设置页出现「七牛云用量」分区，位置在「使用统计」之后
- [ ] 能查今天（带延迟告警）、昨天、指定日期的各模型用量
- [ ] 能按 Key 筛选，且"全部 Key 汇总"可用
- [ ] 能看当月资源包利用率 + 逐包已用/总量/到期
- [ ] AK/SK 可在 GUI 内填写、更新、清除，界面永不回显明文
- [ ] 用量与资源包任一失败时另一部分仍可读，错误文案可定位
- [ ] `pnpm test` 覆盖签名/归一/错误映射，全绿
- [ ] README 说明安装、配置、已知限制

---

## 13. 风险与待验证

### 13.1 客户端 bundle 构建格式（已核实，风险降级为常规工作）

`lib/client.js` 必须是 **`window.__ModuleLoader__.load({ id, factory })`** 形态的自包含产物，React 通过 `require("react")` 走宿主冻结模块表（`PLATFORM_MODULES`）。

**已在本机核实**：`@linxin666/dsh-usage/lib/client.js` 与 `dsh-feng-gu/lib/client.js` 两个产物是**同一模板**（`var module = { exports: {} }` + `factory: (require) => {...}` + `Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })`），差异只在 rolldown/tsdown 的运行时片段。

- 两者的**构建配置未随包发布**，所以这层 wrapper 仍需自己产出（tsdown 的 `output.format` 或一个薄包装脚本）。
- `haste` 提示：`dsh-usage` 随包发布了 `src/`，可直接照抄其 `factory` 外壳与 `require("react")` / `require("react/jsx-runtime")` 取值方式。
- M0 仍应先跑通 `lib/client.js`（哪怕是空面板）再投入 M3，但**不再是"最高风险"**。

### 13.1.1 `host/loopback.ts` 与 `host/http.ts` 应照抄而非重写

`@linxin666/dsh-usage/src/host/loopback.ts` 的文件头注释明确写明它是 `scripts/sync-shared.mjs` 生成的**家族共享副本**（family bundle 内各插件共用一份）。语义为 RFC 5735 IPv4 127/8、`::1`、IPv4-mapped `::ffff:127/8`、localhost hostname，加浏览器同源标记（`sec-fetch-site`、`Origin`）。

因此这两个文件**直接以 dsh-usage 的版本为蓝本**，不要另写一套判定逻辑——安全围栏的语义漂移是最不该出现的东西。`mount-once.ts` 同理（它用 global symbol 让 npm 副本与仓库 link 共享同一判定）。

### 13.2 其他待验证项

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| 1 | 用量响应 `unit` 实际值（文档样例为 `kToken`，真实值待确认） | 数量级错误 | 以 `unit` 字段为准自适应；UI 标注单位；与官方控制台对数 |
| 2 | `api_key` query 参数的过滤语义未验证 | 无（设计不依赖） | 不使用该参数，用本地筛选 |
| 3 | 当天数据延迟程度未知 | 用户误判 | 常驻告警 + 水位线 + 默认也提供昨天口径 |
| 4 | AK 可能没有账单/财务权限 | G2 不可用 | 降级为"仅用量"模式 + 明确引导 |
| 5 | 资源包 `used_amount`（生命周期）与 `month_used`（当月）口径不同 | 误读利用率 | 两处分别标注口径 |
| 6 | 零用量 Key 无法从上游枚举 | 选择器不全 | 允许在配置里登记 Key 名称 |
| 7 | 客户端 HMR 需要 DSH checkout 里跑 `pnpm run dev:web` | 开发体验 | 开发期用 watch 构建 + 手动刷新 |
| 8 | `dsh.client.inject` 误填服务名（裸名）会被**静默忽略**，不报错 | 客户端依赖未按序加载 | 填包名或省略该字段；见 §4.2 |
| 9 | 缺 `webUiSettings` 兼容 binder 时 `ctx.settingsScope` 可能不存在 | 客户端半区崩溃 | `ctx.get('webUiSettings') ?? ctx.settingsScope`；见 §4.2 |
| 10 | 把 `CredentialRef` 当成"值"做输入框 | 交互设计错误、用户填错 | 键名只读 + 值输入框两层；见 §10.2 |

---

## 14. 附录：实现检查清单

**签名器**
- [x] `Host` 不含端口
- [x] query 串只构造一次，签名与请求共用
- [x] `+08:00` 编码为 `%2B08:00`
- [x] GET 不带 `Content-Type`
- [x] `urlsafe_base64` 保留 `=` 填充
- [x] 固定向量测试通过
- [x] body 仅在设置了 `Content-Type` 且非 `application/octet-stream` 时参与签名

**用量归一**
- [ ] Bearer 形态（`data[] = models[]`）
- [ ] AK/SK RFC3339 形态（`data[] = { api_key, name, models[] }`）
- [ ] AK/SK `YYYY-MM-DD` 扁平形态（`items[].values[]`，无 `categories`）
- [ ] `unit` 自适应换算
- [ ] 计费项归类到 输入/输出/缓存/其他
- [ ] 模型按 total 降序

**资源包归一**
- [x] `month-overview` 分页循环
- [x] `list` 分页循环 + 显式 `page_size=200`
- [x] `status` / `carry_over_policy` 文案映射
- [x] `daysRemaining` 计算（按东八区日期）
- [x] `code != 0` → 错误码文案表
- [x] `deduct_amount` 字符串与数字两种形态都接受
- [x] 分页触顶（>5 页）时给出告警而不是静默截断

**宿主**
- [x] 路由全部 loopback-fenced（含凭据路由）
- [x] 缓存键含 day/key/granularity
- [x] single-flight 合并并发
- [x] 全局上游限速 ≥250ms
- [x] 用量与资源包失败隔离
- [x] 卸载时 dispose 路由与定时器
- [x] 凭据引用白名单校验（不能写任意路径）

**客户端**
- [x] `settings.section` order 152
- [x] 轮询挂载周期，关页零请求
- [x] 凭据表单提交后清空、只回显 describe
- [x] 空/错/加载三态齐备
- [x] 只用主题 token 配色
- [x] 刷新时保留旧数据 + 顶部细进度条（不闪空）
- [x] 用量与资源包错误分源展示
- [x] 超过 20 个模型折叠为"其余 N 个模型合计"

---

## 15. M0 实现记录：文档没预见到、但真会卡住的四点

以下都是 M0 落地时由编译器/测试**当场抓出来**的，已写进代码与测试；记录在此，
供 M1–M5 复用，避免重复踩。

### 15.1 Base64URL 必须保留 `=` —— 否则所有请求 401

七牛的 `encodedSign` 带 `=` 填充（官方固定向量以 `=` 结尾）。而 Node 的
`Buffer#toString('base64url')` **会剥掉填充**，两者是不同字符串：

```
Buffer#toString('base64url')  →  1uLvuZM6l6oCzZFqkJ6oI4oFMVQ    （错）
七牛要求                        →  1uLvuZM6l6oCzZFqkJ6oI4oFMVQ=   （对）
```

正确做法是走 base64 再手工替换字符：`+` → `-`、`/` → `_`，`=` 原样保留。
`test/sign.test.ts` 里有一条"回归：Node 的 base64url 会剥掉 =，不能直接使用"
专门钉住这个差异。

### 15.2 `LocaleNamespaceMap` 必须声明合并，否则客户端编译失败

`ctx.locale.register(NS, ...)` / `ctx.locale.bind(NS)` 的参数类型是
`Extract<keyof LocaleNamespaceMap, string>`，不是 `string`。不注册命名空间会得到
`Type '"dsh-qiniu-usage"' is not assignable to parameter of type 'keyof LocaleNamespaceMap'`。

必须在自己包的 locales 模块里 merge：

```ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'dsh-qiniu-usage': keyof typeof zh }
}
```

配套用 `LocaleDictOf<typeof NS>` 约束 `en`，让双语键集不一致时**编译期**报错
而不是界面上露空文案。

### 15.3 `settings.section` 的 `inject` 是必填的

`sections.register` 的类型要求 options 里必须有 `inject: (actions) => object`，
即使面板当前不消费注入面也得给（`inject: () => ({})`）。组件本身要返回
`ReactNode`，返回 `unknown` 会以 "Type 'unknown' is not assignable to type
'ReactNode'" 的形式报在 register 的调用点上，不好定位。

### 15.4 资源包上游的三个实测事实（已核官方文档 2025-09-10 版）

核对 <https://developer.qiniu.com/af/10420/financial-external-api-documentation> 后确认，
设计文档 §3.3 的**字段名全部正确**，但有三点文档没写清：

1. **`page_size` 上限是 200**（官方原文"默认20，最大不超过200"）。所以必须循环取页，
   且循环要有硬上限 —— 本实现取 {@link MAX_PAGES} = 5，触顶时写入 `warnings`
   而不是静默截断。
2. **`deduct_amount` 文档标 `string`，示例却写数字**，而且官方示例那段 JSON 本身
   有语法错误（`"deduct_amount: 1024` 少了引号）。解析必须两种都吃 ——
   归一函数里用 `toNumber()` 统一处理，测试里两种形态都钉住了。
3. **`month-overview` 也是分页接口**，不能当单页返回处理。

另外：官方示例的请求里带了 `Content-Type: application/x-www-form-urlencoded`，但
GET 带这个头会让签名串多一行。本实现按 §3.2 易错点 3 的做法**不带**，签名器对
GET 永远省略 `Content-Type`。

### 15.5 ⚠ 宿主插件绝不能 `export default`（真实启动失败）

这条是**装进 profile 后 `dsh web` 启动直接崩**换来的，代价最大，所以写在前面。

`cordis-plugin-loader` 在 `_init()` 里这样取插件：

```js
plugin = this.loader.unwrapExports(await this.parent.tree.import(this.options.name, ...))

// unwrapExports：
exports = exports.default ?? exports;
if (!exports.__esModule) return exports;
return exports.default ?? exports;
```

也就是说 **loader 优先取 `default`**。当初 `src/index.ts` 末尾有一句 `export default apply`，
于是 loader 拿到的是那个**裸函数**，整个模块命名空间（含 `export const inject = ['webServer']`
与 `name`）被一并丢弃 → fiber 的 inject 为空 → 插件里第一次读 `ctx.webServer` 就被 cordis 的
服务代理拒绝：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry qiniu-usage
(dsh-qiniu-usage): cannot get property "webServer" without inject
```

**只用具名导出**（`name` / `inject` / `apply` / `Config`），与 `@linxin666/dsh-usage` 一致。

**为什么当时的测试没拦住？** 两个测试各自漏了一半：

1. 产物契约测试只断言"模块导出了什么"，**没走 cordis 的 inject 解析 + 应用**，
   所以 `inject` 存在这件事在测试里恒真。
2. 更糟的是 M0 写的产物测试**把 bug 当成了正确行为**：
   `assert.equal(mod.default, mod.apply, 'default 导出应指向 apply')` —— 断言本身
   在要求这个致命形状存在。

现在补齐了两层：`test/contract.test.ts` 复刻 `unwrapExports` 断言归一后仍带 `inject`；
`test/host-boot.test.ts` 用**真 cordis Context** 提供 `webServer` 桩服务并实际 apply 一次，
断言 6 条路由注册成功、禁用时不注册、卸载时 dispose。后者已用"故意加回 `export default`"
验证过确实会红。

### 15.6 ⚠ 一个路径只能注册一条路由（又一起真实启动失败）

修掉 §15.5 之后再次启动，又崩了 —— 这次是我自己的设计错误：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry qiniu-usage
(dsh-qiniu-usage): webserver: duplicate exact route "/api/dsh-qiniu-usage/credentials"
```

**`WebRoute` 没有 method 字段**：

```ts
export interface WebRoute {
  kind: WebRouteKind
  path: string
  handler: (req, res) => void | Promise<void>
}
```

`register()` 按 `(kind, path)` 唯一，重复注册直接抛。因此 **HTTP 方法分派必须写在
handler 内部**（每个 handler 拥有完整的响应生命周期）—— `dsh-usage` 的 refresh 路由
就是这么做的（handler 内判 `req.method !== 'POST'` → 405）。我当初把
`/credentials` 的 GET 与 POST 拆成了两条路由，这是错的。

修法：合并为一条 `${API_PREFIX}/credentials`，handler 内按 `req.method` 分派
（GET → describe，POST → set/unset，其余 → 405）。

**为什么原测试又没拦住？** 和 §15.5 同源：测试里也把这个错误当成了预期。

- `host-boot.test.ts` 的期望路径数组里，我把 `/credentials` **写了两遍**，
  于是"6 条路由"看起来正常；
- `contract.test.ts` 只断言 `paths.includes(expected)` 与 `paths.length >= 6`，
  重复项完全不影响这两条断言。

现在补了一条直接针对该不变量的测试：**遍历 `(kind, path)` 断言无重复**，并已用
"故意重复注册"反证过会红（报 `[["exact /api/dsh-qiniu-usage/credentials",2]]`）。
`host-boot.test.ts` 也加上了 `new Set(paths).size === paths.length`。

**教训**：测试若只断言"存在"而不断言"唯一"，就无法覆盖会拒绝重复的注册表。

### 15.7 构建工具链：esbuild + 手写 ModuleLoader 外壳

`tsdown` 的 output 形态无法直接产出 `window.__ModuleLoader__.load({...})`，
且参考包**都没发布构建配置**。M0 的解法是用 esbuild（打成 CJS）+ 一个薄包装
（`scripts/build.mjs`），并**在构建后自检 7 项契约**（`verifyClientBundle`），
形态一旦漂移就让构建失败，而不是等到浏览器里才发现。

宿主半区则相反：对照参考产物确认其**无任何外部 `require`**，因此 esbuild 用
`external: []` 打成自包含 ESM，避免在 profile 环境里因依赖解析失败而装不上。

产物体积对照：本插件客户端 bundle **4.5 KB**（dsh-usage 为 374 KB）—— 面板只做
表格与进度条，样式只用主题 token，这个量级是合理的。

