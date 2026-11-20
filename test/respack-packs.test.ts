// @vitest-environment jsdom
// 逐包明细的两条硬约束：条形独占一行（同排时条尾随到期文案长短参差），已用完的包默认折叠。

import {strict as assert} from 'node:assert'
import {afterEach, describe, it} from 'vitest'
import {createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'

import {RespackPacks} from '../src/client/RespackPacks.tsx'
import {zh} from '../src/client/locales.ts'
import {cls} from '../src/client/styles.ts'
import type {RespackSnapshot} from '../src/qiniu/respack.ts'

const dict = zh as unknown as Record<string, string>
function t(key: string, params?: Record<string, unknown>): string {
  const template = dict[key]
  if (template === undefined) throw new Error(`文案键缺失：${key}`)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

const ACTIVE = '国产模型实时推理 5000W'
const FULL = '实时推理全系列模型 300W（新用户体验包）'

const snapshot: RespackSnapshot = {
  items: [],
  fetchedAt: '2026-09-17T11:00:00+08:00',
  warnings: [],
  packages: [
    {
      name: ACTIVE,
      unit: 'k/tokens',
      status: 2,
      statusLabel: '使用中',
      effectiveStart: '2026-09-01T00:00:00+08:00',
      effectiveEnd: '2027-02-01T00:00:00+08:00',
      daysRemaining: 137,
      carryOverPolicy: 2,
      carryOverLabel: '一次性分配',
      totalAmount: 50_000,
      usedAmount: 16_440,
      utilization: 0.3288,
      orderHash: 'a'.repeat(32),
      poId: 1,
    },
    {
      name: FULL,
      unit: 'k/tokens',
      status: 3,
      statusLabel: '已用完',
      effectiveStart: '2026-08-01T00:00:00+08:00',
      effectiveEnd: '2026-11-01T00:00:00+08:00',
      daysRemaining: 45,
      carryOverPolicy: 2,
      carryOverLabel: '一次性分配',
      totalAmount: 3_000,
      usedAmount: 3_000,
      utilization: 1,
      orderHash: 'b'.repeat(32),
      poId: 2,
    },
  ],
}

let mounted: { root: Root; container: HTMLElement } | undefined

afterEach(() => {
  mounted?.root.unmount()
  mounted?.container.remove()
  mounted = undefined
})

function mount(): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  root.render(createElement(RespackPacks, { snapshot, details: {}, onLoadDetail: () => {}, t }))
  mounted = { root, container }
  return container
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待超时：条件始终不成立')
}

function click(element: Element): void {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

describe('逐包明细 · 行内布局', () => {
  it('条形是包的直接子元素，占满整行', async () => {
    const container = mount()
    await waitFor(() => container.textContent!.includes(ACTIVE))
    const bar = container.querySelector(`.${cls.packBar}`)
    assert.ok(bar !== null, '应有进度条')
    assert.equal(bar!.parentElement!.classList.contains(cls.pack), true, '条形不该被塞进与元信息同排的容器')
  })

  it('元信息与下钻单独一行（到期提示不再挤占条形宽度）', async () => {
    const container = mount()
    await waitFor(() => container.textContent!.includes(ACTIVE))
    const meta = container.querySelector(`.${cls.packMeta}`)
    const foot = container.querySelector(`.${cls.packFoot}`)
    assert.ok(meta !== null && foot !== null, '应有元信息行')
    assert.equal(meta!.parentElement, foot, '元信息应挂在 packFoot 上')
    assert.ok(foot!.querySelector(`.${cls.packAction}`) !== null, '下钻按钮应与元信息同一行')
    assert.ok(meta!.textContent!.includes('天后到期'), `元信息应含到期提示，实际：${meta!.textContent}`)
  })
})

describe('逐包明细 · 已用完的包默认折叠', () => {
  it('默认不渲染 100% 利用的包，开关带上数量', async () => {
    const container = mount()
    await waitFor(() => container.textContent!.includes(ACTIVE))
    assert.equal(container.textContent!.includes(FULL), false, '默认应隐藏 100% 利用的包')
    const toggle = container.querySelector(`.${cls.packToggle}`)
    assert.ok(toggle !== null, '应有展开开关')
    assert.equal(toggle!.textContent, t('qiniu.respack.showFull', { count: 1 }))
  })

  it('点一次展开，再点一次收起', async () => {
    const container = mount()
    await waitFor(() => container.textContent!.includes(ACTIVE))
    const toggle = container.querySelector(`.${cls.packToggle}`)!
    click(toggle)
    await waitFor(() => container.textContent!.includes(FULL))
    assert.ok(container.textContent!.includes(ACTIVE), '展开后仍在用的包不应消失')
    assert.equal(container.querySelector(`.${cls.packToggle}`)!.textContent, t('qiniu.respack.hideFull'))

    click(container.querySelector(`.${cls.packToggle}`)!)
    await waitFor(() => !container.textContent!.includes(FULL))
  })

  it('没有已用完的包时不出现开关', async () => {
    const onlyActive: RespackSnapshot = { ...snapshot, packages: snapshot.packages.slice(0, 1) }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    root.render(createElement(RespackPacks, { snapshot: onlyActive, details: {}, onLoadDetail: () => {}, t }))
    mounted = { root, container }
    await waitFor(() => container.textContent!.includes(ACTIVE))
    assert.equal(container.querySelector(`.${cls.packToggle}`), null, '没有已用完的包就不该有开关')
  })
})
