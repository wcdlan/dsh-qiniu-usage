// @vitest-environment jsdom
// 选择器只看 [class*=sidebarCol]/[class*=footArea]/[class*=settingsArea] 子串，故用最小 DOM 模拟即可，不必复刻哈希类名。

import {strict as assert} from 'node:assert'
import {afterEach, describe, it} from 'vitest'
import {apply} from '../src/client/index.ts'
import {SIDEBAR_CARD_ATTR, SIDEBAR_CARD_SELECTOR,} from '../src/client/sidebar-mount.tsx'
import {CARD_EXPANDED_KEY} from '../src/client/card-prefs.ts'

// 本用例注册过的所有 effect 清理函数。必须逐个卸载：挂载 effect 含 body 级
// MutationObserver，不拆会在后续用例继续把旧容器往新侧栏里塞（表现为凭空多出卡片）。
let activeEffects: (() => void)[] = []

/** 造一个最小可用的客户端 ctx 替身。 */
function makeCtx(options: { sidebarCard?: boolean } = {}): {
  ctx: unknown
  effects: (() => void)[]
  settingsListeners: (() => void)[]
  localeListeners: (() => void)[]
  setSidebarCard(enabled: boolean): void
} {
  const effects: (() => void)[] = []
  const settingsListeners: (() => void)[] = []
  const localeListeners: (() => void)[] = []
  /** 可变的配置快照：用例可以中途翻转再通知订阅者。 */
  const config: { sidebarCard: boolean } = { sidebarCard: options.sidebarCard ?? true }

  /** 记录清理函数：fiber 销毁与用例收尾都走同一份清单。 */
  const track = (disposer: unknown): void => {
    if (typeof disposer === 'function') {
      effects.push(disposer as () => void)
      activeEffects.push(disposer as () => void)
    }
  }

  const settingsScope = {
    getSnapshot: () => ({ value: config }),
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
      track(cb())
      return () => {}
    },
    // 插件把设置 binder 走**可选**子 fiber 注入；替身直接当场喂给它。
    inject: (_deps: string[], cb: (scopeCtx: unknown) => unknown) => {
      track(cb(ctx))
      return () => {}
    },
    get: (name: string) => (name === 'webUiSettings' ? { bind: () => settingsScope } : undefined),
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

  return {
    ctx,
    effects,
    settingsListeners,
    localeListeners,
    setSidebarCard: (enabled: boolean) => {
      config.sidebarCard = enabled
      for (const listener of settingsListeners) listener()
    },
  }
}

/** 侧栏卡片容器的集合。 */
function cards(): NodeListOf<Element> {
  return document.querySelectorAll(SIDEBAR_CARD_SELECTOR)
}

/** 取唯一的卡片容器；没有则抛。 */
function card(): Element {
  const element = cards()[0]
  assert.ok(element !== undefined, '应有侧栏卡片容器')
  return element
}

/** 等到条件成立（或超时），用于等 React 的并发渲染落地。 */
async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('等待超时')
}

// 铺一段最小的侧栏 DOM：regionArea + footArea（footerActions + settingsArea）。
function installSidebar(): { column: HTMLElement; foot: HTMLElement; settings: HTMLElement } {
  document.body.replaceChildren()
  const column = document.createElement('div')
  column.className = '_test_sidebarCol'
  const region = document.createElement('div')
  region.className = '_test_regionArea'
  const foot = document.createElement('div')
  foot.className = '_test_footArea'
  const actions = document.createElement('div')
  actions.className = '_test_footerActions'
  const settings = document.createElement('div')
  settings.className = '_test_settingsArea'
  foot.append(actions)
  foot.append(settings)
  column.append(region)
  column.append(foot)
  document.body.append(column)
  return { column, foot, settings }
}

/** 装一个记录调用的 fetch 替身。 */
function installFetch(): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
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

/** 点击一个元素（React 监听的是冒泡的 click）。 */
function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

// 把 footArea 的子节点翻译成可读身份证（如 ['actions','ours','rival','settings']），用来断言顺序是否稳定。
function footOrder(foot: HTMLElement): string[] {
  return Array.from(foot.children).map((child) => {
    if (child.hasAttribute(SIDEBAR_CARD_ATTR)) return 'ours'
    if (child.hasAttribute('data-test-rival')) return 'rival'
    const className = typeof child.className === 'string' ? child.className : ''
    if (className.includes('settingsArea')) return 'settings'
    if (className.includes('footerActions')) return 'actions'
    return 'other'
  })
}

/** 卡片里的主按钮（收起/展开）；还没渲染出来时返回 null。 */
function mainButtonOrNull(): HTMLElement | null {
  return cards()[0]?.querySelector<HTMLElement>('button[aria-expanded]') ?? null
}

/** 卡片里的主按钮（收起/展开）。 */
function mainButton(): HTMLElement {
  const button = mainButtonOrNull()
  assert.ok(button !== null, '应有卡片主按钮')
  return button
}

/** 卡片里的「详情」按钮。 */
function detailButton(): HTMLElement {
  const button = card().querySelector<HTMLElement>('[data-dsh-part="sidebar-card-detail"]')
  assert.ok(button !== null, '应有详情按钮（要先展开）')
  return button
}

afterEach(() => {
    // 先拆插件（断开观察者、卸载 React root）再清 DOM：反过来的话，还活着的观察者会把旧容器搬进新侧栏。
  for (const dispose of activeEffects.splice(0)) {
    try {
      dispose()
    } catch {
    }
  }
  document.body.replaceChildren()
  window.localStorage.clear()
})

describe('侧栏卡片 · 挂载与落位', () => {
  it('插进侧栏 footArea 的 Settings 行之前（不是挂在 body 上）', async () => {
    const { foot, settings } = installSidebar()
    const { ctx } = makeCtx()
    apply(ctx as never)

    await waitFor(() => cards().length === 1)
    assert.equal(card().getAttribute(SIDEBAR_CARD_ATTR), '', '容器应带稳定标识')
    assert.equal(card().parentElement, foot, '容器应落在 footArea 里')
    assert.equal(card().nextElementSibling, settings, '应紧贴在 Settings 行之前')
    // React 的首次渲染是异步的：容器先到位，内容随后才进去。
    await waitFor(() => card().querySelector('[data-dsh-plugin="qiniu-usage"]') !== null)
  })

  it('侧栏晚于插件出现时，观察者会把它接上', async () => {
    const { column, foot } = installSidebar()
    document.body.replaceChildren()
    const { ctx } = makeCtx()
    apply(ctx as never)

    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(cards().length, 0, '没有侧栏时容器无处安放，不会挂在 body 上')

    document.body.append(column)
    await waitFor(() => cards()[0]?.parentElement === foot)
  })

  it('容器被 shell 重渲染挤掉后会自己回到 Settings 行之前', async () => {
    const { foot, settings } = installSidebar()
    const { ctx } = makeCtx()
    apply(ctx as never)
    await waitFor(() => card().nextElementSibling === settings)

    const detached = card()
    detached.remove()
    assert.equal(cards().length, 0, '前置条件：容器确实离开了 DOM')
    foot.append(detached)

    await waitFor(() => card().nextElementSibling === settings)
    assert.equal(card().parentElement, foot)
  })

  it('与另一张"紧邻 Settings"的卡片共存时不会每帧互推（否则点击会被吞掉）', async () => {
    const { foot, settings } = installSidebar()

      // 竞争者：复刻 @linxin666/dsh-usage 的落位逻辑（只要自己不紧邻 Settings 就挪过去），它和我们抢同一个位置。
    const rival = document.createElement('div')
    rival.setAttribute('data-test-rival', '')
    const rivalPlace = (): void => {
      if (rival.nextElementSibling !== settings) foot.insertBefore(rival, settings)
    }
    rivalPlace()
    const rivalObserver = new MutationObserver(() => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(rivalPlace)
      else setTimeout(rivalPlace, 16)
    })
    rivalObserver.observe(document.body, { childList: true, subtree: true })
    activeEffects.push(() => {
      rivalObserver.disconnect()
      rival.remove()
    })

    const { ctx } = makeCtx()
    apply(ctx as never)
    await waitFor(() => cards().length === 1)

      // 关键不是"某一瞬间的顺序"：互推时每帧结束都回到同一顺序，只能数 footArea 的结构变化，稳定后应一动不动。
    let moves = 0
    const watcher = new MutationObserver((records) => {
      moves += records.length
    })
    watcher.observe(foot, { childList: true })

    await new Promise((resolve) => setTimeout(resolve, 60))
    moves = 0
    await new Promise((resolve) => setTimeout(resolve, 120))
    watcher.disconnect()

    assert.ok(moves <= 2, `两张卡片应停止互推，实际在 120ms 内改了 ${moves} 次 footArea 结构`)
    assert.ok(
      footOrder(foot).indexOf('ours') < footOrder(foot).indexOf('settings'),
      '我们的卡片必须在 Settings 行之前',
    )
  })

  it('重复挂载不会产生第二个容器，并清掉旧版悬浮按钮的容器（热重载安全）', async () => {
    installSidebar()
    const { ctx } = makeCtx()
    apply(ctx as never)
    await waitFor(() => cards().length === 1)

    const stale = document.createElement('div')
    stale.setAttribute(SIDEBAR_CARD_ATTR, '')
    document.body.append(stale)
    const legacy = document.createElement('div')
    legacy.dataset.dshQiniuUsageRoot = ''
    document.body.append(legacy)
    assert.equal(cards().length, 2, '前置条件：确实有两个容器')

    apply(makeCtx().ctx as never)
    await waitFor(() => cards().length === 1)
    assert.equal(cards().length, 1, '第二次挂载应清掉遗留容器，只留一个')
    assert.equal(
      document.querySelectorAll('div[data-dsh-qiniu-usage-root]').length,
      0,
      '旧版悬浮按钮的容器也应被清掉，避免新旧两个入口同时出现',
    )
  })

  it('fiber 销毁时卸载 React root 并移除容器', async () => {
    installSidebar()
    const { ctx, effects } = makeCtx()
    apply(ctx as never)
    await waitFor(() => cards().length === 1)
    assert.ok(effects.length >= 1, `应注册 effect，实际 ${effects.length}`)

    for (const dispose of effects) dispose()
    assert.equal(cards().length, 0, '销毁后不应留下容器')
  })

  it('配置 sidebarCard=false 时不挂载，改回 true 时挂载', async () => {
    installSidebar()
    const { ctx, setSidebarCard } = makeCtx({ sidebarCard: false })
    apply(ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(cards().length, 0, '关掉配置后不应有卡片')

    setSidebarCard(true)
    await waitFor(() => cards().length === 1)

    setSidebarCard(false)
    await waitFor(() => cards().length === 0)
  })

  it('语言变化时重新渲染（卡片文案跟随）', async () => {
    installSidebar()
    let label = 'zh'
    const { ctx, localeListeners } = makeCtx()
    ;(ctx as { locale: { bind: () => (key: string) => string } }).locale.bind = () => (key: string) => `${label}:${key}`

    apply(ctx as never)
    await waitFor(() => (cards()[0]?.textContent ?? '').includes('zh:'))

    label = 'en'
    for (const listener of localeListeners) listener()
    await waitFor(() => (cards()[0]?.textContent ?? '').includes('en:'))
  })
})

describe('侧栏卡片 · 交互与取数', () => {
  it('挂载即取数（收起态也要有数字），并且只取一次', async () => {
    installSidebar()
    const probe = installFetch()
    try {
      const { ctx } = makeCtx()
      apply(ctx as never)
      await waitFor(() => probe.calls.length > 0)
      await new Promise((resolve) => setTimeout(resolve, 30))
      assert.equal(
        probe.calls.filter((url) => url.includes('/overview')).length,
        1,
        `挂载后应只取一次数，实际：${probe.calls.join(', ')}`,
      )
    } finally {
      probe.restore()
    }
  })

  it('默认收起，点击主按钮展开（并记住展开状态）', async () => {
    installSidebar()
    const { ctx } = makeCtx()
    apply(ctx as never)
    await waitFor(() => mainButtonOrNull() !== null)

    assert.equal(mainButton().getAttribute('aria-expanded'), 'false', '默认应收起')
    assert.equal(window.localStorage.getItem(CARD_EXPANDED_KEY), null, '没点之前不该写偏好')

    click(mainButton())
    await waitFor(() => mainButton().getAttribute('aria-expanded') === 'true')
    assert.equal(window.localStorage.getItem(CARD_EXPANDED_KEY), '1', '展开状态应被记住')

    click(mainButton())
    await waitFor(() => mainButton().getAttribute('aria-expanded') === 'false')
    assert.equal(window.localStorage.getItem(CARD_EXPANDED_KEY), '0')
  })

  it('重新挂载时沿用记住的展开状态', async () => {
    installSidebar()
    window.localStorage.setItem(CARD_EXPANDED_KEY, '1')
    const { ctx } = makeCtx()
    apply(ctx as never)

    await waitFor(() => mainButtonOrNull() !== null)
    await waitFor(() => mainButton().getAttribute('aria-expanded') === 'true')
  })

  it('展开后点「详情」打开弹窗（挂到 body），Esc 关闭', async () => {
    installSidebar()
    const { ctx } = makeCtx()
    apply(ctx as never)
    await waitFor(() => mainButtonOrNull() !== null)

    click(mainButton())
    await waitFor(() => card().querySelector('[data-dsh-part="sidebar-card-detail"]') !== null)

    assert.equal(document.querySelector('[role="dialog"]'), null, '点击前不应有弹窗')
    click(detailButton())
    await waitFor(() => document.querySelector('[role="dialog"]') !== null)

    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog !== null)
    assert.equal(dialog.getAttribute('aria-modal'), 'true')
    assert.equal(
      dialog.closest('[data-dsh-qiniu-usage-sidebar-card]'),
      null,
      '弹窗应 portal 到 body，而不是留在侧栏容器里',
    )

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitFor(() => document.querySelector('[role="dialog"]') === null)
  })
})
