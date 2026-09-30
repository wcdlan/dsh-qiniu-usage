// 262 项测试曾全绿、界面却是一块空白：此前没有任何测试真正渲染过组件。
// 根因是注入面契约：inject 返回对象的成员被摊平成 props（props.store），t 由框架按 locale 注入、不该自己塞。

import {strict as assert} from 'node:assert'
import {describe, it} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {UsageSection, type UsageSectionProps} from '../src/client/UsageSection.tsx'
import {MODEL_PREVIEW_COUNT, SidebarUsageCard} from '../src/client/SidebarUsageCard.tsx'
import {UsageDetailDialog} from '../src/client/UsageDetailDialog.tsx'
import {formatTokens} from '../src/client/format.ts'
import {zh} from '../src/client/locales.ts'
import {createUsageStore} from '../src/client/usage-store.ts'
import {CredentialAccess} from '../src/credentials.ts'
import {resolveConfig} from '../src/config.ts'
import {type KeysPayload, type OverviewPayload, QiniuUsageService} from '../src/service.ts'
import {akskKeyGroups, akskUnattributed} from './fixtures/usage.ts'
import {monthOverviewPage, respackListPage} from './fixtures/respack.ts'

/** 字典查表，带 {name} 占位符替换；键缺失直接抛错。 */
const dict = zh as unknown as Record<string, string>
function translate(key: string, params?: Record<string, unknown>): string {
  const template = dict[key]
  if (template === undefined) {
    throw new Error(`文案键缺失：${key}（zh 字典里没有）`)
  }
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

// 宿主上游 fetch 替身：只让真实 QiniuUsageService 产出载荷，再交由 makeClientFetch 以宿主形态回给 store。
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

// 用真实 service 产出一份宿主 /overview 载荷；刻意把资源包单位改成上游真实的 k/tokens：
// 默认 fixture 用 GB，那样就永远测不到"单位自带量级"的换算路径（会变成空断言）。
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

// 宿主路由 fetch 替身（客户端 store 真正访问的那一层），可直接注入 store。
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

// 造一个 store 并渲染设置页；SSR 不执行 useEffect，所以显式驱动凭据支线（设置页只读它）。
async function renderSection(options: {
  /** 注入的设置作用域替身。 */
  settings?: { getSnapshot(): { value?: { pollIntervalSec?: number } }; subscribe(fn: () => void): () => void; set?(f: string, v: unknown): Promise<boolean> }
  omitStore?: boolean
} = {}): Promise<string> {
  const store = createUsageStore({ fetchImpl: makeClientFetch() })
  store.actions.loadCredentials()
  await waitFor(() => store.getSnapshot().credentials !== null)

  // ⚠ 关键：注入面的成员是**摊平**成 props 的，不是 { face } 包装。
  const props: UsageSectionProps = options.omitStore === true
    ? ({} as UsageSectionProps)
    : {
        store,
        t: translate,
        ...(options.settings === undefined ? {} : { settings: options.settings as never }),
      }

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

describe('设置页渲染 · 只做配置与自检', () => {
  it('渲染出分区标题（而不是空白）', async () => {
    const html = await renderSection()
    assert.ok(html.length > 0, '渲染结果不应为空')
    assert.ok(html.includes('七牛云用量'), `应出现标题，实际 HTML：${html.slice(0, 200)}`)
  })

  it('不再渲染用量/资源包内容，也不再放说明性卡片', async () => {
    const html = await renderSection()

    // 这些是"用量展示"的内容，2026-09-30 起只在侧栏卡片 + 详情弹窗里出现。
    for (const leaked of ['DeepSeek V4 Pro', '各模型用量', '资源包利用情况', '逐包明细']) {
      assert.equal(html.includes(leaked), false, `设置页不该再展示「${leaked}」`)
    }
    // 叙述性描述一律不要：这页只放能点的东西。
    for (const dropped of [
      '用量在左侧栏',
      '输入框里填的是凭据的值',
      '会真的打一次上游',
      '与输入框里未保存的内容无关',
      '测试 AK/SK',
    ]) {
      assert.equal(html.includes(dropped), false, `设置页不该再出现描述「${dropped}」`)
    }
  })

  it('渲染配置项：凭据 + Key 列表 + 自动刷新', async () => {
    const html = await renderSection()
    assert.ok(html.includes(translate('qiniu.credentials.heading')), '应有凭据卡片')
    assert.ok(html.includes(translate('qiniu.credentials.accessKey')), '应有 AccessKey 表单')
    assert.ok(html.includes(translate('qiniu.credentials.secretKey')), '应有 SecretKey 表单')
    assert.ok(html.includes(translate('qiniu.keys.heading')), '应有 Key 列表')
    assert.ok(html.includes(translate('qiniu.keys.empty')), '没有名册时给出空状态')
    assert.ok(html.includes(translate('qiniu.settings.pollHeading')), '应有自动刷新卡片')
    assert.ok(html.includes(translate('qiniu.settings.pollLabel')), '应有刷新间隔输入')
  })

  it('自动刷新默认显示配置里的 5 秒', async () => {
    const html = await renderSection()
    assert.ok(
      html.includes('value="5"'),
      `没有作用域时应显示默认值 5，实际：${html.slice(0, 400)}`,
    )
    assert.ok(html.includes(translate('qiniu.settings.pollUnavailable')), '无写能力时要说清楚')
  })

  it('有设置作用域时显示其中的值，并允许写入', async () => {
    const settings = {
      getSnapshot: () => ({ value: { pollIntervalSec: 30 } }),
      subscribe: () => () => {},
      set: async () => true,
    }
    const html = await renderSection({ settings })
    assert.ok(html.includes('value="30"'), `应显示作用域里的值，实际：${html.slice(0, 400)}`)
    assert.equal(html.includes(translate('qiniu.settings.pollUnavailable')), false, '可写时不该提示只读')
    assert.ok(html.includes(translate('qiniu.settings.pollHint')), '可写时应给使用说明')
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
    await new Promise((resolve) => setTimeout(resolve, 10))
    const html = renderToStaticMarkup(createElement(UsageSection, { store } as UsageSectionProps))
    assert.ok(html.includes('qiniu.title'), '缺 t 时应退化为键名，而不是抛错或空白')
  })
})

describe('侧栏速览卡片 · 渲染', () => {
  /** 造一个 store 并驱动到 ready（或 error）。 */
  async function makeStore(options: { failUsage?: boolean } = {}) {
    const store = createUsageStore({ fetchImpl: makeClientFetch(options) })
    store.actions.start()
    await waitFor(() => {
      const status = store.getSnapshot().status
      return status === 'ready' || status === 'error'
    })
    return store
  }

  /** 用一份现成的宿主载荷造 store（模型数量可控，用于测缩略的截断）。 */
  async function makeStoreWithPayload(payload: OverviewPayload) {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch
    const store = createUsageStore({ fetchImpl })
    store.actions.start()
    await waitFor(() => store.getSnapshot().status === 'ready')
    return store
  }

  it('默认收起：只有一行速览，没有模型行、没有详情按钮、没有弹窗', async () => {
    const store = await makeStore()
    const total = formatTokens(store.getSnapshot().data?.usage?.totals.total)
    const html = renderToStaticMarkup(
      createElement(SidebarUsageCard, { store, t: translate }),
    )
    assert.ok(html.includes('data-dsh-part="sidebar-card-strip"'), '应渲染收起态的一行速览')
    assert.ok(html.includes(translate('qiniu.card.today')), '应显示卡片标题')
    assert.ok(html.includes(`${total} tokens`), `应显示今日总量，实际：${html.slice(0, 300)}`)
    assert.equal(html.includes('data-dsh-part="sidebar-card-models"'), false, '收起时不应有模型缩略')
    assert.equal(html.includes(translate('qiniu.card.detail')), false, '收起时不应有详情按钮')
    assert.equal(html.includes('role="dialog"'), false, '没有点击就不该有弹窗')
  })

  it('展开态只给缩略信息：模型用量 + 详情按钮（弹窗要点才开）', async () => {
    const store = await makeStore()
    const html = renderToStaticMarkup(
      createElement(SidebarUsageCard, { store, t: translate, initialExpanded: true }),
    )
    assert.ok(html.includes('data-dsh-part="sidebar-card-models"'), '应渲染模型缩略区')
    assert.ok(html.includes('DeepSeek V4 Pro'), '应含模型名')
    assert.ok(html.includes('Qwen Max'), '应含第二个模型')
    assert.ok(html.includes(translate('qiniu.card.detail')), '展开后应提供详情按钮')
    // 详细包信息是**下一层**：展开态里不出现，资源包文案只在弹窗里。
    assert.equal(html.includes(translate('qiniu.respack.heading')), false, '展开态不该塞资源包详情')
    assert.equal(html.includes('role="dialog"'), false, '详情按钮只是入口，弹窗要点击才开')
  })

  it('缩略最多 3 个模型，其余折成一行合计', async () => {
    const base = await makePayload()
    const usage = base.usage
    assert.ok(usage !== null, '前置条件：fixture 应有用量数据')
    const models = Array.from({ length: 5 }, (_, index) => ({
      ...usage.models[0]!,
      id: `model-${index}`,
      name: `模型-${index}`,
      total: 1_000 * (index + 1),
    }))
    const store = await makeStoreWithPayload({
      ...base,
      usage: { ...usage, models, totals: { input: 15_000, output: 0, total: 15_000 } },
    })
    const html = renderToStaticMarkup(
      createElement(SidebarUsageCard, { store, t: translate, initialExpanded: true }),
    )
    assert.equal((html.match(/data-dsh-part="sidebar-card-model"/g) ?? []).length, MODEL_PREVIEW_COUNT)
    // 缩略按用量降序：显示的是用量最大的 3 个（模型-4/3/2），不是声明顺序的前 3 个。
    assert.ok(html.includes('模型-4') && html.includes('模型-2'), '应显示用量最大的 3 个模型')
    assert.equal(html.includes('模型-1'), false, '落在缩略之外的模型应被折进合计行')
    assert.ok(
      html.includes(translate('qiniu.card.more', { count: 2, total: formatTokens(1_000 + 2_000) })),
      `应有其余模型合计行，实际：${html.slice(0, 500)}`,
    )
  })

  it('宿主半区没在服务（404）时整块退场，而不是钉一条永远好不了的报错', async () => {
    const store = createUsageStore({
      fetchImpl: (async () => new Response('not found', { status: 404 })) as typeof fetch,
    })
    store.actions.start()
    await waitFor(() => store.getSnapshot().status === 'error')
    const html = renderToStaticMarkup(
      createElement(SidebarUsageCard, { store, t: translate, initialExpanded: true }),
    )
    assert.equal(html, '', '路由 404 时卡片应完全不渲染')
  })

  it('取数失败时展开态给出错误提示而不是空白', async () => {
    const store = await makeStore({ failUsage: true })
    const html = renderToStaticMarkup(
      createElement(SidebarUsageCard, { store, t: translate, initialExpanded: true }),
    )
    assert.ok(html.includes(translate('qiniu.card.failed')), `应提示取数失败，实际：${html.slice(0, 400)}`)
    assert.ok(html.includes(translate('qiniu.card.detail')), '失败时也要能进详情重试')
  })
})

describe('详情弹窗 · 渲染', () => {
  /** 造一个 store 并驱动到 ready（或 error）。 */
  async function makeStore(options: { failUsage?: boolean; unattributedUsage?: boolean } = {}) {
    const store = createUsageStore({ fetchImpl: makeClientFetch(options) })
    store.actions.start()
    await waitFor(() => {
      const status = store.getSnapshot().status
      return status === 'ready' || status === 'error'
    })
    return store
  }

  it('有栏目导航：用量与资源包两个 tab，默认在用量', async () => {
    const store = await makeStore()
    const html = renderToStaticMarkup(
      createElement(UsageDetailDialog, { store, t: translate, onClose: () => {} }),
    )
    assert.ok(html.includes('role="dialog"'), '应是弹窗')
    assert.ok(html.includes('aria-modal="true"'), '应标记为模态')
    assert.ok(html.includes(translate('qiniu.detail.title')), '应有弹窗标题')
    assert.ok(html.includes('role="tablist"'), '应有栏目导航')
    assert.ok(html.includes(translate('qiniu.detail.tab.usage')), '应有用量栏目')
    assert.ok(html.includes(translate('qiniu.detail.tab.respack')), '应有资源包栏目')
    assert.ok(html.includes('DeepSeek V4 Pro'), '默认应显示用量栏内容')
    assert.equal(html.includes(translate('qiniu.respack.heading')), false, '默认不该把资源包也渲染出来')
  })

  it('用量栏带日期与 Key 两个筛选器（单 Key 统计 / 总和）', async () => {
    const store = await makeStore()
    const html = renderToStaticMarkup(
      createElement(UsageDetailDialog, { store, t: translate, onClose: () => {}, initialTab: 'usage' }),
    )
    assert.ok(html.includes('data-dsh-part="detail-day"'), '应有日期筛选')
    assert.ok(html.includes('data-dsh-part="detail-key"'), '应有 Key 筛选')
    assert.ok(html.includes(translate('qiniu.usage.key.all')), '默认应是全部 Key（总和）')
    assert.ok(html.includes(translate('qiniu.usage.heading')), '应含用量块')
    assert.ok(html.includes('DeepSeek V4 Pro'), '应含模型名')
    // 单位换算同样适用于弹窗
    assert.ok(!html.includes('k/tokens'), `弹窗里也不应出现未换算单位：${html.slice(0, 200)}`)
  })

  it('选中单个 Key 时给出"汇总口径"提示，并把 Key 传进查询', async () => {
    // 当天上游没有 Key 归属信息：此时必须说明"下面是账号汇总"。
    const store = await makeStore({ unattributedUsage: true })
    store.actions.setKey('我的测试Key')
    await waitFor(() => store.getSnapshot().key === '我的测试Key')
    const html = renderToStaticMarkup(
      createElement(UsageDetailDialog, { store, t: translate, onClose: () => {}, initialTab: 'usage' }),
    )
    assert.ok(
      html.includes(translate('qiniu.usage.keyUnattributed', { key: '我的测试Key' })),
      '当天数据未归属时要说明"下面是账号汇总"',
    )
    assert.ok(html.includes(translate('qiniu.usage.keySingleHint')), '应说明单 Key 口径取昨天的原因')
  })

  it('资源包栏包含当月口径与逐包明细', async () => {
    const store = await makeStore()
    const html = renderToStaticMarkup(
      createElement(UsageDetailDialog, { store, t: translate, onClose: () => {}, initialTab: 'respack' }),
    )
    assert.ok(html.includes(translate('qiniu.respack.heading')), '应含当月资源包块')
    assert.ok(html.includes(translate('qiniu.respack.packs')), '应含逐包明细块')
    assert.ok(html.includes('中国大陆全时段加速流量5TB'), '应含资源包名')
    assert.ok(html.includes(translate('qiniu.card.detailHint')), '应提示完整面板的位置')
    assert.equal(html.includes('DeepSeek V4 Pro'), false, '资源包栏不该带出用量表')
  })

  it('取数失败时弹窗给出错误而不是空白', async () => {
    const store = await makeStore({ failUsage: true })
    const html = renderToStaticMarkup(
      createElement(UsageDetailDialog, { store, t: translate, onClose: () => {} }),
    )
    assert.ok(html.includes(translate('qiniu.error.usage')), '应显示错误标题')
    assert.ok(html.includes('500'), '应带上可定位的状态码')
  })
})
