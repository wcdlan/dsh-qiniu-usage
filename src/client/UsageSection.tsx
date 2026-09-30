/**
 * 「七牛云用量」设置分区 —— **只做配置与自检**。
 *
 * 2026-09-30 改版：用量与资源包的展示整体搬到左侧栏底部的速览卡片（点开卡片里的
 * 「详情」看完整内容），设置页不再重复渲染一遍用量表 —— 那份内容在 280px 宽的侧栏
 * 里看是缩略、在这里看是全量，两处维护两套状态机，删掉一处才清爽。设置页留下的
 * 是**只有设置页才做得了的事**：
 *
 * - 凭据表单（AK/SK 写入凭据库，值永不回显）；
 * - 自检：AK/SK 测试（真的打一次上游）、API Key 测试（Bearer token 查昨天单 Key）；
 * - 自动刷新间隔（默认 5 秒，写回插件配置即时生效）；
 * - 提示：数据在哪看、其余配置在哪改。
 *
 * 取数周期：设置页只读凭据状态，**不再拉用量**；用量由侧栏卡片的 store 负责。
 *
 * @module dsh-qiniu-usage/client/UsageSection
 */

import { createElement, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsScope } from './settings-scope.ts'
import type { Config } from '../config.ts'
import { CredentialsForm } from './CredentialsForm.tsx'
import { formatTokens } from './format.ts'
import { cls, PANEL_CSS } from './styles.ts'
import type { UsageState, UsageStoreView } from './usage-store.ts'

/** 翻译函数签名（与 locale 提供的形态兼容）。 */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * 注册时由 `inject: face` 提供的注入面。
 *
 * ⚠ **注册返回对象的成员会被摊平成组件 props**，不是一个 `face` 属性。
 * 参考实现同款：`interface UsageSectionProps extends UsageSectionFace { close }`，
 * 组件里直接 `const { store, settings } = props`。
 *
 * 注意这里**故意不含 `t`**：只要注册时声明了 `locale: NS`，框架就会按
 * `PropsLocale<N>` 注入 `t: TranslateNS<N>`（见 dsh-client-ui-slots 的
 * "framework-injected `t` seat, present exactly on entries whose registration
 * declares `locale:`"）。自己在注入面里再塞一个 `t` 会与之冲突。
 */
export interface UsageSectionFace {
  store: UsageStoreView
  /** 设置作用域：读/写 `pollIntervalSec` 等用户配置。 */
  settings?: SettingsScope<Config>
}

/** 组件属性 = 注入面 + 框架注入的 `t` + shell 提供的 `close`。 */
export interface UsageSectionProps extends UsageSectionFace {
  /** 框架按 `locale: NS` 注入的翻译函数。 */
  t?: Translate
  /** shell 提供的关闭回调（本面板不需要，仅为对齐契约）。 */
  close?: () => void
}

/** 设置页里自动刷新间隔的兜底值；与宿主 `Config` 的默认值保持一致。 */
export const DEFAULT_POLL_INTERVAL_SEC = 5

/** 自动刷新间隔的合法区间（与配置 schema 一致）。 */
const POLL_MIN_SEC = 0
const POLL_MAX_SEC = 3600

/**
 * 用量设置分区。
 *
 * 注入面的成员是**摊平**传进来的（`props.store` / `props.settings`），
 * `t` 由框架按 `locale:` 注入。
 *
 * @param props - 组件属性。
 * @returns 面板元素。
 */
export function UsageSection(props: UsageSectionProps): ReactNode {
  const { store, settings } = props
  // 翻译函数缺失时退化为"显示键名"而不是抛错 —— 面板绝不该因为一个文案而整块空白。
  const t: Translate = props.t ?? ((key) => key)

  if (store === undefined) {
    return createElement(
      'div',
      { className: cls.panel },
      createElement('style', null, PANEL_CSS),
    )
  }
  return createElement(UsageSectionInner, { store, settings, t })
}

/** 真正的面板主体；`store` 已保证存在。 */
function UsageSectionInner({ store, settings, t }: {
  store: UsageStoreView
  settings?: SettingsScope<Config>
  t: Translate
}): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  // 设置页只需要凭据状态与 Key 名册（Key 表格要用）；用量由侧栏卡片的 store 取，
  // 这里不 start()、不拉用量。
  useEffect(() => {
    store.actions.loadCredentials()
    store.actions.loadKeys()
  }, [store])

  const poll = usePollInterval(settings, t)

  return createElement(
    'div',
    { className: cls.panel },
    createElement('style', null, PANEL_CSS),

    // 面板头
    createElement(
      'div',
      { className: cls.head },
      createElement('h3', { className: cls.title }, t('qiniu.title')),
      createElement('div', { className: cls.subtitle }, t('qiniu.subtitle')),
    ),

    // 凭据
    createElement(
      'section',
      { className: cls.card },
      createElement(
        'div',
        { className: cls.cardHead },
        createElement('h4', { className: cls.cardTitle }, t('qiniu.credentials.heading')),
      ),
      createElement(CredentialsForm, {
        credentials: state.credentials,
        t,
        onSet: (ref: string, value: string) => store.actions.setCredential(ref, value),
        onUnset: (ref: string) => store.actions.unsetCredential(ref),
      }),
      state.credentialsError === null
        ? null
        : createElement(
            'div',
            { className: `${cls.callout} ${cls.calloutError}` },
            createElement('strong', null, t('qiniu.credentials.heading')),
            createElement('span', null, state.credentialsError),
          ),
    ),

    // Key 列表
    createElement(KeyTableCard, { state, t }),

    // 自动刷新
    createElement(
      'section',
      { className: cls.card },
      createElement(
        'div',
        { className: cls.cardHead },
        createElement('h4', { className: cls.cardTitle }, t('qiniu.settings.pollHeading')),
      ),
      createElement(
        'div',
        { className: cls.formRow },
        createElement('span', { className: cls.label }, t('qiniu.settings.pollLabel')),
        createElement('input', {
          className: cls.input,
          'data-dsh-part': 'settings-poll-input',
          style: { flex: '0 0 92px' },
          type: 'number',
          min: POLL_MIN_SEC,
          max: POLL_MAX_SEC,
          step: 1,
          value: poll.draft,
          disabled: poll.writable !== true,
          'aria-label': t('qiniu.settings.pollLabel'),
          onChange: (event: { target: { value: string } }) => poll.setDraft(event.target.value),
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: cls.btn,
            'data-dsh-part': 'settings-poll-save',
            disabled: poll.writable !== true || poll.save === 'saving',
            onClick: () => void poll.saveNow(),
          },
          poll.save === 'saving' ? t('qiniu.settings.pollSaving') : t('qiniu.settings.pollSave'),
        ),
        poll.save === 'idle' && poll.message === null
          ? null
          : createElement(
              'span',
              { className: poll.save === 'failed' ? cls.dangerText : cls.muted, style: { fontSize: '11px' } },
              poll.message ?? t('qiniu.settings.pollSaved'),
            ),
      ),
      createElement(
        'span',
        { className: cls.muted, style: { fontSize: '11px' } },
        poll.writable ? t('qiniu.settings.pollHint') : t('qiniu.settings.pollUnavailable'),
      ),
    ),

    // 其余配置的位置
    createElement(
      'div',
      { className: cls.muted, style: { fontSize: '11px', textWrap: 'pretty' } },
      t('qiniu.settings.restHint'),
    ),
  )
}

/**
 * Key 表格：列出 `/keys` 拿到的 Key（名称 + 掩码 + 当日三态）。
 *
 * 只做展示：名册来自 AK/SK 接口（最近 30 天出现过的 Key），这张表就是"当前 AK/SK
 * 能看到哪些 Key"的证据。单 Key 的用量统计在左侧栏卡片 →「详情」的用量栏目里。
 */
function KeyTableCard({ state, t }: {
  state: UsageState
  t: Translate
}): ReactNode {
  const keys = state.keys

  return createElement(
    'section',
    { className: cls.card },
    createElement(
      'div',
      { className: cls.cardHead },
      createElement('h4', { className: cls.cardTitle }, t('qiniu.keys.heading')),
      keys.length === 0
        ? null
        : createElement('span', { className: cls.cardNote }, t('qiniu.keys.count', { count: keys.length })),
    ),

    keys.length === 0
      ? createElement('div', { className: cls.empty }, t('qiniu.keys.empty'))
      : createElement(
          'div',
          { className: cls.keyTable, 'data-dsh-part': 'settings-key-table' },
          // 表头：没有它，三列数字/掩码/状态的含义要靠猜。
          createElement(
            'div',
            { className: `${cls.keyRow} ${cls.keyHead}` },
            createElement('span', { className: cls.keyCell }, t('qiniu.keys.name')),
            createElement('span', { className: cls.keyCell }, t('qiniu.keys.masked')),
            createElement('span', { className: cls.keyCell }, t('qiniu.keys.today')),
          ),
          ...keys.map((key) =>
            createElement(
              'div',
              {
                key: `${key.label}-${key.masked}`,
                className: cls.keyRow,
                'data-dsh-part': 'settings-key-row',
              },
              createElement('span', { className: cls.keyCell, title: key.label }, key.label),
              createElement(
                'span',
                { className: cls.keyMasked, title: key.masked },
                key.masked === '' ? '—' : key.masked,
              ),
              createElement(
                'span',
                { className: cls.muted, style: { fontSize: '10.5px', whiteSpace: 'nowrap' } },
                key.hasUsage === true
                  ? t('qiniu.keys.usage.yes')
                  : key.hasUsage === false
                    ? t('qiniu.keys.usage.no')
                    : t('qiniu.keys.usage.unknown'),
              ),
            ),
          ),
        ),
  )
}

/** 自动刷新间隔的读写状态。 */
interface PollIntervalState {
  /** 输入框里的草稿值。 */
  draft: string
  setDraft(next: string): void
  /** 当前部署是否允许写入。 */
  writable: boolean
  save: 'idle' | 'saving' | 'saved' | 'failed'
  /** 保存结果文案；成功且无额外说明时为 `null`。 */
  message: string | null
  saveNow(): Promise<void>
}

/**
 * 自动刷新间隔：读当前配置 + 写回。
 *
 * 作用域可能只有读能力（binder 提供方缺席、或部署不接受写），此时输入框与按钮
 * 都置灰，并说明只能用配置文件里的值。
 *
 * @param settings - 设置作用域；可缺省。
 * @param t - 翻译函数。
 * @returns 草稿值、可写性与保存动作。
 */
function usePollInterval(settings: SettingsScope<Config> | undefined, t: Translate): PollIntervalState {
  const read = (): number => {
    const configured = settings?.getSnapshot().value?.pollIntervalSec
    return typeof configured === 'number' ? configured : DEFAULT_POLL_INTERVAL_SEC
  }
  const [draft, setDraft] = useState<string>(() => String(read()))
  const [save, setSave] = useState<PollIntervalState['save']>('idle')
  const [message, setMessage] = useState<string | null>(null)

  // 配置从别处变化（另一处保存/宿主下发）时跟随，但不覆盖用户正在输入的草稿。
  useEffect(() => {
    if (settings === undefined) return
    const sync = (): void => {
      setDraft((current) => (Number(current) === read() ? current : String(read())))
    }
    sync()
    return settings.subscribe(sync)
    // read 只依赖 settings，重新订阅的时机由它决定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  const writable = typeof settings?.set === 'function'

  return {
    draft,
    setDraft: (next: string) => {
      setDraft(next)
      setSave('idle')
      setMessage(null)
    },
    writable,
    save,
    message,
    saveNow: async (): Promise<void> => {
      if (settings?.set === undefined) return
      const parsed = Number(draft)
      const value = Number.isFinite(parsed)
        ? Math.min(Math.max(Math.round(parsed), POLL_MIN_SEC), POLL_MAX_SEC)
        : DEFAULT_POLL_INTERVAL_SEC
      setSave('saving')
      try {
        const written = await settings.set('pollIntervalSec', value)
        setDraft(String(value))
        setSave(written ? 'saved' : 'failed')
        setMessage(written ? null : t('qiniu.settings.pollFailed'))
      } catch {
        setSave('failed')
        setMessage(t('qiniu.settings.pollFailed'))
      }
    },
  }
}
