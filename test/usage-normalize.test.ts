/**
 * 用量归一测试：三种响应形态必须归一为同一结果。
 *
 * 这是 M1 的验收标准之一（设计文档 §12 M1）。
 *
 * @module dsh-qiniu-usage/test/usage-normalize
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import {
  classifyItem,
  extractUsageKeys,
  itemTotalRaw,
  maskApiKey,
  normalizeUsage,
  parseUnit,
  unitMultiplier,
} from '../src/qiniu/usage.ts'
import {
  akskFlatDates,
  akskKeyGroups,
  akskTwoKeys,
  bearerFlatModels,
  withCacheItems,
} from './fixtures/usage.ts'

const QUERY = {
  granularity: 'hour' as const,
  start: '2026-01-01T00:00:00+08:00',
  end: '2026-01-01T12:00:00+08:00',
  timezone: 'Asia/Shanghai',
}

/** 三种形态各自归一。 */
const bearer = normalizeUsage({
  data: bearerFlatModels,
  auth: 'bearer',
  query: QUERY,
  day: '2026-01-01',
  fallbackKeyLabel: '当前 Key',
})
const akskRfc3339 = normalizeUsage({
  data: akskKeyGroups,
  auth: 'aksk',
  query: QUERY,
  day: '2026-01-01',
  fallbackKeyLabel: '当前 Key',
})
const akskFlatDay = normalizeUsage({
  data: akskFlatDates,
  auth: 'aksk',
  query: { ...QUERY, granularity: 'day' },
  day: '2026-01-01',
  fallbackKeyLabel: '当前 Key',
})

describe('用量归一 · 三种形态结果一致', () => {
  it('模型 id 与顺序一致（按 total 降序）', () => {
    const ids = (s: typeof bearer): string[] => s.models.map((m) => m.id)
    assert.deepEqual(ids(bearer), ['deepseek-v4-pro', 'qwen-max'])
    assert.deepEqual(ids(akskRfc3339), ids(bearer))
    assert.deepEqual(ids(akskFlatDay), ids(bearer))
  })

  it('每个模型的 total 与 byKind 一致', () => {
    for (const snapshot of [bearer, akskRfc3339, akskFlatDay]) {
      const pro = snapshot.models.find((m) => m.id === 'deepseek-v4-pro')
      assert.ok(pro)
      // 1240 kToken 输入 + 310 kToken 输出 = 1550 kToken = 1_550_000 tokens
      assert.equal(pro.totalsByKind.input, 1_240_000)
      assert.equal(pro.totalsByKind.output, 310_000)
      assert.equal(pro.total, 1_550_000)
    }
  })

  it('整体 totals 一致', () => {
    // 输入 (1240+420)k + 输出 (310+110)k = 2080k tokens
    for (const snapshot of [bearer, akskRfc3339, akskFlatDay]) {
      assert.equal(snapshot.totals.input, 1_660_000)
      assert.equal(snapshot.totals.output, 420_000)
      assert.equal(snapshot.totals.total, 2_080_000)
    }
  })

  it('形态 2 与形态 3 结构相同、仅靠 auth 消歧', () => {
    assert.equal(bearer.source, 'bearer')
    assert.equal(akskRfc3339.source, 'aksk')
    assert.equal(akskFlatDay.source, 'aksk')
  })
})

describe('用量归一 · 单位换算以 unit 为权威', () => {
  it('kToken 与 mToken 倍数正确', () => {
    assert.equal(unitMultiplier('kToken'), 1_000)
    assert.equal(unitMultiplier('mtoken'), 1_000_000)
    assert.equal(unitMultiplier('millionToken'), 1_000_000)
    assert.equal(unitMultiplier('token'), 1)
    assert.equal(unitMultiplier(''), 1)
  })

  it('分隔符归一：真实上游写法 k/tokens 必须被识别', () => {
    // 实测资源包接口返回的是带斜杠的 k/tokens；原先只匹配 ktoken(s)，
    // 于是它落到"未识别"分支，界面显示成 50K k/tokens（实为 50,000,000 tokens）。
    assert.equal(unitMultiplier('k/tokens'), 1_000)
    assert.deepEqual(parseUnit('k/tokens'), { factor: 1_000, label: 'tokens' })
    for (const variant of ['kToken', 'ktokens', 'KTokens', 'k tokens', 'k-tokens', 'k_tokens']) {
      assert.equal(unitMultiplier(variant), 1_000, `${variant} 应被识别为千级`)
    }
    assert.equal(unitMultiplier('m/tokens'), 1_000_000)
    assert.equal(unitMultiplier('million tokens'), 1_000_000)
  })

  it('中文带量级单位「千次」也能换算', () => {
    assert.deepEqual(parseUnit('千次'), { factor: 1_000, label: '次' })
  })

  it('不带量级的单位保持未识别（不做无依据的换算）', () => {
    for (const unit of ['GB', '次', '个']) {
      assert.equal(unitMultiplier(unit), undefined, `${unit} 不应被当作 token 量级`)
      assert.equal(parseUnit(unit), undefined)
    }
  })

  it('k/tokens 单位的用量不会被算小 1000 倍', () => {
    const snapshot = normalizeUsage({
      data: [{ id: 'm', name: 'M', items: [{ name: '输入 Token', unit: 'k/tokens', total: 1240 }] }],
      auth: 'bearer',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '当前 Key',
    })
    assert.equal(snapshot.models[0]?.totalsByKind.input, 1_240_000, '1240 k/tokens = 1.24M tokens')
    assert.deepEqual(snapshot.warnings, [], '识别成功就不该有未识别单位告警')
  })

  it('未识别的单位按 1:1 计数并产生告警', () => {
    assert.equal(unitMultiplier('flurbs'), undefined)
    const snapshot = normalizeUsage({
      data: [{ id: 'm', name: 'M', items: [{ name: '输入 Token', unit: 'flurbs', total: 5 }] }],
      auth: 'bearer',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '当前 Key',
    })
    assert.equal(snapshot.models[0]?.total, 5, '未知单位应按 1:1')
    assert.ok(
      snapshot.warnings.some((w) => w.includes('flurbs')),
      `应有未识别单位告警，实际：${JSON.stringify(snapshot.warnings)}`,
    )
  })

  it('totalRaw 保留原始数值，便于与官方控制台对数', () => {
    const pro = bearer.models.find((m) => m.id === 'deepseek-v4-pro')
    const input = pro?.items.find((i) => i.name === '输入 Token')
    assert.equal(input?.totalRaw, 1240)
    assert.equal(input?.total, 1_240_000)
    assert.equal(input?.unit, 'kToken')
  })
})

describe('用量归一 · 计费项归类', () => {
  it('缓存项不会被误并入 input', () => {
    assert.equal(classifyItem('输入 Token'), 'input')
    assert.equal(classifyItem('输出 Token'), 'output')
    assert.equal(classifyItem('缓存命中 Token'), 'cachedInput')
    assert.equal(classifyItem('缓存写入 Token'), 'cachedWrite')
    assert.equal(classifyItem('未知计费项 XYZ'), 'other')
  })

  it('英文写法同样归类', () => {
    assert.equal(classifyItem('Input Tokens'), 'input')
    assert.equal(classifyItem('Output Tokens'), 'output')
    assert.equal(classifyItem('Cache Read Tokens'), 'cachedInput')
    assert.equal(classifyItem('Cache Creation Tokens'), 'cachedWrite')
  })

  it('五类合计等于模型 total', () => {
    const snapshot = normalizeUsage({
      data: withCacheItems,
      auth: 'bearer',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '当前 Key',
    })
    const model = snapshot.models[0]
    assert.ok(model)
    assert.equal(model.totalsByKind.input, 100_000)
    assert.equal(model.totalsByKind.output, 50_000)
    assert.equal(model.totalsByKind.cachedInput, 30_000)
    assert.equal(model.totalsByKind.cachedWrite, 20_000)
    assert.equal(model.totalsByKind.other, 7_000)
    assert.equal(model.total, 207_000)
    // 模型 total 应等于五类之和
    const summed = Object.values(model.totalsByKind).reduce((a, b) => a + b, 0)
    assert.equal(model.total, summed)
  })

  it('未识别计费项在 items 里保留原名', () => {
    const snapshot = normalizeUsage({
      data: withCacheItems,
      auth: 'bearer',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '当前 Key',
    })
    const names = snapshot.models[0]?.items.map((i) => i.name) ?? []
    assert.ok(names.includes('未知计费项 XYZ'))
  })
})

describe('用量归一 · itemTotalRaw 回退', () => {
  it('有 total 时用 total', () => {
    assert.equal(itemTotalRaw({ total: 42, values: [{ value: 1 }] }), 42)
  })

  it('无 total 时退回扁平 values 求和', () => {
    assert.equal(itemTotalRaw({ values: [{ value: 1 }, { value: 2 }] }), 3)
  })

  it('无 total 时退回 categories.values 求和', () => {
    assert.equal(
      itemTotalRaw({ categories: [{ values: [{ value: 3 }, { value: 4 }] }] }),
      7,
    )
  })

  it('全缺时返回 0', () => {
    assert.equal(itemTotalRaw({}), 0)
  })
})

describe('用量归一 · Key 标签与掩码', () => {
  it('形态 2 用上游 name 作标签', () => {
    assert.equal(akskRfc3339.keyLabel, '我的测试Key')
    assert.equal(akskRfc3339.keyMasked, 'abcde*****op')
    assert.equal(akskRfc3339.apiKey, 'abcdefghijklmnop')
  })

  it('Bearer 形态用调用方给的兜底标签', () => {
    assert.equal(bearer.keyLabel, '当前 Key')
    assert.equal(bearer.keyMasked, '')
    assert.equal(bearer.apiKey, undefined)
  })

  it('maskApiKey 保留前 5 后 2，过短则整体打码', () => {
    assert.equal(maskApiKey('abcdefghijklmnop'), 'abcde*****op')
    assert.equal(maskApiKey('short'), '*****')
    assert.equal(maskApiKey('12345678'), '********')
  })

  it('extractUsageKeys 去重并掩码', () => {
    const keys = extractUsageKeys(akskTwoKeys)
    assert.equal(keys.length, 2)
    assert.deepEqual(keys.map((k) => k.name), ['我的测试Key', '生产Key'])
    assert.equal(keys[0]?.masked, 'abcde*****op')
  })

  it('Bearer 形态提取不到 Key（没有 api_key 分组）', () => {
    assert.deepEqual(extractUsageKeys(bearerFlatModels), [])
  })
})

describe('用量归一 · 水位线与降级输入', () => {
  it('水位线取最后一个有数据的时间桶', () => {
    assert.equal(bearer.watermark, '2026-01-01T01:00:00+08:00')
  })

  it('无任何时间桶时水位线为 undefined', () => {
    const snapshot = normalizeUsage({
      data: [{ id: 'm', name: 'M', items: [{ name: '输入 Token', unit: 'kToken', total: 1 }] }],
      auth: 'bearer',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '当前 Key',
    })
    assert.equal(snapshot.watermark, undefined)
  })

  it('data 不是数组时给出空快照而不是抛错', () => {
    for (const data of [undefined, null, 42, 'nope', {}]) {
      const snapshot = normalizeUsage({
        data,
        auth: 'aksk',
        query: QUERY,
        day: '2026-01-01',
        fallbackKeyLabel: '当前 Key',
      })
      assert.deepEqual(snapshot.models, [])
      assert.equal(snapshot.totals.total, 0)
    }
  })

  it('空数组给出空快照', () => {
    const snapshot = normalizeUsage({
      data: [],
      auth: 'aksk',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '当前 Key',
    })
    assert.equal(snapshot.keyLabel, '当前 Key')
    assert.equal(snapshot.day, '2026-01-01')
    assert.deepEqual(snapshot.range, {
      start: QUERY.start,
      end: QUERY.end,
      timezone: QUERY.timezone,
    })
  })
})

describe('用量归一 · 多 Key 合并与筛选', () => {
  const twoKeysSameModel = [
    {
      api_key: 'key-aaaaaaaaaa',
      name: 'A',
      models: [{ id: 'qwen-max', name: 'Qwen Max', items: [{ name: '输入 Token', unit: 'kToken', total: 10 }] }],
    },
    {
      api_key: 'key-bbbbbbbbbb',
      name: 'B',
      models: [{ id: 'qwen-max', name: 'Qwen Max', items: [{ name: '输入 Token', unit: 'kToken', total: 5 }] }],
    },
  ]

  it('账号级汇总：同名模型合并为一行并相加', () => {
    const snapshot = normalizeUsage({
      data: twoKeysSameModel,
      auth: 'aksk',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '全部 Key',
    })
    assert.equal(snapshot.models.length, 1, '同名模型必须合并，而不是并列两行')
    assert.equal(snapshot.models[0]?.totalsByKind.input, 15_000)
    assert.equal(snapshot.totals.input, 15_000)
  })

  it('账号级汇总：不同模型分别保留，按 total 降序', () => {
    const snapshot = normalizeUsage({
      data: [
        {
          api_key: 'k1aaaaaaaaaa',
          name: 'A',
          models: [{ id: 'small', name: 'Small', items: [{ name: '输入 Token', unit: 'kToken', total: 1 }] }],
        },
        {
          api_key: 'k2bbbbbbbbbb',
          name: 'B',
          models: [{ id: 'big', name: 'Big', items: [{ name: '输入 Token', unit: 'kToken', total: 9 }] }],
        },
      ],
      auth: 'aksk',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '全部 Key',
    })
    assert.deepEqual(snapshot.models.map((m) => m.id), ['big', 'small'])
  })

  it('keySelector 按上游 name 筛出单个 Key', () => {
    const snapshot = normalizeUsage({
      data: twoKeysSameModel,
      auth: 'aksk',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '全部 Key',
      keySelector: 'B',
    })
    assert.equal(snapshot.keyLabel, 'B')
    assert.equal(snapshot.totals.input, 5_000, '只应统计 B 的 5k')
  })

  it('keySelector 按 api_key 与掩码都能匹配', () => {
    const byRaw = normalizeUsage({
      data: twoKeysSameModel,
      auth: 'aksk',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '全部 Key',
      keySelector: 'key-aaaaaaaaaa',
    })
    const byMasked = normalizeUsage({
      data: twoKeysSameModel,
      auth: 'aksk',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '全部 Key',
      keySelector: 'key-a*****aa',
    })
    assert.equal(byRaw.totals.input, 10_000)
    assert.equal(byMasked.totals.input, 10_000)
  })

  it('keySelector 匹配不到时给空快照而不是抛错（零用量 Key 的已知边界）', () => {
    const snapshot = normalizeUsage({
      data: twoKeysSameModel,
      auth: 'aksk',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '全部 Key',
      keySelector: '当日零用量的Key',
    })
    assert.deepEqual(snapshot.models, [])
    assert.equal(snapshot.totals.total, 0)
  })

  it('未识别单位告警在合并后仍保留', () => {
    const snapshot = normalizeUsage({
      data: [
        { api_key: 'k1aaaaaaaaaa', name: 'A', models: [{ id: 'm', items: [{ name: '输入 Token', unit: 'flurbs', total: 1 }] }] },
        { api_key: 'k2bbbbbbbbbb', name: 'B', models: [{ id: 'm', items: [{ name: '输入 Token', unit: 'flurbs', total: 2 }] }] },
      ],
      auth: 'aksk',
      query: QUERY,
      day: '2026-01-01',
      fallbackKeyLabel: '全部 Key',
    })
    assert.equal(snapshot.models.length, 1)
    assert.equal(snapshot.models[0]?.total, 3, '同名同单位的 item 应相加')
    assert.equal(snapshot.warnings.filter((w) => w.includes('flurbs')).length, 1, '告警应去重')
  })
})
