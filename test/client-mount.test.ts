/**
 * 悬浮按钮的**挂载**测试（真实 DOM）。
 *
 * 这个文件存在的理由和 `host-boot.test.ts` 一样：接线类的错误（挂到哪里、重复挂、
 * 卸载有没有清干净、关着的时候有没有偷偷发请求）只有真的执行一遍才发现得了。
 *
 * 用的是真 `react-dom/client` + jsdom，`ctx` 是替身。宿主级浮层直接挂
 * `document.body`，因为新会话页没有 session、slot 化会消失。
 *
 * @vitest-environment jsdom
 * @module dsh-qiniu-usage/test/client-mount
 */

import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** 造一个最小可用的客户端 ctx 替身。 */
function makeCtx(options: { floatingButton?: boolean } = {}): {
  ctx: unknown
  effects: (() => void)[]
  settingsListeners: (() => void)[]
  localeListeners: (() => void)[]
} {
  const effects: (() => void)[] = []
  const settingsListeners: (() => void)[] = []
  const localeListeners: (() => void)[] = []

  const settingsScope = {
    getSnapshot: () => ({ value: { floatingButton: options.floatingButton ?? true } }),
    subscribe: (fn: () => void) => {
      settingsListeners.push(fn)
      return () => {
        const index = settingsListeners.indexOf(fn)
        if (index >= 0) settingsListeners.splice(index, 1)
      }
    },
  }

  const ctx = {
    effect: (cb: () => unknown) => {
      const disposer = cb()
      if (typeof disposer === 'function') effects.push(disposer as () => void)
      return () => {}
    },
    get: (name: string) => (name === 'webUiSettings' ? { bind: () => settingsScope } : undefined),
    settingsScope: { bind: () => settingsScope },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
      subscribe: (fn: () => void) => {
        localeListeners.push(fn)
        return () => {
          const index = localeListeners.indexOf(fn)
          if (index >= 0) localeListeners.splice(index, 1)
        }
      },
    },
    slots: {
      inject: (_name: string, cb: () => unknown) => cb(),
      register: () => () => {},
    },
  }

  return { ctx, effects, settingsListeners, localeListeners }
}

/** 当前页面上的悬浮根容器。 */
function floatingRoots(): NodeListOf<Element> {
  return document.querySelectorAll('div[data-dsh-qiniu-usage-root]')
}

/** 等到条件成立（或超时），用于等 React 的并发渲染落地。 */
async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('等待超时')
}

/** 装一个记录调用的 fetch 替身。 */
function installFetch(): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    return new Response(
      JSON.stringify({ ok: true, usage: null, respack: null, errors: [], fetchedAt: '' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

afterEach(() => {
  document.body.replaceChildren()
  // 位置是"按浏览器记住"的，用例之间必须清干净，否则互相污染。
  window.localStorage.clear()
  for (const restore of rectRestores.splice(0)) restore()
})

/** 已安装的 getBoundingClientRect 替身，用例结束统一还原。 */
const rectRestores: (() => void)[] = []

/**
 * 让所有元素报告同一个矩形。
 *
 * jsdom 没有布局引擎，`getBoundingClientRect()` 一律返回全 0，FAB 的"量出位置"
 * 与拖拽都需要真实尺寸，所以这里自己喂。
 */
function installRect(rect: { left: number; top: number; width: number; height: number }): void {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => ({}),
    } as DOMRect
  }
  rectRestores.push(() => {
    Element.prototype.getBoundingClientRect = original
  })
}

/**
 * 派发一个指针事件。
 *
 * jsdom 没有 `PointerEvent` 构造器，所以用 `Event` 加手填字段 —— React 是从
 * 原生事件对象上读 `clientX`/`pointerId` 的，手填即可。
 */
function pointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' })
  target.dispatchEvent(event)
}

/**
 * 取 React 渲染出来的 `.fab-root`：位置写在这个元素上。
 *
 * 注意 `floatingRoots()` 拿到的是宿主容器 div（`data-dsh-qiniu-usage-root`），
 * React 的浮层是它的**子元素**。
 */
function fabRootElement(): HTMLElement {
  const element = fabRootOrNull()
  assert.ok(element !== null, '应有 fabRoot 元素')
  return element
}

/**
 * 同上，但没渲染好时返回 null。
 *
 * `waitFor` 的判定里**不能**用会抛异常的版本：容器是先挂到 DOM、React 再往里渲染的，
 * 两者之间有一个空窗期，抛异常会让轮询变成偶发失败。
 */
function fabRootOrNull(): HTMLElement | null {
  const element = floatingRoots()[0]?.firstElementChild
  return element instanceof HTMLElement ? element : null
}

/** 取悬浮按钮（弹层里也有 button，必须按语义选）。 */
function fabButton(): Element {
  const root = floatingRoots()[0]
  assert.ok(root !== undefined, '应先有悬浮根容器')
  const button = root.querySelector('button[aria-haspopup="dialog"]')
  assert.ok(button !== null, '应有悬浮按钮')
  return button
}

describe('悬浮按钮 · 挂载', () => {
  it('挂到 document.body 的独立容器上，并带 data-dsh-plugin 供宿主隐藏', async () => {
    const { ctx } = makeCtx()
    apply(ctx as never)

    await waitFor(() => floatingRoots().length === 1)
    const root = floatingRoots()[0]
    assert.ok(root !== undefined)
    assert.equal(root.getAttribute('data-dsh-plugin'), 'qiniu-usage')
    assert.ok(root.parentElement === document.body, '应直接挂在 body 上')
  })

  it('按钮渲染出来了，且默认不展开弹层', async () => {
    const { ctx } = makeCtx()
    apply(ctx as never)

    await waitFor(() => (floatingRoots()[0]?.textContent ?? '').length > 0)
    const root = floatingRoots()[0]
    assert.ok(root !== undefined)
    assert.ok(root.textContent?.includes('qiniu.fab.button'), '应有按钮文案（t 替身返回键名）')

    // 用语义选择器定位悬浮按钮：弹层里也有 button，按顺序取会取错。
    const button = root.querySelector('button[aria-haspopup="dialog"]')
    assert.ok(button !== null, '应有悬浮按钮')
    assert.equal(button.getAttribute('aria-expanded'), 'false', '默认应为收起状态')
    assert.equal(root.querySelector('[role="dialog"]'), null, '默认不应渲染弹层')
  })

  it('浮层关闭时不发任何请求（零后台流量）', async () => {
    const probe = installFetch()
    try {
      const { ctx } = makeCtx()
      apply(ctx as never)
      await waitFor(() => (floatingRoots()[0]?.textContent ?? '').length > 0)
      await new Promise((resolve) => setTimeout(resolve, 30))
      assert.deepEqual(probe.calls, [], '未展开时不应有请求')
    } finally {
      probe.restore()
    }
  })

  it('点击按钮展开弹层并触发一次取数', async () => {
    const probe = installFetch()
    try {
      const { ctx } = makeCtx()
      apply(ctx as never)
      await waitFor(() => (floatingRoots()[0]?.textContent ?? '').length > 0)

      const root = floatingRoots()[0]
      assert.ok(root !== undefined)
      const button = root.querySelector('button[aria-haspopup="dialog"]')
      assert.ok(button !== null)
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      await waitFor(() => root.querySelector('[role="dialog"]') !== null)
      assert.equal(
        root.querySelector('button[aria-haspopup="dialog"]')?.getAttribute('aria-expanded'),
        'true',
        '展开后 aria-expanded 应为 true',
      )
      await waitFor(() => probe.calls.length > 0)
      assert.ok(
        probe.calls.some((url) => url.includes('/overview')),
        `展开后应取数，实际：${probe.calls.join(', ')}`,
      )
    } finally {
      probe.restore()
    }
  })

  it('重复挂载不会产生第二个容器（热重载安全）', async () => {    const { ctx } = makeCtx()
    apply(ctx as never)
    await waitFor(() => floatingRoots().length === 1)

    // 模拟上一个 bundle 实例留下的容器
    const stale = document.createElement('div')
    stale.dataset.dshQiniuUsageRoot = ''
    document.body.appendChild(stale)
    assert.equal(floatingRoots().length, 2, '前置条件：确实有两个容器')

    apply(makeCtx().ctx as never)
    await waitFor(() => floatingRoots().length === 1)
    assert.equal(floatingRoots().length, 1, '第二次挂载应清掉遗留容器，只留一个')
  })

  it('fiber 销毁时卸载 React root 并移除容器', async () => {
    const { ctx, effects } = makeCtx()
    apply(ctx as never)
    await waitFor(() => floatingRoots().length === 1)
    // apply 会注册两个 effect：文案字典 + 悬浮按钮。
    assert.ok(effects.length >= 1, `应注册 effect，实际 ${effects.length}`)

    for (const dispose of effects) dispose()
    assert.equal(floatingRoots().length, 0, '销毁后不应留下容器')
  })

  it('配置 floatingButton=false 时不挂载', async () => {
    const { ctx } = makeCtx({ floatingButton: false })
    apply(ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(floatingRoots().length, 0, '关掉配置后不应有浮层')
  })

  it('配置改为 false 时卸载，改回 true 时重新挂载', async () => {
    let enabled = true
    const listeners: (() => void)[] = []
    const scope = {
      getSnapshot: () => ({ value: { floatingButton: enabled } }),
      subscribe: (fn: () => void) => {
        listeners.push(fn)
        return () => {}
      },
    }
    const ctx = {
      effect: (cb: () => unknown) => {
        cb()
        return () => {}
      },
      get: () => ({ bind: () => scope }),
      settingsScope: { bind: () => scope },
      locale: { register: () => () => {}, bind: () => (k: string) => k, subscribe: () => () => {} },
      slots: { inject: (_n: string, cb: () => unknown) => cb(), register: () => () => {} },
    }

    apply(ctx as never)
    await waitFor(() => floatingRoots().length === 1)

    enabled = false
    for (const listener of listeners) listener()
    await waitFor(() => floatingRoots().length === 0)

    enabled = true
    for (const listener of listeners) listener()
    await waitFor(() => floatingRoots().length === 1)
  })

  it('语言变化时重新渲染（按钮文案跟随）', async () => {
    let label = 'zh'
    const { ctx, localeListeners } = makeCtx()
    // 覆盖 locale.bind 让它返回当前语言标签
    ;(ctx as { locale: { bind: () => (key: string) => string } }).locale.bind = () => (key: string) => `${label}:${key}`

    apply(ctx as never)
    await waitFor(() => (floatingRoots()[0]?.textContent ?? '').includes('zh:'))

    label = 'en'
    for (const listener of localeListeners) listener()
    await waitFor(() => (floatingRoots()[0]?.textContent ?? '').includes('en:'))
  })
})

describe('悬浮按钮 · 位置（默认右上角 / 拖拽 / 记忆）', () => {
  /** jsdom 的视口是 1024×768；按钮放在右上角。 */
  const TOP_RIGHT = { left: 700, top: 56, width: 160, height: 34 }

  /** 挂载并等位置被"量"成显式坐标。 */
  async function mountWithRect(): Promise<{ root: Element; fab: HTMLElement }> {
    installRect(TOP_RIGHT)
    const { ctx } = makeCtx()
    apply(ctx as never)
    await waitFor(() => floatingRoots().length === 1)
    const root = floatingRoots()[0]
    assert.ok(root !== undefined)
    await waitFor(() => fabRootOrNull()?.style.left === '700px')
    return { root, fab: fabRootElement() }
  }

  it('默认落在右上角，并把量到的位置固化成坐标', async () => {
    const { fab: element } = await mountWithRect()
    assert.equal(element.style.left, '700px')
    assert.equal(element.style.top, '56px')
    assert.equal(element.style.right, 'auto', '改用显式坐标后要清掉 CSS 的 right，否则被拉伸')
  })

  it('拖拽改变位置，并把结果写进 localStorage', async () => {
    const { fab: element } = await mountWithRect()
    const button = fabButton()

    pointer(button, 'pointerdown', 710, 66)
    pointer(button, 'pointermove', 510, 366)
    pointer(button, 'pointerup', 510, 366)

    await waitFor(() => element.style.left === '500px')
    assert.equal(element.style.top, '356px', '位移应完全跟手：56 + 300')
    assert.deepEqual(
      JSON.parse(window.localStorage.getItem('dsh-qiniu-usage:fab-position') ?? 'null'),
      { x: 500, y: 356 },
      '位置应被记住',
    )
  })

  it('拖拽不会被当成点击（松手后弹层不会自己开）', async () => {
    const { root } = await mountWithRect()
    const button = fabButton()

    pointer(button, 'pointerdown', 710, 66)
    pointer(button, 'pointermove', 400, 300)
    pointer(button, 'pointerup', 400, 300)
    // 浏览器在 pointerup 之后一定会补一个 click —— 它必须被抑制。
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(root.querySelector('[role="dialog"]'), null, '拖完不该顺手打开弹层')

    // 抑制只作用于紧随其后的那一次：下一次点击要照常打开。
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await waitFor(() => root.querySelector('[role="dialog"]') !== null)
  })

  it('微小手抖（未超过阈值）仍然算点击', async () => {
    const { root } = await mountWithRect()
    const button = fabButton()

    pointer(button, 'pointerdown', 710, 66)
    pointer(button, 'pointermove', 712, 67)
    pointer(button, 'pointerup', 712, 67)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await waitFor(() => root.querySelector('[role="dialog"]') !== null)
    assert.equal(fabRootElement().style.left, '700px', '没超过阈值就不该移动')
  })

  it('重新挂载会恢复到记住的位置（不必再量）', async () => {
    window.localStorage.setItem('dsh-qiniu-usage:fab-position', '{"x":120,"y":300}')
    const { ctx } = makeCtx()
    apply(ctx as never)
    await waitFor(() => floatingRoots().length === 1)

    const element = fabRootElement()
    assert.equal(element.style.left, '120px')
    assert.equal(element.style.top, '300px')
  })

  it('拖出视口会被钳回可见范围', async () => {
    const { fab: element } = await mountWithRect()
    const button = fabButton()

    pointer(button, 'pointerdown', 710, 66)
    pointer(button, 'pointermove', 5_000, 5_000)
    pointer(button, 'pointerup', 5_000, 5_000)

    // 1024 - 160 - 8 = 856；768 - 34 - 8 = 726
    await waitFor(() => element.style.left === '856px')
    assert.equal(element.style.top, '726px')
  })

  it('窗口变小后位置被重新钳回，并更新记忆', async () => {
    const { fab: element } = await mountWithRect()

    const originalWidth = window.innerWidth
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
      window.dispatchEvent(new Event('resize'))
      // 320 - 160 - 8 = 152
      await waitFor(() => element.style.left === '152px')
      assert.deepEqual(
        JSON.parse(window.localStorage.getItem('dsh-qiniu-usage:fab-position') ?? 'null'),
        { x: 152, y: 56 },
      )
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })
})
