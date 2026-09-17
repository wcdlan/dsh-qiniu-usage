/**
 * 悬浮按钮"余量"汇总的单测。
 *
 * 这个函数是 FAB 上那个数字的唯一来源，此前只在渲染测试里被间接覆盖 ——
 * 而"不同单位不能相加"这条恰恰是渲染测试看不出来的（fixture 里单位是一致的）。
 *
 * @module dsh-qiniu-usage/test/respack-summary
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'

import { sumMonthRemain } from '../src/client/respack-summary.ts'

describe('sumMonthRemain · 当月剩余汇总', () => {
  it('没有计费项时返回 undefined', () => {
    assert.equal(sumMonthRemain([]), undefined, '空列表不应编出一个 0 余量')
  })

  it('单位一致时把剩余量加起来', () => {
    assert.deepEqual(
      sumMonthRemain([
        { monthRemain: 3_000_000, unit: 'k/tokens' },
        { monthRemain: 2_000_000, unit: 'k/tokens' },
      ]),
      { value: 5_000_000, unit: 'k/tokens' },
    )
  })

  it('不同单位不跨类相加，只报剩余量最大的那一组', () => {
    // `k/tokens` 与 `GB` 相加没有意义 —— 这也是 7 月那次"300W 显示成 3K"
    // 的单位事故的同类问题，必须分组。
    const result = sumMonthRemain([
      { monthRemain: 1_000, unit: 'GB' },
      { monthRemain: 4_000_000, unit: 'k/tokens' },
      { monthRemain: 2_000_000, unit: 'k/tokens' },
    ])
    assert.deepEqual(result, { value: 6_000_000, unit: 'k/tokens' })
    assert.notEqual(result?.value, 6_001_000, '不能把 GB 加进 tokens')
  })

  it('按剩余量比较而不是按计费项个数', () => {
    // 单项很小但条数多的一组，不应该压过单项更大的另一组。
    const result = sumMonthRemain([
      { monthRemain: 10, unit: 'GB' },
      { monthRemain: 10, unit: 'GB' },
      { monthRemain: 10, unit: 'GB' },
      { monthRemain: 25, unit: 'k/tokens' },
    ])
    assert.deepEqual(result, { value: 30, unit: 'GB' })
  })

  it('并列为最大时给出并列中的某个单位（不是错的数值）', () => {
    const result = sumMonthRemain([
      { monthRemain: 5, unit: 'GB' },
      { monthRemain: 5, unit: 'k/tokens' },
    ])
    assert.equal(result?.value, 5)
    assert.ok(
      result !== undefined && ['GB', 'k/tokens'].includes(result.unit),
      `并列时单位应取自并列项，实际：${String(result?.unit)}`,
    )
  })

  it('非有限值按 0 计，不产出 NaN 余量', () => {
    const result = sumMonthRemain([
      { monthRemain: Number.NaN, unit: 'GB' },
      { monthRemain: Number.POSITIVE_INFINITY, unit: 'GB' },
      { monthRemain: 7, unit: 'GB' },
    ])
    assert.deepEqual(result, { value: 7, unit: 'GB' })
  })

  it('全部为非有限值时仍返回 0 而不是吞掉这一组', () => {
    // 0 余量与"没有数据"是两码事：前者要显示"余 0"，后者不显示。
    assert.deepEqual(sumMonthRemain([{ monthRemain: Number.NaN, unit: 'GB' }]), {
      value: 0,
      unit: 'GB',
    })
  })

  it('负数（超额）照实累加', () => {
    const result = sumMonthRemain([
      { monthRemain: -5, unit: 'GB' },
      { monthRemain: 3, unit: 'GB' },
    ])
    assert.deepEqual(result, { value: -2, unit: 'GB' })
  })

  it('不修改传入的数组', () => {
    const items = [
      { monthRemain: 1, unit: 'GB' },
      { monthRemain: 2, unit: 'GB' },
    ]
    sumMonthRemain(items)
    assert.deepEqual(items, [
      { monthRemain: 1, unit: 'GB' },
      { monthRemain: 2, unit: 'GB' },
    ])
  })
})
