/**
 * 视觉预览入口：把面板渲染成一段 HTML（含样式），供 scripts/preview.mjs 落盘后截图。
 *
 * 数据刻意贴近真实账号的样子（多模型、含已用完/零用量资源包、长名称），
 * 这样spacing 与截断问题才会暴露出来。
 *
 * 这不是测试，是开发期的视觉自检工具。
 *
 * @module dsh-qiniu-usage/scripts/preview-entry
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarUsageCard } from '../src/client/SidebarUsageCard.tsx'
import { UsageDetailDialog } from '../src/client/UsageDetailDialog.tsx'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { zh } from '../src/client/locales.ts'
import { createUsageStore } from '../src/client/usage-store.ts'
import type { OverviewPayload } from '../src/service.ts'

/** 中文文案查表（带 `{name}` 占位符）。 */
const dict = zh as unknown as Record<string, string>
function t(key: string, params?: Record<string, unknown>): string {
  const template = dict[key]
  if (template === undefined) throw new Error(`缺少文案键：${key}`)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

/** 贴近真实账号的用量数据。 */
const USAGE: OverviewPayload['usage'] = {
  source: 'aksk',
  keyLabel: '全部 Key（汇总）',
  keyMasked: '',
  // 当天上游尚未把用量归属到具体 Key（实测），面板据此显示账号汇总。
  unattributedKeys: true,
  day: '2026-09-17',
  granularity: 'hour',
  range: {
    start: '2026-09-17T00:00:00+08:00',
    end: '2026-09-17T12:00:00+08:00',
    timezone: 'Asia/Shanghai',
  },
  // 取自真实账号的数据，再补齐几个模型：侧栏卡片的"缩略 + 其余 N 个"
  // 只有在多模型下才看得出来，单一模型会让这段排版永远没被检查过。
  models: [
    {
      id: 'deepseek/deepseek-v4.1-flash',
      name: 'deepseek/deepseek-v4.1-flash',
      items: [],
      totalsByKind: { input: 117_340_000, output: 427_770, cachedInput: 0, cachedWrite: 0, other: 0 },
      total: 117_767_770,
    },
    {
      id: 'deepseek/deepseek-v3.2',
      name: 'deepseek/deepseek-v3.2',
      items: [],
      totalsByKind: { input: 21_400_000, output: 96_400, cachedInput: 8_000_000, cachedWrite: 0, other: 0 },
      total: 21_496_400,
    },
    {
      id: 'qwen/qwen3-max-preview-2026-08',
      name: 'qwen/qwen3-max-preview-2026-08',
      items: [],
      totalsByKind: { input: 4_120_000, output: 51_200, cachedInput: 0, cachedWrite: 0, other: 0 },
      total: 4_171_200,
    },
    {
      id: 'moonshot/kimi-k2-thinking',
      name: 'moonshot/kimi-k2-thinking',
      items: [],
      totalsByKind: { input: 302_000, output: 8_100, cachedInput: 0, cachedWrite: 0, other: 0 },
      total: 310_100,
    },
  ],
  totals: { input: 143_162_000, output: 583_470, total: 143_745_470 },
  watermark: '2026-09-17T11:00:00+08:00',
  warnings: ['当天数据可能存在延迟（上游按小时粒度返回）'],
  fetchedAt: new Date().toISOString(),
}

/** 贴近真实账号的资源包数据（含零用量、已用完、长名称）。 */
const RESPACK: NonNullable<OverviewPayload['respack']> = {
  items: [
    {
      itemName: 'AI推理大模型可购买系列通用计费项',
      zoneName: '中国大陆',
      availableTime: '全时段',
      // 上游真实单位就是带斜杠的 k/tokens（不是 kTokens）
      unit: 'k/tokens',
      monthCapacity: 75_140,
      monthUsed: 31_580,
      monthRemain: 43_560,
      utilization: 0.4203,
    },
    {
      itemName: 'AI推理大模型系列通用计费项',
      zoneName: '中国大陆',
      availableTime: '全时段',
      unit: 'k/tokens',
      monthCapacity: 3_000,
      monthUsed: 0,
      monthRemain: 3_000,
      utilization: 0,
    },
  ],
  packages: [
    {
      name: '国产模型实时推理 5000W',
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
      name: '国产模型实时推理 1000W',
      unit: 'k/tokens',
      status: 2,
      statusLabel: '使用中',
      effectiveStart: '2026-09-01T00:00:00+08:00',
      effectiveEnd: '2027-08-01T00:00:00+08:00',
      daysRemaining: 318,
      carryOverPolicy: 2,
      carryOverLabel: '一次性分配',
      totalAmount: 10_000,
      usedAmount: 0,
      utilization: 0,
      orderHash: 'b'.repeat(32),
      poId: 2,
    },
    {
      name: '【邀请基础奖励】300 万全系列活动限定',
      unit: 'k/tokens',
      status: 2,
      statusLabel: '使用中',
      effectiveStart: '2026-09-01T00:00:00+08:00',
      effectiveEnd: '2028-08-01T00:00:00+08:00',
      daysRemaining: 684,
      carryOverPolicy: 2,
      carryOverLabel: '一次性分配',
      totalAmount: 3_000,
      usedAmount: 0,
      utilization: 0,
      orderHash: 'c'.repeat(32),
      poId: 3,
    },
    {
      name: '实时推理全系列模型 300W（新用户体验包）',
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
      orderHash: 'd'.repeat(32),
      poId: 4,
    },
    {
      name: '国产模型实时推理 1亿',
      unit: 'k/tokens',
      status: 3,
      statusLabel: '已用完',
      effectiveStart: '2026-06-01T00:00:00+08:00',
      effectiveEnd: '2027-02-01T00:00:00+08:00',
      daysRemaining: 137,
      carryOverPolicy: 2,
      carryOverLabel: '一次性分配',
      totalAmount: 100_000,
      usedAmount: 100_000,
      utilization: 1,
      orderHash: 'e'.repeat(32),
      poId: 5,
    },
  ],
  fetchedAt: new Date().toISOString(),
  warnings: [],
}

/** 造一个已就绪的 store（预览与浮层共用）。 */
async function makeReadyStore(): Promise<ReturnType<typeof createUsageStore>> {
  const store = createUsageStore({ fetchImpl: makePreviewFetch() })
  store.actions.start()
  store.actions.loadKeys()
  store.actions.loadCredentials()
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const status = store.getSnapshot().status
    if (status === 'ready' || status === 'error') break
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  while (Date.now() < deadline && store.getSnapshot().credentials === null) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  // Key 名册是另一条支线：真实面板的 effect 也会拉它，预览要对齐。
  while (Date.now() < deadline && store.getSnapshot().keys.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return store
}

/** 预览用的 Key 名册：取自真实账号（上游已脱敏）。 */
const KEYS = [
  { label: 'dsh', masked: 'sk-69*****03bf3', apiKey: 'sk-69*****03bf3', hasUsage: undefined, hasToken: false },
  { label: 'Halo', masked: 'sk-15*****72ca6', apiKey: 'sk-15*****72ca6', hasUsage: false, hasToken: false },
  { label: 'Lobehub', masked: 'sk-32*****67460', apiKey: 'sk-32*****67460', hasUsage: false, hasToken: false },
  { label: 'cc', masked: 'sk-72*****3e981', apiKey: 'sk-72*****3e981', hasUsage: false, hasToken: false },
]

/** 凭据状态（真实场景：凭据库可用但未配置）。 */
const CREDENTIALS = {
  accessKey: { ref: 'QINIU_ACCESS_KEY', configured: true, source: 'file', writable: true },
  secretKey: { ref: 'QINIU_SECRET_KEY', configured: true, source: 'file', writable: true },
  apiKeys: [],
  hasStore: true,
}

/** 预览用的 fetch 替身（返回宿主 `/overview` 等路由的载荷）。 */
function makePreviewFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    const body = url.pathname.endsWith('/credentials')
          ? { ok: true, credentials: CREDENTIALS }
          : url.pathname.endsWith('/keys')
            ? { keys: KEYS }
            : makePayload()
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

/** 预览用的宿主载荷。 */
function makePayload(): OverviewPayload {
  return {
    ok: true,
    usage: USAGE,
    respack: RESPACK,
    errors: [],
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * 渲染面板为 HTML 片段。
 *
 * 异步：先把 store 推到 ready（SSR 不跑 effect，必须显式驱动），再静态渲染。
 *
 * @param options - `key` 用于预览"选了具体 Key、但当天上游未归属"的提示态。
 * @returns 面板的静态 HTML。
 */
export async function renderPanel(): Promise<string> {
  const payload: OverviewPayload = {
    ok: true,
    usage: USAGE,
    respack: RESPACK,
    errors: [],
    fetchedAt: new Date().toISOString(),
  }

  // store 预置好数据：SSR 不跑 effect，所以直接给一个已就绪的快照。
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    const body = url.pathname.endsWith('/credentials')
      ? { ok: true, credentials: CREDENTIALS }
      : url.pathname.endsWith('/keys')
        ? { keys: KEYS }
        : payload
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  void payload
  const store = await makeReadyStore()
  return renderToStaticMarkup(createElement(UsageSection, {
    store,
    t,
    // 预览里给一个可写的设置作用域，看的才是真实形态（否则是"部署只读"的降级态）。
    settings: {
      getSnapshot: () => ({ value: { pollIntervalSec: 5 } }),
      subscribe: () => () => {},
      set: async () => true,
    } as never,
  }))
}

/**
 * 渲染侧栏速览卡片为 HTML 片段（左侧栏视图用）。
 *
 * @param options - `expanded` 直接渲染展开态（SSR 没有事件处理器，点不出来）。
 * @returns 卡片静态 HTML。
 */
export async function renderSidebarCard(options: { expanded?: boolean } = {}): Promise<string> {
  const store = await makeReadyStore()
  return renderToStaticMarkup(
    createElement(SidebarUsageCard, { store, t, initialExpanded: options.expanded === true }),
  )
}

/**
 * 渲染详情弹窗为 HTML 片段。
 *
 * @param options - 初始栏目（SSR 点不了 tab）。
 * @returns 弹窗静态 HTML。
 */
export async function renderDetailDialog(options: { tab?: 'usage' | 'respack' } = {}): Promise<string> {
  const store = await makeReadyStore()
  return renderToStaticMarkup(
    createElement(UsageDetailDialog, {
      store,
      t,
      onClose: () => {},
      initialTab: options.tab ?? 'usage',
    }),
  )
}

export { t as translate }
