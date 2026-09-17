/**
 * 路由与上游 HTTP 客户端的测试。
 *
 * 路由测试用最小替身驱动 handler，重点验证：**fence 先于一切**、入参白名单、
 * 405 方法校验、响应头 `no-store`。HTTP 测试验证双外壳解析与重试边界。
 *
 * @module dsh-qiniu-usage/test/routes
 */

import { strict as assert } from 'node:assert'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, it } from 'vitest'
import {
  makeKeysRoute,
  makeOverviewRoute,
  makeRefreshRoute,
  makeRespackDetailRoute,
  parseDayParam,
  parseKeyParam,
} from '../src/routes.ts'
import { QiniuUpstreamError, fetchUpstreamData, sanitizeErrorMessage } from '../src/qiniu/http.ts'
import type { DaySelector, KeySelector, OverviewPayload } from '../src/service.ts'
import { akskKeyGroups } from './fixtures/usage.ts'

/** 记录一次响应的替身。 */
interface CapturedResponse {
  status?: number
  body?: unknown
  headers?: Record<string, unknown>
}

/** 造一个 IncomingMessage 替身（含 async iterable 的 body，与真实请求一致）。 */
function makeRequest(options: {
  method?: string
  url?: string
  remoteAddress?: string
  host?: string
  origin?: string
  secFetchSite?: string
  /** 请求体原文；省略时视为空 body。 */
  body?: string
}): IncomingMessage {
  const body = options.body
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: {
      host: options.host ?? '127.0.0.1:3080',
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.secFetchSite === undefined ? {} : { 'sec-fetch-site': options.secFetchSite }),
    },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    // readJsonBody 用 for await 读请求体，替身必须实现 async iterable。
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body, 'utf8')
    },
    destroy: () => {},
  } as unknown as IncomingMessage
}

/** 造一个 ServerResponse 替身并把写入结果收集起来。 */
function makeResponse(captured: CapturedResponse): ServerResponse {
  return {
    writeHead: (status: number, headers: Record<string, unknown>) => {
      captured.status = status
      captured.headers = headers
      return captured as unknown as ServerResponse
    },
    end: (payload?: string) => {
      captured.body = payload === undefined ? undefined : JSON.parse(payload)
    },
  } as unknown as ServerResponse
}

/** 造一个只记录调用参数的 service 替身。 */
function makeServiceStub(): {
  service: Parameters<typeof makeOverviewRoute>[0]
  calls: { day: DaySelector; key: KeySelector }[]
  detailCalls: { orderHash: string; poId: number }[]
} {
  const calls: { day: DaySelector; key: KeySelector }[] = []
  const detailCalls: { orderHash: string; poId: number }[] = []
  const payload = (): OverviewPayload => ({
    ok: true,
    usage: null,
    respack: null,
    errors: [],
    fetchedAt: '2026-01-01T00:00:00.000Z',
  })
  const stub = {
    overview: async (day: DaySelector, key: KeySelector) => {
      calls.push({ day, key })
      return payload()
    },
    refresh: async (day: DaySelector, key: KeySelector) => {
      calls.push({ day, key })
      return payload()
    },
    keys: async (day: DaySelector) => {
      calls.push({ day, key: '' })
      return { keys: [] }
    },
    respackDetail: async (orderHash: string, poId: number) => {
      detailCalls.push({ orderHash, poId })
      return { name: 'stub', deductDetails: [] }
    },
  }
  return {
    service: stub as unknown as Parameters<typeof makeOverviewRoute>[0],
    calls,
    detailCalls,
  }
}

describe('路由 · 入参白名单', () => {
  it('day 只接受 today / yesterday / 合法日期', () => {
    assert.equal(parseDayParam('today'), 'today')
    assert.equal(parseDayParam('yesterday'), 'yesterday')
    assert.equal(parseDayParam('2025-11-20'), '2025-11-20')
    assert.equal(parseDayParam(null), 'today')
    assert.equal(parseDayParam(undefined), 'today')
  })

  it('非法 day 一律回落到 today（不把它带进上游请求）', () => {
    const bad = [
      '2026-13-45',
      '2026-02-30',
      'not-a-date',
      '2026-1-1',
      '../../etc/passwd',
      "2026-01-01' OR 1=1",
      'x'.repeat(500),
    ]
    for (const value of bad) {
      assert.equal(parseDayParam(value), 'today', `${value} 应回落到 today`)
    }
  })

  it('key 去掉控制字符、裁剪长度', () => {
    assert.equal(parseKeyParam('  我的Key  '), '我的Key')
    assert.equal(parseKeyParam('a\u0000b'), 'ab')
    assert.equal(parseKeyParam(null), '')
    assert.equal(parseKeyParam('x'.repeat(500)).length, 128, '应裁剪到 128')
  })
})

describe('路由 · loopback fence', () => {
  const fenceCases = [
    { name: '非回环 socket 地址', remoteAddress: '10.0.0.5' },
    { name: '非回环 Host', host: 'example.com' },
    { name: '跨站 fetch', secFetchSite: 'cross-site' },
    { name: '异源 Origin', origin: 'https://evil.example.com' },
  ]

  for (const testCase of fenceCases) {
    it(`${testCase.name} → 403`, async () => {
      const { service, calls } = makeServiceStub()
      const route = makeOverviewRoute(service)
      const captured: CapturedResponse = {}
      const res = makeResponse(captured)

      await route.handler(
        makeRequest({
          url: '/api/dsh-qiniu-usage/overview',
          remoteAddress: testCase.remoteAddress,
          host: testCase.host,
          origin: testCase.origin,
          secFetchSite: testCase.secFetchSite,
        }),
        res as ServerResponse,
      )

      assert.equal(captured.status, 403, `${testCase.name} 必须被拒绝`)
      assert.equal(calls.length, 0, '被拒绝的请求不得触达服务层')
      assert.equal(captured.headers?.['cache-control'], 'no-store')
    })
  }

  it('同源回环请求放行，且响应带 no-store', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeOverviewRoute(service)
    const captured: CapturedResponse = {}

    await route.handler(
      makeRequest({
        url: '/api/dsh-qiniu-usage/overview',
        origin: 'http://127.0.0.1:3080',
      }),
      makeResponse(captured) as ServerResponse,
    )

    assert.equal(captured.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(captured.headers?.['cache-control'], 'no-store')
    assert.equal(captured.headers?.['referrer-policy'], 'no-referrer')
  })

  it('localhost Host 且无 Origin 也放行', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeOverviewRoute(service)
    const captured: CapturedResponse = {}
    await route.handler(
      makeRequest({ url: '/api/dsh-qiniu-usage/overview', host: 'localhost:3080' }),
      makeResponse(captured) as ServerResponse,
    )
    assert.equal(captured.status, 200)
    assert.equal(calls.length, 1)
  })
})

describe('路由 · 方法与参数传递', () => {
  it('overview 拒绝非 GET', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeOverviewRoute(service)
    const captured: CapturedResponse = {}
    await route.handler(
      makeRequest({ method: 'DELETE', url: '/api/dsh-qiniu-usage/overview' }),
      makeResponse(captured) as ServerResponse,
    )
    assert.equal(captured.status, 405)
    assert.equal(calls.length, 0)
  })

  it('overview 把校验后的 day/key 传给服务', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeOverviewRoute(service)
    await route.handler(
      makeRequest({ url: '/api/dsh-qiniu-usage/overview?day=yesterday&key=%E7%94%9F%E4%BA%A7Key' }),
      makeResponse({}) as ServerResponse,
    )
    assert.deepEqual(calls, [{ day: 'yesterday', key: '生产Key' }])
  })

  it('overview 的非法 day 被替换为 today', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeOverviewRoute(service)
    await route.handler(
      makeRequest({ url: '/api/dsh-qiniu-usage/overview?day=2026-13-45' }),
      makeResponse({}) as ServerResponse,
    )
    assert.deepEqual(calls, [{ day: 'today', key: '' }])
  })

  it('refresh 拒绝非 POST', async () => {
    const { service } = makeServiceStub()
    const route = makeRefreshRoute(service)
    const captured: CapturedResponse = {}
    await route.handler(
      makeRequest({ method: 'GET', url: '/api/dsh-qiniu-usage/refresh' }),
      makeResponse(captured) as ServerResponse,
    )
    assert.equal(captured.status, 405)
  })

  it('refresh 从 query 读参数', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeRefreshRoute(service)
    await route.handler(
      makeRequest({ method: 'POST', url: '/api/dsh-qiniu-usage/refresh?day=yesterday&key=A' }),
      makeResponse({}) as ServerResponse,
    )
    assert.deepEqual(calls, [{ day: 'yesterday', key: 'A' }])
  })

  it('refresh 无 query 时从 JSON body 读参数', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeRefreshRoute(service)
    await route.handler(
      makeRequest({
        method: 'POST',
        url: '/api/dsh-qiniu-usage/refresh',
        body: JSON.stringify({ day: 'yesterday', key: '生产Key' }),
      }),
      makeResponse({}) as ServerResponse,
    )
    assert.deepEqual(calls, [{ day: 'yesterday', key: '生产Key' }])
  })

  it('refresh 的 body 里非法 day 同样被替换为 today', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeRefreshRoute(service)
    await route.handler(
      makeRequest({
        method: 'POST',
        url: '/api/dsh-qiniu-usage/refresh',
        body: JSON.stringify({ day: '../../etc/passwd' }),
      }),
      makeResponse({}) as ServerResponse,
    )
    assert.deepEqual(calls, [{ day: 'today', key: '' }])
  })

  it('refresh 的 body 非 JSON 时不崩溃，回落到默认口径', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeRefreshRoute(service)
    const captured: CapturedResponse = {}
    await route.handler(
      makeRequest({ method: 'POST', url: '/api/dsh-qiniu-usage/refresh', body: 'not json at all' }),
      makeResponse(captured) as ServerResponse,
    )
    assert.equal(captured.status, 200)
    assert.deepEqual(calls, [{ day: 'today', key: '' }])
  })

  it('keys 把 day 传给服务', async () => {
    const { service, calls } = makeServiceStub()
    const route = makeKeysRoute(service)
    await route.handler(
      makeRequest({ url: '/api/dsh-qiniu-usage/keys?day=yesterday' }),
      makeResponse({}) as ServerResponse,
    )
    assert.deepEqual(calls, [{ day: 'yesterday', key: '' }])
  })
})

describe('上游 HTTP · 双外壳与重试', () => {
  /** 造一个按序列返回响应的 fetch 替身。 */
  function sequenceFetch(
    responses: { status: number; body: unknown }[],
  ): { fetchImpl: typeof fetch; calls: number } {
    const state = { calls: 0 }
    const fetchImpl = (async () => {
      const response = responses[Math.min(state.calls, responses.length - 1)]
      state.calls += 1
      return new Response(JSON.stringify(response?.body ?? null), { status: response?.status ?? 200 })
    }) as typeof fetch
    return { fetchImpl, calls: state.calls }
  }

  const noSleep = async (): Promise<void> => {}
  const url = new URL('https://api.qnaigc.com/v3/stat/usage')

  it('qnaigc 外壳 status=true 时返回 data', async () => {
    const { fetchImpl } = sequenceFetch([{ status: 200, body: { status: true, data: [1, 2] } }])
    const data = await fetchUpstreamData({ url }, 'qnaigc', { fetchImpl, sleepImpl: noSleep })
    assert.deepEqual(data, [1, 2])
  })

  it('qnaigc 外壳 status=false 时抛错并带上 error 原文', async () => {
    const { fetchImpl } = sequenceFetch([{ status: 200, body: { status: false, error: '时区非法' } }])
    await assert.rejects(
      () => fetchUpstreamData({ url }, 'qnaigc', { fetchImpl, sleepImpl: noSleep }),
      (error: unknown) => error instanceof QiniuUpstreamError && error.message === '时区非法',
    )
  })

  it('qiniu 外壳 code=0 时返回 data', async () => {
    const { fetchImpl } = sequenceFetch([{ status: 200, body: { code: 0, message: 'Success', data: { a: 1 } } }])
    const data = await fetchUpstreamData({ url }, 'qiniu', { fetchImpl, sleepImpl: noSleep })
    assert.deepEqual(data, { a: 1 })
  })

  it('qiniu 外壳 code!=0 时抛错并带上 code', async () => {
    const { fetchImpl } = sequenceFetch([{ status: 200, body: { code: 1013, message: 'GetBalanceOverviewFailed' } }])
    await assert.rejects(
      () => fetchUpstreamData({ url }, 'qiniu', { fetchImpl, sleepImpl: noSleep }),
      (error: unknown) =>
        error instanceof QiniuUpstreamError && error.code === 1013 && error.message === 'GetBalanceOverviewFailed',
    )
  })

  it('401 不重试', async () => {
    const state = { calls: 0 }
    const fetchImpl = (async () => {
      state.calls += 1
      return new Response(JSON.stringify({ status: false, error: 'unauthorized' }), { status: 401 })
    }) as typeof fetch

    await assert.rejects(
      () => fetchUpstreamData({ url }, 'qnaigc', { fetchImpl, sleepImpl: noSleep }),
      (error: unknown) => error instanceof QiniuUpstreamError && error.isAuthError,
    )
    assert.equal(state.calls, 1, '401 必须只请求一次')
  })

  it('400 不重试', async () => {
    const state = { calls: 0 }
    const fetchImpl = (async () => {
      state.calls += 1
      return new Response(JSON.stringify({ status: false, error: 'bad param' }), { status: 400 })
    }) as typeof fetch
    await assert.rejects(() => fetchUpstreamData({ url }, 'qnaigc', { fetchImpl, sleepImpl: noSleep }))
    assert.equal(state.calls, 1)
  })

  it('500 重试后成功', async () => {
    const state = { calls: 0 }
    const fetchImpl = (async () => {
      state.calls += 1
      if (state.calls === 1) return new Response('boom', { status: 500 })
      return new Response(JSON.stringify({ status: true, data: 'ok' }), { status: 200 })
    }) as typeof fetch

    const data = await fetchUpstreamData({ url }, 'qnaigc', { fetchImpl, sleepImpl: noSleep })
    assert.equal(data, 'ok')
    assert.equal(state.calls, 2)
  })

  it('持续 500 时重试到上限后抛错', async () => {
    const state = { calls: 0 }
    const fetchImpl = (async () => {
      state.calls += 1
      return new Response('boom', { status: 500 })
    }) as typeof fetch

    await assert.rejects(() => fetchUpstreamData({ url }, 'qnaigc', { fetchImpl, sleepImpl: noSleep }))
    assert.equal(state.calls, 3, '首次 + 2 次重试')
  })

  it('429 重试', async () => {
    const state = { calls: 0 }
    const fetchImpl = (async () => {
      state.calls += 1
      if (state.calls === 1) return new Response('slow down', { status: 429 })
      return new Response(JSON.stringify({ status: true, data: 1 }), { status: 200 })
    }) as typeof fetch
    assert.equal(await fetchUpstreamData({ url }, 'qnaigc', { fetchImpl, sleepImpl: noSleep }), 1)
    assert.equal(state.calls, 2)
  })

  it('sanitizeErrorMessage 折叠空白并截断', () => {
    assert.equal(sanitizeErrorMessage('a\n\n  b\tc'), 'a b c')
    assert.equal(sanitizeErrorMessage('x'.repeat(400)).length, 301, '300 字符 + 省略号')
  })
})

describe('路由 · 与真实服务串联', () => {
  it('overview 路由经服务返回归一后的用量', async () => {
    const { QiniuUsageService } = await import('../src/service.ts')
    const { CredentialAccess } = await import('../src/credentials.ts')
    const { resolveConfig } = await import('../src/config.ts')

    // 用量与资源包都要有对应响应，否则会记一条 respack 错误。
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input))
      if (url.pathname.startsWith('/billing-api/')) {
        return new Response(JSON.stringify({ code: 0, message: 'Success', data: [] }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ status: true, data: akskKeyGroups }), { status: 200 })
    }) as typeof fetch

    const service = new QiniuUsageService({
      config: resolveConfig(),
      credentials: new CredentialAccess(
        {
          resolve: async (ref: string) =>
            ref === 'QINIU_ACCESS_KEY' ? { value: 'AK', source: 'file' } : { value: 'SK', source: 'file' },
          describe: async () => ({ configured: true, writable: true }),
          set: async () => {},
          unset: async () => {},
        },
        {},
      ),
      fetchImpl,
      now: () => Date.parse('2026-01-01T04:00:00Z'),
      sleep: async () => {},
      minRequestIntervalMs: 0,
    })

    const route = makeOverviewRoute(service)
    const captured: CapturedResponse = {}
    await route.handler(
      makeRequest({ url: '/api/dsh-qiniu-usage/overview?day=yesterday' }),
      makeResponse(captured) as ServerResponse,
    )

    const body = captured.body as OverviewPayload
    assert.equal(captured.status, 200)
    assert.equal(body.usage?.totals.total, 2_080_000)
    assert.equal(body.errors.length, 0)
  })
})

describe('路由 · /respack/detail', () => {
  it('拒绝非法 order_hash 或 po_id，且不打上游', async () => {
    const bad = [
      'order_hash=&po_id=1',
      'order_hash=abc&po_id=',
      'order_hash=abc&po_id=notanumber',
      'order_hash=abc&po_id=-1',
      'order_hash=abc&po_id=1.5',
      `order_hash=${'x'.repeat(65)}&po_id=1`,
      'order_hash=has%20space&po_id=1',
    ]
    for (const query of bad) {
      const { service, detailCalls } = makeServiceStub()
      const route = makeRespackDetailRoute(service)
      const captured: CapturedResponse = {}
      await route.handler(
        makeRequest({ url: `/api/dsh-qiniu-usage/respack/detail?${query}` }),
        makeResponse(captured) as ServerResponse,
      )
      assert.equal(captured.status, 400, `${query} 应被拒绝`)
      assert.equal(detailCalls.length, 0, '非法参数不得触达服务层')
    }
  })

  it('合法参数透传 order_hash 与 po_id', async () => {
    const { service, detailCalls } = makeServiceStub()
    const route = makeRespackDetailRoute(service)
    const captured: CapturedResponse = {}
    await route.handler(
      makeRequest({
        url: '/api/dsh-qiniu-usage/respack/detail?order_hash=f9cefba946e0b547a72abb4a9d4acc3c&po_id=524913',
      }),
      makeResponse(captured) as ServerResponse,
    )
    assert.equal(captured.status, 200)
    assert.deepEqual(detailCalls, [{ orderHash: 'f9cefba946e0b547a72abb4a9d4acc3c', poId: 524913 }])
    assert.equal((captured.body as { ok: boolean }).ok, true)
  })

  it('下钻失败时返回 ok=false 与结构化错误，而不是 500', async () => {
    const { service } = makeServiceStub()
    // 让 detail 抛错
    ;(service as unknown as { respackDetail: () => Promise<never> }).respackDetail = async () => {
      throw new QiniuUpstreamError('资源包详情获取失败', { code: 1011 })
    }
    const route = makeRespackDetailRoute(service)
    const captured: CapturedResponse = {}
    await route.handler(
      makeRequest({ url: '/api/dsh-qiniu-usage/respack/detail?order_hash=abc123&po_id=1' }),
      makeResponse(captured) as ServerResponse,
    )
    assert.equal(captured.status, 200, '下钻失败不应变成 5xx')
    const body = captured.body as { ok: boolean; detail: unknown; error: { source: string; code: number } }
    assert.equal(body.ok, false)
    assert.equal(body.detail, null)
    assert.equal(body.error.source, 'respack')
    assert.equal(body.error.code, 1011)
  })

  it('非回环请求被拒绝', async () => {
    const { service, detailCalls } = makeServiceStub()
    const route = makeRespackDetailRoute(service)
    const captured: CapturedResponse = {}
    await route.handler(
      makeRequest({
        url: '/api/dsh-qiniu-usage/respack/detail?order_hash=abc123&po_id=1',
        remoteAddress: '10.0.0.5',
      }),
      makeResponse(captured) as ServerResponse,
    )
    assert.equal(captured.status, 403)
    assert.equal(detailCalls.length, 0)
  })
})
