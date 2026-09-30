/**
 * 设置页的**交互**测试（真实 DOM）。
 *
 * 这一页现在只做三件事：写凭据、跑自检、改自动刷新间隔。三件都是"点了之后真的
 * 发了请求 / 真的写了配置"的行为，SSR 渲染测试看不见，所以单独用 jsdom 跑一遍。
 *
 * @vitest-environment jsdom
 * @module dsh-qiniu-usage/test/client-settings
 */

import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { createUsageStore } from '../src/client/usage-store.ts'
import { zh } from '../src/client/locales.ts'

/** 真实字典查表；缺键直接抛错（漏翻译会被抓住）。 */
const dict = zh as unknown as Record<string, string>
function t(key: string, params?: Record<string, unknown>): string {
  const template = dict[key]
  if (template === undefined) throw new Error(`文案键缺失：${key}`)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

/** 造一个记录请求的 fetch 替身。 */
function installFetch(): { calls: { url: string; body: unknown }[]; restore: () => void } {
  const calls: { url: string; body: unknown }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, body })
    const json = (payload: unknown): Response =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    if (url.includes('/keys')) {
      return json({
        keys: [
          { label: 'dsh', masked: 'sk-69*****03bf3', apiKey: 'sk-69*****03bf3', hasUsage: true, hasToken: false },
          { label: 'Halo', masked: 'sk-15*****72ca6', apiKey: 'sk-15*****72ca6', hasUsage: false, hasToken: false },
        ],
      })
    }
    if (url.includes('/test/key')) {
      return json({
        ok: true,
        result: {
          ok: true,
          credentialOk: true,
          checks: [{ id: 'key', ok: true, message: 'Key 可用：2025-12-31 可见 1 个模型', isAuthError: false, isForbidden: false }],
          summary: { models: 1, total: 12_345, day: '2025-12-31' },
          testedAt: '2026-01-01T00:00:00.000Z',
        },
      })
    }
    return json({ ok: true, usage: null, respack: null, errors: [], fetchedAt: '' })
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

/** 挂载设置页，返回容器与卸载函数。 */
async function mountSection(options: {
  settings?: {
    value?: { pollIntervalSec?: number }
    /** `false` 表示这个部署只读（作用域没有 set）。 */
    writable?: boolean
    /** 收集写入调用。 */
    writes?: unknown[]
  }
} = {}): Promise<{ container: HTMLElement; unmount: () => void }> {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)

  const writes = options.settings?.writes ?? []
  const scope = options.settings === undefined
    ? undefined
    : {
        getSnapshot: () => ({ value: options.settings?.value }),
        subscribe: () => () => {},
        ...(options.settings.writable === false
          ? {}
          : {
              set: async (field: string, value: unknown) => {
                writes.push({ field, value })
                return true
              },
            }),
      }

  const store = createUsageStore({ fetchImpl: globalThis.fetch })
  root.render(createElement(UsageSection, {
    store,
    t,
    ...(scope === undefined ? {} : { settings: scope as never }),
  }))
  await waitFor(() => container.textContent!.includes(t('qiniu.credentials.heading')))
  return {
    container,
    unmount: () => {
      root.unmount()
      container.remove()
    },
  }
}

/** 轮询等待条件成立。 */
async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('等待超时')
}

/**
 * 按 `data-dsh-part` 取控件。
 *
 * **不要按文案取**：设置页里「保存」同时出现在凭据表单与自动刷新卡片上，
 * 按文案取会拿到第一个（凭据那个），测试就变成在测别的东西。
 *
 * @param container - 面板容器。
 * @param part - `data-dsh-part` 的值。
 * @returns 命中的元素。
 */
function byPart<T extends Element>(container: HTMLElement, part: string): T {
  const element = container.querySelector<T>(`[data-dsh-part="${part}"]`)
  assert.ok(element !== null, `应有 data-dsh-part="${part}" 的控件`)
  return element
}

/** 派发一次点击。 */
function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

/**
 * 往受控输入框里"真的打字"。
 *
 * 直接赋 `input.value` 会被 React 的值追踪吃掉（它比对上一次的值，认为没变就不
 * 触发 onChange），必须走原型上的原生 setter 再派发 input 事件。
 *
 * @param input - 目标输入框。
 * @param value - 要填入的值。
 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  assert.ok(setter !== undefined, '应能拿到原生 value setter')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * 选中一个下拉框选项（同上：走原生 setter + change 事件）。
 *
 * @param select - 目标下拉框。
 * @param value - 要选中的值。
 */
function chooseIn(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  assert.ok(setter !== undefined, '应能拿到原生 value setter')
  setter.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
})

describe('设置页 · Key 列表与配置写入', () => {
  it('Key 表格列出名册（表头 + 名称 + 掩码 + 当日状态），只做展示', async () => {
    const probe = installFetch()
    const mounted = await mountSection()
    try {
      await waitFor(() => mounted.container.querySelectorAll('[data-dsh-part="settings-key-row"]').length === 2)

      const text = mounted.container.textContent ?? ''
      assert.ok(text.includes(t('qiniu.keys.name')), '应有表头：名称')
      assert.ok(text.includes(t('qiniu.keys.masked')), '应有表头：掩码')
      assert.ok(text.includes('dsh'), '应显示 Key 名称')
      assert.ok(text.includes('sk-69*****03bf3'), '应显示掩码')
      assert.ok(text.includes(t('qiniu.keys.usage.yes')), '应标出当日有用量')
      assert.ok(text.includes(t('qiniu.keys.usage.no')), '无用量也要标出来')
      // 表格只是展示：没有测试入口，也没有可点的行。
      assert.equal(mounted.container.querySelector('[data-dsh-part="settings-key-test"]'), null, '不再有 Key 测试按钮')
      assert.equal(mounted.container.querySelectorAll('button[data-dsh-part="settings-key-row"]').length, 0)
    } finally {
      mounted.unmount()
      probe.restore()
    }
  })

  it('名册为空时给出空状态', async () => {
    const probe = installFetch()
    const inner = globalThis.fetch
    // 覆盖 /keys：返回空名册。
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/keys')) {
        return new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return inner(input, init)
    }) as typeof fetch

    const mounted = await mountSection()
    try {
      await waitFor(() => mounted.container.textContent!.includes(t('qiniu.keys.empty')))
      assert.equal(mounted.container.querySelector('[data-dsh-part="settings-key-table"]'), null)
    } finally {
      mounted.unmount()
      probe.restore()
    }
  })

  it('保存自动刷新间隔会写回配置，并给出反馈', async () => {
    const probe = installFetch()
    const writes: unknown[] = []
    const mounted = await mountSection({ settings: { value: { pollIntervalSec: 5 }, writes } })
    try {
      const input = byPart<HTMLInputElement>(mounted.container, 'settings-poll-input')
      assert.equal(input.value, '5', '应显示配置里的当前值')

      typeInto(input, '30')
      click(byPart<HTMLButtonElement>(mounted.container, 'settings-poll-save'))

      await waitFor(() => writes.length > 0)
      assert.deepEqual(writes[0], { field: 'pollIntervalSec', value: 30 })
      await waitFor(() => mounted.container.textContent!.includes(t('qiniu.settings.pollSaved')))
    } finally {
      mounted.unmount()
      probe.restore()
    }
  })

  it('部署只读时不提供写入：输入框与保存都禁用，并说明原因', async () => {
    const probe = installFetch()
    const mounted = await mountSection({ settings: { value: { pollIntervalSec: 5 }, writable: false } })
    try {
      assert.equal(
        byPart<HTMLInputElement>(mounted.container, 'settings-poll-input').disabled,
        true,
        '不可写时输入框应禁用',
      )
      assert.equal(byPart<HTMLButtonElement>(mounted.container, 'settings-poll-save').disabled, true)
      assert.ok(mounted.container.textContent!.includes(t('qiniu.settings.pollUnavailable')))
    } finally {
      mounted.unmount()
      probe.restore()
    }
  })
})
