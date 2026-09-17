/**
 * 资源包归一与分页测试。
 *
 * @module dsh-qiniu-usage/test/respack
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import {
  CARRY_OVER_POLICY,
  MAX_PAGE_SIZE,
  MAX_PAGES,
  RESPACK_ERROR_MESSAGES,
  RespackClient,
  daysUntil,
  describeRespackError,
  normalizeDeductDetail,
  normalizeDetail,
  normalizeMonthItem,
  normalizePack,
  ratio,
} from '../src/qiniu/respack.ts'
import { QiniuUpstreamError } from '../src/qiniu/http.ts'
import {
  makeFullPage,
  monthOverviewPage,
  respackDetailMixedTypes,
  respackListPage,
} from './fixtures/respack.ts'

/** 固定的"当前时刻"：2026-01-01 12:00 +08:00。 */
const NOW_MS = Date.parse('2026-01-01T04:00:00Z')

/** 造一个按 URL 分派、可自定义分页数据的 fetch 替身。 */
function makeRespackFetch(options: {
  monthPages?: Record<string, unknown>[][]
  listPages?: Record<string, unknown>[][]
  detail?: unknown
  detailStatus?: number
  code?: number
  message?: string
}): { fetchImpl: typeof fetch; urls: URL[] } {
  const urls: URL[] = []
  const monthPages = options.monthPages ?? [monthOverviewPage]
  const listPages = options.listPages ?? [respackListPage]

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(String(input))
    urls.push(url)

    if (options.code !== undefined && options.code !== 0) {
      return new Response(
        JSON.stringify({ code: options.code, message: options.message ?? 'failed' }),
        { status: options.detailStatus ?? 200 },
      )
    }

    const page = Number(url.searchParams.get('page') ?? '1')
    if (url.pathname.endsWith('/month-overview')) {
      return new Response(
        JSON.stringify({ code: 0, message: 'Success', data: monthPages[page - 1] ?? [] }),
        { status: 200 },
      )
    }
    if (url.pathname.endsWith('/list')) {
      return new Response(
        JSON.stringify({ code: 0, message: 'Success', data: listPages[page - 1] ?? [] }),
        { status: 200 },
      )
    }
    return new Response(
      JSON.stringify({ code: 0, message: 'Success', data: options.detail ?? respackDetailMixedTypes }),
      { status: 200 },
    )
  }) as typeof fetch

  return { fetchImpl, urls }
}

/** 造一个客户端。 */
function makeClient(
  fetchImpl: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof RespackClient>[0]> = {},
): RespackClient {
  return new RespackClient({
    baseUrl: 'https://api.qiniu.com',
    accessKey: 'MY_ACCESS_KEY',
    secretKey: 'MY_SECRET_KEY',
    fetchImpl,
    schedule: (task) => task(),
    now: () => NOW_MS,
    sleepImpl: async () => {},
    ...overrides,
  })
}

describe('资源包 · 错误码映射', () => {
  it('官方错误码表覆盖 1000-1014', () => {
    for (const code of [1000, 1005, 1009, 1010, 1011, 1012, 1013, 1014]) {
      assert.ok(RESPACK_ERROR_MESSAGES[code] !== undefined, `缺少 code=${code}`)
    }
    assert.equal(RESPACK_ERROR_MESSAGES[1013], '账户余额获取失败')
  })

  it('已知码翻译为可读提示并保留 code', () => {
    assert.equal(describeRespackError(1010, 'raw'), '资源包列表获取失败（code=1010）')
  })

  it('未知码保留上游原文', () => {
    assert.equal(describeRespackError(9999, '上游原话'), '上游原话')
    assert.equal(describeRespackError(undefined, '无码'), '无码')
  })
})

describe('资源包 · 归一', () => {
  it('month-overview 归一并对利用率封顶', () => {
    const item = normalizeMonthItem(monthOverviewPage[1] as never)
    assert.equal(item.itemName, 'AI大模型融合资源包')
    assert.equal(item.monthCapacity, 100)
    assert.equal(item.monthUsed, 68)
    assert.equal(item.monthRemain, 32)
    assert.equal(item.utilization, 0.68)
    assert.equal(item.unit, 'GB')
  })

  it('month_remain 缺失时用 可用-已用 推算', () => {
    const item = normalizeMonthItem({ item_name: 'x', total_surplus: 100, month_used: 30 } as never)
    assert.equal(item.monthRemain, 70)
  })

  it('可用量为 0 时利用率为 0 而不是 NaN', () => {
    const item = normalizeMonthItem({ item_name: 'x', total_surplus: 0, month_used: 0 } as never)
    assert.equal(item.utilization, 0)
    assert.ok(Number.isFinite(item.utilization))
  })

  it('ratio 对越界值做钳制', () => {
    assert.equal(ratio(150, 100), 1, '超额不应超过 1')
    assert.equal(ratio(-5, 100), 0, '负值应夹到 0')
    assert.equal(ratio(1, 0), 0, '分母为 0 应返回 0')
  })

  it('资源包归一：状态与分配方式都有可读标签', () => {
    const pack = normalizePack(respackListPage[1] as never, NOW_MS)
    assert.equal(pack.name, '中国大陆全时段加速流量5TB')
    assert.equal(pack.status, 2)
    assert.equal(pack.statusLabel, '使用中')
    assert.equal(pack.carryOverPolicy, 1)
    assert.equal(pack.carryOverLabel, '按月分配不可结转')
    assert.equal(pack.totalAmount, 5120)
    assert.equal(pack.usedAmount, 1280)
    assert.equal(pack.utilization, 0.25)
    assert.equal(pack.orderHash, 'f9cefba946e0b547a72abb4a9d4acc3c')
    assert.equal(pack.poId, 1)
  })

  it('未知状态码不会崩，给出"未知状态(n)"', () => {
    const pack = normalizePack({ status: 99, carry_over_policy: 7 } as never, NOW_MS)
    assert.equal(pack.statusLabel, '未知状态(99)')
    assert.equal(pack.carryOverLabel, '未知分配方式(7)')
  })

  it('生命周期口径与当月口径是不同字段，不互相污染', () => {
    const pack = normalizePack(respackListPage[1] as never, NOW_MS)
    const item = normalizeMonthItem(monthOverviewPage[1] as never)
    // 同一个"AI大模型融合资源包"概念下，pack 用的是 used_amount（生命周期），
    // item 用的是 month_used（当月）—— 二者必须各自独立。
    assert.equal(pack.usedAmount, 1280)
    assert.equal(item.monthUsed, 68)
    assert.notEqual(pack.usedAmount, item.monthUsed)
  })

  it('deduct_amount 字符串与数字都能解析（官方文档标 string，示例写数字）', () => {
    const asString = normalizeDeductDetail({
      deduct_date: '2026-01-01T00:00:00+08:00',
      deduct_status: 2,
      deduct_amount: '1024' as unknown as number,
    })
    assert.equal(asString.deductAmount, 1024)
    assert.equal(asString.deductStatusLabel, '已出账抵扣')

    const asNumber = normalizeDeductDetail({ deduct_status: 1, deduct_amount: 256 })
    assert.equal(asNumber.deductAmount, 256)
    assert.equal(asNumber.deductStatusLabel, '未出账抵扣')
  })

  it('detail 归一：融合包标记与抵扣明细', () => {
    const detail = normalizeDetail(respackDetailMixedTypes as never)
    assert.equal(detail.isCombo, true)
    assert.equal(detail.itemCode, 'fusion:dyn:transfer:https')
    assert.ok(detail.description.includes('抵扣系数'))
    assert.equal(detail.deductDetails.length, 2)
    assert.equal(detail.deductDetails[0]?.deductAmount, 1024)
    assert.equal(detail.deductDetails[1]?.deductAmount, 256)
  })

  it('detail 字段缺失时回落到已归一的包', () => {
    const pack = normalizePack(respackListPage[1] as never, NOW_MS)
    const detail = normalizeDetail({ respack_name: undefined } as never, pack)
    assert.equal(detail.name, pack.name)
    assert.equal(detail.totalAmount, pack.totalAmount)
    assert.equal(detail.usedAmount, pack.usedAmount)
    assert.equal(detail.unit, pack.unit)
  })
})

describe('资源包 · daysRemaining', () => {
  it('按东八区日期算天数差', () => {
    // 2026-01-01 12:00 +08:00 → 2026-01-11 00:00 +08:00 = 10 天
    assert.equal(daysUntil('2026-01-11T00:00:00+08:00', NOW_MS), 10)
  })

  it('已过期给出负数', () => {
    assert.equal(daysUntil('2025-12-31T00:00:00+08:00', NOW_MS), -1)
  })

  it('时刻差异不污染天数', () => {
    // 同一天的不同时刻都应是 0 天
    assert.equal(daysUntil('2026-01-01T00:00:01+08:00', NOW_MS), 0)
    assert.equal(daysUntil('2026-01-01T23:59:59+08:00', NOW_MS), 0)
  })

  it('无法解析的时间返回 undefined', () => {
    assert.equal(daysUntil('not-a-date', NOW_MS), undefined)
    assert.equal(daysUntil('', NOW_MS), undefined)
  })

  it('包里带上 daysRemaining', () => {
    const pack = normalizePack(respackListPage[1] as never, NOW_MS)
    assert.equal(pack.daysRemaining, 365, '2026-01-01 → 2027-01-01 = 365 天')
  })
})

describe('资源包 · 分页循环', () => {
  it('请求显式带上 page_size=200（官方上限）', async () => {
    const { fetchImpl, urls } = makeRespackFetch({})
    await makeClient(fetchImpl).snapshot()
    assert.ok(urls.length >= 2)
    for (const url of urls) {
      assert.equal(url.searchParams.get('page_size'), String(MAX_PAGE_SIZE))
    }
  })

  it('满页时继续翻页，直到不足一页', async () => {
    const { fetchImpl, urls } = makeRespackFetch({
      monthPages: [makeFullPage(MAX_PAGE_SIZE), makeFullPage(3, MAX_PAGE_SIZE)],
      listPages: [makeFullPage(1)],
    })
    const snapshot = await makeClient(fetchImpl).snapshot()

    const monthUrls = urls.filter((u) => u.pathname.endsWith('/month-overview'))
    assert.equal(monthUrls.length, 2, '第一页满 200 应继续取第二页')
    assert.equal(monthUrls[0]?.searchParams.get('page'), '1')
    assert.equal(monthUrls[1]?.searchParams.get('page'), '2')
    assert.equal(snapshot.items.length, MAX_PAGE_SIZE + 3)
  })

  it('翻页次数达到上限时给出告警', async () => {
    const fullPages = Array.from({ length: MAX_PAGES + 2 }, (_, index) =>
      makeFullPage(MAX_PAGE_SIZE, index * MAX_PAGE_SIZE),
    )
    const { fetchImpl, urls } = makeRespackFetch({ monthPages: fullPages, listPages: [makeFullPage(1)] })
    const snapshot = await makeClient(fetchImpl).snapshot()

    const monthUrls = urls.filter((u) => u.pathname.endsWith('/month-overview'))
    assert.equal(monthUrls.length, MAX_PAGES, `最多翻 ${MAX_PAGES} 页`)
    assert.ok(snapshot.warnings.some((w) => w.includes('超过')))
  })

  it('空结果不崩', async () => {
    const { fetchImpl } = makeRespackFetch({ monthPages: [[]], listPages: [[]] })
    const snapshot = await makeClient(fetchImpl).snapshot()
    assert.deepEqual(snapshot.items, [])
    assert.deepEqual(snapshot.packages, [])
  })

  it('排序：当月概览按已用降序，资源包使用中优先且快到期在前', async () => {
    const { fetchImpl } = makeRespackFetch({})
    const snapshot = await makeClient(fetchImpl).snapshot()

    assert.equal(snapshot.items[0]?.itemName, 'AI大模型融合资源包', '已用 68 > 0')

    const statuses = snapshot.packages.map((p) => p.status)
    assert.deepEqual([...statuses].sort((a, b) => a - b), statuses, '状态应升序（使用中在前）')
  })
})

describe('资源包 · 错误处理', () => {
  it('无权限时抛出的错误带 code 与 isForbidden', async () => {
    const { fetchImpl } = makeRespackFetch({ code: 1013, message: 'GetBalanceOverviewFailed' })
    await assert.rejects(
      () => makeClient(fetchImpl).snapshot(),
      (error: unknown) =>
        error instanceof QiniuUpstreamError && error.code === 1013 && error.isForbidden === false,
    )
  })

  it('403 被标记为 isForbidden（AK 缺账单权限）', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 1013, message: 'no permission' }), {
        status: 403,
      })) as typeof fetch
    await assert.rejects(
      () => makeClient(fetchImpl).snapshot(),
      (error: unknown) => error instanceof QiniuUpstreamError && error.isForbidden === true,
    )
  })

  it('detail 缺少 order_hash 时直接报参数错误，不打上游', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    await assert.rejects(
      () => makeClient(fetchImpl).detail('', 1),
      (error: unknown) => error instanceof QiniuUpstreamError && error.code === 1000,
    )
    assert.equal(called, false, '参数不合法时不该发请求')
  })

  it('detail 返回非对象时抛 1011', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 0, message: 'Success', data: 'nope' }), {
        status: 200,
      })) as typeof fetch
    await assert.rejects(
      () => makeClient(fetchImpl).detail('abc123', 1),
      (error: unknown) => error instanceof QiniuUpstreamError && error.code === 1011,
    )
  })

  it('detail 正常路径返回归一结果', async () => {
    const { fetchImpl, urls } = makeRespackFetch({})
    const detail = await makeClient(fetchImpl).detail('f9cefba946e0b547a72abb4a9d4acc3c', 1)
    assert.equal(detail.isCombo, true)
    assert.equal(urls[0]?.searchParams.get('order_hash'), 'f9cefba946e0b547a72abb4a9d4acc3c')
    assert.equal(urls[0]?.searchParams.get('po_id'), '1')
  })
})
