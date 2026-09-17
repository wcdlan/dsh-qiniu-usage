/**
 * 对话页悬浮按钮：点击展开用量/资源包速览。
 *
 * 为什么是"挂到 document.body 的独立 React root"而不是 slot：悬浮按钮是**宿主级** UI，
 * 对话页（尤其是新会话页）没有 session，session 作用域的 slot 在那里不会渲染。
 * 参考实现 `@linxin666/dsh-pet` 同款做法（其注释明确写了这条理由）。
 * 挂载代码在 `client/index.ts`。
 *
 * 取数策略：**只在展开时拉取**，收起即 `stop()`，所以关着的时候零后台请求。
 *
 * 关闭方式：再点按钮、按 Esc、点击弹层外部。
 *
 * @module dsh-qiniu-usage/client/FloatingUsage
 */

import {
  createElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { ModelUsageTable } from './ModelUsageTable.tsx'
import { RespackMonth } from './RespackMonth.tsx'
import { RespackPacks } from './RespackPacks.tsx'
import { formatClock, formatTokens, formatWatermark } from './format.ts'
import { cls, PANEL_CSS } from './styles.ts'
import type { UsageStoreView } from './usage-store.ts'

/** 翻译函数签名。 */
type Translate = (key: string, params?: Record<string, unknown>) => string

/** 组件属性。 */
export interface FloatingUsageProps {
  store: UsageStoreView
  t: Translate
  /**
   * 初始是否展开。
   *
   * 仅用于视觉预览与测试：SSR 出来的静态 HTML 没有事件处理器，无法靠"点一下"
   * 得到展开态截图，只能一开始就渲染成展开的。
   */
  initialOpen?: boolean
}

/** 弹层属性。 */
export interface FloatingPanelProps {
  store: UsageStoreView
  t: Translate
  onClose: () => void
}

/** 按钮上的小图标（内联 SVG，避免引入图标库）。 */
function UsageIcon(): ReactNode {
  return createElement(
    'svg',
    {
      className: cls.fabIcon,
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

/**
 * 展开的速览弹层。
 *
 * 单独导出以便测试直接渲染（不需要先点按钮）。
 *
 * @param props - store、翻译函数与关闭回调。
 * @returns 弹层元素。
 */
export function FloatingPanel({ store, t, onClose }: FloatingPanelProps): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const usage = state.data?.usage ?? null
  const respack = state.data?.respack ?? null
  const warnings = [...(usage?.warnings ?? []), ...(respack?.warnings ?? [])]

  // 'idle' 也算加载中（effect 触发 start() 之前的一帧），避免闪错误态。
  const loading = state.data === null && state.status !== 'error'
  const failed = state.status === 'error' && state.data === null

  return createElement(
    'div',
    {
      className: cls.popup,
      role: 'dialog',
      'aria-label': t('qiniu.title'),
    },
    createElement(
      'div',
      { className: cls.popupHead },
      createElement('h3', { className: cls.popupTitle }, t('qiniu.title')),
      state.updatedAt === null
        ? null
        : createElement(
            'span',
            { className: `${cls.label}`, style: { marginLeft: 'auto' } },
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
        state.refreshing ? t('qiniu.refreshing') : t('qiniu.fab.reload'),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: `${cls.btn} ${cls.btnGhost}`,
          onClick: onClose,
          'aria-label': t('qiniu.fab.close'),
        },
        t('qiniu.fab.close'),
      ),
    ),

    createElement(
      'div',
      { className: cls.popupBody },
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

      !loading && !failed && state.day === 'today' && usage !== null
        ? createElement(
            'div',
            { className: `${cls.callout} ${cls.calloutWarn}` },
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

      !loading && !failed
        ? createElement(
            'div',
            { className: cls.card },
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
                ? createElement('div', { className: cls.empty }, t('qiniu.empty.noUsage'))
                : createElement(ModelUsageTable, {
                    models: usage.models,
                    grandTotal: usage.totals.total,
                    t,
                  }),
          )
        : null,

      !loading && !failed
        ? createElement(
            'div',
            { className: cls.card },
            createElement(
              'div',
              { className: cls.cardHead },
              createElement('h4', { className: cls.cardTitle }, t('qiniu.respack.heading')),
              createElement('span', { className: cls.badge }, t('qiniu.respack.monthScope')),
            ),
            respack === null
              ? createElement('div', { className: cls.empty }, t('qiniu.error.respack'))
              : createElement(RespackMonth, { snapshot: respack, t }),
          )
        : null,

      !loading && !failed
        ? createElement(
            'div',
            { className: cls.card },
            createElement(
              'div',
              { className: cls.cardHead },
              createElement('h4', { className: cls.cardTitle }, t('qiniu.respack.packs')),
              createElement('span', { className: cls.badge }, t('qiniu.respack.packLifecycle')),
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
          )
        : null,

      warnings.length === 0
        ? null
        : createElement(
            'div',
            { className: cls.warnList },
            ...warnings.map((warning, index) =>
              createElement(
                'div',
                { key: `${index}-${warning}`, className: cls.muted, style: { fontSize: '11px' } },
                `· ${warning}`,
              ),
            ),
          ),

      state.data === null
        ? null
        : state.data.errors.map((error) =>
            createElement(
              'div',
              { key: `${error.source}-${error.code ?? 'na'}`, className: `${cls.callout} ${cls.calloutError}` },
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
            ),
          ),
    ),

    createElement('div', { className: cls.popupFoot }, t('qiniu.fab.hint')),
  )
}

/**
 * 悬浮按钮 + 弹层。
 *
 * @param props - store 与翻译函数。
 * @returns 悬浮区域元素。
 */
export function FloatingUsage({ store, t, initialOpen = false }: FloatingUsageProps): ReactNode {
  const [open, setOpen] = useState(initialOpen)
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const wrapper = useRef<HTMLDivElement | null>(null)

  // 展开时取数、收起即停 —— 关着的时候零后台请求。
  useEffect(() => {
    if (!open) {
      store.actions.stop()
      return
    }
    store.actions.start()
    return () => {
      store.actions.stop()
    }
  }, [open, store])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 点击弹层外部关闭（用 pointerdown 以便在焦点变化前生效）
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event): void => {
      const node = wrapper.current
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const total = state.data?.usage?.totals.total

  return createElement(
    'div',
    { className: cls.fabRoot, ref: wrapper },
    createElement('style', null, PANEL_CSS),
    open ? createElement(FloatingPanel, { store, t, onClose: () => setOpen(false) }) : null,
    createElement(
      'button',
      {
        type: 'button',
        className: cls.fab,
        'aria-label': t('qiniu.fab.open'),
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        onClick: () => setOpen((value) => !value),
      },
      createElement(UsageIcon, null),
      createElement('span', null, t('qiniu.fab.button')),
      // 数据到手后把总量显示在按钮上，省得每次都要点开看
      total === undefined
        ? null
        : createElement('span', { className: cls.fabTotal }, formatTokens(total)),
    ),
  )
}
