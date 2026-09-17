/**
 * 客户端状态。
 *
 * 刻意**不依赖平台内部 store 引擎**（`@deepseek-ai/dsh-client-store` 不在 profile
 * 顶层，dsh-usage 需要 try/catch 里再 join 字符串去 require）。这里用 React 自带的
 * `useSyncExternalStore`，契约只有 `subscribe` + `getSnapshot`，零平台依赖。
 *
 * `fetch` 可注入，因此状态机（首屏 / 刷新保留旧数据 / 部分失败 / 全失败）都能直接
 * 单测，不需要真的渲染组件。
 *
 * @module dsh-qiniu-usage/client/usage-store
 */

import type { KeysPayload, OverviewPayload, SourceError } from '../service.ts'
import type { RespackDetail } from '../qiniu/respack.ts'
import type { CredentialsView } from './CredentialsForm.tsx'

/** 面板状态机。 */
export type UiStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 面板状态。 */
export interface UsageState {
  status: UiStatus
  /** 最近一次成功取到的载荷；刷新期间保留旧值以免闪空。 */
  data: OverviewPayload | null
  /** 面板级错误（传输层失败或 404）。 */
  error: string | null
  /** 当前日期口径。 */
  day: string
  /** 当前 Key 过滤；空串为账号全量汇总。 */
  key: string
  /** 是否正在刷新（已有数据时用来显示顶部细进度条）。 */
  refreshing: boolean
  /** 上一次成功刷新的时间戳。 */
  updatedAt: number | null
  /** Key 选择器候选集。 */
  keys: KeysPayload['keys']
  /** 已验证的 Key 选择器（仅当含 Key 选择器的实现在用）。 */
  keyFilter: string | null
  /** 最近一次下钻结果，按 `orderHash:poId` 缓存。 */
  details: Record<string, RespackDetail>
  /** 凭据状态（describe 形状，永不含值）；未加载时为 `null`。 */
  credentials: CredentialsView | null
  /** 凭据表单的最近一次错误。 */
  credentialsError: string | null
}

/** 面板对外暴露的动作。 */
export interface UsageStoreActions {
  start(): void
  stop(): void
  setDay(day: string): void
  setKey(key: string): void
  refresh(): void
  loadKeys(): void
  loadDetail(orderHash: string, poId: number): void
  /**
   * 更新轮询间隔（毫秒，`<= 0` 为纯手动）。
   *
   * **必须原地更新而不是重建 store**：注入面（`face`）在分区注册时就把它捕获进
   * 闭包了，重建的实例组件拿不到。运行中也会按新值重装定时器。
   */
  setPollIntervalMs(intervalMs: number): void
  /** 读取凭据状态（describe 形状）。 */
  loadCredentials(): void
  /** 写入一个凭据引用。 */
  setCredential(ref: string, value: string): Promise<void>
  /** 清除一个凭据引用。 */
  unsetCredential(ref: string): Promise<void>
}

/** 组件消费的只读视图。 */
export interface UsageStoreView {
  subscribe(listener: () => void): () => void
  getSnapshot(): UsageState
  actions: UsageStoreActions
}

/** {@link createUsageStore} 的参数。 */
export interface UsageStoreOptions {
  /** `fetch` 替身，默认全局 `fetch`。 */
  fetchImpl?: typeof fetch
  /** 轮询间隔毫秒；`<= 0` 表示纯手动刷新。 */
  pollIntervalMs?: number
  /** 初始日期口径。 */
  initialDay?: string
  /** 初始 Key 过滤。 */
  initialKey?: string
  /** 每次请求的超时毫秒数。 */
  timeoutMs?: number
}

/** 面板 API 前缀；必须与宿主 `API_PREFIX` 一致。 */
export const API_PREFIX = '/api/dsh-qiniu-usage'

/** 单次请求超时；卡住的上游不该让请求堆积。 */
const DEFAULT_TIMEOUT_MS = 20_000

/** 初始状态。 */
function initialState(options: UsageStoreOptions): UsageState {
  return {
    status: 'idle',
    data: null,
    error: null,
    day: options.initialDay ?? 'today',
    key: options.initialKey ?? '',
    refreshing: false,
    updatedAt: null,
    keys: [],
    keyFilter: null,
    details: {},
    credentials: null,
    credentialsError: null,
  }
}

/**
 * 创建面板状态容器。
 *
 * @param options - 可注入的 `fetch`、轮询间隔与初始口径。
 * @returns 只读视图 + 动作。
 */
export function createUsageStore(options: UsageStoreOptions = {}): UsageStoreView {
  const doFetch = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  /** 可变：`setPollIntervalMs` 会原地改它，运行中也会重装定时器。 */
  let pollIntervalMs = options.pollIntervalMs ?? 0

  let state: UsageState = initialState(options)
  const listeners = new Set<() => void>()
  /** 请求序号：迟到的响应不得覆盖更新的状态。 */
  let seq = 0
  let timer: ReturnType<typeof setInterval> | undefined
  /** 面板是否在挂载周期内；关闭后不发请求。 */
  let running = false

  const emit = (next: UsageState): void => {
    state = next
    for (const listener of listeners) listener()
  }

  /** 发起一次带超时的 JSON 请求。 */
  const requestJson = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await doFetch(`${API_PREFIX}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      throw new Error(`${path} 请求失败：HTTP ${response.status}`)
    }
    return (await response.json()) as unknown
  }

  const isOverview = (value: unknown): value is OverviewPayload =>
    typeof value === 'object' && value !== null && 'errors' in value && 'usage' in value

  /** 拉取 overview（首屏或刷新）。 */
  const load = async (mode: 'initial' | 'refresh'): Promise<void> => {
    const requestSeq = seq + 1
    seq = requestSeq

    emit({
      ...state,
      status: mode === 'initial' && state.data === null ? 'loading' : state.status,
      refreshing: mode === 'refresh' || state.data !== null,
      error: null,
    })

    try {
      const path = mode === 'refresh' ? '/refresh' : '/overview'
      const query = `?day=${encodeURIComponent(state.day)}&key=${encodeURIComponent(state.key)}`
      const raw = await requestJson(`${path}${query}`, mode === 'refresh' ? { method: 'POST' } : undefined)
      if (requestSeq !== seq) return
      if (!isOverview(raw)) throw new Error('overview 返回了无法解析的载荷')

      emit({
        ...state,
        status: 'ready',
        data: raw,
        error: null,
        refreshing: false,
        updatedAt: Date.now(),
      })
    } catch (error) {
      if (requestSeq !== seq) return
      emit({
        ...state,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        refreshing: false,
      })
    }
  }

  /** 按当前间隔安装定时器；先清旧的。 */
  const armTimer = (): void => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
    if (!running || pollIntervalMs <= 0) return
    timer = setInterval(() => {
      void load('refresh')
    }, pollIntervalMs)
  }

  const actions: UsageStoreActions = {
    start(): void {
      if (running) return
      running = true
      void load('initial')
      armTimer()
    },

    stop(): void {
      running = false
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
      // 让在途响应对状态失效。
      seq += 1
    },

    setPollIntervalMs(intervalMs: number): void {
      const next = Number.isFinite(intervalMs) && intervalMs > 0 ? Math.round(intervalMs) : 0
      if (next === pollIntervalMs) return
      pollIntervalMs = next
      armTimer()
    },

    setDay(day: string): void {
      if (day === state.day) return
      emit({ ...state, day })
      void load('initial')
    },

    setKey(key: string): void {
      if (key === state.key) return
      emit({ ...state, key })
      void load('initial')
    },

    refresh(): void {
      void load('refresh')
    },

    loadKeys(): void {
      void (async () => {
        try {
          const raw = await requestJson(`/keys?day=${encodeURIComponent(state.day)}`)
          if (typeof raw !== 'object' || raw === null) return
          const keys = (raw as KeysPayload).keys
          if (!Array.isArray(keys)) return
          emit({ ...state, keys })
        } catch {
          // Key 清单是增强项，失败静默：面板仍可显示"全部 Key"。
        }
      })()
    },

    loadCredentials(): void {
      void (async () => {
        try {
          const raw = await requestJson('/credentials')
          if (typeof raw !== 'object' || raw === null) return
          const record = raw as { ok?: boolean; credentials?: CredentialsView; error?: { message?: string } }
          if (record.ok !== true || record.credentials === undefined) {
            emit({ ...state, credentialsError: record.error?.message ?? 'failed to read credential status' })
            return
          }
          emit({ ...state, credentials: record.credentials, credentialsError: null })
        } catch (error) {
          emit({
            ...state,
            credentialsError: error instanceof Error ? error.message : String(error),
          })
        }
      })()
    },

    async setCredential(ref: string, value: string): Promise<void> {
      const raw = await requestJson('/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref, action: 'set', value }),
      })
      const record = raw as { ok?: boolean; credentials?: CredentialsView; error?: { message?: string } }
      if (record.ok !== true) {
        // 只读遮蔽、引用不在白名单等都是可预期失败 —— 抛出以便表单就地显示。
        throw new Error(record.error?.message ?? 'failed to save credential')
      }
      emit({
        ...state,
        ...(record.credentials === undefined ? {} : { credentials: record.credentials }),
        credentialsError: null,
      })
      // 凭据变了，旧数据可能来自失效凭据 —— 重新取数。
      void load('refresh')
    },

    async unsetCredential(ref: string): Promise<void> {
      const raw = await requestJson('/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref, action: 'unset' }),
      })
      const record = raw as { ok?: boolean; credentials?: CredentialsView; error?: { message?: string } }
      if (record.ok !== true) {
        throw new Error(record.error?.message ?? 'failed to clear credential')
      }
      emit({
        ...state,
        ...(record.credentials === undefined ? {} : { credentials: record.credentials }),
        credentialsError: null,
      })
      void load('refresh')
    },

    loadDetail(orderHash: string, poId: number): void {
      const cacheKey = `${orderHash}:${poId}`
      if (state.details[cacheKey] !== undefined) return
      void (async () => {
        try {
          const raw = await requestJson(
            `/respack/detail?order_hash=${encodeURIComponent(orderHash)}&po_id=${poId}`,
          )
          if (typeof raw !== 'object' || raw === null) return
          const detail = (raw as { detail?: RespackDetail }).detail
          if (detail === undefined) return
          emit({ ...state, details: { ...state.details, [cacheKey]: detail } })
        } catch {
          // 下钻失败只影响这一行；不改变面板整体状态。
        }
      })()
    },
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    actions,
  }
}

/**
 * 面板里"是否所有数据源都失败"——用于区分"部分失败"与"整体失败"。
 *
 * @param data - 最近一次载荷。
 * @returns 两个数据源都缺失且至少有一条错误时为 `true`。
 */
export function isTotalFailure(data: OverviewPayload | null): boolean {
  if (data === null) return false
  return data.usage === null && data.respack === null && data.errors.length > 0
}

/**
 * 按数据源取错误，供 UI 分源展示。
 *
 * @param errors - 载荷里的错误列表。
 * @param source - 数据源。
 * @returns 该源的错误，或 `undefined`。
 */
export function errorFor(
  errors: SourceError[],
  source: SourceError['source'],
): SourceError | undefined {
  return errors.find((error) => error.source === source)
}

/**
 * Key 选择器的候选列表：始终包含"全部 Key"。
 *
 * @param keys - 上游与配置合并后的 Key 清单。
 * @param allLabel - "全部 Key"的显示文案。
 * @returns 选项数组。
 */
export function keyOptions(
  keys: KeysPayload['keys'],
  allLabel: string,
): { label: string; value: string; hasUsage: boolean }[] {
  return [
    { label: allLabel, value: '', hasUsage: true },
    ...keys.map((key) => ({ label: key.label, value: key.label, hasUsage: key.hasUsage })),
  ]
}
