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
})

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

  it('重复挂载不会产生第二个容器（热重载安全）', async () => {
    const { ctx } = makeCtx()
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
