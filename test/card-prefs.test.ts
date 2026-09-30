/**
 * 侧栏卡片偏好（展开状态）的读写测试。
 *
 * 重点不是"能存能取"，而是**存储不可用时的降级**：隐私模式下 `localStorage`
 * 会直接抛错，卡片必须照常渲染（退回默认收起），而不是整块消失。
 *
 * @vitest-environment jsdom
 * @module dsh-qiniu-usage/test/card-prefs
 */

import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'vitest'
import { CARD_EXPANDED_KEY, readCardExpanded, writeCardExpanded } from '../src/client/card-prefs.ts'

afterEach(() => {
  window.localStorage.clear()
})

describe('侧栏卡片 · 展开状态偏好', () => {
  it('默认收起', () => {
    assert.equal(readCardExpanded(), false)
  })

  it('写进去能读回来', () => {
    writeCardExpanded(true)
    assert.equal(window.localStorage.getItem(CARD_EXPANDED_KEY), '1')
    assert.equal(readCardExpanded(), true)

    writeCardExpanded(false)
    assert.equal(window.localStorage.getItem(CARD_EXPANDED_KEY), '0')
    assert.equal(readCardExpanded(), false)
  })

  it('存储读不了时退回默认收起（而不是抛错）', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled')
      },
    })
    try {
      assert.equal(readCardExpanded(), false)
      // 写入失败也不能炸：本次会话内的状态由组件自己持有。
      writeCardExpanded(true)
    } finally {
      if (original !== undefined) Object.defineProperty(window, 'localStorage', original)
    }
  })
})
