# dsh-qiniu-usage

[English](README.md) | 中文

一个 [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI 插件，接入
[七牛云](https://www.qiniu.com/)。它让你不必离开浏览器就能回答两个问题：

- **今天各模型花了多少？** —— 指定单个 API Key 或整个账号的各模型 Token 用量
  （输入 / 输出 / 合计），可查今天、昨天或任意历史日期。
- **这个月资源包还剩多少？** —— 各计费项当月可用 / 已用 / 剩余，以及逐包的已用量与
  到期时间。

它以**设置页的「七牛云用量」分区**呈现，并在**左侧栏会话列表的下方**常驻一张速览
卡片。插件对七牛是**只读**的 —— 不会创建、修改或产生任何计费。界面提供中英文，并跟随
宿主主题。

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/settings.png">
    <img src="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/settings-light.png" width="520" alt="设置 → 七牛云用量">
  </picture>
  <br>
  <sub><b>设置 → 七牛云用量</b> · 凭据、Key 名册与自动刷新</sub>
</div>

<div align="center">
  <table>
    <tr>
      <td align="center" valign="top">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/details-model.png">
          <img src="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/details-model-light.png" height="440" alt="详情 · 各模型用量">
        </picture>
        <br>
        <sub><b>详情 · 各模型用量</b><br>日期 / Key 筛选与逐模型输入 / 输出 / 合计</sub>
      </td>
      <td width="28">&nbsp;</td>
      <td align="center" valign="top">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/details-respack.png">
          <img src="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/details-respack-light.png" height="440" alt="详情 · 资源包利用">
        </picture>
        <br>
        <sub><b>详情 · 资源包利用</b><br>当月口径利用率与逐包明细</sub>
      </td>
    </tr>
  </table>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/sidebar-card.png">
    <img src="https://raw.giteeusercontent.com/wcdlan/dsh-qiniu-usage/raw/main/img/sidebar-card-light.png" width="400" alt="侧栏速览卡片">
  </picture>
  <br>
  <sub><b>侧栏速览卡片</b> · 收起时一行，展开给用量最大的 3 个模型与
  <b>详情</b> / <b>刷新</b></sub>
</div>

## 环境要求

| | |
|---|---|
| DSH | `>= 0.1.5-rc.1`（`dsh --version`），且所在 profile 会启动 Web 应用，通常是 `web` |
| Node | `^22.19.0 \|\| >=24.0.0` |
| 七牛 | 一对 **AccessKey / SecretKey**。只有 `sk-` token 不够：资源包（财务）接口只接受管理凭证，且要求该 AK 具备账单 / IAM 财务权限。没有权限时资源包卡片会给出针对性引导，用量部分照常可用。 |

## 安装

本包**未发布到 npm** —— 请从本地检出安装。`lib/` 不在 git 仓库里，所以要先构建：

```bash
cd /path/to/dsh-qiniu-usage
npm install && npm run build
dsh plugin --profile web add link:$PWD
dsh web
```

打开 **设置 → 七牛云用量**。安装到这一步就结束了。

`dsh plugin` 是一个很薄的 `pnpm` 转发器，在 profile 目录里执行。它把依赖写进
`$DSH_HOME/profiles/web/package.json`，并因为该包声明了 `dsh.bundle.patch`，自动把包名
追加进 `dsh.profile.bundles` —— 不需要手工编辑 patch 层，**web 应用也不会被重建**
（shell 会发现 `dsh.client` 声明并把 `exports["./client"]` 挂到
`/plugins/<id>/client.js`）。

<details>
<summary>其他安装来源、更新、卸载</summary>

```bash
# 复制而非软链（改动不再同步）
dsh plugin --profile web add file:/path/to/dsh-qiniu-usage

# 打包好的 tarball
cd /path/to/dsh-qiniu-usage && npm run build && npm pack
dsh plugin --profile web add /path/to/dsh-qiniu-usage-<version>.tgz

# 更新
cd /path/to/dsh-qiniu-usage && git pull && npm install && npm run build && dsh web

# 卸载
dsh plugin --profile web remove dsh-qiniu-usage
```

用 `git+…` 安装会拿不到 `lib/`，而本包没有 `prepare` 脚本，插件不会加载 —— 请先自行
构建，再用 `add link:$PWD`。

不用 CLI 也可以：把依赖加进 `$DSH_HOME/profiles/web/package.json`，并把包名（要与包的
`name` 字段一致，不是路径或 git URL）追加到 `dsh.profile.bundles`，然后执行
`dsh plugin --profile web install`。

卸载会移除依赖与 bundle 条目，但你通过 GUI 存进 DSH 凭据库的 AK/SK **不会**被一并
删除。想清掉的话，先到 **设置 → 七牛云用量 → 凭据** 里清除。

用 `link:` 安装时 profile 始终指向同一份检出。**宿主半区**改动后重启 `dsh web`；
**客户端半区**改动后重新构建并刷新页面即可。

</details>

## 配置

### 凭据

插件按**引用名**（POSIX 环境变量名）读取凭据，从不按值读取。两种提供方式：

**A. 环境变量（只读）。** 在启动 `dsh` 的那个环境里导出：

```bash
export QINIU_ACCESS_KEY=...
export QINIU_SECRET_KEY=...
dsh web
```

DSH **不会**自动读取 `.env` 文件 —— 变量名见 [`.env.example`](./.env.example)。环境变量
来源只能读，因此 GUI 表单会置灰并显示 `来源：环境变量 QINIU_ACCESS_KEY · 只读`。

**B. GUI 凭据表单。** 在 **设置 → 七牛云用量 → 凭据** 里填 AK / SK 并保存，它们会写进
DSH 凭据库；**轮换密钥下一次请求即生效，无需重启**。表单上方只读展示的是**引用名**，
下方才是**值**输入框 —— 这正是实际的分工：配置存名字，凭据库存值。

### 配置项

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。关闭时不注册任何路由、不发起任何上游请求 |
| `accessKeyRef` | `QINIU_ACCESS_KEY` | 存放 AccessKey 的条目**名** |
| `secretKeyRef` | `QINIU_SECRET_KEY` | 同上，存放 SecretKey |
| `timezone` | `Asia/Shanghai` | 上游只接受 IANA 时区名（传 `Local` 会 400） |
| `pollIntervalSec` | `5` | 客户端自动刷新间隔，秒；`0` = 纯手动刷新 |
| `sidebarCard` | `true` | 是否显示左侧栏底部的速览卡片；关掉后只保留设置页面板 |

所有字段都有默认值，因此空配置也是合法的。其余项（`apiKeys[]`、`defaultDay`、
`defaultKey`、缓存 TTL、接口基地址）见 [`DESIGN.md`](./DESIGN.md) §10.1。

这些配置与 DSH 其他插件设置一样，通过 profile 的插件配置修改。其中
`pollIntervalSec` 与 `sidebarCard` 会**即时生效**，其余在下次 `dsh web` 启动时生效。

## 使用

设置页只做**配置** —— 凭据表单、Key 名册（**名称 / 掩码 / 当日状态**，只做展示；这张表
本身就是"当前 AK/SK 能不能用、能看到哪些 Key"的答案），以及自动刷新间隔。

**侧栏速览卡片**常驻在左侧栏底部（左侧栏收成 56px 图标栏时自动隐藏）。收起时是一行：
图标 + 标题 + 当日数值；展开后给用量最大的 3 个模型与「其余 N 个模型合计」一行，以及
「详情」与「刷新」两个按钮。

**详情弹窗**分两个栏目，点击导航切换：

- **各模型用量** —— 日期（今天 / 昨天）与 Key（全部 Key 汇总 / 单个 Key）两个筛选器，
  各模型输入 / 输出 / 合计表。
- **资源包利用** —— 当月口径的计费项利用率 + 逐包明细。

卡片标题跟着筛选走：切到昨天就写「昨日用量」，筛了单个 Key 就补上 Key 名 —— 卡片与
弹窗共用一个 store，不会出现"卡片上的数字其实是某个 Key 的"这种误读。展开状态按浏览器
各自记住（`localStorage` 键 `dsh-qiniu-usage:sidebar-card:expanded`）。

## 安全与隐私

- **凭据永不进入浏览器。** AK/SK 只存在于宿主进程；路由只回传
  `{ configured, source, writable }` —— 这个形状里没有任何能放值的槽位。
- **路由全部 loopback-fenced。** 每条路由都校验 socket、Host 与同源，不信任
  `X-Forwarded-For`，响应一律带 `cache-control: no-store`。
- **日志脱敏。** AccessKey 只显示前 4 位；**SecretKey 绝不打印**。凭据只通过 DSH 凭据库
  写入，从不写进插件自己的配置文件。

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 设置页里没有「七牛云用量」分区 | bundle 没进 `dsh.profile.bundles`。确认 `dsh plugin --profile web add …` 成功，然后重启 `dsh web`。 |
| 启动报 `Cannot find module …/lib/index.js` | `lib/` 没构建过。在检出目录里跑 `npm install && npm run build`。 |
| 启动报 `cannot get property "webServer" without inject` | 同时挂载了两份插件。`dsh.profile.bundles` 里只保留一条。 |
| 面板能出，但所有数字都是鉴权错误 | 凭据缺失或错误。看「凭据」卡片里的 `configured` / `source`。 |
| 资源包卡片报错，用量部分正常 | 该 AK 缺少账单 / IAM 财务权限。 |
| Key 列表是空的 | 名册取不到：凭据没配 / 无效，或该 AK 没有用量查询权限。 |
| 左侧栏里没有速览卡片 | `sidebarCard` 为 `false`，或左侧栏收成了 56px 图标栏。 |
| 卡片上的「详情」弹窗被别的浮层盖住 | 弹窗 `z-index` 是 60；宿主的全屏遮罩若更高就会盖住它。 |

## 已知限制

- **当天无法按 Key 筛选。** 上游尚未把当天的用量归属到具体 Key，只返回唯一一个
  `api_key: "unknown"` 的聚合分组。因此 Key 名册取自「最近 30 天、截止昨天」的窗口；
  在查看当天时选中某个 Key，界面会明确说明这些数字是账号汇总口径。要看单 Key 数据请查
  **昨天**或更早。
- **当天数据有延迟。** 面板常驻告警并显示水位线。
- **零用量的 Key 无法枚举。** 上游用量响应只列出在所查窗口内有用量的 Key。
- **生命周期口径与当月口径不同。** 资源包的 `used_amount` 是生命周期累计，而
  `month-overview` 的 `month_used` 是当月口径；面板对两者都做了标注。
- **侧栏卡片依赖 shell 的类名。** 卡片容器由插件直接插进 shell 的 `footArea`
  （`[class*=sidebarCol]` / `[class*=footArea]` / `[class*=settingsArea]` 子串匹配）——
  侧栏底部唯一的扩展位 `sidebar.footer.action` 是一条 flex 行，放不下整块卡片。shell
  若改了这些类名，卡片会暂时找不到落点（不报错，靠 body 级观察者等它出现）。
- **尚未用真实账号验证。** 本插件里所有上游事实都来自官方文档与 fixture。若真实数据下
  有出入，`scripts/smoke.mjs` 就是暴露问题的工具。

## 开发

```bash
npm install
npm run build      # lib/index.js、lib/client.js、lib/types/**
npm run check      # tsc --noEmit
npm test           # vitest
```

构建产出两个契约不同的产物，`scripts/build.mjs` 在**落盘之前**断言它们：

- `lib/index.js` —— 宿主半区，自包含 ESM；唯一 import 是 `node:crypto`。
- `lib/client.js` —— 浏览器半区，自包含的
  `window.__ModuleLoader__.load({ id, factory })` 产物，`react` 是唯一外部依赖。

`src/qiniu/respack.ts` 看着是纯函数，实际经 `sign.ts` 摸到 `node:crypto`，因此浏览器
半区只能从 `react`、`src/client/**` 与 `src/qiniu/usage.ts` **取值** —— 从别处取一个值
就会让整个客户端产物构建失败。类型导入不受影响。

`node scripts/preview.mjs` 把面板渲染成 HTML（`--theme dark|light`、`?w=<px>`），
`node scripts/screenshots.mjs` 重新生成本 README 里的截图，`node scripts/smoke.mjs`
只从环境变量读 AK/SK 并打印归一后的快照。用故意的假凭据跑一次 `smoke.mjs`，就能看到
用量接口的鉴权失败是 **HTTP 200 + `{"status":false,"error":"UNAUTHENTICATED"}`** 而
不是 401 —— 这正是错误分类器同时按错误码文本判定的原因。

[`DESIGN.md`](./DESIGN.md) 是完整设计记录 —— 上游接口事实、签名易错点、路由契约、数据
模型、缓存，以及实现期真实踩过的坑。动手前请先读。

## 许可

Apache-2.0，见 [`LICENSE`](./LICENSE)；归属声明见 [`NOTICE`](./NOTICE)。
