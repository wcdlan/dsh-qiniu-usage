/**
 * 插件配置：设置命名空间 `dsh-qiniu-usage` 的 schema 与归一化。
 *
 * 设计文档 §10.1。要点：
 *
 * - 配置里存的是凭据**引用名**（POSIX 环境变量名），不是 AK/SK 明文。
 *   明文只走凭据库或环境变量，绝不进插件配置文件。
 * - 所有字段都有默认值，schema 解析失败不应让插件整个挂掉。
 *
 * @module dsh-qiniu-usage/config
 */

import z from 'schemastery'

/** 用户可在设置页调整的插件配置。 */
export interface Config {
  /** 总开关。关闭时不注册任何路由、不发起任何上游请求。 */
  enabled?: boolean

  /** AccessKey 的凭据引用名（键名，非值）。 */
  accessKeyRef?: string
  /** SecretKey 的凭据引用名（键名，非值）。 */
  secretKeyRef?: string

  /**
   * 可选的单 Key Bearer token 登记表。
   *
   * AK/SK 模式下用量接口返回账号下**全部** Key，所以常规筛选不需要它；
   * 仅在用户恰好持有某个 `sk-`/`tk-` token、想精确查询单个 Key 时才需要。
   */
  apiKeys?: { label: string; tokenRef: string }[]

  /** 面板默认选中的 Key 标签；空串表示"全部 Key（汇总）"。 */
  defaultKey?: string
  /** 面板默认日期：`today` / `yesterday` / `YYYY-MM-DD`。 */
  defaultDay?: string

  /** 大模型用量接口基地址。 */
  usageBaseUrl?: string
  /** 财务/资源包接口基地址。 */
  financeBaseUrl?: string
  /** 查询时区；上游只接受 IANA 名，不接受 `Local`。 */
  timezone?: string

  /** 当天（小时粒度）数据的缓存 TTL，秒。 */
  todayTtlSec?: number
  /** 历史日与资源包的缓存 TTL，秒。 */
  dashboardTtlSec?: number
  /** 客户端轮询间隔，秒；`0` = 纯手动刷新（默认）。 */
  pollIntervalSec?: number

  /**
   * 是否在页面上显示悬浮按钮（对话页的用量速览入口）。
   *
   * 默认开启：它是这个插件最主要的日常入口。不想要常驻浮层的用户可关掉，
   * 面板仍在「设置 → 七牛云用量」里。
   */
  floatingButton?: boolean
}

const DEFAULT_USAGE_BASE_URL = 'https://api.qnaigc.com'
const DEFAULT_FINANCE_BASE_URL = 'https://api.qiniu.com'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'

/** 设置命名空间；宿主与客户端半区必须一致。 */
export const SETTINGS_NAMESPACE = 'dsh-qiniu-usage'

/**
 * 配置 schema。
 *
 * `z.array(...).default([])` 在 schemastery 中会得到"可缺省的数组"，
 * 归一化时再兜一层，避免上游传进 `undefined`。
 */
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
  pollIntervalSec: z.number().min(0).max(3600).default(0),
  floatingButton: z.boolean().default(true),
})

/** 归一化后的配置：所有字段必有值，且 URL 已去掉尾部 `/`。 */
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
  floatingButton: boolean
}

/** 去掉 URL 末尾的 `/`，避免拼接出 `//v3/stat/usage`。 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * 把可能残缺的用户配置归一为完整配置。
 *
 * 对每个字段单独兜底（而不是依赖 schema 已跑过），这样 `installSection` 的
 * `setSource` 在设置服务缺失时也能安全调用。
 *
 * @param config - 原始配置，可为 `undefined`。
 * @returns 完整配置。
 */
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
    pollIntervalSec: config?.pollIntervalSec ?? 0,
    floatingButton: config?.floatingButton ?? true,
  }
}
