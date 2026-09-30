// 配置只存凭据引用名（POSIX 环境变量名），明文只走凭据库或环境变量；见 DESIGN.md §10.1。

import z from 'schemastery'

export interface Config {
    /** 总开关；关闭时不注册路由、不发起上游请求。 */
  enabled?: boolean

  /** AccessKey 的凭据引用名（键名，非值）。 */
  accessKeyRef?: string
  /** SecretKey 的凭据引用名（键名，非值）。 */
  secretKeyRef?: string

    /** 可选的单 Key Bearer token 登记表；AK/SK 模式已返回全部 Key，仅在持有 `sk-`/`tk-` token 想精确查单 Key 时才需要。 */
  apiKeys?: { label: string; tokenRef: string }[]

  /** 面板默认选中的 Key 标签；空串表示"全部 Key（汇总）"。 */
  defaultKey?: string
  /** 面板默认日期：`today` / `yesterday` / `YYYY-MM-DD`。 */
  defaultDay?: string

  usageBaseUrl?: string
  financeBaseUrl?: string
  /** 查询时区；上游只接受 IANA 名，不接受 `Local`。 */
  timezone?: string

  todayTtlSec?: number
  dashboardTtlSec?: number
    /** 客户端自动刷新间隔（秒），`0` = 纯手动；默认 5 秒。界面刷得快不等于上游被打得快：宿主侧仍按 TTL 取数。 */
  pollIntervalSec?: number

    /** 是否在左侧栏底部显示用量速览卡片；默认开启，它是本插件最主要的日常入口。 */
  sidebarCard?: boolean
}

const DEFAULT_USAGE_BASE_URL = 'https://api.qnaigc.com'
const DEFAULT_FINANCE_BASE_URL = 'https://api.qiniu.com'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'

const DEFAULT_POLL_INTERVAL_SEC = 5

/** 设置命名空间；宿主与客户端半区必须一致。 */
export const SETTINGS_NAMESPACE = 'dsh-qiniu-usage'

/** 配置 schema；`z.array().default([])` 在 schemastery 得到"可缺省的数组"，归一化时再兜一层。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),

  accessKeyRef: z.string().default('QINIU_ACCESS_KEY'),
  secretKeyRef: z.string().default('QINIU_SECRET_KEY'),

  apiKeys: z
    .array(
      z.object({
        label: z.string(),
        tokenRef: z.string(),
      }),
    )
    .default([]),

  defaultKey: z.string().default(''),
  defaultDay: z.string().default('today'),

  usageBaseUrl: z.string().default(DEFAULT_USAGE_BASE_URL),
  financeBaseUrl: z.string().default(DEFAULT_FINANCE_BASE_URL),
  timezone: z.string().default(DEFAULT_TIMEZONE),

  todayTtlSec: z.number().min(10).max(600).default(60),
  dashboardTtlSec: z.number().min(60).max(3600).default(600),
  pollIntervalSec: z.number().min(0).max(3600).default(DEFAULT_POLL_INTERVAL_SEC),
  sidebarCard: z.boolean().default(true),
})

/** 归一化后的配置：所有字段必有值，URL 已去掉尾部 `/`。 */
export interface ResolvedConfig {
  enabled: boolean
  accessKeyRef: string
  secretKeyRef: string
  apiKeys: { label: string; tokenRef: string }[]
  defaultKey: string
  defaultDay: string
  usageBaseUrl: string
  financeBaseUrl: string
  timezone: string
  todayTtlSec: number
  dashboardTtlSec: number
  pollIntervalSec: number
  sidebarCard: boolean
}

/** 去掉 URL 末尾的 `/`，避免拼接出 `//v3/stat/usage`。 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/** 把可能残缺的用户配置归一为完整配置；逐字段兜底，使 `installSection` 的 `setSource` 在设置服务缺失时也能安全调用。 */
export function resolveConfig(config?: Config): ResolvedConfig {
  return {
    enabled: config?.enabled ?? true,
    accessKeyRef: config?.accessKeyRef ?? 'QINIU_ACCESS_KEY',
    secretKeyRef: config?.secretKeyRef ?? 'QINIU_SECRET_KEY',
    apiKeys: config?.apiKeys ?? [],
    defaultKey: config?.defaultKey ?? '',
    defaultDay: config?.defaultDay ?? 'today',
    usageBaseUrl: trimTrailingSlash(config?.usageBaseUrl ?? DEFAULT_USAGE_BASE_URL),
    financeBaseUrl: trimTrailingSlash(config?.financeBaseUrl ?? DEFAULT_FINANCE_BASE_URL),
    timezone: config?.timezone ?? DEFAULT_TIMEZONE,
    todayTtlSec: config?.todayTtlSec ?? 60,
    dashboardTtlSec: config?.dashboardTtlSec ?? 600,
    pollIntervalSec: config?.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC,
    sidebarCard: config?.sidebarCard ?? true,
  }
}
