/**
 * QiniuUsageService：快照装配 + 内存缓存 + single-flight + 上游限速。
 *
 * 设计文档 §8。三条不可妥协的约束：
 *
 * 1. **缓存挡在上游前面**：用量接口同 IP 5 次/秒，必须挡。
 * 2. **single-flight**：相同缓存键的并发请求合并为一次上游调用。
 * 3. **失败隔离**：`/overview` 里用量与资源包各自独立，任一失败不遮蔽另一个。
 *
 * 时钟、`fetch`、睡眠都可注入，因此缓存过期、合并、限速行为都能直接单测。
 *
 * @module dsh-qiniu-usage/service
 */

import { RateLimiter, SingleFlight, TtlCache } from './core/cache.ts'
import type { CredentialAccess, CredentialStatus } from './credentials.ts'
import { MissingCredentialsError } from './credentials.ts'
import { QiniuUpstreamError, fetchUpstreamData } from './qiniu/http.ts'
import { signQiniuRequest } from './qiniu/sign.ts'
import { RespackClient, type RespackDetail, type RespackPack, type RespackSnapshot } from './qiniu/respack.ts'
import { extractUsageKeys, normalizeUsage, type UsageSnapshot } from './qiniu/usage.ts'
import type { RawUsageData } from './qiniu/types.ts'
import type { ResolvedConfig } from './config.ts'

/** 面板请求的日期口径。 */
export type DaySelector = 'today' | 'yesterday' | string

/** Key 过滤：空串表示账号级汇总。 */
export type KeySelector = string

/** 一个数据源的错误（不含任何凭据信息）。 */
export interface SourceError {
  source: 'usage' | 'respack'
  /** 上游业务错误码；无则为 `undefined`。 */
  code?: number | string
  /** 用户可读信息（已脱敏、已截断）。 */
  message: string
  /** 鉴权失败，UI 应引导重新配置凭据。 */
  isAuthError: boolean
  /** 权限不足（财务 API 常见：AK 缺账单权限）。 */
  isForbidden: boolean
}

/** `/overview` 的载荷。 */
export interface OverviewPayload {
  ok: boolean
  usage: UsageSnapshot | null
  respack: RespackSnapshot | null
  errors: SourceError[]
  fetchedAt: string
}

/** `/keys` 的载荷。 */
export interface KeysPayload {
  /**
   * 候选 Key。`hasUsage` 是三态：`true` 当日有、`false` 当日有归属但没它、
   * `undefined` 当日上游没有归属信息（无法判断，UI 不标注）。
   */
  keys: { label: string; masked: string; apiKey?: string; hasUsage?: boolean; hasToken: boolean }[]
}

/** Key 名册的一条：上游窗口里出现过的 Key。 */
interface KeyRosterEntry {
  label: string
  masked: string
  apiKey: string
}

/** {@link QiniuUsageService} 的构造参数。 */
export interface UsageServiceOptions {
  config: ResolvedConfig
  credentials: CredentialAccess
  /** `fetch` 替身，默认全局 `fetch`。 */
  fetchImpl?: typeof fetch
  /** 时钟，默认 `Date.now`。 */
  now?: () => number
  /** 睡眠实现，默认 `setTimeout`；限速测试注入它以免真的等待。 */
  sleep?: (ms: number) => Promise<void>
  /** 上游最小请求间隔，默认 250ms（设计文档 §8.3）。 */
  minRequestIntervalMs?: number
  /** 缓存容量上限。 */
  maxCacheEntries?: number
}

/** 一次用量查询的参数（归一后的内部表示）。 */
interface UsageQueryPlan {
  /** 传给上游的粒度。 */
  granularity: 'day' | 'hour'
  /** 归一后的日期 `YYYY-MM-DD`。 */
  day: string
  /** 传给上游的 start（RFC3339）。 */
  start: string
  /** 传给上游的 end（RFC3339）。 */
  end: string
  /** 缓存键片段。 */
  cacheKey: string
}

/** 一次用量取数的内部结果。 */
interface UsageFetchResult {
  snapshot: UsageSnapshot
  /** 本次响应里出现的 Key（供 `/keys` 复用同一次上游调用）。 */
  keys: { apiKey: string; masked: string; name?: string }[]
}

/** 东八区固定偏移。上游 `timezone` 是 IANA 名，但日期窗口按该偏移算最省事。 */
const CST_OFFSET = '+08:00'

/**
 * 把 `DaySelector` 解析为一次查询计划。
 *
 * 口径（设计文档 §8.1）：
 *
 * - 今天 → `hour` 粒度，范围到今天此刻；UI 常驻延迟告警。
 * - 昨天 / 指定日期 → `day` 粒度，全天；官方推荐的"完整可信"口径。
 *
 * @param selector - `today` / `yesterday` / `YYYY-MM-DD`。
 * @param nowMs - 当前时间戳。
 * @returns 查询计划。
 */
export function planUsageQuery(selector: DaySelector, nowMs: number): UsageQueryPlan {
  // 用 +08:00 偏移把"当前时刻"折算到目标时区的墙上时间，再取日期部分。
  const shifted = new Date(nowMs + 8 * 3600 * 1000)
  const todayWall = shifted.toISOString().slice(0, 10)

  let day: string
  if (selector === 'today' || selector === '') day = todayWall
  else if (selector === 'yesterday') {
    day = new Date(shifted.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
  } else day = selector

  const isToday = selector === 'today' || selector === '' || day === todayWall
  if (isToday) {
    // 今天：小时粒度，窗口从当日 00:00 到此刻。
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

/** Key 名册的查询窗口（RFC3339 的 start/end 与缓存键）。 */
export interface KeyRosterQueryPlan {
  start: string
  end: string
  cacheKey: string
}

/** 名册窗口的天数：上游 `day` 粒度上限是 31 天，留一天余量。 */
const ROSTER_WINDOW_DAYS = 30

/**
 * 把"现在"解析为 Key 名册的查询窗口：**最近 30 天、截止到昨天**。
 *
 * 为什么截止昨天：当天数据上游尚未归属到具体 Key（`api_key: "unknown"`），
 * 把今天包进窗口只会多出一个无名分组。见设计文档 §15.10。
 *
 * @param nowMs - 当前时间戳。
 * @returns 窗口与缓存键。
 */
export function planKeyRosterQuery(nowMs: number): KeyRosterQueryPlan {
  const shifted = new Date(nowMs + 8 * 3600 * 1000)
  const day = (offsetDays: number): string =>
    new Date(shifted.getTime() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const end = day(-1)
  // 含昨天共 ROSTER_WINDOW_DAYS 天（`-ROSTER_WINDOW_DAYS` 到 `-1`）。
  const start = day(-ROSTER_WINDOW_DAYS)
  return {
    start: `${start}T00:00:00${CST_OFFSET}`,
    end: `${end}T23:59:59${CST_OFFSET}`,
    cacheKey: `${start}:${end}`,
  }
}

/** 把任意错误归一为可回传浏览器的 {@link SourceError}。 */
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

/**
 * 七牛用量服务。
 *
 * 生命周期由宿主半区持有：`apply` 时构造，卸载时不需要额外清理（无定时器）；
 * 客户端轮询挂在面板挂载周期上。
 */
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
  /** Key 名册缓存：走"低频"TTL（与资源包同档），名册本身变化很慢。 */
  readonly #rosterCache: TtlCache<KeyRosterEntry[]>
  readonly #rosterInflight = new SingleFlight<KeyRosterEntry[]>()
  /** 上一次成功取到的逐包明细，供下钻补齐上游未返回的字段。 */
  #lastPacks: RespackPack[] = []

  /**
   * @param options - 配置、凭据访问器与可注入的 fetch/时钟/睡眠。
   */
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

  /** 当前配置。 */
  get config(): ResolvedConfig {
    return this.#config
  }

  /** 限速器，暴露出来便于诊断与测试。 */
  get limiter(): RateLimiter {
    return this.#limiter
  }

  /**
   * 热更新配置：失效全部缓存。
   *
   * 由 `settings.installSection` 的 `onChange` 触发。
   *
   * @param config - 新的归一化配置。
   */
  applyConfig(config: ResolvedConfig): void {
    this.#config = config
    this.#overviewCache.clear()
    this.#respackCache.clear()
    this.#rosterCache.clear()
  }

  /**
   * 取 `/overview` 载荷。
   *
   * @param day - 日期口径。
   * @param key - Key 过滤；空串为账号级汇总。
   * @returns 载荷；失败被隔离在 `errors` 里。
   */
  async overview(day: DaySelector, key: KeySelector): Promise<OverviewPayload> {
    // 两个数据源并发发起（受同一限速队列节流），失败互不影响。
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

  /**
   * 取 `/keys` 载荷 —— Key 选择器的候选集合。
   *
   * **名册来自历史窗口，不是当天的响应**：实测（设计文档 §15.10）查当天时上游把
   * 全部用量塞进唯一一个 `api_key: "unknown"`、`name: ""` 的分组，拿它做名册只能
   * 得到一串星号。历史日期（含昨天的 `hour` 粒度）才会给出真实归属。
   * 所以名册固定用「最近 30 天、截止昨天」的 `day` 粒度查询枚举。
   *
   * `hasUsage` 是**三态**：
   * - `true` —— 所选日期确实有这个 Key；
   * - `false` —— 所选日期有归属信息、但没有它（当日零用量）；
   * - `undefined` —— 所选日期**没有归属信息**（当天），无法判断，UI 不标"无用量"。
   *
   * @param day - 日期口径（只影响 `hasUsage` 判定，不影响名册）。
   * @returns Key 清单；上游失败时返回空清单而不是抛错。
   */
  async keys(day: DaySelector): Promise<KeysPayload> {
    let result: UsageFetchResult
    try {
      // 账号级查询（不筛 Key）才能看到全部 Key。
      result = await this.getUsage(day, '')
    } catch {
      return { keys: [] }
    }

    // 名册取不到（网络/权限）时退回"所选日期这份响应里的 Key" —— 至少当天的
// 下拉框仍可用；两者都没有时才是空清单。
    const roster = await this.#keyRoster().catch(() =>
      result.keys.map((k) => ({
        label: k.name !== undefined && k.name !== '' ? k.name : k.masked,
        masked: k.masked,
        apiKey: k.apiKey,
      })),
    )
    const unattributed = result.snapshot.unattributedKeys === true

    /** 所选日期的响应里有没有这个 Key。 */
    const usedOnDay = (entry: { label: string; masked: string }): boolean =>
      result.keys.some((k) => (
        (entry.masked !== '' && k.masked === entry.masked)
        || (entry.label !== '' && k.name === entry.label)
      ))

    const keys: KeysPayload['keys'] = [
      // 名册：上游窗口里出现过的 Key（带真实名称与掩码）。
      ...roster.map((entry) => ({
        label: entry.label,
        masked: entry.masked,
        apiKey: entry.apiKey,
        hasUsage: unattributed ? undefined : usedOnDay(entry),
        hasToken: this.#hasTokenFor(entry.label, entry.masked),
      })),
      // 配置里登记、但名册里没有的 Key（例如窗口内零用量）。
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

  /**
   * 取 Key 名册：最近 30 天（**截止昨天**）按 `day` 粒度枚举上游出现过的 Key。
   *
   * 缓存走"低频"档（{@link ResolvedConfig.dashboardTtlSec}）：名册变化很慢，
   * 而它与 `/overview` 的当天查询是完全不同的请求，不该互相顶掉缓存。
   *
   * @returns 名册条目（label 取上游 `name`，退化时用掩码）。
   */
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

  /**
   * 手动刷新：失效缓存后重取。
   *
   * @param day - 日期口径。
   * @param key - Key 过滤。
   * @returns 新的载荷。
   */
  async refresh(day: DaySelector, key: KeySelector): Promise<OverviewPayload> {
    this.#overviewCache.clear()
    this.#respackCache.clear()
    this.#rosterCache.clear()
    return this.overview(day, key)
  }

  /**
   * 取资源包快照（带缓存与 single-flight）。
   *
   * 资源包数据日更，所以用 {@link ResolvedConfig.dashboardTtlSec}（默认 10 分钟）
   * 而不是今天的 60 秒。
   *
   * @returns 资源包快照。
   * @throws {MissingCredentialsError | QiniuUpstreamError} 缺凭据、无账单权限或上游错误。
   */
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

  /**
   * 单包下钻。
   *
   * @param orderHash - 订单唯一编号。
   * @param poId - 商品订单编号。
   * @returns 归一后的详情。
   * @throws {MissingCredentialsError | QiniuUpstreamError} 缺凭据或上游错误。
   */
  async respackDetail(orderHash: string, poId: number): Promise<RespackDetail> {
    const pack = this.#lastPacks.find(
      (candidate) => candidate.orderHash === orderHash && candidate.poId === poId,
    )
    const client = await this.#respackClient()
    return client.detail(orderHash, poId, pack)
  }

  /**
   * 凭据访问器，供凭据路由使用。
   *
   * 暴露它是为了把"引用名白名单"与 describe/set/unset 的调用点收在一处
   * （见 `routes.ts` 的凭据路由）。
   */
  get credentials(): CredentialAccess {
    return this.#credentials
  }

  /**
   * 查询配置里声明的凭据引用状态（**永不返回值**）。
   *
   * @returns AccessKey / SecretKey / 各 token 引用的 describe 结果。
   */
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

  /**
   * 写入一个凭据引用。
   *
   * @param ref - 引用名；必须在本插件声明的白名单内。
   * @param value - 非空值。
   * @throws {Error} 引用不在白名单内，或来源只读遮蔽。
   */
  async setCredential(ref: string, value: string): Promise<void> {
    this.#assertKnownRef(ref)
    if (value === '') throw new Error('凭据值不能为空（要清除请用清除操作）')
    await this.#credentials.set(ref, value)
    // 旧数据可能用了失效的凭据 —— 清缓存以便下次拿到新值。
    this.#overviewCache.clear()
    this.#respackCache.clear()
    this.#rosterCache.clear()
  }

  /**
   * 清除一个凭据引用。
   *
   * @param ref - 引用名；必须在本插件声明的白名单内。
   * @throws {Error} 引用不在白名单内，或来源只读遮蔽。
   */
  async unsetCredential(ref: string): Promise<void> {
    this.#assertKnownRef(ref)
    await this.#credentials.unset(ref)
    this.#overviewCache.clear()
    this.#respackCache.clear()
    this.#rosterCache.clear()
  }

  /**
   * 引用名白名单校验（设计文档 §11.6：只允许写 config 声明的 ref）。
   *
   * @param ref - 待校验的引用名。
   * @throws {Error} 不在白名单内。
   */
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

  /** 按当前凭据构造财务 API 客户端（每次调用重新解析凭据）。 */
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

  /** 某个上游 Key 是否配了 Bearer token。 */
  #hasTokenFor(name: string | undefined, masked: string): boolean {
    return this.#config.apiKeys.some((entry) => {
      if (entry.tokenRef === '') return false
      const label = entry.label
      return label === name || label === masked
    })
  }

  /**
   * 取一次用量（带缓存与 single-flight）。
   *
   * @param day - 日期口径。
   * @param key - Key 过滤；空串为账号级汇总。
   * @returns 归一快照与本次响应里出现的 Key。
   */
  async getUsage(day: DaySelector, key: KeySelector): Promise<UsageFetchResult> {
    const plan = planUsageQuery(day, this.#now())
    const cacheKey = `usage:${key}:${plan.cacheKey}`
    const ttlMs = (plan.granularity === 'hour' ? this.#config.todayTtlSec : this.#config.dashboardTtlSec) * 1000

    const cached = this.#overviewCache.get(cacheKey)
    if (cached !== undefined) return cached

    return this.#inflight.run(cacheKey, async () => {
      // 进入 single-flight 后再查一次：先到的调用可能刚好填上了缓存。
      const raced = this.#overviewCache.get(cacheKey)
      if (raced !== undefined) return raced

      const result = await this.#fetchUsage(day, key, plan)
      this.#overviewCache.set(cacheKey, result, ttlMs)
      return result
    })
  }

  /** 真正发起上游调用并归一。 */
  async #fetchUsage(
    day: DaySelector,
    key: KeySelector,
    plan: UsageQueryPlan,
  ): Promise<UsageFetchResult> {
    const { accessKey, secretKey } = await this.#credentials.resolveKeyPair(
      this.#config.accessKeyRef,
      this.#config.secretKeyRef,
    )

    // query 串在这里构造一次，同时用于签名与最终 URL（签名器保证逐字节一致）。
    // 用量接口是 qnaigc 域名，但它同样吃七牛管理凭证签名。
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

    // 今天的数据上游明确可能延迟 —— 常驻告警（设计文档 §8.1）。
    if (plan.granularity === 'hour') {
      snapshot.warnings = [...snapshot.warnings, '当天数据可能存在延迟（上游按小时粒度返回）']
    }

    return { snapshot, keys: extractUsageKeys(data as RawUsageData) }
  }
}
