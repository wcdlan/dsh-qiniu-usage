/**
 * 缓存 / single-flight / 限速的单元测试。
 *
 * 三者都注入了时钟与睡眠，因此测试不需要真的等待。
 *
 * @module dsh-qiniu-usage/test/cache
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { RateLimiter, SingleFlight, TtlCache } from '../src/core/cache.ts'

/** 手动推进的时钟。 */
function makeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe('TtlCache', () => {
  it('未过期时命中，过期后落空', () => {
    const clock = makeClock()
    const cache = new TtlCache<number>({ now: clock.now })
    cache.set('a', 1, 1_000)

    assert.equal(cache.get('a'), 1)
    clock.advance(999)
    assert.equal(cache.get('a'), 1, '999ms 时仍应命中')
    clock.advance(1)
    assert.equal(cache.get('a'), undefined, '1000ms 时应过期')
    assert.equal(cache.size, 0, '过期条目应被顺手删除')
  })

  it('invalidate 指定键只删该键', () => {
    const cache = new TtlCache<number>()
    cache.set('a', 1, 10_000)
    cache.set('b', 2, 10_000)
    cache.invalidate('a')
    assert.equal(cache.get('a'), undefined)
    assert.equal(cache.get('b'), 2)
  })

  it('invalidate 不传参时清空全部', () => {
    const cache = new TtlCache<number>()
    cache.set('a', 1, 10_000)
    cache.set('b', 2, 10_000)
    cache.invalidate()
    assert.equal(cache.size, 0)
  })

  it('超过容量时淘汰最久未使用的一条', () => {
    const cache = new TtlCache<string>({ maxEntries: 2 })
    cache.set('a', 'A', 10_000)
    cache.set('b', 'B', 10_000)
    // 访问 a，使 b 变成最久未使用。
    assert.equal(cache.get('a'), 'A')
    cache.set('c', 'C', 10_000)

    assert.equal(cache.get('b'), undefined, 'b 应被淘汰')
    assert.equal(cache.get('a'), 'A')
    assert.equal(cache.get('c'), 'C')
  })

  it('重复写同一键应刷新值而不是占用两个槽位', () => {
    const cache = new TtlCache<number>({ maxEntries: 2 })
    cache.set('a', 1, 10_000)
    cache.set('a', 2, 10_000)
    assert.equal(cache.size, 1)
    assert.equal(cache.get('a'), 2)
  })
})

describe('SingleFlight', () => {
  it('同一键的并发调用只执行一次', async () => {
    const flight = new SingleFlight<number>()
    let calls = 0
    const task = async (): Promise<number> => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return 42
    }

    const results = await Promise.all([
      flight.run('k', task),
      flight.run('k', task),
      flight.run('k', task),
    ])

    assert.deepEqual(results, [42, 42, 42])
    assert.equal(calls, 1, '三次并发应只触发一次真实执行')
  })

  it('不同键各自执行', async () => {
    const flight = new SingleFlight<string>()
    let calls = 0
    const task = async (tag: string): Promise<string> => {
      calls += 1
      return tag
    }
    assert.equal(await flight.run('a', () => task('a')), 'a')
    assert.equal(await flight.run('b', () => task('b')), 'b')
    assert.equal(calls, 2)
  })

  it('失败不会被缓存成在途：下一次调用重新执行', async () => {
    const flight = new SingleFlight<number>()
    let calls = 0
    const failing = async (): Promise<number> => {
      calls += 1
      throw new Error('boom')
    }

    await assert.rejects(() => flight.run('k', failing), /boom/)
    assert.equal(flight.inflightCount, 0, '失败后应移除在途记录')
    await assert.rejects(() => flight.run('k', failing), /boom/)
    assert.equal(calls, 2, '第二次应重新执行')
  })

  it('执行完成后在途记录被清理', async () => {
    const flight = new SingleFlight<number>()
    await flight.run('k', async () => 1)
    assert.equal(flight.inflightCount, 0)
  })
})

describe('RateLimiter', () => {
  it('相邻任务间隔不小于最小间隔', async () => {
    const clock = makeClock(0)
    const sleeps: number[] = []
    const limiter = new RateLimiter({
      minIntervalMs: 250,
      now: clock.now,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        clock.advance(ms)
      },
    })

    const startedAt: number[] = []
    await Promise.all([
      limiter.run(async () => {
        startedAt.push(clock.now())
      }),
      limiter.run(async () => {
        startedAt.push(clock.now())
      }),
      limiter.run(async () => {
        startedAt.push(clock.now())
      }),
    ])

    assert.equal(startedAt.length, 3)
    // 第一个不需要等待，后两个各等 250ms。
    assert.deepEqual(sleeps, [250, 250])
    assert.deepEqual(startedAt, [0, 250, 500])
    assert.equal(limiter.throttledCount, 2)
  })

  it('间隔已经足够时不睡眠', async () => {
    const clock = makeClock(0)
    const sleeps: number[] = []
    const limiter = new RateLimiter({
      minIntervalMs: 250,
      now: clock.now,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        clock.advance(ms)
      },
    })

    await limiter.run(async () => {})
    clock.advance(1_000)
    await limiter.run(async () => {})

    assert.deepEqual(sleeps, [], '间隔足够时不应睡眠')
    assert.equal(limiter.throttledCount, 0)
  })

  it('任务串行执行，不会交叉', async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0, sleep: async () => {} })
    const order: string[] = []

    await Promise.all([
      limiter.run(async () => {
        order.push('a-start')
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push('a-end')
      }),
      limiter.run(async () => {
        order.push('b-start')
        order.push('b-end')
      }),
    ])

    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'], '第二个任务必须等第一个结束')
  })

  it('任务抛错不会卡死队列', async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0, sleep: async () => {} })
    await assert.rejects(() => limiter.run(async () => {
      throw new Error('boom')
    }), /boom/)
    assert.equal(await limiter.run(async () => 'ok'), 'ok')
  })
})
