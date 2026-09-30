// 客户端状态。刻意不依赖平台内部 store 引擎（`@deepseek-ai/dsh-client-store` 不在
// profile 顶层），而用 React 的 `useSyncExternalStore`，契约只有 `subscribe` + `getSnapshot`。
// `fetch` 可注入，状态机（首屏 / 刷新保留旧数据 / 部分失败 / 全失败）可直接单测。

import type {KeysPayload, OverviewPayload, SourceError} from '../service.ts'
import type {RespackDetail} from '../qiniu/respack.ts'
import type {CredentialsView} from './CredentialsForm.tsx'

export type UiStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface UsageState {
  status: UiStatus
    // 刷新期间保留旧值以免闪空。
  data: OverviewPayload | null
  error: string | null
  day: string
    // 空串 = 账号全量汇总。
  key: string
  refreshing: boolean
  updatedAt: number | null
  keys: KeysPayload['keys']
  keyFilter: string | null
    // 按 `orderHash:poId` 缓存。
  details: Record<string, RespackDetail>
    // describe 形状，永不含值；未加载时为 `null`。
  credentials: CredentialsView | null
  credentialsError: string | null
}

export interface UsageStoreActions {
  start(): void
  stop(): void
  setDay(day: string): void
  setKey(key: string): void

    // 详情弹窗"选具体 Key 就切到昨天"用，**只取一次数**：分两次调用会打两次上游，
    // 而上游限速 5 次/秒。
  setFilters(day: string, key: string): void
  refresh(): void
  loadKeys(): void
  loadDetail(orderHash: string, poId: number): void

    // **必须原地更新而不是重建 store**：注入面（`face`）在分区注册时就把它捕获进闭包，
    // 重建的实例组件拿不到。毫秒，`<= 0` 为纯手动。
  setPollIntervalMs(intervalMs: number): void
  loadCredentials(): void
  setCredential(ref: string, value: string): Promise<void>
  unsetCredential(ref: string): Promise<void>
}

export interface UsageStoreView {
  subscribe(listener: () => void): () => void
  getSnapshot(): UsageState
  actions: UsageStoreActions
}

export interface UsageStoreOptions {
  fetchImpl?: typeof fetch
    // `<= 0` 表示纯手动刷新。
  pollIntervalMs?: number
  initialDay?: string
  initialKey?: string
  timeoutMs?: number
}

// 必须与宿主 `API_PREFIX` 一致。
export const API_PREFIX = '/api/dsh-qiniu-usage'

// 卡住的上游不该让请求堆积。
const DEFAULT_TIMEOUT_MS = 20_000

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

export function createUsageStore(options: UsageStoreOptions = {}): UsageStoreView {
  const doFetch = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let pollIntervalMs = options.pollIntervalMs ?? 0

  let state: UsageState = initialState(options)
  const listeners = new Set<() => void>()
    // 请求序号：迟到的响应不得覆盖更新的状态。
  let seq = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  const emit = (next: UsageState): void => {
    state = next
    for (const listener of listeners) listener()
  }

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

    setFilters(day: string, key: string): void {
      if (day === state.day && key === state.key) return
      emit({ ...state, day, key })
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

export function isTotalFailure(data: OverviewPayload | null): boolean {
  if (data === null) return false
  return data.usage === null && data.respack === null && data.errors.length > 0
}

export function errorFor(
  errors: SourceError[],
  source: SourceError['source'],
): SourceError | undefined {
  return errors.find((error) => error.source === source)
}

// Key 选择器候选；`hasUsage` 原样透传上游三态：`undefined` 表示所选日期上游没有 Key
// 归属信息（当天数据尚未归属），此时**不能**标"无用量"。
export function keyOptions(
  keys: KeysPayload['keys'],
  allLabel: string,
): { label: string; value: string; hasUsage?: boolean }[] {
  return [
    { label: allLabel, value: '', hasUsage: true },
    ...keys.map((key) => ({ label: key.label, value: key.label, hasUsage: key.hasUsage })),
  ]
}
