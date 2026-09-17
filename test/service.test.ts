/**
 * 服务层测试：缓存、single-flight、失败隔离、日期口径、鉴权降级。
 *
 * 全部用注入的 `fetch` 替身，不触网。
 *
 * @module dsh-qiniu-usage/test/service
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { CredentialAccess } from '../src/credentials.ts'
import { resolveConfig } from '../src/config.ts'
import { planUsageQuery, QiniuUsageService, toSourceError } from '../src/service.ts'
import { QiniuUpstreamError } from '../src/qiniu/http.ts'
import { akskKeyGroups, akskTwoKeys, bearerFlatModels } from './fixtures/usage.ts'
import {
  monthOverviewPage,
  respackDetailMixedTypes,
  respackListPage,
} from './fixtures/respack.ts'

/** 固定的"当前时刻"：2026-01-01 12:00 +08:00。 */
const NOW_MS = Date.parse('2026-01-01T04:00:00Z')

/** 造一个按 URL 分派的 fetch 替身：用量与资源包各自返回对应外壳。 */
function makeFetchStub(
  data: unknown,
  options: { status?: number; body?: unknown; respack?: 'ok' | 'forbidden' | 'fail' } = {},
): { fetchImpl: typeof fetch; calls: URL[] } {
  const calls: URL[] = []
  const respackMode = options.respack ?? 'ok'

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(String(input))
    calls.push(url)

    // 财务 API（api.qiniu.com）走 qiniu 外壳，单独分派。
    if (url.pathname.startsWith('/billing-api/')) {
      if (respackMode === 'forbidden') {
        return new Response(JSON.stringify({ code: 1013, message: 'GetBalanceOverviewFailed' }), {
          status: 403,
        })
      }
      if (respackMode === 'fail') {
        return new Response(JSON.stringify({ code: 1010, message: 'RespackOverviewGetFailed' }), {
          status: 200,
        })
      }
      if (url.pathname.endsWith('/month-overview')) {
        return new Response(
          JSON.stringify({ code: 0, message: 'Success', data: monthOverviewPage }),
          { status: 200 },
        )
      }
      if (url.pathname.endsWith('/list')) {
        return new Response(JSON.stringify({ code: 0, message: 'Success', data: respackListPage }), {
          status: 200,
        })
      }
      if (url.pathname.endsWith('/detail')) {
        return new Response(
          JSON.stringify({ code: 0, message: 'Success', data: respackDetailMixedTypes }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ code: 0, message: 'Success', data: [] }), { status: 200 })
    }

    const status = options.status ?? 200
    const payload = options.body ?? { status: true, data }
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

/** 只统计打向用量接口的请求；资源包请求共用同一个替身。 */
function usageCalls(calls: URL[]): URL[] {
  return calls.filter((url) => url.hostname === 'api.qnaigc.com')
}

/** 用固定凭据的执行环境造一个服务。 */
function makeService(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof resolveConfig>[0]> = {},
): QiniuUsageService {
  return new QiniuUsageService({
    config: resolveConfig({ todayTtlSec: 60, dashboardTtlSec: 600, ...overrides }),
    credentials: new CredentialAccess(
      {
        resolve: async (ref: string) =>
          ref === 'QINIU_ACCESS_KEY'
            ? { value: 'MY_ACCESS_KEY', source: 'file' }
            : { value: 'MY_SECRET_KEY', source: 'file' },
        describe: async () => ({ configured: true, source: 'file', writable: true }),
        set: async () => {},
        unset: async () => {},
      },
      {},
    ),
    fetchImpl,
    now: () => NOW_MS,
    // 限速不睡眠：本文件关心的是缓存与合并，限速有自己的测试。
    sleep: async () => {},
    minRequestIntervalMs: 0,
  })
}

describe('planUsageQuery · 日期口径', () => {
  it('今天 → hour 粒度，窗口从 00:00 到此刻（+08:00）', () => {
    const plan = planUsageQuery('today', NOW_MS)
    assert.equal(plan.granularity, 'hour')
    assert.equal(plan.day, '2026-01-01')
    assert.equal(plan.start, '2026-01-01T00:00:00+08:00')
    assert.equal(plan.end, '2026-01-01T12:00:00+08:00')
  })

  it('昨天 → day 粒度，全天', () => {
    const plan = planUsageQuery('yesterday', NOW_MS)
    assert.equal(plan.granularity, 'day')
    assert.equal(plan.day, '2025-12-31')
    assert.equal(plan.start, '2025-12-31T00:00:00+08:00')
    assert.equal(plan.end, '2025-12-31T23:59:59+08:00')
  })

  it('指定历史日期 → day 粒度', () => {
    const plan = planUsageQuery('2025-11-20', NOW_MS)
    assert.equal(plan.granularity, 'day')
    assert.equal(plan.day, '2025-11-20')
    assert.equal(plan.start, '2025-11-20T00:00:00+08:00')
  })

  it('空串按今天处理', () => {
    assert.equal(planUsageQuery('', NOW_MS).granularity, 'hour')
  })

  it('显式传入今天日期时也走 hour 粒度', () => {
    assert.equal(planUsageQuery('2026-01-01', NOW_MS).granularity, 'hour')
  })

  it('跨时区边界：UTC 00:00 时东八区已是次日', () => {
    const plan = planUsageQuery('today', Date.parse('2025-12-31T16:00:00Z'))
    assert.equal(plan.day, '2026-01-01', '东八区 2026-01-01 00:00')
  })
})

describe('服务 · 用量取数与归一', () => {
  it('账号级汇总返回归一快照', async () => {
    const { fetchImpl } = makeFetchStub(akskKeyGroups)
    const payload = await makeService(fetchImpl).overview('today', '')

    assert.equal(payload.ok, true)
    assert.equal(payload.errors.length, 0)
    assert.equal(payload.usage?.totals.total, 2_080_000)
    assert.equal(payload.usage?.models.length, 2)
  })

  it('请求 URL 带上正确的 query（含时区）且被签名', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskKeyGroups)
    await makeService(fetchImpl).overview('yesterday', '')

    const usage = usageCalls(calls)
    assert.equal(usage.length, 1)
    const url = usage[0]
    assert.ok(url)
    assert.equal(url.origin + url.pathname, 'https://api.qnaigc.com/v3/stat/usage')
    assert.equal(url.searchParams.get('granularity'), 'day')
    assert.equal(url.searchParams.get('timezone'), 'Asia/Shanghai')
    assert.equal(url.searchParams.get('start'), '2025-12-31T00:00:00+08:00')
  })

  it('今天（hour 粒度）附带数据延迟告警；昨天（day）不附带', async () => {
    const todayStub = makeFetchStub(akskKeyGroups)
    const today = await makeService(todayStub.fetchImpl).overview('today', '')
    assert.ok(today.usage?.warnings.some((w) => w.includes('延迟')))

    const yesterdayStub = makeFetchStub(akskKeyGroups)
    const yesterday = await makeService(yesterdayStub.fetchImpl).overview('yesterday', '')
    assert.ok(
      !yesterday.usage?.warnings.some((w) => w.includes('延迟')),
      `day 粒度不应有延迟告警：${JSON.stringify(yesterday.usage?.warnings)}`,
    )
  })

  it('按 Key 筛选只统计该 Key', async () => {
    const { fetchImpl } = makeFetchStub(akskTwoKeys)
    const payload = await makeService(fetchImpl).overview('yesterday', '生产Key')
    assert.equal(payload.usage?.keyLabel, '生产Key')
    assert.equal(payload.usage?.totals.total, 100_000, '只应含生产Key 的 100 kToken 输入')
  })
})

describe('服务 · 缓存与 single-flight', () => {
  it('同一查询在 TTL 内只打一次上游', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskKeyGroups)
    const service = makeService(fetchImpl)

    await service.overview('yesterday', '')
    await service.overview('yesterday', '')
    await service.overview('yesterday', '')

    assert.equal(usageCalls(calls).length, 1, '三次调用应只打一次上游')
  })

  it('不同 Key 的查询各自缓存', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskTwoKeys)
    const service = makeService(fetchImpl)

    await service.overview('yesterday', '')
    await service.overview('yesterday', '生产Key')
    assert.equal(usageCalls(calls).length, 2, '账号级与单 Key 是两个缓存键')
  })

  it('并发同键查询被 single-flight 合并', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskKeyGroups)
    const service = makeService(fetchImpl)

    const results = await Promise.all([
      service.overview('yesterday', ''),
      service.overview('yesterday', ''),
      service.overview('yesterday', ''),
    ])

    assert.equal(usageCalls(calls).length, 1, '并发应合并为一次上游调用')
    assert.equal(results[0]?.usage?.totals.total, 2_080_000)
  })

  it('refresh 跳过 TTL 强制重取', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskKeyGroups)
    const service = makeService(fetchImpl)

    await service.overview('yesterday', '')
    assert.equal(usageCalls(calls).length, 1)
    await service.refresh('yesterday', '')
    assert.equal(usageCalls(calls).length, 2, 'refresh 必须穿透缓存')
  })

  it('配置热更新会清空缓存', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskKeyGroups)
    const service = makeService(fetchImpl)

    await service.overview('yesterday', '')
    assert.equal(usageCalls(calls).length, 1)
    service.applyConfig(resolveConfig({ timezone: 'UTC' }))
    await service.overview('yesterday', '')
    assert.equal(usageCalls(calls).length, 2, '配置变化后必须重新取数')
  })
})

describe('服务 · 失败隔离与错误归一', () => {
  it('上游 401 → 一条 usage 错误，usage 为 null，且不抛异常', async () => {
    const { fetchImpl } = makeFetchStub(undefined, {
      status: 401,
      body: { status: false, error: 'bad token' },
    })
    const payload = await makeService(fetchImpl).overview('today', '')

    assert.equal(payload.ok, false)
    assert.equal(payload.usage, null)
    assert.equal(payload.errors.length, 1)
    assert.equal(payload.errors[0]?.source, 'usage')
    assert.equal(payload.errors[0]?.isAuthError, true)
    assert.equal(payload.errors[0]?.message, 'bad token')
  })

  it('status=false 但 HTTP 200 也算上游错误', async () => {
    const { fetchImpl } = makeFetchStub(undefined, {
      body: { status: false, error: '时区不支持' },
    })
    const payload = await makeService(fetchImpl).overview('today', '')

    assert.equal(payload.ok, false)
    assert.equal(payload.errors[0]?.message, '时区不支持')
    assert.equal(payload.errors[0]?.isAuthError, false)
  })

  it('凭据缺失时给出可读信息而不是崩溃', async () => {
    const service = new QiniuUsageService({
      config: resolveConfig(),
      credentials: new CredentialAccess(undefined, {}),
      fetchImpl: makeFetchStub(akskKeyGroups).fetchImpl,
      now: () => NOW_MS,
      sleep: async () => {},
      minRequestIntervalMs: 0,
    })
    const payload = await service.overview('today', '')
    assert.equal(payload.ok, false)
    assert.ok(payload.errors[0]?.message.includes('凭据'))
    assert.equal(payload.errors[0]?.isAuthError, false, '缺凭据不是鉴权失败')
  })

  it('上游返回非 JSON 时不崩溃', async () => {
    const fetchImpl = (async () =>
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch
    const payload = await makeService(fetchImpl).overview('today', '')
    assert.equal(payload.ok, false)
    assert.ok(payload.errors[0]?.message.includes('502'))
  })

  it('toSourceError 归一三类错误', () => {
    const upstream = toSourceError(
      new QiniuUpstreamError('nope', { code: 1013, status: 200, isForbidden: true }),
      'respack',
    )
    assert.equal(upstream.source, 'respack')
    assert.equal(upstream.code, 1013)
    assert.equal(upstream.isForbidden, true)

    const plain = toSourceError(new Error('plain'), 'usage')
    assert.equal(plain.message, 'plain')
    assert.equal(plain.code, undefined)

    const weird = toSourceError('a string', 'usage')
    assert.equal(weird.message, 'a string')
  })
})

describe('服务 · /keys 候选集', () => {
  it('上游枚举到的 Key 带 hasUsage=true 与掩码', async () => {
    const { fetchImpl } = makeFetchStub(akskTwoKeys)
    const payload = await makeService(fetchImpl).keys('yesterday')

    const labels = payload.keys.map((k) => k.label)
    assert.deepEqual(labels, ['我的测试Key', '生产Key'])
    assert.equal(payload.keys[0]?.masked, 'abcde*****op')
    assert.equal(payload.keys[0]?.hasUsage, true)
  })

  it('配置里登记的 Key 即使当日无用量也出现在候选集里', async () => {
    const { fetchImpl } = makeFetchStub(akskKeyGroups)
    const payload = await makeService(fetchImpl, {
      apiKeys: [{ label: '零用量的Key', tokenRef: '' }],
    }).keys('yesterday')

    const zero = payload.keys.find((k) => k.label === '零用量的Key')
    assert.ok(zero, '登记的 Key 必须出现在候选集里')
    assert.equal(zero.hasUsage, false)
    assert.equal(zero.hasToken, false)
  })

  it('配了 tokenRef 的登记 Key 标记 hasToken=true', async () => {
    const { fetchImpl } = makeFetchStub(akskKeyGroups)
    const payload = await makeService(fetchImpl, {
      apiKeys: [{ label: '我的测试Key', tokenRef: 'QINIU_TOKEN_MY_KEY' }],
    }).keys('yesterday')

    const mine = payload.keys.find((k) => k.label === '我的测试Key')
    assert.equal(mine?.hasToken, true)
  })

  it('上游失败时返回空清单而不是抛错', async () => {
    const { fetchImpl } = makeFetchStub(undefined, { status: 500, body: { status: false } })
    const payload = await makeService(fetchImpl).keys('yesterday')
    assert.deepEqual(payload.keys, [])
  })

  it('与 overview 共用缓存，不重复打上游', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskKeyGroups)
    const service = makeService(fetchImpl)
    await service.overview('yesterday', '')
    await service.keys('yesterday')
    assert.equal(usageCalls(calls).length, 1, '/keys 应复用账号级查询的缓存')
  })
})

describe('服务 · Bearer 形态兼容', () => {
  it('形态 1（data[] = models[]）也能归一', async () => {
    const { fetchImpl } = makeFetchStub(bearerFlatModels)
    const payload = await makeService(fetchImpl).overview('yesterday', '')
    assert.equal(payload.usage?.totals.total, 2_080_000)
    assert.equal(payload.usage?.source, 'aksk', '当前实现走 AK/SK 路径')
    assert.equal(payload.usage?.keyLabel, '全部 Key', '形态 1 无 api_key，用兜底标签')
  })
})

describe('服务 · 资源包接入与失败隔离', () => {
  it('overview 同时返回用量与资源包', async () => {
    const { fetchImpl } = makeFetchStub(akskKeyGroups)
    const payload = await makeService(fetchImpl).overview('yesterday', '')

    assert.equal(payload.ok, true)
    assert.equal(payload.usage?.totals.total, 2_080_000)
    assert.equal(payload.respack?.items.length, monthOverviewPage.length)
    assert.equal(payload.respack?.packages.length, respackListPage.length)
  })

  it('资源包无权限时用量仍可读，错误按源分开', async () => {
    const { fetchImpl } = makeFetchStub(akskKeyGroups, { respack: 'forbidden' })
    const payload = await makeService(fetchImpl).overview('yesterday', '')

    assert.equal(payload.ok, false)
    assert.ok(payload.usage !== null, '资源包失败不得遮蔽用量')
    assert.equal(payload.usage?.totals.total, 2_080_000)
    assert.equal(payload.respack, null)
    assert.equal(payload.errors.length, 1)
    assert.equal(payload.errors[0]?.source, 'respack')
    assert.equal(payload.errors[0]?.isForbidden, true)
  })

  it('用量失败时资源包仍可读', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input))
      if (url.hostname === 'api.qnaigc.com') {
        return new Response(JSON.stringify({ status: false, error: 'bad key' }), { status: 401 })
      }
      if (url.pathname.endsWith('/month-overview')) {
        return new Response(JSON.stringify({ code: 0, message: 'Success', data: monthOverviewPage }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ code: 0, message: 'Success', data: respackListPage }), {
        status: 200,
      })
    }) as typeof fetch

    const payload = await makeService(fetchImpl).overview('yesterday', '')
    assert.equal(payload.usage, null)
    assert.ok(payload.respack !== null, '用量失败不得遮蔽资源包')
    assert.equal(payload.errors[0]?.source, 'usage')
    assert.equal(payload.errors[0]?.isAuthError, true)
  })

  it('两个数据源都失败时给出两条独立错误', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: false, error: 'x', code: 1010, message: 'y' }), {
        status: 401,
      })) as typeof fetch
    const payload = await makeService(fetchImpl).overview('yesterday', '')
    assert.equal(payload.ok, false)
    assert.equal(payload.errors.length, 2)
    assert.deepEqual(payload.errors.map((e) => e.source).sort(), ['respack', 'usage'])
  })

  it('资源包在 TTL 内只打一次上游（两个接口各一次）', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskKeyGroups)
    const service = makeService(fetchImpl)

    await service.overview('yesterday', '')
    const afterFirst = calls.filter((u) => u.pathname.startsWith('/billing-api/')).length
    assert.equal(afterFirst, 2, 'month-overview 与 list 各一次')

    await service.overview('yesterday', '')
    const afterSecond = calls.filter((u) => u.pathname.startsWith('/billing-api/')).length
    assert.equal(afterSecond, 2, '第二次应命中缓存')
  })

  it('资源包请求被 single-flight 合并', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskKeyGroups)
    const service = makeService(fetchImpl)

    await Promise.all([service.getRespack(), service.getRespack(), service.getRespack()])
    const respackCalls = calls.filter((u) => u.pathname.startsWith('/billing-api/'))
    assert.equal(respackCalls.length, 2, '三个并发应只合并为两个接口各一次')
  })

  it('refresh 同时穿透用量与资源包缓存', async () => {
    const { fetchImpl, calls } = makeFetchStub(akskKeyGroups)
    const service = makeService(fetchImpl)
    await service.overview('yesterday', '')
    await service.refresh('yesterday', '')
    const respackCalls = calls.filter((u) => u.pathname.startsWith('/billing-api/'))
    assert.equal(respackCalls.length, 4, 'refresh 后资源包也应重取')
  })

  it('respackDetail 用已缓存包补齐字段', async () => {
    const { fetchImpl } = makeFetchStub(akskKeyGroups)
    const service = makeService(fetchImpl)
    // 先取快照，让 #lastPacks 有内容
    await service.getRespack()
    const detail = await service.respackDetail('f9cefba946e0b547a72abb4a9d4acc3c', 1)
    assert.equal(detail.isCombo, true)
    assert.equal(detail.deductDetails.length, 2)
  })

  it('respackDetail 在详情字段缺失时回落到缓存包', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input))
      if (url.pathname.endsWith('/month-overview')) {
        return new Response(JSON.stringify({ code: 0, message: 'Success', data: monthOverviewPage }), { status: 200 })
      }
      if (url.pathname.endsWith('/list')) {
        return new Response(JSON.stringify({ code: 0, message: 'Success', data: respackListPage }), { status: 200 })
      }
      // detail 只回名称
      return new Response(JSON.stringify({ code: 0, message: 'Success', data: { respack_name: '只有名字' } }), { status: 200 })
    }) as typeof fetch

    const service = makeService(fetchImpl)
    await service.getRespack()
    const detail = await service.respackDetail('f9cefba946e0b547a72abb4a9d4acc3c', 1)
    assert.equal(detail.name, '只有名字')
    assert.equal(detail.totalAmount, 5120, '总量应回落到缓存包')
    assert.equal(detail.unit, 'GB')
  })
})
