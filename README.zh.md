# dsh-qiniu-usage

一个 [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI 插件：在设置页展示
**七牛云指定 API Key 当天的各模型 Token 用量**，以及**账号资源包的利用情况**。

> **状态：M0（脚手架）已完成。** 签名层已落地并通过官方固定向量测试；面板目前是占位卡片。
> M1–M5（用量归一、资源包、界面、凭据表单）见 [`DESIGN.md`](./DESIGN.md) ——
> 那是本项目的权威设计文档，动手前请先读。

## 将展示什么

| 目标 | 数据来源 |
|---|---|
| 指定 Key 当天（或历史某天）的各模型 Token 用量（输入 / 输出 / 合计） | `GET https://api.qnaigc.com/v3/stat/usage` |
| 资源包利用情况：当月各计费项可用 / 已用 / 剩余，以及逐包已用量与到期时间 | `https://api.qiniu.com/billing-api/v1/respack/*` |
| 在 GUI 内填写 / 更新 / 清除 AK/SK，密钥永不进入浏览器 | DSH 凭据库（`ctx.credentials`） |

## 安装

```bash
dsh plugin --profile web add link:/path/to/dsh-qiniu-usage
```

`dsh plugin add` 会检测本包声明的 `dsh.bundle.patch`，**自动**把它加进 profile 的
`dsh.profile.bundles` —— 不需要手工编辑 patch 层。之后：

- 宿主半区改动 → 重启 `dsh web`
- 客户端半区改动 → 重新构建后刷新页面

## 配置

插件按**引用名**（POSIX 环境变量名）读取凭据，从不按值读取：

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `accessKeyRef` | `QINIU_ACCESS_KEY` | 存放 AccessKey 的环境变量 / 凭据库条目**名** |
| `secretKeyRef` | `QINIU_SECRET_KEY` | 同上，存放 SecretKey |
| `apiKeys[]` | `[]` | 可选的单 Key `sk-`/`tk-` token，用于精确查询单个 Key |
| `timezone` | `Asia/Shanghai` | 上游只接受 IANA 时区名（传 `Local` 会 400） |
| `pollIntervalSec` | `0` | `0` = 纯手动刷新 |

两种提供值的方式：

1. **环境变量** —— 导出 `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY`（见
   [`.env.example`](./.env.example)）。这类来源是只读的，GUI 表单会置灰并显示
   `来源：环境变量`。
2. **GUI 凭据表单**（M4）—— 写入 DSH 凭据库。

### 为什么 AK/SK 是必需的

资源包（财务）接口只接受七牛**管理凭证**（AK/SK），`sk-` bearer token 无法访问。
因此 AK/SK 是必需项，`apiKeys[]` 里的 bearer token 只是可选的精度增强，不是主路径。

## 开发

```bash
npm install
npm run build      # lib/index.js、lib/client.js、lib/types/**
npm run check      # tsc --noEmit
npm test           # vitest
```

构建产出两个契约不同的产物：

- `lib/index.js` —— 宿主半区，自包含 ESM（无任何外部 `require`）。
- `lib/client.js` —— 浏览器半区，必须是自包含的
  `window.__ModuleLoader__.load({ id, factory })` 产物，`react` 是唯一外部依赖。
  `scripts/build.mjs` 在每次构建后断言这些契约，因此形态漂移会让**构建失败**，
  而不是等到浏览器里才发现。

## 安全

- 浏览器永不接触 AK/SK：客户端 bundle 里不存在任何凭据读取路径
  （由 `test/bundle.test.ts` 断言）。
- 宿主路由全部 loopback-fenced，响应带 `cache-control: no-store`。
- 日志里 AK 只显示前 4 位；**SK 绝不打印**。

## 文档

- [`DESIGN.md`](./DESIGN.md) —— 完整设计：上游接口事实、签名易错点、路由契约、
  数据模型、缓存与限速、里程碑、风险清单。
- [`NOTICE`](./NOTICE) —— 改编自家族共享源码的归属声明。

## 许可

Apache-2.0，见 [`LICENSE`](./LICENSE) 与 [`NOTICE`](./NOTICE)。
