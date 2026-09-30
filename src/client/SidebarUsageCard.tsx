/**
 * 侧栏速览卡片：坐在左侧列表下方（Settings 行之上）、形态对齐宿主自带的
 * 「今日用量」卡片的一块常驻入口。
 *
 * 为什么不再是对话页的悬浮按钮：浮层要用户先找到、还挡住内容；左侧栏是每天都会
 * 扫一眼的地方，宿主自己的用量速览也在那里。挂载方式见 `sidebar-mount.tsx`。
 *
 * 三种形态（展开状态记忆在 `localStorage`，默认**收起**）：
 *
 * 1. 收起 —— 一行速览：图标 + 「今日用量」 + 今天的总量；
 * 2. 展开 —— 只放**缩略信息**：前 {@link MODEL_PREVIEW_COUNT} 个模型的用量条，
 *    以及一行「其余 N 个模型合计」；侧栏只有 280px 宽，多了就是噪音；
 * 3. 详情 —— 展开后才有「详情」按钮，点开 `UsageDetailDialog`（资源包等
 *    详细包信息都在那里）。侧栏里塞不下逐包明细，所以刻意分成两层。
 *
 * 取数周期挂在挂载上：卡片常驻，`start()` 只在挂载时跑一次，之后按配置的
 * `pollIntervalSec` 轮询（默认 0 = 纯手动，展开态里有「刷新」）。
 *
 * @module dsh-qiniu-usage/client/SidebarUsageCard
 */

import {
  createElement,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { UsageModel } from '../qiniu/usage.ts'
import { UsageDetailDialog } from './UsageDetailDialog.tsx'
import { readCardExpanded, writeCardExpanded } from './card-prefs.ts'
import { formatClock, formatPercent, formatTokens, truncate } from './format.ts'
import { cls, PANEL_CSS } from './styles.ts'
import type { UsageStoreView } from './usage-store.ts'

/** 翻译函数签名。 */
type Translate = (key: string, params?: Record<string, unknown>) => string

/** 展开态里最多预览几个模型。 */
export const MODEL_PREVIEW_COUNT = 3

/** 组件属性。 */
export interface SidebarUsageCardProps {
  store: UsageStoreView
  t: Translate
  /**
   * 初始是否展开。
   *
   * 仅用于视觉预览与测试：SSR 出来的静态 HTML 没有事件处理器，无法靠"点一下"
   * 得到展开态截图，只能一开始就渲染成展开的。缺省时读 `localStorage`。
   */
  initialExpanded?: boolean
}

/** 卡片上的小图标（内联 SVG，避免引入图标库）。 */
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

/** 展开/收起箭头：收起时朝上（点开），展开时朝下（点收）。 */
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

/**
 * 总量文本（收起态的一行速览与展开态的标题行共用）。
 *
 * @param total - 今日总量；`undefined` 表示还没有数据。
 * @param unitText - 单位后缀，默认 `tokens`。
 * @returns 展示文本。
 */
function summaryText(total: number | undefined): string {
  return total === undefined ? '—' : `${formatTokens(total)} tokens`
}

/** 单个模型的预览行：名字 + 数值 + 占比条。 */
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

/**
 * 侧栏速览卡片。
 *
 * @param props - store、翻译函数与初始展开态。
 * @returns 卡片元素。
 */
export function SidebarUsageCard({ store, t, initialExpanded }: SidebarUsageCardProps): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [expanded, setExpanded] = useState<boolean>(() =>
    initialExpanded ?? readCardExpanded(),
  )
  const [detailOpen, setDetailOpen] = useState(false)

  // 卡片常驻：挂载即取数，卸载即停（离开页面就零请求）。
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
  // 'idle' 是挂载后、effect 跑起来之前的那一帧：也算加载中，别闪一下错误态。
  const loading = state.data === null && state.status !== 'error'
  /**
   * 用量这一路是不是坏了。
   *
   * 分两种情况：整份载荷都取不到（`data === null` + error），或载荷到了但用量那一路
   * 报错（资源包成功、用量失败是很常见的组合）。两者都不该在展开态里显示成
   * "当日没有用量记录" —— 那是在说谎。
   */
  const usageErrored = state.data === null
    ? state.status === 'error'
    : state.data.errors.some((error) => error.source === 'usage')
  // 宿主半区没在服务（路由 404，通常是插件被 `enabled: false` 关掉了）：整块退场，
  // 而不是在侧栏底部钉一条永远好不了的报错。设置页里仍能看到原因。
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
  /**
   * 卡片标题跟随**详情弹窗里的筛选**（两者共用一个 store）：
   * 选了昨天就写「昨日用量」，筛了单个 Key 就补上 Key 名 —— 否则卡片上的数字
   * 会让人以为是账号总量。
   */
  const title = [
    state.day === 'yesterday' ? t('qiniu.card.yesterday') : t('qiniu.card.today'),
    ...(state.key === '' ? [] : [state.key]),
  ].join(' · ')

  /** 右上角的箭头按钮：与主按钮互为兄弟（按钮不能嵌套按钮）。 */
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

      // 主按钮：整块可点，点它就是展开/收起。
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

      // 展开态：只放缩略信息 —— 模型用量。
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

      // 展开态的动作行：详情（弹窗）+ 刷新 + 更新时间。
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

    // 展开/收起箭头：始终渲染，收起时朝上、展开时朝下。
    toggleButton,

    // 详情弹窗走 portal 挂到 body：侧栏宽度裁不住它，也不受列表滚动容器影响。
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
