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
import { zh } from '../src/client/locales.ts'
import { createUsageStore } from '../src/client/usage-store.ts'
import { CredentialAccess } from '../src/credentials.ts'
import { resolveConfig } from '../src/config.ts'
import { QiniuUsageService, type OverviewPayload } from '../src/service.ts'
import { akskKeyGroups } from './fixtures/usage.ts'
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
function makeUpstreamFetch(options: { emptyUsage?: boolean } = {}): typeof fetch {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  return (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(String(input), 'http://localhost')
    if (url.pathname.startsWith('/billing-api/')) {
      const data = url.pathname.endsWith('/month-overview') ? monthOverviewPage : respackListPage
      return json({ code: 0, message: 'Success', data })
    }
    return json({ status: true, data: options.emptyUsage === true ? [] : akskKeyGroups })
  }) as typeof fetch
}

/**
 * 用真实 service 产出一份宿主 `/overview` 载荷。
 *
 * 刻意把资源包单位改成上游真实存在的 `kTokens`：默认 fixture 用的是 `GB`，
 * 那样就永远测不到"单位自带量级"的换算路径（会变成空断言）。
 */
async function makePayload(options: { emptyUsage?: boolean } = {}): Promise<OverviewPayload> {
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
function makeClientFetch(options: { failUsage?: boolean; emptyUsage?: boolean } = {}): typeof fetch {
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
    if (url.pathname.endsWith('/keys')) return json({ keys: [] })
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
  start?: boolean
  omitStore?: boolean
} = {}): Promise<string> {
  const store = createUsageStore({ fetchImpl: makeClientFetch(options) })
  if (options.start !== false) {
    store.actions.start()
    // 等到出现终态（ready 或 error）。
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      const status = store.getSnapshot().status
      if (status === 'ready' || status === 'error') break
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
  }

  // ⚠ 关键：注入面的成员是**摊平**成 props 的，不是 { face } 包装。
  const props: UsageSectionProps = options.omitStore === true
    ? ({} as UsageSectionProps)
    : { store, t: translate }

  return renderToStaticMarkup(createElement(UsageSection, props))
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
