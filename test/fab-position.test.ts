/**
 * 悬浮按钮位置逻辑的单测。
 *
 * 这些是纯函数，所以直接在 node 环境测：钳制、读写记忆、弹层换边。
 * 真实 DOM 上的拖拽行为在 `client-mount.test.ts` 里测（那需要 jsdom）。
 *
 * @module dsh-qiniu-usage/test/fab-position
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import {
  clampFabPosition,
  defaultFabStorage,
  fabPopupPlacement,
  FAB_EDGE_MARGIN,
  FAB_POSITION_KEY,
  readFabPosition,
  storeFabPosition,
  type FabStorage,
} from '../src/client/fab-position.ts'

/** 一个最小存储替身，可切换成"每次都抛异常"。 */
function makeStorage(options: { throwOn?: 'get' | 'set'; initial?: Record<string, string> } = {}): {
  storage: FabStorage
  data: Map<string, string>
} {
  const data = new Map<string, string>(Object.entries(options.initial ?? {}))
  return {
    data,
    storage: {
      getItem: (key) => {
        if (options.throwOn === 'get') throw new Error('storage disabled')
        return data.get(key) ?? null
      },
      setItem: (key, value) => {
        if (options.throwOn === 'set') throw new Error('quota exceeded')
        data.set(key, value)
      },
    },
  }
}

describe('悬浮按钮位置 · 钳制', () => {
  const size = { width: 160, height: 34 }
  const viewport = { width: 1_000, height: 800 }

  it('视口内的坐标原样返回', () => {
    assert.deepEqual(clampFabPosition({ x: 300, y: 200 }, size, viewport), { x: 300, y: 200 })
  })

  it('拖出右下角会被拉回可见范围', () => {
    assert.deepEqual(clampFabPosition({ x: 5_000, y: 5_000 }, size, viewport), {
      x: 1_000 - 160 - FAB_EDGE_MARGIN,
      y: 800 - 34 - FAB_EDGE_MARGIN,
    })
  })

  it('拖出左上角会被推回留白处', () => {
    assert.deepEqual(clampFabPosition({ x: -500, y: -500 }, size, viewport), {
      x: FAB_EDGE_MARGIN,
      y: FAB_EDGE_MARGIN,
    })
  })

  it('视口比按钮还小时不会算出负数', () => {
    const tiny = clampFabPosition({ x: -100, y: -100 }, { width: 900, height: 400 }, { width: 320, height: 200 })
    assert.equal(tiny.x, FAB_EDGE_MARGIN)
    assert.equal(tiny.y, FAB_EDGE_MARGIN)
  })

  it('非有限数值回落到留白处而不是 NaN', () => {
    const result = clampFabPosition({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, size, viewport)
    assert.equal(result.x, FAB_EDGE_MARGIN)
    // Infinity 会被钳到最大值（不是留白处）—— 关键是它必须是有限数。
    assert.ok(Number.isFinite(result.y))
  })
})

describe('悬浮按钮位置 · 记忆', () => {
  it('写进去能读出来', () => {
    const { storage, data } = makeStorage()
    storeFabPosition({ x: 123.6, y: 45.2 }, storage)
    assert.equal(data.get(FAB_POSITION_KEY), '{"x":124,"y":45}', '存的应是取整后的坐标')
    assert.deepEqual(readFabPosition(storage), { x: 124, y: 45 })
  })

  it('没存过 → null（回落到默认右上角）', () => {
    assert.equal(readFabPosition(makeStorage().storage), null)
  })

  it('存的是坏 JSON → null 而不是抛错', () => {
    const { storage } = makeStorage({ initial: { [FAB_POSITION_KEY]: 'not json' } })
    assert.equal(readFabPosition(storage), null)
  })

  it('存的结构不对（缺 y / 不是数字）→ null', () => {
    for (const raw of ['{"x":1}', '{"x":1,"y":"2"}', '{"x":null,"y":2}', '[1,2]', '42', 'null']) {
      const { storage } = makeStorage({ initial: { [FAB_POSITION_KEY]: raw } })
      assert.equal(readFabPosition(storage), null, `${raw} 应被当作没记住`)
    }
  })

  it('存储读取抛异常（隐私模式）→ null 且不抛', () => {
    assert.equal(readFabPosition(makeStorage({ throwOn: 'get' }).storage), null)
  })

  it('存储写入抛异常（配额）→ 不抛出去', () => {
    assert.doesNotThrow(() => storeFabPosition({ x: 1, y: 2 }, makeStorage({ throwOn: 'set' }).storage))
  })

  it('没有存储可用时读 null、写不抛', () => {
    assert.equal(readFabPosition(undefined), null)
    assert.doesNotThrow(() => storeFabPosition({ x: 1, y: 2 }, undefined))
  })

  it('node 环境（没有 localStorage）下 defaultFabStorage 返回 undefined', () => {
    assert.equal(defaultFabStorage(), undefined)
  })
})

describe('悬浮按钮位置 · 弹层展开方向', () => {
  const viewport = { width: 1_000, height: 800 }
  const button = { width: 160, height: 34 }

  it('按钮在上半屏 → 向下展开', () => {
    assert.equal(fabPopupPlacement({ ...button, x: 800, y: 56 }, viewport).vertical, 'down')
  })

  it('按钮在下半屏 → 向上展开', () => {
    assert.equal(fabPopupPlacement({ ...button, x: 800, y: 700 }, viewport).vertical, 'up')
  })

  it('按钮在右半屏 → 右对齐（弹层向左长，不会顶出视口）', () => {
    assert.equal(fabPopupPlacement({ ...button, x: 820, y: 56 }, viewport).align, 'end')
  })

  it('按钮在左半屏 → 左对齐（弹层向右长）', () => {
    assert.equal(fabPopupPlacement({ ...button, x: 20, y: 56 }, viewport).align, 'start')
  })
})
