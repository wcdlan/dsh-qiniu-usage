// 用量接口同 IP 限 5 次/秒，故上游调用必须经缓存与限速；见 DESIGN.md §8。

import {RateLimiter, SingleFlight, TtlCache} from './core/cache.ts'
import type {CredentialAccess, CredentialStatus} from './credentials.ts'
import {MissingCredentialsError} from './credentials.ts'
import {fetchUpstreamData, QiniuUpstreamError} from './qiniu/http.ts'
import {signQiniuRequest} from './qiniu/sign.ts'
import {RespackClient, type RespackDetail, type RespackPack, type RespackSnapshot} from './qiniu/respack.ts'
import {extractUsageKeys, normalizeUsage, type UsageSnapshot} from './qiniu/usage.ts'
import type {RawUsageData} from './qiniu/types.ts'
import type {ResolvedConfig} from './config.ts'

export type DaySelector = 'today' | 'yesterday' | string

/** Key 过滤；空串表示账号级汇总。 */
export type KeySelector = string

/** 单个数据源的错误；不含任何凭据信息，可安全回传浏览器。 */
export interface SourceError {
  source: 'usage' | 'respack'
  code?: number | string
    /** 用户可读信息；已脱敏、已截断。 */
  message: string
    /** 鉴权失败；UI 应引导重新配置凭据。 */
  isAuthError: boolean
    /** 权限不足；财务 API 常见于 AK 缺账单权限。 */
  isForbidden: boolean
}

export interface OverviewPayload {
  ok: boolean
  usage: UsageSnapshot | null
  respack: RespackSnapshot | null
  errors: SourceError[]
  fetchedAt: string
}

export interface KeysPayload {
    /** 候选 Key；`hasUsage` 三态：`true` 当日有、`false` 当日有归属但没它、`undefined` 上游无归属信息（UI 不标注）。 */
  keys: { label: string; masked: string; apiKey?: string; hasUsage?: boolean; hasToken: boolean }[]
}

interface KeyRosterEntry {
  label: string
  masked: string
  apiKey: string
}

export interface UsageServiceOptions {
  config: ResolvedConfig
  credentials: CredentialAccess
  fetchImpl?: typeof fetch
  now?: () => number
    /** 睡眠实现；限速测试注入它以免真的等待。 */
  sleep?: (ms: number) => Promise<void>
    /** 上游最小请求间隔；见 DESIGN.md §8.3。 */
  minRequestIntervalMs?: number
  maxCacheEntries?: number
}

interface UsageQueryPlan {
  granularity: 'day' | 'hour'
  day: string
  start: string
  end: string
  cacheKey: string
}

interface UsageFetchResult {
  snapshot: UsageSnapshot
    /** 本次响应里出现的 Key；供 `/keys` 复用同一次上游调用。 */
  keys: { apiKey: string; masked: string; name?: string }[]
}

/** 东八区固定偏移；上游 `timezone` 是 IANA 名，日期窗口按此偏移折算。 */
const CST_OFFSET = '+08:00'

/** 解析日期口径为查询计划：今天用 `hour` 粒度、其余用 `day` 粒度（DESIGN.md §8.1）。 */
export function planUsageQuery(selector: DaySelector, nowMs: number): UsageQueryPlan {
  const shifted = new Date(nowMs + 8 * 3600 * 1000)
  const todayWall = shifted.toISOString().slice(0, 10)

  let day: string
  if (selector === 'today' || selector === '') day = todayWall
  else if (selector === 'yesterday') {
    day = new Date(shifted.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
  } else day = selector

  const isToday = selector === 'today' || selector === '' || day === todayWall
  if (isToday) {
    const nowWall = new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 19)
    return {
      granularity: 'hour',
      day: todayWall,
      start: `${todayWall}T00:00:00${CST_OFFSET}`,
      end: `${nowWall}${CST_OFFSET}`,
      cacheKey: `${todayWall}:hour`,
    }
  }

  return {
    granularity: 'day',
    day,
    start: `${day}T00:00:00${CST_OFFSET}`,
    end: `${day}T23:59:59${CST_OFFSET}`,
    cacheKey: `${day}:day`,
  }
}

export interface KeyRosterQueryPlan {
  start: string
  end: string
  cacheKey: string
}

/** 名册窗口天数；上游 `day` 粒度上限 31 天，留一天余量。 */
const ROSTER_WINDOW_DAYS = 30

/** 名册窗口：最近 30 天、截止昨天。当天数据上游尚未归属 Key（`api_key: "unknown"`），见 DESIGN.md §15.10。 */
export function planKeyRosterQuery(nowMs: number): KeyRosterQueryPlan {
  const shifted = new Date(nowMs + 8 * 3600 * 1000)
  const day = (offsetDays: number): string =>
    new Date(shifted.getTime() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const end = day(-1)
    // 含昨天共 ROSTER_WINDOW_DAYS 天。
  const start = day(-ROSTER_WINDOW_DAYS)
  return {
    start: `${start}T00:00:00${CST_OFFSET}`,
    end: `${end}T23:59:59${CST_OFFSET}`,
    cacheKey: `${start}:${end}`,
  }
}

/** 把任意错误归一为可安全回传浏览器的 {@link SourceError}。 */
export function toSourceError(error: unknown, source: 'usage' | 'respack'): SourceError {
  if (error instanceof MissingCredentialsError) {
    return {
      source,
      message: error.message,
      isAuthError: false,
      isForbidden: false,
    }
  }
  if (error instanceof QiniuUpstreamError) {
    return {
      source,
      ...(error.code === undefined ? {} : { code: error.code }),
      message: error.message,
      isAuthError: error.isAuthError,
      isForbidden: error.isForbidden,
    }
  }
  return {
    source,
    message: error instanceof Error ? error.message : String(error),
    isAuthError: false,
    isForbidden: false,
  }
}

/** 七牛用量服务；无定时器，卸载无需清理（生命周期由宿主半区持有）。 */
export class QiniuUsageService {
  #config: ResolvedConfig
  readonly #credentials: CredentialAccess
  readonly #fetch: typeof fetch
  readonly #now: () => number
  readonly #limiter: RateLimiter
  readonly #sleep: (ms: number) => Promise<void>
  readonly #overviewCache: TtlCache<UsageFetchResult>
  readonly #inflight = new SingleFlight<UsageFetchResult>()
  readonly #respackCache: TtlCache<RespackSnapshot>
  readonly #respackInflight = new SingleFlight<RespackSnapshot>()
    /** 名册缓存走"低频"TTL（与资源包同档）；名册变化很慢。 */
  readonly #rosterCache: TtlCache<KeyRosterEntry[]>
  readonly #rosterInflight = new SingleFlight<KeyRosterEntry[]>()
    /** 上次成功取到的逐包明细；下钻时补齐上游未返回的字段。 */
  #lastPacks: RespackPack[] = []

  constructor(options: UsageServiceOptions) {
    this.#config = options.config
    this.#credentials = options.credentials
    this.#fetch = options.fetchImpl ?? globalThis.fetch
    this.#now = options.now ?? Date.now
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.#limiter = new RateLimiter({
      minIntervalMs: options.minRequestIntervalMs ?? 250,
      now: this.#now,
      sleep: this.#sleep,
    })
    const maxEntries = options.maxCacheEntries ?? 200
    this.#overviewCache = new TtlCache<UsageFetchResult>({ maxEntries, now: this.#now })
    this.#respackCache = new TtlCache<RespackSnapshot>({ maxEntries, now: this.#now })
    this.#rosterCache = new TtlCache<KeyRosterEntry[]>({ maxEntries, now: this.#now })
  }

  get config(): ResolvedConfig {
    return this.#config
  }

    /** 限速器；暴露出来便于诊断与测试。 */
  get limiter(): RateLimiter {
    return this.#limiter
  }

    /** 凭据访问器；把引用名白名单与 describe/set/unset 的调用点收在 `routes.ts` 一处。 */
  get credentials(): CredentialAccess {
    return this.#credentials
  }

    /** 热更新配置并失效全部缓存；由 `settings.installSection` 的 `onChange` 触发。 */
  applyConfig(config: ResolvedConfig): void {
    this.#config = config
    this.#overviewCache.clear()
    this.#respackCache.clear()
    this.#rosterCache.clear()
  }

    /** 取 `/overview` 载荷；两个数据源的失败隔离在 `errors` 里。 */
  async overview(day: DaySelector, key: KeySelector): Promise<OverviewPayload> {
        // 并发发起，受同一限速队列节流；失败互不影响。
    const [usageResult, respackResult] = await Promise.allSettled([
      this.getUsage(day, key),
      this.getRespack(),
    ])

    const errors: SourceError[] = []
    let usage: UsageSnapshot | null = null
    let respack: RespackSnapshot | null = null

    if (usageResult.status === 'fulfilled') usage = usageResult.value.snapshot
    else errors.push(toSourceError(usageResult.reason, 'usage'))

    if (respackResult.status === 'fulfilled') respack = respackResult.value
    else errors.push(toSourceError(respackResult.reason, 'respack'))

    return {
      ok: errors.length === 0,
      usage,
      respack,
      errors,
      fetchedAt: new Date(this.#now()).toISOString(),
    }
  }

    /** 取 `/keys` 载荷；名册固定用「最近 30 天、截止昨天」，因为当天上游不归属 Key（DESIGN.md §15.10）。 */
  async keys(day: DaySelector): Promise<KeysPayload> {
    let result: UsageFetchResult
    try {
      result = await this.getUsage(day, '')
    } catch {
      return { keys: [] }
    }

        // 名册取不到时退回本次响应里的 Key，至少当天下拉可用；两者都没有才是空清单。
    const roster = await this.#keyRoster().catch(() =>
      result.keys.map((k) => ({
        label: k.name !== undefined && k.name !== '' ? k.name : k.masked,
        masked: k.masked,
        apiKey: k.apiKey,
      })),
    )
    const unattributed = result.snapshot.unattributedKeys === true

    const usedOnDay = (entry: { label: string; masked: string }): boolean =>
      result.keys.some((k) => (
        (entry.masked !== '' && k.masked === entry.masked)
        || (entry.label !== '' && k.name === entry.label)
      ))

    const keys: KeysPayload['keys'] = [
      ...roster.map((entry) => ({
        label: entry.label,
        masked: entry.masked,
        apiKey: entry.apiKey,
        hasUsage: unattributed ? undefined : usedOnDay(entry),
        hasToken: this.#hasTokenFor(entry.label, entry.masked),
      })),
        // 配置里登记但名册里没有的 Key（例如窗口内零用量）。
      ...this.#config.apiKeys
        .map((entry) => entry.label)
        .filter((label) => !roster.some((entry) => entry.label === label))
        .map((label) => ({
          label,
          masked: '',
          hasUsage: unattributed ? undefined : false,
          hasToken: this.#config.apiKeys.some((entry) => entry.label === label && entry.tokenRef !== ''),
        })),
    ]

    return { keys }
  }

    /** 手动刷新：失效缓存后重取。 */
  async refresh(day: DaySelector, key: KeySelector): Promise<OverviewPayload> {
    this.#overviewCache.clear()
    this.#respackCache.clear()
    this.#rosterCache.clear()
    return this.overview(day, key)
  }

    /** 取资源包快照（带缓存与 single-flight）；资源包数据日更，故用 dashboardTtlSec 而非当天 TTL。 */
  async getRespack(): Promise<RespackSnapshot> {
    const cacheKey = 'respack:snapshot'
    const cached = this.#respackCache.get(cacheKey)
    if (cached !== undefined) return cached

    return this.#respackInflight.run(cacheKey, async () => {
      const raced = this.#respackCache.get(cacheKey)
      if (raced !== undefined) return raced

      const snapshot = await (await this.#respackClient()).snapshot()
      this.#respackCache.set(cacheKey, snapshot, this.#config.dashboardTtlSec * 1000)
      this.#lastPacks = snapshot.packages
      return snapshot
    })
  }

    /** 单包下钻。 */
  async respackDetail(orderHash: string, poId: number): Promise<RespackDetail> {
    const pack = this.#lastPacks.find(
      (candidate) => candidate.orderHash === orderHash && candidate.poId === poId,
    )
    const client = await this.#respackClient()
    return client.detail(orderHash, poId, pack)
  }

    /** 查询配置里声明的凭据引用状态；永不返回值。 */
  async describeCredentials(): Promise<{
    accessKey: { ref: string } & CredentialStatus
    secretKey: { ref: string } & CredentialStatus
    apiKeys: { label: string; ref: string; status: CredentialStatus }[]
    /** 是否由 DSH 凭据库支撑；`false` 表示降级为环境变量只读。 */
    hasStore: boolean
  }> {
    const accessKeyRef = this.#config.accessKeyRef
    const secretKeyRef = this.#config.secretKeyRef

    const [accessKeyStatus, secretKeyStatus, ...tokenStatuses] = await Promise.all([
      this.#credentials.describe(accessKeyRef),
      this.#credentials.describe(secretKeyRef),
      ...this.#config.apiKeys.map((entry) => this.#credentials.describe(entry.tokenRef)),
    ])

    return {
      accessKey: { ref: accessKeyRef, ...accessKeyStatus },
      secretKey: { ref: secretKeyRef, ...secretKeyStatus },
      apiKeys: this.#config.apiKeys.map((entry, index) => ({
        label: entry.label,
        ref: entry.tokenRef,
        status: tokenStatuses[index] ?? { configured: false, writable: false },
      })),
      hasStore: this.#credentials.hasStore,
    }
  }

    /** 写入一个凭据引用；`ref` 必须在插件声明的白名单内。 */
  async setCredential(ref: string, value: string): Promise<void> {
    this.#assertKnownRef(ref)
    if (value === '') throw new Error('凭据值不能为空（要清除请用清除操作）')
    await this.#credentials.set(ref, value)
        // 换凭据后清缓存，避免旧值继续命中。
    this.#overviewCache.clear()
    this.#respackCache.clear()
    this.#rosterCache.clear()
  }

    /** 清除一个凭据引用；`ref` 必须在插件声明的白名单内。 */
  async unsetCredential(ref: string): Promise<void> {
    this.#assertKnownRef(ref)
    await this.#credentials.unset(ref)
    this.#overviewCache.clear()
    this.#respackCache.clear()
    this.#rosterCache.clear()
  }

    /** 取一次用量（带缓存与 single-flight）。 */
  async getUsage(day: DaySelector, key: KeySelector): Promise<UsageFetchResult> {
    const plan = planUsageQuery(day, this.#now())
    const cacheKey = `usage:${key}:${plan.cacheKey}`
    const ttlMs = (plan.granularity === 'hour' ? this.#config.todayTtlSec : this.#config.dashboardTtlSec) * 1000

    const cached = this.#overviewCache.get(cacheKey)
    if (cached !== undefined) return cached

    return this.#inflight.run(cacheKey, async () => {
        // single-flight 内再查一次：先到的调用可能刚好填上缓存。
      const raced = this.#overviewCache.get(cacheKey)
      if (raced !== undefined) return raced

      const result = await this.#fetchUsage(day, key, plan)
      this.#overviewCache.set(cacheKey, result, ttlMs)
      return result
    })
  }

    /** 取 Key 名册（最近 30 天、截止昨天）；缓存走低频 TTL，避免与 `/overview` 当天查询互相顶掉。 */
  async #keyRoster(): Promise<KeyRosterEntry[]> {
    const window = planKeyRosterQuery(this.#now())
    const cached = this.#rosterCache.get(window.cacheKey)
    if (cached !== undefined) return cached

    return this.#rosterInflight.run(window.cacheKey, async () => {
      const raced = this.#rosterCache.get(window.cacheKey)
      if (raced !== undefined) return raced

      const { accessKey, secretKey } = await this.#credentials.resolveKeyPair(
        this.#config.accessKeyRef,
        this.#config.secretKeyRef,
      )
      const { url, headers } = signQiniuRequest(accessKey, secretKey, {
        method: 'GET',
        baseUrl: this.#config.usageBaseUrl,
        path: '/v3/stat/usage',
        query: [
          ['granularity', 'day'],
          ['start', window.start],
          ['end', window.end],
          ['timezone', this.#config.timezone],
        ],
      })
      const data = await this.#limiter.run(() =>
        fetchUpstreamData({ url, method: 'GET', headers }, 'qnaigc', {
          fetchImpl: this.#fetch,
          sleepImpl: (ms) => this.#sleep(ms),
        }),
      )
      const roster = extractUsageKeys(data).map((entry) => ({
        label: entry.name !== undefined && entry.name !== '' ? entry.name : entry.masked,
        masked: entry.masked,
        apiKey: entry.apiKey,
      }))
      this.#rosterCache.set(window.cacheKey, roster, this.#config.dashboardTtlSec * 1000)
      return roster
    })
  }

    /** 引用名白名单校验；只允许写 config 声明的 ref（DESIGN.md §11.6）。 */
  #assertKnownRef(ref: string): void {
    const allowed = new Set<string>([
      this.#config.accessKeyRef,
      this.#config.secretKeyRef,
      ...this.#config.apiKeys.map((entry) => entry.tokenRef),
    ])
    if (!allowed.has(ref)) {
      throw new Error(`不允许写入未声明的凭据引用：${ref}`)
    }
  }

  #hasTokenFor(name: string | undefined, masked: string): boolean {
    return this.#config.apiKeys.some((entry) => {
      if (entry.tokenRef === '') return false
      const label = entry.label
      return label === name || label === masked
    })
  }

    /** 按当前凭据构造财务 API 客户端；每次调用重新解析凭据。 */
  async #respackClient(): Promise<RespackClient> {
    const { accessKey, secretKey } = await this.#credentials.resolveKeyPair(
      this.#config.accessKeyRef,
      this.#config.secretKeyRef,
    )
    return new RespackClient({
      baseUrl: this.#config.financeBaseUrl,
      accessKey,
      secretKey,
      fetchImpl: this.#fetch,
      schedule: (task) => this.#limiter.run(task),
      now: this.#now,
      sleepImpl: (ms) => this.#sleep(ms),
    })
  }

  async #fetchUsage(
    day: DaySelector,
    key: KeySelector,
    plan: UsageQueryPlan,
  ): Promise<UsageFetchResult> {
    const { accessKey, secretKey } = await this.#credentials.resolveKeyPair(
      this.#config.accessKeyRef,
      this.#config.secretKeyRef,
    )

      // query 串在此构造一次，签名与最终 URL 共用（签名器保证逐字节一致）。
      // 用量接口虽在 qnaigc 域名，但同样吃七牛管理凭证签名。
    const { url, headers } = signQiniuRequest(accessKey, secretKey, {
      method: 'GET',
      baseUrl: this.#config.usageBaseUrl,
      path: '/v3/stat/usage',
      query: [
        ['granularity', plan.granularity],
        ['start', plan.start],
        ['end', plan.end],
        ['timezone', this.#config.timezone],
      ],
    })

    const data = await this.#limiter.run(() =>
      fetchUpstreamData({ url, method: 'GET', headers }, 'qnaigc', {
        fetchImpl: this.#fetch,
        sleepImpl: (ms) => this.#sleep(ms),
      }),
    )

    const snapshot = normalizeUsage({
      data,
      auth: 'aksk',
      query: {
        granularity: plan.granularity,
        start: plan.start,
        end: plan.end,
        timezone: this.#config.timezone,
      },
      day: plan.day,
      fallbackKeyLabel: '全部 Key',
      ...(key === '' ? {} : { keySelector: key }),
    })

      // 当天数据上游明确可能延迟，常驻告警（DESIGN.md §8.1）。
    if (plan.granularity === 'hour') {
      snapshot.warnings = [...snapshot.warnings, '当天数据可能存在延迟（上游按小时粒度返回）']
    }

    return { snapshot, keys: extractUsageKeys(data as RawUsageData) }
  }
}
