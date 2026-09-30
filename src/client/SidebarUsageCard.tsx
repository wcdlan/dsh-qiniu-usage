// 侧栏速览卡片：常驻入口，挂载方式见 sidebar-mount.tsx。展开状态记忆在 localStorage，默认收起。
import {createElement, type ReactNode, useEffect, useState, useSyncExternalStore,} from 'react'
import {createPortal} from 'react-dom'
import type {UsageModel} from '../qiniu/usage.ts'
import {UsageDetailDialog} from './UsageDetailDialog.tsx'
import {readCardExpanded, writeCardExpanded} from './card-prefs.ts'
import {formatClock, formatPercent, formatTokens, truncate} from './format.ts'
import {cls, PANEL_CSS} from './styles.ts'
import type {UsageStoreView} from './usage-store.ts'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** 展开态最多预览的模型数。 */
export const MODEL_PREVIEW_COUNT = 3

export interface SidebarUsageCardProps {
  store: UsageStoreView
  t: Translate
    // 仅用于视觉预览与测试：SSR 静态 HTML 无法靠"点一下"得到展开态截图。缺省时读 localStorage。
  initialExpanded?: boolean
}

/** 内联 SVG，避免引入图标库。 */
function UsageIcon(): ReactNode {
  return createElement(
    'svg',
    {
      className: cls.sideIcon,
      width: 13,
      height: 13,
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    createElement('rect', { x: 1.5, y: 9, width: 3, height: 5.5, rx: 1, fill: 'currentColor' }),
    createElement('rect', { x: 6.5, y: 5, width: 3, height: 9.5, rx: 1, fill: 'currentColor' }),
    createElement('rect', { x: 11.5, y: 2, width: 3, height: 12.5, rx: 1, fill: 'currentColor' }),
  )
}

/** 箭头：收起时朝上（点开），展开时朝下（点收）。 */
function ChevronIcon({ collapsed }: { collapsed: boolean }): ReactNode {
  return createElement(
    'svg',
    {
      width: 12,
      height: 12,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    createElement('path', { d: collapsed ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4' }),
  )
}

function summaryText(total: number | undefined): string {
  return total === undefined ? '—' : `${formatTokens(total)} tokens`
}

function renderModelRow(model: UsageModel, grandTotal: number): ReactNode {
  const fraction = grandTotal > 0 ? model.total / grandTotal : 0
  return createElement(
    'div',
    { className: cls.sideModel, key: model.id, 'data-dsh-part': 'sidebar-card-model' },
    createElement(
      'div',
      { className: cls.sideModelRow },
      createElement(
        'span',
        { className: cls.sideModelName, title: `${model.name} · ${formatPercent(fraction)}` },
        truncate(model.name, 22),
      ),
      createElement('span', { className: cls.sideModelValue }, formatTokens(model.total)),
    ),
    createElement(
      'span',
      { className: cls.sideModelBar, 'aria-hidden': 'true' },
      createElement('span', {
        className: cls.sideModelFill,
        style: { width: fraction <= 0 ? '0%' : `${Math.min(fraction * 100, 100).toFixed(2)}%` },
      }),
    ),
  )
}

export function SidebarUsageCard({ store, t, initialExpanded }: SidebarUsageCardProps): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [expanded, setExpanded] = useState<boolean>(() =>
    initialExpanded ?? readCardExpanded(),
  )
  const [detailOpen, setDetailOpen] = useState(false)

    // 卡片常驻：挂载即取数，卸载即停。
  useEffect(() => {
    store.actions.start()
    return () => {
      store.actions.stop()
    }
  }, [store])

  const toggle = (): void => {
    setExpanded((current) => {
      writeCardExpanded(!current)
      return !current
    })
  }

  const usage = state.data?.usage ?? null
  const total = usage?.totals.total
    // 'idle' 是挂载后、effect 跑起来之前那一帧：也算加载中，别闪错误态。
  const loading = state.data === null && state.status !== 'error'
    // 用量这一路是否坏了：整份载荷取不到，或载荷到了但用量那一路报错（资源包成功、用量失败很常见）。
    // 两种情况都不该在展开态显示成"当日没有用量记录"。
  const usageErrored = state.data === null
    ? state.status === 'error'
    : state.data.errors.some((error) => error.source === 'usage')
    // 宿主半区路由 404（通常是插件被 enabled:false 关掉）：整块退场，不在侧栏钉一条永远好不了的报错。
  if (state.data === null && state.status === 'error' && /404/.test(state.error ?? '')) {
    return null
  }
  const summary = loading ? '…' : summaryText(total)
  const models = usage === null
    ? []
    : [...usage.models].sort((left, right) => right.total - left.total)
  const preview = models.slice(0, MODEL_PREVIEW_COUNT)
  const rest = models.slice(MODEL_PREVIEW_COUNT)
  const restTotal = rest.reduce((sum, model) => sum + model.total, 0)
  const toggleLabel = t(expanded ? 'qiniu.card.collapse' : 'qiniu.card.expand')
    // 标题跟随详情弹窗里的筛选（共用一个 store），否则卡片数字会让人以为是账号总量。
  const title = [
    state.day === 'yesterday' ? t('qiniu.card.yesterday') : t('qiniu.card.today'),
    ...(state.key === '' ? [] : [state.key]),
  ].join(' · ')

    // 右上角箭头按钮：与主按钮互为兄弟（按钮不能嵌套按钮）。
  const toggleButton = createElement(
    'button',
    {
      type: 'button',
      className: cls.sideToggle,
      'data-dsh-part': 'sidebar-card-toggle',
      'aria-label': toggleLabel,
      title: toggleLabel,
      onClick: toggle,
    },
    createElement(ChevronIcon, { collapsed: !expanded }),
  )

  return createElement(
    'div',
    {
      className: cls.sideCard,
      'data-dsh-plugin': 'qiniu-usage',
      'data-dsh-part': 'sidebar-card',
    },
    createElement('style', null, PANEL_CSS),

    createElement(
      'div',
      { className: cls.sideBody },

      createElement(
        'button',
        {
          type: 'button',
          className: cls.sideCardMain,
          'data-dsh-part': expanded ? 'sidebar-card-head' : 'sidebar-card-strip',
          'aria-expanded': expanded,
          'aria-label': toggleLabel,
          title: toggleLabel,
          onClick: toggle,
        },
        expanded
          ? createElement(
              'span',
              { className: cls.sideHead },
              createElement('span', { className: cls.sideTitle }, createElement(UsageIcon, null), title),
              createElement('span', { className: cls.sideValue }, summary),
            )
          : createElement(
              'span',
              { className: cls.sideStrip },
              createElement(UsageIcon, null),
              createElement('span', { className: cls.sideStripLabel }, title),
              createElement('span', { className: cls.sideStripValue }, summary),
            ),
      ),

      expanded
        ? createElement(
            'div',
            { className: cls.sideModels, 'data-dsh-part': 'sidebar-card-models' },
            preview.length === 0
              ? createElement(
                  'div',
                  { className: usageErrored ? cls.sideError : cls.sideNote },
                  usageErrored
                    ? t('qiniu.card.failed')
                    : loading
                      ? t('qiniu.loading')
                      : t('qiniu.empty.noUsage'),
                )
              : [
                  ...preview.map((model) => renderModelRow(model, usage?.totals.total ?? 0)),
                  rest.length === 0
                    ? null
                    : createElement(
                        'div',
                        { className: cls.sideMore, key: '__more__' },
                        t('qiniu.card.more', {
                          count: rest.length,
                          total: formatTokens(restTotal),
                        }),
                      ),
                ],
          )
        : null,

      expanded
        ? createElement(
            'div',
            { className: cls.sideActions },
            createElement(
              'button',
              {
                type: 'button',
                className: cls.btn,
                'data-dsh-part': 'sidebar-card-detail',
                onClick: () => setDetailOpen(true),
              },
              t('qiniu.card.detail'),
            ),
            createElement(
              'button',
              {
                type: 'button',
                className: `${cls.btn} ${cls.btnGhost}`,
                disabled: state.refreshing,
                onClick: () => store.actions.refresh(),
              },
              state.refreshing ? t('qiniu.refreshing') : t('qiniu.refresh'),
            ),
            state.updatedAt === null
              ? null
              : createElement(
                  'span',
                  { className: cls.sideMeta },
                  t('qiniu.updated', { time: formatClock(state.updatedAt) }),
                ),
          )
        : null,
    ),

    toggleButton,

      // 详情弹窗走 portal 挂到 body：不被侧栏宽度裁掉，也不受列表滚动容器影响。
    detailOpen && typeof document !== 'undefined'
      ? createPortal(
          createElement(UsageDetailDialog, {
            store,
            t,
            onClose: () => setDetailOpen(false),
          }),
          document.body,
        )
      : null,
  )
}
