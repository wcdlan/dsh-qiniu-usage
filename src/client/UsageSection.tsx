/**
 * 「七牛云用量」设置分区主面板。
 *
 * 设计文档 §9。要点：
 *
 * - 轮询与取数都挂在**挂载周期**上：关掉设置页 → 零请求。
 * - 已有数据时刷新保留旧数据 + 顶部细进度条，避免闪空。
 * - 用量与资源包**分源展示错误**，互不遮蔽。
 *
 * @module dsh-qiniu-usage/client/UsageSection
 */

import { createElement, useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UsageSnapshot } from '../qiniu/usage.ts'
import type { Config } from '../config.ts'
import { ModelUsageTable } from './ModelUsageTable.tsx'
import { RespackBars } from './RespackBars.tsx'
import { keyOptions, type UsageStoreView } from './usage-store.ts'
import { formatClock, formatTokens, formatWatermark } from './format.ts'
import {
  buttonDisabledStyle,
  buttonStyle,
  captionStyle,
  cardStyle,
  emptyStyle,
  errorStyle,
  KEYFRAMES,
  mutedStyle,
  progressBarStyle,
  rootStyle,
  sectionTitleStyle,
  selectStyle,
  skeletonStyle,
  toolbarSpacerStyle,
  toolbarStyle,
  warnStyle,
} from './styles.ts'

/** 翻译函数签名（与 locale 提供的形态兼容）。 */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/** 注入给面板的面。 */
export interface UsageSectionFace {
  store: UsageStoreView
  /** 设置作用域：读取 `pollIntervalSec` 等用户配置。 */
  settings?: SettingsScope<Config>
  /** 翻译函数。 */
  t: Translate
}

/** 组件属性。 */
export interface UsageSectionProps {
  face?: UsageSectionFace
}

/**
 * 用户配置的轮询间隔（秒）；非法/缺失时为 0（纯手动）。
 *
 * 注意 `SettingsScope` 没有 `get()` —— 读的是 `getSnapshot().value`，而且
 * `value` 在首次同步前是 `undefined`。
 */
function pollIntervalMs(face: UsageSectionFace): number {
  let seconds: unknown
  try {
    seconds = face.settings?.getSnapshot().value?.pollIntervalSec
  } catch {
    return 0
  }
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : 0
}

/** 日期选择器的选项值。 */
const DAY_OPTIONS = ['today', 'yesterday'] as const

/**
 * 用量分区主面板。
 *
 * @param props - 注入面。
 * @returns 面板元素。
 */
export function UsageSection({ face }: UsageSectionProps): ReactNode {
  if (face === undefined) {
    return createElement('div', { style: rootStyle }, createElement('div', { style: mutedStyle }, '…'))
  }
  return createElement(UsageSectionInner, { face })
}

/** 真正的面板主体；`face` 已保证存在。 */
function UsageSectionInner({ face }: { face: UsageSectionFace }): ReactNode {
  const { store, t } = face
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  // 挂载周期 = 请求生命周期。卸载时 stop()，因此关掉设置页后零请求。
  useEffect(() => {
    store.actions.start()
    store.actions.loadKeys()
    return () => {
      store.actions.stop()
    }
  }, [store])

  const data = state.data
  const usage = data?.usage ?? null
  const respack = data?.respack ?? null
  const warnings = [...(usage?.warnings ?? []), ...(respack?.warnings ?? [])]
  const keys = keyOptions(state.keys, t('qiniu.account.all'))

  const isInitialLoading = state.status === 'loading' && data === null
  const showOnlyError = state.status === 'error' && data === null

  return createElement(
    'div',
    { style: rootStyle },
    createElement('style', null, KEYFRAMES),

    // 顶部细进度条：刷新时保留旧数据
    state.refreshing && data !== null ? createElement('div', { style: progressBarStyle }) : null,

    createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
      createElement('h3', { style: { ...sectionTitleStyle, fontSize: '14px' } }, t('qiniu.title')),
      createElement('div', { style: mutedStyle }, t('qiniu.subtitle')),
    ),

    // 工具条
    createElement(
      'div',
      { style: toolbarStyle },
      createElement('span', { style: mutedStyle }, t('qiniu.key')),
      createElement(
        'select',
        {
          style: selectStyle,
          value: state.key,
          'aria-label': t('qiniu.key'),
          onChange: (event: { target: { value: string } }) => store.actions.setKey(event.target.value),
        },
        ...keys.map((option) =>
          createElement(
            'option',
            { key: option.value, value: option.value },
            option.hasUsage ? option.label : `${option.label}（${t('qiniu.empty.noUsage')}）`,
          ),
        ),
      ),
      createElement('span', { style: mutedStyle }, t('qiniu.day')),
      createElement(
        'select',
        {
          style: selectStyle,
          value: state.day,
          'aria-label': t('qiniu.day'),
          onChange: (event: { target: { value: string } }) => store.actions.setDay(event.target.value),
        },
        ...DAY_OPTIONS.map((value) => createElement('option', { key: value, value }, t(`qiniu.day.${value}`))),
        // 落在一个非今天/昨天的具体日期上时，补一个选项以免 select 显示错乱。
        DAY_OPTIONS.includes(state.day as (typeof DAY_OPTIONS)[number])
          ? null
          : createElement('option', { key: state.day, value: state.day }, state.day),
      ),
      createElement('span', { style: toolbarSpacerStyle }),
      state.updatedAt === null
        ? null
        : createElement('span', { style: captionStyle }, t('qiniu.updated', { time: formatClock(state.updatedAt) })),
      createElement(
        'button',
        {
          type: 'button',
          style: state.refreshing ? buttonDisabledStyle : buttonStyle,
          disabled: state.refreshing,
          onClick: () => store.actions.refresh(),
        },
        state.refreshing ? t('qiniu.refreshing') : t('qiniu.refresh'),
      ),
    ),

    // 今天口径常驻延迟告警（设计文档 §8.1）
    state.day === 'today' && usage !== null
      ? createElement(
          'div',
          { style: warnStyle },
          createElement(
            'span',
            null,
            `⚠ ${t('qiniu.warn.dataDelay')}`
            + (usage.watermark === undefined || usage.watermark === ''
              ? ''
              : `（上游水位 ${formatWatermark(usage.watermark)}）`),
          ),
        )
      : null,

    // 面板级传输错误
    showOnlyError
      ? createElement(
          'div',
          { style: errorStyle },
          createElement('span', { style: { fontWeight: 600 } }, t('qiniu.error.usage')),
          createElement('span', null, state.error ?? ''),
          createElement(
            'button',
            { type: 'button', style: { ...buttonStyle, alignSelf: 'flex-start' }, onClick: () => store.actions.refresh() },
            t('qiniu.error.retry'),
          ),
        )
      : null,

    // 首屏骨架
    isInitialLoading
      ? createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          createElement('div', { style: { ...skeletonStyle, width: '60%' } }),
          createElement('div', { style: { ...skeletonStyle, width: '85%' } }),
          createElement('div', { style: { ...skeletonStyle, width: '45%' } }),
          createElement('div', { style: mutedStyle }, t('qiniu.loading')),
        )
      : null,

    !isInitialLoading && !showOnlyError
      ? createElement(
          'div',
          { style: cardStyle },
          renderUsageBlock(usage, state.key, t),
        )
      : null,

    !isInitialLoading && !showOnlyError
      ? createElement('div', { style: cardStyle }, renderRespackBlock(face, respack, warnings, t))
      : null,

    // 分源错误
    ...(!showOnlyError && data !== null
      ? data.errors.map((error) => {
          const label = error.source === 'usage' ? t('qiniu.error.usage') : t('qiniu.error.respack')
          const hint = error.isForbidden
            ? t('qiniu.error.forbidden')
            : error.isAuthError
              ? t('qiniu.error.auth')
              : null
          return createElement(
            'div',
            { key: `${error.source}-${error.code ?? 'na'}`, style: errorStyle },
            createElement('span', { style: { fontWeight: 600 } }, label + (error.code === undefined ? '' : `（code=${error.code}）`)),
            createElement('span', null, error.message),
            hint === null ? null : createElement('span', { style: mutedStyle }, hint),
          )
        })
      : []),
  )
}

/** 用量块：空状态 / 模型表。 */
function renderUsageBlock(usage: UsageSnapshot | null, selectedKey: string, t: Translate): ReactNode {
  if (usage === null) {
    return createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      createElement('h4', { style: sectionTitleStyle }, t('qiniu.usage.heading')),
      createElement('div', { style: emptyStyle }, t('qiniu.error.usage')),
    )
  }

  if (usage.models.length === 0) {
    return createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      createElement('h4', { style: sectionTitleStyle }, t('qiniu.usage.heading')),
      createElement(
        'div',
        { style: emptyStyle },
        selectedKey === '' ? t('qiniu.empty.noUsage') : t('qiniu.empty.noUsageKey'),
      ),
    )
  }

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    createElement(ModelUsageTable, { models: usage.models, grandTotal: usage.totals.total, t }),
    createElement(
      'div',
      { style: mutedStyle },
      t('qiniu.usage.summary', {
        total: formatTokens(usage.totals.total),
        models: usage.models.length,
      }),
    ),
  )
}

/** 资源包块：空状态 / 利用率与逐包。 */
function renderRespackBlock(
  face: UsageSectionFace,
  respack: Parameters<typeof RespackBars>[0]['snapshot'] | null,
  warnings: string[],
  t: Translate,
): ReactNode {
  if (respack === null) {
    return createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      createElement('h4', { style: sectionTitleStyle }, t('qiniu.respack.heading')),
      createElement('div', { style: emptyStyle }, t('qiniu.error.respack')),
    )
  }
  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    createElement(RespackBars, {
      snapshot: respack,
      details: face.store.getSnapshot().details,
      onLoadDetail: (orderHash: string, poId: number) => face.store.actions.loadDetail(orderHash, poId),
      t,
    }),
    warnings.length === 0
      ? null
      : createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          createElement('span', { style: captionStyle }, t('qiniu.warnings.heading')),
          ...warnings.map((warning, index) =>
            createElement('span', { key: `${index}-${warning}`, style: captionStyle }, `· ${warning}`),
          ),
        ),
  )
}
