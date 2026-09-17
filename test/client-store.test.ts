/**
 * 客户端 store 与格式化函数的测试。
 *
 * store 不依赖 React，`fetch` 可注入，因此在 node 环境下就能跑完整状态机：
 * 首屏、刷新保留旧数据、部分失败、竞态丢弃、以及"关页后零请求"。
 *
 * @module dsh-qiniu-usage/test/client-store
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import {
  API_PREFIX,
  createUsageStore,
  errorFor,
  isTotalFailure,
  keyOptions,
} from '../src/client/usage-store.ts'
import {
  formatAmount,
  formatClock,
  formatMonthDay,
  formatPercent,
  formatTokens,
  formatWatermark,
  truncate,
} from '../src/client/format.ts'
import type { OverviewPayload } from '../src/service.ts'

/** 休息若干毫秒（用于驱动轮询）。 */
const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 一份"成功"载荷。 */
function okPayload(overrides: Partial<OverviewPayload> = {}): OverviewPayload {
  return {
    ok: true,
    usage: {
      source: 'aksk',
      keyLabel: '全部 Key',
      keyMasked: '',
      day: '2026-01-01',
      granularity: 'hour',
      range: { start: 'a', end: 'b', timezone: 'Asia/Shanghai' },
      models: [],
      totals: { input: 0, output: 0, total: 1_000 },
      warnings: [],
      fetchedAt: '2026-01-01T00:00:00.000Z',
    },
    respack: null,
    errors: [],
    fetchedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 造一个可编排响应的 fetch 替身。 */
function makeFetch(routes: {
  overview?: () => Promise<Response> | Response
  refresh?: () => Promise<Response> | Response
  keys?: () => Promise<Response> | Response
  detail?: () => Promise<Response> | Response
}): { fetchImpl: typeof fetch; calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = []
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })

    if (url.startsWith(`${API_PREFIX}/refresh`)) {
      return routes.refresh === undefined ? json(okPayload()) : routes.refresh()
    }
    if (url.startsWith(`${API_PREFIX}/overview`)) {
      return routes.overview === undefined ? json(okPayload()) : routes.overview()
    }
    if (url.startsWith(`${API_PREFIX}/keys`)) {
      return routes.keys === undefined ? json({ keys: [] }) : routes.keys()
    }
    if (url.startsWith(`${API_PREFIX}/respack/detail`)) {
      return routes.detail === undefined ? json({ ok: true, detail: null }) : routes.detail()
    }
    return json({ error: 'unexpected' }, 404)
  }) as typeof fetch

  return { fetchImpl, calls }
}

/** 等到状态满足条件（或超时）。 */
async function waitFor(
  store: ReturnType<typeof createUsageStore>,
  predicate: (state: ReturnType<typeof store.getSnapshot>) => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate(store.getSnapshot())) return
    await tick(2)
  }
  throw new Error(`等待状态超时：${JSON.stringify(store.getSnapshot())}`)
}

describe('客户端 store · 首屏与状态机', () => {
  it('start 后从 loading 走到 ready，并带上 day/key query', async () => {
    const { fetchImpl, calls } = makeFetch({})
    const store = createUsageStore({ fetchImpl, initialDay: 'yesterday', initialKey: '生产Key' })

    store.actions.start()
    await waitFor(store, (state) => state.status === 'ready')

    const state = store.getSnapshot()
    assert.equal(state.data?.usage?.totals.total, 1_000)
    assert.equal(state.error, null)
    assert.equal(state.refreshing, false)
    assert.ok(state.updatedAt !== null, '应记录更新时间')

    const overview = calls.find((call) => call.url.includes('/overview'))
    assert.ok(overview !== undefined)
    assert.ok(overview.url.includes('day=yesterday'))
    assert.ok(overview.url.includes('key=%E7%94%9F%E4%BA%A7Key'), 'key 应被 URL 编码')
  })

  it('传输失败进入 error 状态并保留可读信息', async () => {
    const { fetchImpl } = makeFetch({ overview: () => new Response('nope', { status: 500 }) })
    const store = createUsageStore({ fetchImpl })

    store.actions.start()
    await waitFor(store, (state) => state.status === 'error')

    assert.ok(store.getSnapshot().error?.includes('500'))
    assert.equal(store.getSnapshot().data, null)
  })

  it('载荷形态不对时给出明确错误而不是静默', async () => {
    const { fetchImpl } = makeFetch({
      overview: () =>
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    const store = createUsageStore({ fetchImpl })
    store.actions.start()
    await waitFor(store, (state) => state.status === 'error')
    assert.ok(store.getSnapshot().error?.includes('无法解析'))
  })

  it('刷新保留旧数据（不闪空）', async () => {
    let resolveRefresh: ((value: Response) => void) | undefined
    const { fetchImpl } = makeFetch({
      refresh: () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve
        }),
    })
    const store = createUsageStore({ fetchImpl })

    store.actions.start()
    await waitFor(store, (state) => state.status === 'ready')
    const before = store.getSnapshot().data

    store.actions.refresh()
    // 刷新在途时：旧数据仍在，refreshing 为 true（对应顶部细进度条）。
    await waitFor(store, (state) => state.refreshing)
    assert.equal(store.getSnapshot().data, before, '刷新期间不得清空旧数据')
    assert.equal(store.getSnapshot().status, 'ready')

    resolveRefresh?.(
      new Response(JSON.stringify(okPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await waitFor(store, (state) => !state.refreshing)
    assert.equal(store.getSnapshot().status, 'ready')
  })

  it('refresh 走 POST /refresh', async () => {
    const { fetchImpl, calls } = makeFetch({})
    const store = createUsageStore({ fetchImpl })
    store.actions.start()
    await waitFor(store, (state) => state.status === 'ready')

    store.actions.refresh()
    await waitFor(store, (state) => !state.refreshing && state.status === 'ready')

    const refresh = calls.find((call) => call.url.includes('/refresh'))
    assert.ok(refresh !== undefined, '应请求 /refresh')
    assert.equal(refresh.method, 'POST')
  })

  it('切日期与切 Key 会立刻重新取数', async () => {
    const { fetchImpl, calls } = makeFetch({})
    const store = createUsageStore({ fetchImpl })
    store.actions.start()
    await waitFor(store, (state) => state.status === 'ready')

    const before = calls.length
    store.actions.setDay('yesterday')
    await waitFor(store, (state) => state.day === 'yesterday' && state.status === 'ready')
    assert.ok(calls.length > before, '切日期应触发请求')

    const afterDay = calls.length
    store.actions.setKey('生产Key')
    await waitFor(store, (state) => state.key === '生产Key' && state.status === 'ready')
    assert.ok(calls.length > afterDay, '切 Key 应触发请求')
  })

  it('切到同样的值不重复请求', async () => {
    const { fetchImpl, calls } = makeFetch({})
    const store = createUsageStore({ fetchImpl, initialDay: 'today' })
    store.actions.start()
    await waitFor(store, (state) => state.status === 'ready')

    const before = calls.length
    store.actions.setDay('today')
    store.actions.setKey('')
    await tick(10)
    assert.equal(calls.length, before, '同值 set 不应触发请求')
  })

  it('迟到的响应不覆盖更新的状态（竞态防护）', async () => {
    let resolveSlow: ((value: Response) => void) | undefined
    let callCount = 0
    const { fetchImpl } = makeFetch({
      overview: () => {
        callCount += 1
        if (callCount === 1) {
          // 第一次请求故意很慢
          return new Promise<Response>((resolve) => {
            resolveSlow = resolve
          })
        }
        // 第二次立即返回不同的总量
        return new Response(
          JSON.stringify(okPayload({
            usage: { ...okPayload().usage!, totals: { input: 0, output: 0, total: 999 } },
          })),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })

    const store = createUsageStore({ fetchImpl })
    store.actions.start()
    // 第二个请求（切日期）先完成
    store.actions.setDay('yesterday')
    await waitFor(store, (state) => state.data?.usage?.totals.total === 999)

    // 现在让慢的第一次请求返回一个不同的值 —— 它必须被丢弃
    resolveSlow?.(
      new Response(
        JSON.stringify(okPayload({
          usage: { ...okPayload().usage!, totals: { input: 0, output: 0, total: 111 } },
        })),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    await tick(20)
    assert.equal(
      store.getSnapshot().data?.usage?.totals.total,
      999,
      '迟到的旧响应必须被丢弃',
    )
  })
})

describe('客户端 store · 挂载周期与轮询', () => {
  it('stop 之后不再发请求（关页零请求）', async () => {
    const { fetchImpl, calls } = makeFetch({})
    const store = createUsageStore({ fetchImpl, pollIntervalMs: 5 })
    store.actions.start()
    await waitFor(store, (state) => state.status === 'ready')

    // 轮询确实在工作
    await tick(30)
    const duringRun = calls.filter((call) => call.url.includes('/refresh')).length
    assert.ok(duringRun >= 1, `轮询应产生请求，实际 ${duringRun}`)

    store.actions.stop()
    const afterStop = calls.length
    await tick(40)
    assert.equal(calls.length, afterStop, 'stop 后不得再有任何请求')
  })

  it('pollIntervalMs<=0 时不轮询', async () => {
    const { fetchImpl, calls } = makeFetch({})
    const store = createUsageStore({ fetchImpl, pollIntervalMs: 0 })
    store.actions.start()
    await waitFor(store, (state) => state.status === 'ready')

    const before = calls.length
    await tick(30)
    assert.equal(calls.length, before, '纯手动模式下不应有轮询请求')
  })

  it('setPollIntervalMs 运行中生效（原地改而不是重建）', async () => {
    const { fetchImpl, calls } = makeFetch({})
    const store = createUsageStore({ fetchImpl, pollIntervalMs: 0 })
    store.actions.start()
    await waitFor(store, (state) => state.status === 'ready')

    store.actions.setPollIntervalMs(5)
    await tick(40)
    assert.ok(
      calls.filter((call) => call.url.includes('/refresh')).length >= 1,
      '运行中开启轮询后应开始刷新',
    )

    store.actions.setPollIntervalMs(0)
    await tick(15)
    const afterDisable = calls.length
    await tick(40)
    assert.equal(calls.length, afterDisable, '关闭轮询后应停止刷新')
  })

  it('重复 start 只装一个定时器', async () => {
    const { fetchImpl, calls } = makeFetch({})
    const store = createUsageStore({ fetchImpl, pollIntervalMs: 5 })
    store.actions.start()
    store.actions.start()
    await waitFor(store, (state) => state.status === 'ready')

    const initialOverviews = calls.filter((call) => call.url.includes('/overview')).length
    assert.equal(initialOverviews, 1, '重复 start 不应重复首屏请求')
    store.actions.stop()
  })
})

describe('客户端 store · keys 与下钻', () => {
  it('loadKeys 填充候选集', async () => {
    const { fetchImpl } = makeFetch({
      keys: () =>
        new Response(
          JSON.stringify({ keys: [{ label: 'A', masked: 'a*****z', hasUsage: true, hasToken: false }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })
    const store = createUsageStore({ fetchImpl })
    store.actions.loadKeys()
    await waitFor(store, (state) => state.keys.length > 0)
    assert.equal(store.getSnapshot().keys[0]?.label, 'A')
  })

  it('loadKeys 失败时静默（面板仍可用）', async () => {
    const { fetchImpl } = makeFetch({ keys: () => new Response('boom', { status: 500 }) })
    const store = createUsageStore({ fetchImpl })
    store.actions.loadKeys()
    await tick(20)
    assert.deepEqual(store.getSnapshot().keys, [])
  })

  it('loadDetail 缓存结果，重复请求不重复打上游', async () => {
    const { fetchImpl, calls } = makeFetch({
      detail: () =>
        new Response(
          JSON.stringify({ ok: true, detail: { name: '包', unit: 'GB', deductDetails: [] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })
    const store = createUsageStore({ fetchImpl })

    store.actions.loadDetail('hash1', 42)
    await waitFor(store, (state) => state.details['hash1:42'] !== undefined)
    assert.equal(store.getSnapshot().details['hash1:42']?.name, '包')

    store.actions.loadDetail('hash1', 42)
    await tick(10)
    assert.equal(calls.filter((call) => call.url.includes('/respack/detail')).length, 1)
  })

  it('loadDetail 失败不影响面板状态', async () => {
    const { fetchImpl } = makeFetch({ detail: () => new Response('boom', { status: 500 }) })
    const store = createUsageStore({ fetchImpl })
    store.actions.loadDetail('hash1', 42)
    await tick(20)
    assert.equal(store.getSnapshot().status, 'idle', '下钻失败不应改变面板状态')
    assert.deepEqual(store.getSnapshot().details, {})
  })
})

describe('客户端 store · 纯函数辅助', () => {
  it('isTotalFailure 只在两个源都缺失且有错误时为真', () => {
    assert.equal(isTotalFailure(null), false)
    assert.equal(isTotalFailure(okPayload()), false)
    assert.equal(
      isTotalFailure(okPayload({
        usage: null,
        respack: null,
        errors: [{ source: 'usage', message: 'x', isAuthError: true, isForbidden: false }],
      })),
      true,
    )
    assert.equal(
      isTotalFailure(okPayload({
        usage: null,
        errors: [],
      })),
      false,
      '没有错误就不算整体失败',
    )
  })

  it('errorFor 按源取错误', () => {
    const errors = [
      { source: 'usage' as const, message: 'u', isAuthError: false, isForbidden: false },
      { source: 'respack' as const, message: 'r', code: 1013, isAuthError: false, isForbidden: true },
    ]
    assert.equal(errorFor(errors, 'usage')?.message, 'u')
    assert.equal(errorFor(errors, 'respack')?.code, 1013)
    assert.equal(errorFor([], 'usage'), undefined)
  })

  it('keyOptions 始终含"全部 Key"且在最前', () => {
    const options = keyOptions([{ label: 'A', masked: '', hasUsage: true, hasToken: false }], '全部 Key（汇总）')
    assert.equal(options.length, 2)
    assert.equal(options[0]?.value, '')
    assert.equal(options[0]?.label, '全部 Key（汇总）')
    assert.equal(options[1]?.label, 'A')
  })
})

describe('客户端格式化', () => {
  it('formatTokens 用 K/M/B 紧凑表示', () => {
    assert.equal(formatTokens(0), '0')
    assert.equal(formatTokens(999), '999')
    assert.equal(formatTokens(1_000), '1K')
    assert.equal(formatTokens(1_550_000), '1.55M')
    assert.equal(formatTokens(2_080_000), '2.08M')
    assert.equal(formatTokens(1_000_000_000), '1B')
  })

  it('formatTokens 去掉多余尾随零', () => {
    assert.equal(formatTokens(2_000_000), '2M')
    assert.equal(formatTokens(2_500_000), '2.5M')
  })

  it('formatTokens 对非法输入返回 0', () => {
    assert.equal(formatTokens(undefined), '0')
    assert.equal(formatTokens(Number.NaN), '0')
    assert.equal(formatTokens(Number.POSITIVE_INFINITY), '0')
  })

  it('formatPercent 取整', () => {
    assert.equal(formatPercent(0.68), '68%')
    assert.equal(formatPercent(0), '0%')
    assert.equal(formatPercent(1), '100%')
    assert.equal(formatPercent(undefined), '0%')
  })

  it('formatClock 按东八区显示 HH:MM:SS', () => {
    // 2026-01-01T04:00:00Z → 东八区 12:00:00
    assert.equal(formatClock(Date.parse('2026-01-01T04:00:00Z')), '12:00:00')
    assert.equal(formatClock(null), '')
    assert.equal(formatClock(undefined), '')
  })

  it('formatWatermark 按东八区显示 HH:MM', () => {
    assert.equal(formatWatermark('2026-01-01T04:00:00Z'), '12:00')
    assert.equal(formatWatermark(undefined), '')
    assert.equal(formatWatermark('garbage'), '')
  })

  it('formatMonthDay 按东八区显示 MM-DD', () => {
    assert.equal(formatMonthDay('2026-01-01T00:00:00+08:00'), '01-01')
    assert.equal(formatMonthDay('2025-12-31T16:00:00Z'), '01-01', '跨时区应归到东八区次日')
    assert.equal(formatMonthDay(''), '')
    assert.equal(formatMonthDay('garbage'), 'garbage')
  })

  it('formatAmount 拼单位', () => {
    assert.equal(formatAmount(1280, 'GB'), '1.28K GB')
    assert.equal(formatAmount(10, ''), '10')
  })

  it('truncate 保留长度上限', () => {
    assert.equal(truncate('short', 28), 'short')
    assert.equal(truncate('x'.repeat(40), 10).length, 10)
    assert.ok(truncate('x'.repeat(40), 10).endsWith('…'))
  })
})
