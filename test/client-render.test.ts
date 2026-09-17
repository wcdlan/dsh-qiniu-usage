/**
 * 面板**渲染**测试。
 *
 * 存在的理由：262 项测试当时全绿，但界面里「七牛云用量」是一块空白 —— 因为
 * 没有任何测试真正渲染过这个组件。真实原因是**注入面契约理解错了**：
 *
 * - `inject: face` 返回对象的成员会被**摊平成组件 props**（`props.store`），
 *   而我读的是 `props.face` → 永远 `undefined` → 渲染出一个极小的占位符，看着就是空的。
 * - `t` 由框架按 `locale: NS` 注入，不该自己塞进注入面。
 *
 * 所以这里用 react-dom/server 把组件渲染成 HTML 并断言**用户能看见的文字**，
 * 而不是只测 store 这类零件。
 *
 * `t` 用真实 `zh` 字典实现，并在键缺失时**抛错** —— 这样漏翻译也会被抓住。
 *
 * @module dsh-qiniu-usage/test/client-render
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UsageSection, type UsageSectionProps } from '../src/client/UsageSection.tsx'
import { FloatingPanel, FloatingUsage } from '../src/client/FloatingUsage.tsx'
import { cls } from '../src/client/styles.ts'
import { zh } from '../src/client/locales.ts'
import { createUsageStore } from '../src/client/usage-store.ts'
import { CredentialAccess } from '../src/credentials.ts'
import { resolveConfig } from '../src/config.ts'
import { QiniuUsageService, type KeysPayload, type OverviewPayload } from '../src/service.ts'
import { akskKeyGroups, akskUnattributed } from './fixtures/usage.ts'
import { monthOverviewPage, respackListPage } from './fixtures/respack.ts'

/** 字典查表实现，带 `{name}` 占位符替换；键缺失直接抛错。 */
const dict = zh as unknown as Record<string, string>
function translate(key: string, params?: Record<string, unknown>): string {
  const template = dict[key]
  if (template === undefined) {
    throw new Error(`文案键缺失：${key}（zh 字典里没有）`)
  }
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

/**
 * 造一个**宿主上游**的 fetch 替身：用量走 qnaigc 外壳，财务走 qiniu 外壳。
 *
 * 注意层次：客户端 store 访问的是**宿主自己的** `/overview` 等路由，不是上游 API。
 * 所以这里只用来让真实 `QiniuUsageService` 产出载荷，再由下面的
 * {@link makeClientFetch} 以宿主载荷形态回给 store。
 */
function makeUpstreamFetch(options: { emptyUsage?: boolean; unattributedUsage?: boolean } = {}): typeof fetch {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const usageData = options.unattributedUsage === true
    ? akskUnattributed
    : (options.emptyUsage === true ? [] : akskKeyGroups)

  return (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(String(input), 'http://localhost')
    if (url.pathname.startsWith('/billing-api/')) {
      const data = url.pathname.endsWith('/month-overview') ? monthOverviewPage : respackListPage
      return json({ code: 0, message: 'Success', data })
    }
    return json({ status: true, data: usageData })
  }) as typeof fetch
}

/**
 * 用真实 service 产出一份宿主 `/overview` 载荷。
 *
 * 刻意把资源包单位改成上游真实存在的 `kTokens`：默认 fixture 用的是 `GB`，
 * 那样就永远测不到"单位自带量级"的换算路径（会变成空断言）。
 */
async function makePayload(options: { emptyUsage?: boolean; unattributedUsage?: boolean } = {}): Promise<OverviewPayload> {
  const service = new QiniuUsageService({
    config: resolveConfig(),
    credentials: new CredentialAccess(
      {
        resolve: async (ref: string) => ({ value: `v-${ref}`, source: 'file' }),
        describe: async () => ({ configured: true, source: 'file', writable: true }),
        set: async () => {},
        unset: async () => {},
      },
      {},
    ),
    fetchImpl: makeUpstreamFetch(options),
    sleep: async () => {},
    minRequestIntervalMs: 0,
  })
  const payload = await service.overview('today', '')
  if (payload.respack !== null) {
    // 换成上游真实的 k/tokens（带斜杠）：验证换算后界面里不再出现两套量级叠加的写法。
    payload.respack = {
      ...payload.respack,
      items: payload.respack.items.map((item) => ({ ...item, unit: 'k/tokens' })),
      packages: payload.respack.packages.map((pack) => ({ ...pack, unit: 'k/tokens' })),
    }
  }
  return payload
}

/**
 * 造一个**宿主路由**的 fetch 替身（客户端 store 真正访问的那一层）。
 *
 * @param options - 让 /overview 失败或返回空用量。
 * @returns 可直接注入 store 的 fetch。
 */
function makeClientFetch(options: {
  failUsage?: boolean
  emptyUsage?: boolean
  unattributedUsage?: boolean
  keys?: KeysPayload['keys']
} = {}): typeof fetch {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  // 载荷预先算好（SSR 下 store 是异步驱动，替身必须是同步返回的）。
  let payload: OverviewPayload | undefined
  const ready = makePayload(options).then((value) => {
    payload = value
  })

  return (async (input: RequestInfo | URL) => {
    await ready
    const url = input instanceof URL ? input : new URL(String(input), 'http://localhost')
    if (options.failUsage === true && (url.pathname.endsWith('/overview') || url.pathname.endsWith('/refresh'))) {
      return new Response('boom', { status: 500 })
    }
    if (url.pathname.endsWith('/keys')) return json({ keys: options.keys ?? [] })
    if (url.pathname.endsWith('/credentials')) {
      return json({
        ok: true,
        credentials: {
          accessKey: { ref: 'QINIU_ACCESS_KEY', configured: false, writable: true },
          secretKey: { ref: 'QINIU_SECRET_KEY', configured: false, writable: true },
          apiKeys: [],
          hasStore: true,
        },
      })
    }
    if (url.pathname.endsWith('/respack/detail')) return json({ ok: true, detail: null })
    return json(payload)
  }) as typeof fetch
}

/**
 * 造一个已加载完数据的 store 并渲染面板。
 *
 * SSR 不执行 `useEffect`，所以这里显式驱动 store 取数。
 *
 * @param options - 取数行为与是否传入注入面。
 * @returns 渲染出的 HTML。
 */
async function renderSection(options: {
  failUsage?: boolean
  emptyUsage?: boolean
  unattributedUsage?: boolean
  keys?: KeysPayload['keys']
  /** 渲染前先选中的 Key（会触发一次按 Key 的重新取数）。 */
  key?: string
  start?: boolean
  omitStore?: boolean
} = {}): Promise<string> {
  const store = createUsageStore({ fetchImpl: makeClientFetch(options) })
  if (options.start !== false) {
    store.actions.start()
    store.actions.loadKeys()
    // 等到出现终态（ready 或 error）。
    await waitFor(() => {
      const status = store.getSnapshot().status
      return status === 'ready' || status === 'error'
    })
    // Key 清单是另一条异步支线，等它落地再渲染。
    if ((options.keys ?? []).length > 0) {
      await waitFor(() => store.getSnapshot().keys.length > 0)
    }
    if (options.key !== undefined) {
      store.actions.setKey(options.key)
      await waitFor(() => store.getSnapshot().status === 'ready')
    }
  }

  // ⚠ 关键：注入面的成员是**摊平**成 props 的，不是 { face } 包装。
  const props: UsageSectionProps = options.omitStore === true
    ? ({} as UsageSectionProps)
    : { store, t: translate }

  return renderToStaticMarkup(createElement(UsageSection, props))
}

/** 轮询等待某个条件成立（SSR 下 store 是异步驱动的）。 */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

describe('面板渲染 · 注入面摊平成 props', () => {
  it('渲染出分区标题（而不是空白）', async () => {
    const html = await renderSection()
    assert.ok(html.length > 0, '渲染结果不应为空')
    assert.ok(html.includes('七牛云用量'), `应出现标题，实际 HTML：${html.slice(0, 200)}`)
  })

  it('有数据时渲染模型名、合计与资源包', async () => {
    const html = await renderSection()

    // 用量表：模型显示名 + 汇总
    assert.ok(html.includes('DeepSeek V4 Pro'), '应渲染模型显示名')
    assert.ok(html.includes('Qwen Max'), '应渲染第二个模型')
    assert.ok(html.includes('2.08M'), `应渲染合计 tokens，实际：${html.slice(0, 400)}`)
    assert.ok(html.includes('各模型用量'), '应渲染用量分区标题')

    // 资源包：当月口径 + 逐包
    assert.ok(html.includes('资源包利用情况'), '应渲染资源包分区标题')
    assert.ok(html.includes('AI大模型融合资源包'), '应渲染计费项名')
    assert.ok(html.includes('68%'), '应渲染利用率')
    assert.ok(html.includes('中国大陆全时段加速流量5TB'), '应渲染资源包名')

    // 单位可读性：上游单位 kTokens 一律换算成 tokens，界面里不应再出现 "K kTokens"。
    // （载荷已被改成 kTokens 单位，所以这两条断言是真的在跑换算路径。）
    assert.ok(!html.includes('k/tokens'), `界面里不应出现未换算的 k/tokens：${html.slice(0, 300)}`)
    assert.ok(!html.includes('kTokens'), `界面里不应出现未换算的 kTokens：${html.slice(0, 300)}`)
    assert.ok(html.includes('M tokens'), `应显示换算后的 tokens 单位：${html.slice(0, 300)}`)

    // 凭据卡片（状态未加载时也不应崩）
    assert.ok(html.includes('凭据'), '应渲染凭据分区标题')
  })

  it('今天口径渲染延迟告警', async () => {
    const html = await renderSection()
    assert.ok(html.includes('当天数据可能有延迟'), '今天（hour 粒度）应显示延迟告警')
  })

  it('所有文案都从字典解析，没有漏翻译的裸键', async () => {
    const html = await renderSection()
    // translate() 在键缺失时会抛错；这里再兜一层：HTML 里不应出现 'qiniu.' 前缀的键名。
    const leaked = html.match(/qiniu\.[a-zA-Z.]+/g) ?? []
    assert.deepEqual(leaked, [], `界面里露出了未翻译的键：${leaked.join(', ')}`)
  })

  it('完全没有 props 时不抛错（防御性）', async () => {
    const html = await renderSection({ omitStore: true })
    assert.equal(typeof html, 'string')
  })

  it('缺少 t 时退化为显示键名而不是崩掉', async () => {
    const store = createUsageStore({ fetchImpl: makeClientFetch() })
    store.actions.start()
    await new Promise((resolve) => setTimeout(resolve, 30))
    // 只给 store，不给 t
    const html = renderToStaticMarkup(createElement(UsageSection, { store } as UsageSectionProps))
    assert.ok(html.includes('qiniu.title'), '缺 t 时应退化为键名，而不是抛错或空白')
  })
})

describe('面板渲染 · 三态', () => {
  it('首屏（尚未取数）渲染骨架而不是错误', async () => {
    const html = await renderSection({ start: false })
    assert.ok(html.includes('七牛云用量'), '加载中也应有标题')
    assert.ok(html.includes('正在加载用量数据'), '应渲染加载提示')
    assert.ok(!html.includes('用量查询失败'), '首帧不应闪出错误文案')
  })

  it('传输失败渲染错误态与重试按钮', async () => {
    const html = await renderSection({ failUsage: true })
    assert.ok(html.includes('用量查询失败'), `应渲染错误标题，实际：${html.slice(0, 300)}`)
    assert.ok(html.includes('重试'), '应提供重试按钮')
    assert.ok(html.includes('500'), '应带上可定位的状态码信息')
  })

  it('无数据渲染空状态而不是崩', async () => {
    const html = await renderSection({ emptyUsage: true })
    assert.ok(html.includes('当日没有用量记录'), `应渲染空状态，实际：${html.slice(0, 300)}`)
  })
})

describe('面板渲染 · Key 选择器', () => {
  /** 真实账号名册（设计文档 §15.10 实测）。 */
  const REAL_KEYS: KeysPayload['keys'] = [
    { label: 'dsh', masked: 'sk-69*****03bf3', apiKey: 'sk-69*****03bf3', hasUsage: undefined, hasToken: false },
    { label: 'Halo', masked: 'sk-15*****72ca6', apiKey: 'sk-15*****72ca6', hasUsage: undefined, hasToken: false },
  ]

  it('下拉框里是真名，不是一串星号', async () => {
    const html = await renderSection({ keys: REAL_KEYS })
    assert.ok(html.includes('>dsh<'), `应渲染 Key 名 dsh，实际：${html.slice(0, 500)}`)
    assert.ok(html.includes('>Halo<'), '应渲染 Key 名 Halo')
    assert.ok(!html.includes('*******'), `不该出现星号占位选项，实际：${html.slice(0, 500)}`)
  })

  it('hasUsage=undefined 时不标"无用量"（当天没归属信息，标了就是撒谎）', async () => {
    const html = await renderSection({ keys: REAL_KEYS })
    assert.ok(!html.includes('无用量'), '三态里的"不确定"不应渲染成无用量')
  })

  it('hasUsage=false（真无用量）仍标出来', async () => {
    const html = await renderSection({
      keys: [{ label: 'Halo', masked: '', hasUsage: false, hasToken: false }],
    })
    assert.ok(html.includes('Halo（当日没有用量记录）'), `应标注无用量，实际：${html.slice(0, 500)}`)
  })

  it('没有任何可选 Key 时 Key 选择器置灰而不是消失（避免布局跳动）', async () => {
    const html = await renderSection({ keys: [] })
    assert.ok(html.includes('上游暂未返回 Key 名册'), '应给出置灰原因')
    assert.ok(html.includes('disabled'), 'Key 选择器应禁用')
    assert.ok(html.includes('全部 Key（汇总）'), '仍显示当前口径')
    assert.ok(html.includes('日期'), '日期字段仍在')
  })

  it('选了具体 Key 但当天上游没归属时，明确说明下方是账号汇总', async () => {
    const html = await renderSection({
      keys: REAL_KEYS,
      unattributedUsage: true,
      key: 'dsh',
    })
    assert.ok(
      html.includes('上游尚未把当天用量归属到「dsh」'),
      `应渲染未归属提示条，实际：${html.slice(0, 600)}`,
    )
    assert.ok(html.includes('DeepSeek V4 Pro'), '仍要显示账号汇总数据，不能是空面板')
  })

  it('账号级视图（未选 Key）不显示未归属提示', async () => {
    const html = await renderSection({ keys: REAL_KEYS, unattributedUsage: true })
    assert.ok(!html.includes('上游尚未把当天用量归属到'), '账号级视图无需这条提示')
  })
})

describe('面板渲染 · 逐包明细独立成卡片', () => {
  /** 按卡片切开 HTML，便于断言"某内容属于哪张卡"。 */
  function cards(html: string): string[] {
    return html.split(`class="${cls.card}"`).slice(1)
  }

  it('当月资源包与逐包明细是两张不同的卡片', async () => {
    const html = await renderSection()
    const sections = cards(html)

    const monthCard = sections.find((chunk) => chunk.includes('资源包利用情况'))
    const packsCard = sections.find((chunk) => chunk.includes('逐包明细'))

    assert.ok(monthCard !== undefined, '应存在「资源包利用情况」卡片')
    assert.ok(packsCard !== undefined, '应存在「逐包明细」卡片')
    assert.notEqual(monthCard, packsCard, '两者必须是不同的卡片')
  })

  it('当月卡片只放当月计费项，不放逐包条目', async () => {
    const sections = cards(await renderSection())
    const monthCard = sections.find((chunk) => chunk.includes('资源包利用情况'))
    assert.ok(monthCard !== undefined)
    assert.ok(monthCard.includes('AI大模型融合资源包'), '当月计费项应在当月卡片里')
    assert.ok(
      !monthCard.includes('中国大陆全时段加速流量5TB'),
      '逐包条目不应出现在当月卡片里（口径不同，混在一起会读错）',
    )
  })

  it('逐包卡片只放逐包条目，并带生命周期口径徽标', async () => {
    const sections = cards(await renderSection())
    const packsCard = sections.find((chunk) => chunk.includes('逐包明细'))
    assert.ok(packsCard !== undefined)
    assert.ok(packsCard.includes('中国大陆全时段加速流量5TB'), '资源包名应在逐包卡片里')
    assert.ok(packsCard.includes('生命周期口径'), '逐包卡片应标注口径')
    assert.ok(
      !packsCard.includes('AI大模型融合资源包'),
      '当月计费项不应出现在逐包卡片里',
    )
  })
})

describe('悬浮按钮 · 渲染', () => {
  /** 造一个 store 并驱动到 ready（或 error）。 */
  async function makeStore(options: { failUsage?: boolean } = {}) {
    const { createUsageStore } = await import('../src/client/usage-store.ts')
    const store = createUsageStore({ fetchImpl: makeClientFetch(options) })
    store.actions.start()
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      const status = store.getSnapshot().status
      if (status === 'ready' || status === 'error') break
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    return store
  }

  it('收起状态只渲染悬浮按钮，不渲染弹层', async () => {
    const store = await makeStore()
    const html = renderToStaticMarkup(
      createElement(FloatingUsage, { store, t: translate }),
    )
    assert.ok(html.includes('aria-haspopup="dialog"'), '应渲染悬浮按钮')
    assert.equal(html.includes('role="dialog"'), false, '收起时不应渲染弹层')
    assert.ok(html.includes(translate('qiniu.fab.button')), '应显示按钮文案')
  })

  it('展开的弹层包含用量、当月资源包与逐包明细三块', async () => {
    const store = await makeStore()
    const html = renderToStaticMarkup(
      createElement(FloatingPanel, { store, t: translate, onClose: () => {} }),
    )
    assert.ok(html.includes('role="dialog"'), '应渲染弹层')
    assert.ok(html.includes(translate('qiniu.usage.heading')), '应含用量块')
    assert.ok(html.includes('DeepSeek V4 Pro'), '应含模型名')
    assert.ok(html.includes(translate('qiniu.respack.heading')), '应含当月资源包块')
    assert.ok(html.includes(translate('qiniu.respack.packs')), '应含逐包明细块')
    assert.ok(html.includes('中国大陆全时段加速流量5TB'), '应含资源包名')
    assert.ok(html.includes(translate('qiniu.fab.hint')), '应提示完整面板的位置')
    // 单位换算同样适用于浮层
    assert.ok(!html.includes('k/tokens'), `浮层里也不应出现未换算单位：${html.slice(0, 200)}`)
  })

  it('取数失败时弹层给出错误而不是空白', async () => {
    const store = await makeStore({ failUsage: true })
    const html = renderToStaticMarkup(
      createElement(FloatingPanel, { store, t: translate, onClose: () => {} }),
    )
    assert.ok(html.includes(translate('qiniu.error.usage')), '应显示错误标题')
    assert.ok(html.includes('500'), '应带上可定位的状态码')
  })
})
