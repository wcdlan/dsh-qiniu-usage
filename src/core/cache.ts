/**
 * 缓存、single-flight 与上游限速三件套。
 *
 * 设计文档 §8.2 / §8.3。都是纯内存、无落盘、可注入时钟，因此能直接单测。
 *
 * @module dsh-qiniu-usage/core/cache
 */

/** 单条缓存的元信息。 */
interface Entry<T> {
  value: T
  /** 过期时间戳（毫秒）。`Infinity` 表示永不过期（用于被显式失效的条目）。 */
  expiresAt: number
}

/**
 * 带 TTL 与 LRU 淘汰的取值缓存。
 *
 * 只缓存**聚合结果**，不缓存原始响应体 —— 设计文档 §8.2。
 */
export class TtlCache<T> {
  readonly #entries = new Map<string, Entry<T>>()
  readonly #maxEntries: number
  readonly #now: () => number

  /**
   * @param options - 容量上限与时钟。
   */
  constructor(options: { maxEntries?: number; now?: () => number } = {}) {
    this.#maxEntries = options.maxEntries ?? 200
    this.#now = options.now ?? Date.now
  }

  /** 当前条目数，用于测试与诊断。 */
  get size(): number {
    return this.#entries.size
  }

  /**
   * 读一条缓存。
   *
   * @param key - 缓存键。
   * @returns 未过期时返回值，否则 `undefined`（并顺手删除过期条目）。
   */
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

  /**
   * 写一条缓存。
   *
   * @param key - 缓存键。
   * @param value - 值。
   * @param ttlMs - 存活毫秒数。
   */
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

  /**
   * 失效指定键，或（不传参时）清空全部。
   *
   * `/refresh` 用它跳过 TTL 强制重取。
   *
   * @param key - 可选缓存键。
   */
  invalidate(key?: string): void {
    if (key === undefined) this.#entries.clear()
    else this.#entries.delete(key)
  }

  /** 清空。 */
  clear(): void {
    this.#entries.clear()
  }
}

/**
 * single-flight：把同一键上的并发调用合并为一次真实执行。
 *
 * 所有等待者拿到同一个 Promise 的结果（含失败）。失败后立即移除在途记录，
 * 因此下一次调用会重新执行 —— 不能把失败也缓存成"在途"。
 */
export class SingleFlight<T> {
  readonly #inflight = new Map<string, Promise<T>>()

  /** 当前在途数量，用于测试与诊断。 */
  get inflightCount(): number {
    return this.#inflight.size
  }

  /**
   * 在 `key` 上执行 `fn`，同一键的并发调用共享结果。
   *
   * @param key - 合并键。
   * @param fn - 真实执行体。
   * @returns 执行结果。
   */
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

/**
 * 串行限速队列：保证相邻任务开始时间间隔不小于 `minIntervalMs`。
 *
 * 七牛用量接口限流为同一 IP **5 次/秒**，设计取 ≥250ms 间隔并留余量。
 * 用量与资源包共用同一个队列。
 */
export class RateLimiter {
  readonly #minIntervalMs: number
  readonly #now: () => number
  readonly #sleep: (ms: number) => Promise<void>
  #tail: Promise<unknown> = Promise.resolve()
  #lastStartedAt = Number.NEGATIVE_INFINITY
  /** 已观测到的、小于最小间隔的等待次数，用于诊断是否真的在限速。 */
  #throttledCount = 0

  /**
   * @param options - 最小间隔、时钟与睡眠实现（便于测试注入）。
   */
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

  /** 因限速而等待过的次数。 */
  get throttledCount(): number {
    return this.#throttledCount
  }

  /** 最小间隔（毫秒）。 */
  get minIntervalMs(): number {
    return this.#minIntervalMs
  }

  /**
   * 排队执行一个任务；队列严格串行。
   *
   * @param task - 任务体。
   * @returns 任务结果。
   */
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
