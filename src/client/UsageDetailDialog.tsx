// 用量详情弹窗：分「各模型用量」与「资源包利用」两栏，各栏只留自己的筛选/告警/错误。
// 定位用 position:fixed，因此 DOM 挂在侧栏内部也铺满视口，不被侧栏宽度裁掉。
import {createElement, type ReactNode, useEffect, useState, useSyncExternalStore} from 'react'
import {ModelUsageTable} from './ModelUsageTable.tsx'
import {RespackMonth} from './RespackMonth.tsx'
import {RespackPacks} from './RespackPacks.tsx'
import {formatClock, formatTokens, formatWatermark} from './format.ts'
import {cls} from './styles.ts'
import {keyOptions, type UsageState, type UsageStoreView} from './usage-store.ts'

type Translate = (key: string, params?: Record<string, unknown>) => string

export type DetailTab = 'usage' | 'respack'

export interface UsageDetailDialogProps {
  store: UsageStoreView
  t: Translate
  onClose: () => void
    // 仅用于视觉预览与测试：SSR 静态 HTML 无事件处理器，切不了栏目。
  initialTab?: DetailTab
}

// 与宿主 `/overview` 的 `day` 参数一致。
const DAY_OPTIONS = ['today', 'yesterday'] as const

type SourceErrorView = NonNullable<UsageState['data']>['errors'][number]

type UsageView = NonNullable<UsageState['data']>['usage']

type RespackView = NonNullable<UsageState['data']>['respack']

export function UsageDetailDialog({ store, t, onClose, initialTab }: UsageDetailDialogProps): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [tab, setTab] = useState<DetailTab>(initialTab ?? 'usage')

  const usage = state.data?.usage ?? null
  const respack = state.data?.respack ?? null

    // 'idle' 也算加载中（卡片 start() 之前那一帧），避免闪错误态。
  const loading = state.data === null && state.status !== 'error'
  const failed = state.status === 'error' && state.data === null

    // Key 名册是另一条支线：弹窗筛选器与设置页 Key 表格都要它。
  useEffect(() => {
    store.actions.loadKeys()
  }, [store])

    // Esc 关闭；挂 document 而非弹窗元素，因为焦点可能还在卡片的按钮上。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'usage', label: t('qiniu.detail.tab.usage') },
    { id: 'respack', label: t('qiniu.detail.tab.respack') },
  ]

  return createElement(
    'div',
    {
      className: cls.overlay,
        // 只有点在遮罩本身才关闭，点弹窗内部不关。
      onPointerDown: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) onClose()
      },
    },
    createElement(
      'div',
      {
        className: cls.dialog,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('qiniu.detail.title'),
      },

      createElement(
        'div',
        { className: cls.dialogHead },
        createElement('h3', { className: cls.dialogTitle }, t('qiniu.detail.title')),
        state.updatedAt === null
          ? null
          : createElement(
              'span',
              { className: cls.label, style: { marginLeft: 'auto' } },
              t('qiniu.updated', { time: formatClock(state.updatedAt) }),
            ),
        createElement(
          'button',
          {
            type: 'button',
            className: `${cls.btn} ${cls.btnGhost}`,
            onClick: () => store.actions.refresh(),
            disabled: state.refreshing,
          },
          state.refreshing ? t('qiniu.refreshing') : t('qiniu.detail.reload'),
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: `${cls.btn} ${cls.btnGhost}`,
            onClick: onClose,
            'aria-label': t('qiniu.detail.close'),
          },
          t('qiniu.detail.close'),
        ),
      ),

      createElement(
        'div',
        { className: cls.tabBar, role: 'tablist', 'aria-label': t('qiniu.detail.tablist') },
        ...tabs.map((entry) =>
          createElement(
            'button',
            {
              key: entry.id,
              type: 'button',
              role: 'tab',
              className: entry.id === tab ? `${cls.tab} ${cls.tabActive}` : cls.tab,
              'data-dsh-part': `detail-tab-${entry.id}`,
              'aria-selected': entry.id === tab,
              onClick: () => setTab(entry.id),
            },
            entry.label,
          ),
        ),
      ),

      createElement(
        'div',
        { className: cls.dialogBody },
        loading
          ? createElement(
              'div',
              { className: cls.skeleton },
              createElement('div', { className: cls.skelLine, style: { width: '34%' } }),
              createElement('div', { className: cls.skelLine, style: { width: '90%' } }),
              createElement('div', { className: cls.skelLine, style: { width: '70%' } }),
            )
          : null,

        failed
          ? createElement(
              'div',
              { className: `${cls.callout} ${cls.calloutError}` },
              createElement('strong', null, t('qiniu.error.usage')),
              createElement('span', null, state.error ?? ''),
            )
          : null,

        !loading && !failed && tab === 'usage'
          ? renderUsageTab({ store, state, usage, t })
          : null,

        !loading && !failed && tab === 'respack'
          ? renderRespackTab({ store, state, respack, t })
          : null,
      ),

      createElement('div', { className: cls.dialogFoot }, t('qiniu.card.detailHint')),
    ),
  )
}

function renderUsageTab({ store, state, usage, t }: {
  store: UsageStoreView
  state: UsageState
  usage: UsageView
  t: Translate
}): ReactNode {
  const options = keyOptions(state.keys, t('qiniu.usage.key.all'))
  const unattributed = state.key !== '' && usage?.unattributedKeys === true

    // 换 Key：选具体 Key 时自动切到昨天 —— 当天上游只返回 `api_key: "unknown"` 的聚合分组，昨天才有单 Key 口径。
  const pickKey = (next: string): void => {
    if (next !== '' && state.day === 'today') {
      // 一次改两个字段，只打一次上游。
      store.actions.setFilters('yesterday', next)
      return
    }
    store.actions.setKey(next)
  }

  return [
    createElement(
      'div',
      { className: cls.toolbar, key: 'toolbar' },
      createElement(
        'div',
        { className: cls.field },
        createElement('span', { className: cls.label }, t('qiniu.usage.day')),
        createElement(
          'select',
          {
            className: cls.select,
            'data-dsh-part': 'detail-day',
            value: state.day,
            'aria-label': t('qiniu.usage.day'),
            onChange: (event: { target: { value: string } }) => store.actions.setDay(event.target.value),
          },
          ...DAY_OPTIONS.map((value) =>
            createElement('option', { key: value, value }, t(`qiniu.usage.day.${value}`)),
          ),
            // 落在别的日期上时补一个选项，避免 select 显示错乱。
          DAY_OPTIONS.includes(state.day as (typeof DAY_OPTIONS)[number])
            ? null
            : createElement('option', { key: state.day, value: state.day }, state.day),
        ),
      ),
      createElement(
        'div',
        { className: cls.field },
        createElement('span', { className: cls.label }, t('qiniu.usage.key')),
        createElement(
          'select',
          {
            className: cls.select,
            'data-dsh-part': 'detail-key',
            value: state.key,
            'aria-label': t('qiniu.usage.key'),
            disabled: state.keys.length === 0,
            ...(state.keys.length === 0 ? { title: t('qiniu.usage.key.unavailable') } : {}),
            onChange: (event: { target: { value: string } }) => pickKey(event.target.value),
          },
          ...options.map((option) =>
            createElement(
              'option',
              { key: option.value, value: option.value },
                // 只有明确 hasUsage === false 才标无用量；undefined 表示当天没有归属信息。
              option.hasUsage === false
                ? `${option.label}（${t('qiniu.empty.noUsage')}）`
                : option.label,
            ),
          ),
          state.key === '' || options.some((option) => option.value === state.key)
            ? null
            : createElement('option', { key: state.key, value: state.key }, state.key),
        ),
      ),
    ),

    state.day === 'today' && usage !== null
      ? createElement(
          'div',
          { className: `${cls.callout} ${cls.calloutWarn}`, key: 'delay' },
          createElement('strong', null, t('qiniu.warn.dataDelay')),
          usage.watermark === undefined || usage.watermark === ''
            ? null
            : createElement(
                'span',
                { className: cls.muted, style: { fontSize: '11.5px' } },
                `上游水位 ${formatWatermark(usage.watermark)}`,
              ),
        )
      : null,

    unattributed
      ? createElement(
          'div',
          { className: `${cls.callout} ${cls.calloutWarn}`, key: 'unattributed', role: 'status' },
          createElement('strong', null, t('qiniu.usage.keyUnattributed', { key: state.key })),
        )
      : null,

    createElement(
      'div',
      { className: cls.card, key: 'usage' },
      createElement(
        'div',
        { className: cls.cardHead },
        createElement('h4', { className: cls.cardTitle }, t('qiniu.usage.heading')),
        usage === null || usage.models.length === 0
          ? null
          : createElement(
              'span',
              { className: cls.cardNote },
              t('qiniu.usage.summary', {
                total: formatTokens(usage.totals.total),
                models: usage.models.length,
              }),
            ),
      ),
      usage === null
        ? createElement('div', { className: cls.empty }, t('qiniu.error.usage'))
        : usage.models.length === 0
          ? createElement(
              'div',
              { className: cls.empty },
              state.key === '' ? t('qiniu.empty.noUsage') : t('qiniu.empty.noUsageKey'),
            )
          : createElement(ModelUsageTable, {
              models: usage.models,
              grandTotal: usage.totals.total,
              t,
            }),
      state.key === ''
        ? null
        : createElement(
            'div',
            { className: cls.muted, style: { fontSize: '11px' } },
            t('qiniu.usage.keySingleHint'),
          ),
    ),

    ...(usage?.warnings ?? []).map((warning, index) =>
      createElement(
        'div',
        { key: `warn-${index}`, className: cls.muted, style: { fontSize: '11px' } },
        `· ${warning}`,
      ),
    ),

    ...(state.data?.errors ?? [])
      .filter((error) => error.source === 'usage')
      .map((error, index) => renderSourceError(error, t, `usage-${index}`)),
  ]
}

function renderRespackTab({ store, state, respack, t }: {
  store: UsageStoreView
  state: UsageState
  respack: RespackView
  t: Translate
}): ReactNode {
  return [
    createElement(
      'div',
      { className: cls.card, key: 'month' },
      createElement(
        'div',
        { className: cls.cardHead },
        createElement('h4', { className: cls.cardTitle }, t('qiniu.respack.heading')),
        createElement('span', { className: cls.badge }, t('qiniu.respack.monthScope')),
      ),
      respack === null
        ? createElement('div', { className: cls.empty }, t('qiniu.error.respack'))
        : createElement(RespackMonth, { snapshot: respack, t }),
    ),

    createElement(
      'div',
      { className: cls.card, key: 'packs' },
      createElement(
        'div',
        { className: cls.cardHead },
        createElement('h4', { className: cls.cardTitle }, t('qiniu.respack.packs')),
        createElement('span', { className: cls.badge }, t('qiniu.respack.packLifecycle')),
        respack === null || respack.packages.length === 0
          ? null
          : createElement(
              'span',
              { className: cls.cardNote },
              t('qiniu.respack.packsCount', { count: respack.packages.length }),
            ),
      ),
      respack === null
        ? createElement('div', { className: cls.empty }, t('qiniu.error.respack'))
        : createElement(RespackPacks, {
            snapshot: respack,
            details: state.details,
            onLoadDetail: (orderHash: string, poId: number) =>
              store.actions.loadDetail(orderHash, poId),
            t,
          }),
    ),

    ...(respack?.warnings ?? []).map((warning, index) =>
      createElement(
        'div',
        { key: `warn-${index}`, className: cls.muted, style: { fontSize: '11px' } },
        `· ${warning}`,
      ),
    ),

    ...(state.data?.errors ?? [])
      .filter((error) => error.source === 'respack')
      .map((error, index) => renderSourceError(error, t, `respack-${index}`)),
  ]
}

function renderSourceError(error: SourceErrorView, t: Translate, key: string): ReactNode {
  return createElement(
    'div',
    { key, className: `${cls.callout} ${cls.calloutError}` },
    createElement(
      'strong',
      null,
      (error.source === 'usage' ? t('qiniu.error.usage') : t('qiniu.error.respack'))
      + (error.code === undefined ? '' : `（code=${error.code}）`),
    ),
    createElement('span', null, error.message),
    error.isForbidden
      ? createElement('span', { className: cls.muted, style: { fontSize: '11.5px' } }, t('qiniu.error.forbidden'))
      : error.isAuthError
        ? createElement('span', { className: cls.muted, style: { fontSize: '11.5px' } }, t('qiniu.error.auth'))
        : null,
  )
}
