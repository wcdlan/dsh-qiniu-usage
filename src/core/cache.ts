// 缓存、single-flight 与上游限速。设计文档 §8.2 / §8.3；纯内存、无落盘、可注入时钟。

interface Entry<T> {
  value: T
    // 过期时间戳；`Infinity` 表示永不过期（用于被显式失效的条目）。
  expiresAt: number
}

// 只缓存**聚合结果**，不缓存原始响应体（设计文档 §8.2）。
export class TtlCache<T> {
  readonly #entries = new Map<string, Entry<T>>()
  readonly #maxEntries: number
  readonly #now: () => number

  constructor(options: { maxEntries?: number; now?: () => number } = {}) {
    this.#maxEntries = options.maxEntries ?? 200
    this.#now = options.now ?? Date.now
  }

  get size(): number {
    return this.#entries.size
  }

  get(key: string): T | undefined {
    const entry = this.#entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key)
      return undefined
    }
    // LRU：命中后移动到队尾。
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: T, ttlMs: number): void {
    this.#entries.delete(key)
    this.#entries.set(key, { value, expiresAt: this.#now() + ttlMs })
    while (this.#entries.size > this.#maxEntries) {
      // Map 迭代顺序即插入顺序，首个就是最久未使用的。
      const oldest = this.#entries.keys().next()
      if (oldest.done === true) break
      this.#entries.delete(oldest.value)
    }
  }

    // 不传 key 时清空全部；`/refresh` 用它跳过 TTL 强制重取。
  invalidate(key?: string): void {
    if (key === undefined) this.#entries.clear()
    else this.#entries.delete(key)
  }

  clear(): void {
    this.#entries.clear()
  }
}

// 合并同键并发调用；失败后立即移除在途记录，不能把失败也缓存成"在途"。
export class SingleFlight<T> {
  readonly #inflight = new Map<string, Promise<T>>()

  get inflightCount(): number {
    return this.#inflight.size
  }

  async run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.#inflight.get(key)
    if (existing !== undefined) return existing
    const promise = fn().finally(() => {
      this.#inflight.delete(key)
    })
    this.#inflight.set(key, promise)
    return promise
  }
}

// 串行限速队列：相邻任务开始时间间隔不小于 `minIntervalMs`。七牛用量接口限流为同一 IP
// **5 次/秒**，设计取 ≥250ms 间隔并留余量；用量与资源包共用同一个队列。
export class RateLimiter {
  readonly #minIntervalMs: number
  readonly #now: () => number
  readonly #sleep: (ms: number) => Promise<void>
  #tail: Promise<unknown> = Promise.resolve()
  #lastStartedAt = Number.NEGATIVE_INFINITY
    // 因限速而等待过的次数，用于诊断是否真的在限速。
  #throttledCount = 0

  constructor(
    options: {
      minIntervalMs?: number
      now?: () => number
      sleep?: (ms: number) => Promise<void>
    } = {},
  ) {
    this.#minIntervalMs = options.minIntervalMs ?? 250
    this.#now = options.now ?? Date.now
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  get throttledCount(): number {
    return this.#throttledCount
  }

  get minIntervalMs(): number {
    return this.#minIntervalMs
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.#tail
    let release: () => void = () => {}
    this.#tail = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous.catch(() => undefined)

    const wait = this.#lastStartedAt + this.#minIntervalMs - this.#now()
    if (wait > 0) {
      this.#throttledCount += 1
      await this.#sleep(wait)
    }
    this.#lastStartedAt = this.#now()

    try {
      return await task()
    } finally {
      release()
    }
  }
}
