// 设置分区只做配置与自检（凭据表单、Key 表格、自动刷新间隔）；用量由侧栏卡片的 store 负责。
import {createElement, type ReactNode, useEffect, useState, useSyncExternalStore} from 'react'
import type {SettingsScope} from './settings-scope.ts'
import type {Config} from '../config.ts'
import {CredentialsForm} from './CredentialsForm.tsx'
import {cls, PANEL_CSS} from './styles.ts'
import type {UsageState, UsageStoreView} from './usage-store.ts'

export type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * 注册时由 `inject: face` 提供的注入面。注册对象的成员会被摊平成组件 props
 * （`props.store` / `props.settings`），不是 `face` 属性。
 * 这里故意不含 `t`：声明了 `locale: NS` 后框架会按 `PropsLocale` 注入，自己再给会冲突。
 */
export interface UsageSectionFace {
  store: UsageStoreView
  settings?: SettingsScope<Config>
}

export interface UsageSectionProps extends UsageSectionFace {
  t?: Translate
    // shell 提供；本面板不需要，仅为对齐契约。
  close?: () => void
}

/** 兜底值，与宿主 `Config` 默认值一致。 */
export const DEFAULT_POLL_INTERVAL_SEC = 5

// 与配置 schema 一致。
const POLL_MIN_SEC = 0
const POLL_MAX_SEC = 3600

export function UsageSection(props: UsageSectionProps): ReactNode {
  const { store, settings } = props
    // 翻译函数缺失时退化为"显示键名"，面板不该因一个文案整块空白。
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

function UsageSectionInner({ store, settings, t }: {
  store: UsageStoreView
  settings?: SettingsScope<Config>
  t: Translate
}): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

    // 设置页只取凭据状态与 Key 名册；不 start()、不拉用量。
  useEffect(() => {
    store.actions.loadCredentials()
    store.actions.loadKeys()
  }, [store])

  const poll = usePollInterval(settings, t)

  return createElement(
    'div',
    { className: cls.panel },
    createElement('style', null, PANEL_CSS),

    createElement(
      'div',
      { className: cls.head },
      createElement('h3', { className: cls.title }, t('qiniu.title')),
      createElement('div', { className: cls.subtitle }, t('qiniu.subtitle')),
    ),

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

    createElement(KeyTableCard, { state, t }),

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

    createElement(
      'div',
      { className: cls.muted, style: { fontSize: '11px', textWrap: 'pretty' } },
      t('qiniu.settings.restHint'),
    ),
  )
}

// Key 表格只做展示：名册来自 AK/SK 接口（最近 30 天出现过的 Key）；单 Key 用量统计在侧栏卡片「详情」里。
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
            // 表头：没有它三列（名称/掩码/状态）的含义要靠猜。
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

interface PollIntervalState {
  draft: string
  setDraft(next: string): void
  writable: boolean
  save: 'idle' | 'saving' | 'saved' | 'failed'
    // 成功且无额外说明时为 null。
  message: string | null
  saveNow(): Promise<void>
}

// 自动刷新间隔：读当前配置 + 写回。作用域可能只读（binder 缺席或部署不接受写），此时输入框与按钮置灰。
function usePollInterval(settings: SettingsScope<Config> | undefined, t: Translate): PollIntervalState {
  const read = (): number => {
    const configured = settings?.getSnapshot().value?.pollIntervalSec
    return typeof configured === 'number' ? configured : DEFAULT_POLL_INTERVAL_SEC
  }
  const [draft, setDraft] = useState<string>(() => String(read()))
  const [save, setSave] = useState<PollIntervalState['save']>('idle')
  const [message, setMessage] = useState<string | null>(null)

    // 配置从别处变化时跟随，但不覆盖用户正在输入的草稿。
  useEffect(() => {
    if (settings === undefined) return
    const sync = (): void => {
      setDraft((current) => (Number(current) === read() ? current : String(read())))
    }
    sync()
    return settings.subscribe(sync)
      // read 只依赖 settings，重订阅时机由它决定。
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
