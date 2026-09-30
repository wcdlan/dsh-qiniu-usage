# dsh-qiniu-usage

[English](README.md) | 中文

一个 [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI 插件，接入
[七牛云](https://www.qiniu.com/)。它让你不必离开浏览器就能回答两个问题：

- **今天各模型花了多少？** —— 指定单个 API Key 或整个账号的各模型 Token 用量
  （输入 / 输出 / 合计），可查今天、昨天或任意历史日期。
- **这个月资源包还剩多少？** —— 各计费项当月可用 / 已用 / 剩余，以及逐包的已用量与
  到期时间。

它以**设置页的「七牛云用量」分区**呈现，并在**左侧栏会话列表的下方**常驻一张速览卡片
（形态与宿主自带的「今日用量」卡一致）：收起时是一行当日总量，点开只给**模型用量**
缩略，详细的资源包信息再点卡片里的「详情」按钮。插件对七牛是**只读**的 —— 不会创建、
修改或产生任何计费。

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

左侧栏底部那张卡片长这样（收起 / 展开）：

```
│ 会话 11 …                                                   │
│ 会话 12 …                                                   │
├ 今日用量（宿主自带）                       2.18M tokens  ∧   ┤
├ 📊 今日用量                               11.63M tokens  ∧   ┤   ← 收起：一行速览
├ 📊 今日用量                               11.63M tokens  ∨   ┤   ← 展开：点一下
│   deepseek/deepseek-v4.1-flash                 117.77M      │
│   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇        │
│   deepseek/deepseek-v3.2                         21.5M      │
│   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇        │
│   其余 1 个模型合计 310.1K                                  │
│   [详情] [刷新]                     更新于 12:04:31          │   ← 「详情」才给包信息
├ ⚙ 设置                                                      ┤
```

## 状态

| | |
|---|---|
| 已实现 | 签名、用量归一、资源包、设置页面板、凭据表单、侧栏速览卡片 |
| 测试 | 352 项通过 / 17 个文件（`npm test`） |
| 尚未完成 | **用真实七牛账号跑一遍端到端联调** —— 本插件里所有上游事实都来自官方文档与 fixture。若真实数据下有出入，[`scripts/smoke.mjs`](#用真实账号联调) 就是暴露问题的工具。 |

界面提供中英文，并跟随宿主主题。

## 环境要求

| | |
|---|---|
| DSH | `>= 0.1.5-rc.1`（`dsh --version`） |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Profile | 任意会启动 Web 应用的 profile，通常是 `web` |
| 七牛 | 一对 **AccessKey / SecretKey**。只有 `sk-` token 不够：资源包（财务）接口只接受管理凭证。 |

## 安装

本包**未发布到 npm** —— 请从本地检出安装。
[`dsh plugin`](https://github.com/deepseek-ai/deepseek-harness) 是一个很薄的 `pnpm`
转发器：它在 profile 目录里执行 pnpm，然后自动把 profile 的 bundle 列表对齐到实际
安装状态。

### 1. 构建插件

运行时产物在 `lib/`，而它**不在 git 仓库里**：

```bash
cd /path/to/dsh-qiniu-usage
npm install
npm run build          # → lib/index.js、lib/client.js、lib/types/**
```

`npm test` 可跑可不跑，但很便宜（约 1 秒）—— 想先确认这份检出是健康的，就跑一下。

### 2. 注册到 profile

```bash
dsh plugin --profile web add link:/path/to/dsh-qiniu-usage
```

安装到这一步就结束了。它背后做了三件事：

1. `pnpm add` 把依赖写进 `$DSH_HOME/profiles/web/package.json`。
2. CLI 发现该包声明了 `dsh.bundle.patch`（`./cordis.patch.yml`），于是**自动把它
   追加进 `dsh.profile.bundles`** —— 不需要手工编辑 profile 的 patch 层。
3. 下次启动时，Web shell 会发现该包的 `dsh.client` 声明，把
   `exports["./client"]` 挂到 `/plugins/<id>/client.js`。**web-app 不需要重建。**

### 3. 重启

```bash
dsh web          # 或：dsh --profile web
```

打开 **设置 → 七牛云用量**。如果分区没出现，见[排错](#排错)。

### 其他安装来源

`add` 接受 pnpm 支持的任何形态，且 bundle 列表在所有情况下都是按**真实的包名**
对齐的：

```bash
# 本地检出 —— 软链，重新构建后能吃到改动（推荐）
dsh plugin --profile web add link:/path/to/dsh-qiniu-usage

# 复制而非软链（改动不会同步）
dsh plugin --profile web add file:/path/to/dsh-qiniu-usage

# 打包好的 tarball —— 先 build 再 pack
cd /path/to/dsh-qiniu-usage && npm run build && npm pack
dsh plugin --profile web add /path/to/dsh-qiniu-usage-<version>.tgz

# 直接从 git 远端装（⚠ lib/ 被 gitignore，见下）
dsh plugin --profile web add git+https://git.nagioa.cn/EntropyCrop/dsh-qiniu-usage.git
```

> ⚠ **从 git 装会拿不到 `lib/`。** 仓库只提交 `src/`，而本包没有 `prepare` 脚本，
> 所以 pnpm 装出来的包里 `main`（`lib/index.js`）并不存在 —— 插件不会加载。请先自己
> 构建：
>
> ```bash
> git clone https://git.nagioa.cn/EntropyCrop/dsh-qiniu-usage.git ~/dsh-qiniu-usage
> cd ~/dsh-qiniu-usage && npm install && npm run build
> dsh plugin --profile web add link:$PWD
> ```
>
> 用 `npm pack` 出来的 tarball 没这个问题，因为打包前已经跑过 `npm run build`。

### 手工安装（不用 CLI）

如果你更愿意直接改文件：把依赖加进 `$DSH_HOME/profiles/web/package.json`，并把包名
追加到 `dsh.profile.bundles`，然后执行 `dsh plugin --profile web install`。

<details>
<summary>profile 清单应该长什么样</summary>

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
        // … 其他 bundle …
        "dsh-qiniu-usage"
      ],
      "patchReload": "live"
    }
  }
}
```

bundle 名必须与包的 `name` 字段一致 —— 不是路径，也不是 git URL。

</details>

### 更新已安装的插件

```bash
cd /path/to/dsh-qiniu-usage
git pull && npm install && npm run build
dsh web          # 重启
```

用 `link:` 安装时，profile 始终指向同一份检出，因此不需要重新 add。**宿主半区**改动
后重启 `dsh web`；**客户端半区**改动后重新构建并刷新页面即可。

### 卸载

```bash
dsh plugin --profile web remove dsh-qiniu-usage
```

CLI 会移除依赖，并把它从 `dsh.profile.bundles` 中删掉。你通过 GUI 存进 DSH 凭据库的
AK/SK **不会**被一并删除 —— 想清掉的话，先到 **设置 → 七牛云用量 → 凭据** 里清除。

## 配置

插件按**引用名**（POSIX 环境变量名）读取凭据，从不按值读取：

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。关闭时不注册任何路由、不发起任何上游请求 |
| `accessKeyRef` | `QINIU_ACCESS_KEY` | 存放 AccessKey 的条目**名** |
| `secretKeyRef` | `QINIU_SECRET_KEY` | 同上，存放 SecretKey |
| `apiKeys[]` | `[]` | 可选的逐 Key `{ label, tokenRef }`，用于精确查询单个 Key |
| `defaultKey` | `""` | 打开时默认选中的 Key 标签；空串 = 全部 Key（账号汇总） |
| `defaultDay` | `today` | 初始日期口径：`today` / `yesterday` / `YYYY-MM-DD` |
| `timezone` | `Asia/Shanghai` | 上游只接受 IANA 时区名（传 `Local` 会 400） |
| `usageBaseUrl` | `https://api.qnaigc.com` | 大模型用量接口基地址 |
| `financeBaseUrl` | `https://api.qiniu.com` | 资源包 / 财务接口基地址 |
| `todayTtlSec` | `60` | 当天（小时粒度）数据缓存 TTL，秒；`10`–`600` |
| `dashboardTtlSec` | `600` | 历史日与资源包的缓存 TTL，秒；`60`–`3600` |
| `pollIntervalSec` | `5` | 客户端自动刷新间隔，秒；`0` = 纯手动刷新 |
| `sidebarCard` | `true` | 是否显示左侧栏底部的速览卡片；关掉后只保留设置页面板 |

所有字段都有默认值，因此空配置也是合法的。

面板本身提供 Key / 日期选择器、刷新与凭据表单；其余配置项与 DSH 其他插件设置一样，
通过 profile 的插件配置修改（例如在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里加一条
按 id 定位的配置行）。其中 `pollIntervalSec` 与 `sidebarCard` 会**即时生效**，其余
在下次 `dsh web` 启动时生效。

### 两种提供凭据的方式

**A. 环境变量（只读）。** 在启动 `dsh` 的那个环境里导出：

```bash
export QINIU_ACCESS_KEY=...
export QINIU_SECRET_KEY=...
dsh web
```

注意 DSH **不会**自动读取 `.env` 文件 —— 变量名见
[`.env.example`](./.env.example)，复制后自行导出或交给 shell。环境变量来源只能读，
因此 GUI 表单会置灰并显示 `来源：环境变量 QINIU_ACCESS_KEY` 与 `只读`。

**B. GUI 凭据表单。** 在 **设置 → 七牛云用量 → 凭据** 里填 AK / SK 并保存，它们会写进
DSH 凭据库；插件在**每次上游调用时**重新解析，所以**轮换密钥下一次请求即生效，无需
重启**。表单上方只读展示的是**引用名**，下方才是**值**输入框 —— 这正是实际的分工：
配置存名字，凭据库存值。

### 为什么 AK/SK 是必需的

资源包（财务）接口只接受七牛**管理凭证**（AK/SK），`sk-` bearer token 无法访问。因此
AK/SK 是必需项，`apiKeys[]` 只是可选的精度增强，不是主路径。此外财务接口要求 AK 具备
账单 / IAM 财务权限；没有权限时资源包卡片会给出针对性引导，而用量部分照常可用。

## 使用

设置页（**设置 → 七牛云用量**）只做**配置**，用量展示整体在左侧栏的速览卡片里：

- **凭据** —— AccessKey / SecretKey 表单（写入凭据库，值永不回显）。
- **Key 列表** —— 表格列出 `/keys` 拿到的 Key（**名称 / 掩码 / 当日状态**），只做展示。
  这张表本身就是"当前 AK/SK 能不能用、能看到哪些 Key"的答案（它走的是要签名的
  `/keys`）；单 Key 的用量统计去左侧栏卡片 →「详情」的用量栏目里选。
- **自动刷新** —— 刷新间隔（秒），默认 **5**，`0` = 纯手动；写回插件配置并即时生效。
- **提示** —— 时区、缓存 TTL、Key 名单等其余配置在 profile 的插件配置里。

**侧栏速览卡片**常驻在左侧会话列表下方、设置行之上（左侧栏收成图标栏时自动隐藏）。
它有两层：

- **收起（默认）** —— 一行速览：图标 + 标题 + 数值，点一下展开；
- **展开** —— 只放**缩略信息**（用量最大的 3 个模型 + 「其余 N 个模型合计」），
  以及「详情」与「刷新」两个按钮。

**详情弹窗**分两个栏目，导航点击切换：

- **各模型用量** —— 日期（今天 / 昨天）与 Key（全部 Key 汇总 / 单个 Key）两个筛选器，
  各模型输入 / 输出 / 合计表；选具体 Key 时会**自动切到昨天**并说明原因（当天上游
  尚未把用量归属到具体 Key）。
- **资源包利用** —— 当月口径的计费项利用率 + 逐包明细（生命周期口径、抵扣下钻）。

卡片标题跟着筛选走：切到昨天就写「昨日用量」，筛了单个 Key 就补上 Key 名 —— 卡片与
弹窗共用一个 store，不会出现"卡片上的数字其实是某个 Key 的"这种误读。

展开状态按浏览器各自记住（`localStorage` 键 `dsh-qiniu-usage:sidebar-card:expanded`）。
用 `sidebarCard: false` 可以整块关掉。

卡片常驻，因此它在**挂载时取一次数**，之后按 `pollIntervalSec` 轮询（默认 5 秒；`0` =
纯手动，展开态里的「刷新」按钮随取随新）。上游当天数据本身有小时级缓存
（`todayTtlSec`，默认 60 秒），所以界面刷得快不等于上游被打得快。设置页只读凭据状态
与 Key 名册，**不拉用量**。

## 安全与隐私

- **凭据永不进入浏览器。** AK/SK 只存在于宿主进程；客户端 bundle 里不存在任何凭据
  读取路径（由 `test/bundle.test.ts` 断言）。路由只回传
  `{ configured, source, writable }` —— 这个形状里没有任何能放值的槽位。
- **路由全部 loopback-fenced。** 每条路由都校验 socket、Host 与同源，且不信任
  `X-Forwarded-For`；响应一律带 `cache-control: no-store`。
- **日志脱敏。** AccessKey 只显示前 4 位；**SecretKey 绝不打印**。
- **凭据不落盘。** 插件只通过 DSH 凭据库写入，从不写进自己的配置文件。
- **错误透传有界。** 上游错误文本在进入界面之前会被截断，并剥离可能出现凭据的片段。

## 开发

```bash
npm install
npm run build      # lib/index.js、lib/client.js、lib/types/**
npm run check      # tsc --noEmit
npm test           # vitest —— 353 项
```

构建产出两个契约不同的产物，且 `scripts/build.mjs` 在**落盘之前**断言它们 ——
形态一旦漂移就会**构建失败**，而不是等到浏览器里才发现；构建失败也不会留下一个
写坏的 `lib/client.js`：

- `lib/index.js` —— 宿主半区，自包含 ESM。无任何外部 `require`，唯一 import 是
  `node:crypto`。
- `lib/client.js` —— 浏览器半区，自包含的
  `window.__ModuleLoader__.load({ id, factory })` 产物，`react` 是唯一外部依赖。

> **两个半区的 import 不对称。** 宿主可以随便 import；浏览器半区只能从**纯模块**
> 取值（`react`、`src/client/**`、`src/qiniu/usage.ts`）。`src/qiniu/respack.ts`
> 看着是纯函数，实际经 `sign.ts` 摸到 `node:crypto` —— 从它取任何一个值都会让整个
> 客户端产物构建失败。类型导入不受影响。这条边界由 `test/client-graph.test.ts`
> 真跑一次 esbuild 来守。
>
> `npm test` 还会断言 `lib/*.js` **不比它们的输入旧** —— 过期产物不会被当成证据。
> 这条失败时请直接 `npm run build`，不要去翻逻辑 bug。

### 不开浏览器也能看面板

改布局时，把它渲染成 HTML 再截图，而不是盲改 CSS：

```bash
node scripts/preview.mjs
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --disable-crashpad --crash-dumps-dir="$PWD/.tmp/crash" \
  --user-data-dir="$PWD/.tmp/chrome-profile" --virtual-time-budget=2500 \
  --force-device-scale-factor=2 --window-size=820,1500 \
  --screenshot="$PWD/.tmp/shot.png" "file://$PWD/.tmp/preview.html?w=820&diag=1"
```

`preview.mjs` 会生成五份文档：`.tmp/preview.html`（设置页）、
`.tmp/preview-card.html` 与 `.tmp/preview-card-expanded.html`（把速览卡片放进
**模拟的侧栏**里，收起态与展开态各一张）、`.tmp/preview-detail.html` 与
`.tmp/preview-detail-packs.html`（详情弹窗的两个栏目）。后四份带宿主自带的
「今日用量」卡作为对照。

`?w=<px>` 设定模拟的面板宽度 —— 测窄宽度要用它而不是 `--window-size`：Chrome 会把窗口
夹到约 500px，只会把截图右侧裁掉，看着像布局溢出，其实不是。`?diag=1` 列出超出面板
宽度的元素，用来定位是谁撑破了布局。

### 用真实账号联调

```bash
export QINIU_ACCESS_KEY=...
export QINIU_SECRET_KEY=...
node scripts/smoke.mjs                 # 默认查昨天
node scripts/smoke.mjs --day today
node scripts/smoke.mjs --key 我的测试Key
node scripts/smoke.mjs --json          # 输出原始载荷
```

脚本**只从环境变量读凭据**，不写入任何地方。它直接运行 `src/` 下的 TypeScript 源码
（Node 24 原生支持），因此不依赖 `lib/` 构建产物。它会打印归一后的用量与资源包快照。
退出码：`0` 成功、`1` 上游 / 数据失败、`2` 缺凭据。

它也是最快的上游行为验证手段：用故意的假凭据跑一次，就能看到用量接口的鉴权失败是
**HTTP 200 + `{"status":false,"error":"UNAUTHENTICATED"}`** 而不是 401 —— 这正是错误
分类器同时按错误码文本判定的原因。

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 设置页里没有「七牛云用量」分区 | bundle 没进 `dsh.profile.bundles`。确认 `dsh plugin --profile web add …` 成功，然后重启 `dsh web`。 |
| 启动报 `Cannot find module …/lib/index.js` | `lib/` 没构建过（git 安装后最常见）。在检出目录里跑 `npm install && npm run build`。 |
| 启动报 `cannot get property "webServer" without inject` | 同时挂载了两份插件。`dsh.profile.bundles` 里只保留一条；进程内 `mountOnce` 守卫会让第二次挂载变成 no-op，但仍应清掉重复项。 |
| 面板提示宿主半区未启用 | 插件配置里 `enabled` 为 `false`。 |
| 面板能出，但所有数字都是鉴权错误 | 凭据缺失或错误。看「凭据」卡片里的 `configured` / `source`。 |
| 凭据表单是灰的 | 该 ref 由只读来源（环境变量）解析。取消该环境变量并重启，表单才可写。 |
| 资源包卡片报错，用量部分正常 | 该 AK 缺少账单 / IAM 财务权限。 |
| Key 列表是空的 | 名册取不到：凭据没配 / 无效，或该 AK 没有用量查询权限。先在「凭据」里把 AK/SK 存好。 |
| 左侧栏里没有速览卡片 | 先确认插件配置里 `sidebarCard` 不是 `false`；再确认左侧栏是展开（宽）状态 —— 收成 56px 图标栏时卡片会隐藏。若 shell 改了侧栏类名，卡片会暂时找不到落点（宿主升级后重启并刷新一次即可）。 |
| 卡片上的「详情」弹窗被别的浮层盖住 | 弹窗 `z-index` 是 60；宿主的全屏遮罩若更高就会盖住它。 |

## 已知限制

- **单 Key 统计放在详情弹窗里。** 设置页只列出 Key（名称 / 掩码 / 当日状态）；要看单个
  Key 的用量，打开左侧栏卡片的「详情」→ 用量栏目选 Key（会自动切到昨天，因为当天上游
  尚未把用量归属到具体 Key）。
- **零用量的 Key 无法枚举。** 上游用量响应只列出在所查窗口内有用量的 Key，因此某天
  零用量的 Key 不可见（`apiKeys[]` 里登记过的 Key 仍会出现在 `/keys` 名册里）。
- **当天无法按 Key 筛选。** 实测查当天时上游**尚未把用量归属到具体 Key**，只返回唯一
  一个 `api_key: "unknown"` 的聚合分组 —— 这也是「Key 测试」固定查**昨天**的原因：
  只有归属完成后，单 Key 口径才有意义。
- **当天数据有延迟。** 上游文档明确说明；面板常驻告警并显示水位线。要可信的完整数据
  请查**昨天**或指定日期。
- **不使用 `api_key` query 过滤。** 该参数语义未文档化，所以 Key 筛选是"拉全账号 +
  本地筛选"。
- **生命周期口径与当月口径不同。** 资源包的 `used_amount` 是生命周期累计，而
  `month-overview` 的 `month_used` 是当月口径；面板对两者都做了标注。
- **侧栏卡片依赖 shell 的类名。** 卡片容器由插件直接插进 shell 的 `footArea`
  （`[class*=sidebarCol]` / `[class*=footArea]` / `[class*=settingsArea]` 子串匹配）——
  侧栏底部唯一的扩展位 `sidebar.footer.action` 是一条 flex 行，放不下整块卡片。shell
  若改了这些类名，卡片会暂时找不到落点（不报错，靠 body 级观察者等它出现）。
- **详情弹窗的 z-index。** 弹窗用 `position: fixed`、`z-index: 60`；宿主的全屏遮罩若
  高于它就会盖住弹窗。
- **需要账单权限。** 财务 API 要求 AK 具备账单 / IAM 财务权限。没有权限时资源包卡片
  给出针对性引导，用量部分照常可用。

## 文档

- [`DESIGN.md`](./DESIGN.md) —— 完整设计记录：上游接口事实、签名易错点、路由契约、
  数据模型、缓存与限速、里程碑、风险清单，以及实现期真实踩过的坑。动手前请先读。
- [`NOTICE`](./NOTICE) —— 改编自家族共享源码的归属声明。

## 许可

Apache-2.0，见 [`LICENSE`](./LICENSE) 与 [`NOTICE`](./NOTICE)。
