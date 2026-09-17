/**
 * 对话页悬浮按钮：点击展开用量/资源包速览；可拖拽，位置按浏览器记住。
 *
 * 为什么是"挂到 document.body 的独立 React root"而不是 slot：悬浮按钮是**宿主级** UI，
 * 对话页（尤其是新会话页）没有 session，session 作用域的 slot 在那里不会渲染。
 * 参考实现 `@linxin666/dsh-pet` 同款做法（其注释明确写了这条理由）。
 * 挂载代码在 `client/index.ts`。
 *
 * 取数策略：**只在展开时拉取**，收起即 `stop()`，所以关着的时候零后台请求。
 *
 * 位置：默认右上角，拖走后写进 `localStorage`（见 `fab-position.ts`）。拖拽用
 * pointer 事件 + `setPointerCapture`，因此指针移出按钮也照样跟手；位移超过
 * {@link FAB_DRAG_THRESHOLD} 就抑制随后的 click，免得"拖完顺手把面板打开/关掉"。
 *
 * 关闭方式：再点按钮、按 Esc、点击弹层外部。
 *
 * @module dsh-qiniu-usage/client/FloatingUsage
 */

import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { sumMonthRemain } from '../qiniu/respack.ts'
import {
  clampFabPosition,
  fabPopupPlacement,
  FAB_DEFAULT_INSET,
  FAB_DRAG_THRESHOLD,
  readFabPosition,
  storeFabPosition,
  type FabPoint,
  type FabSize,
} from './fab-position.ts'
import { ModelUsageTable } from './ModelUsageTable.tsx'
import { RespackMonth } from './RespackMonth.tsx'
import { RespackPacks } from './RespackPacks.tsx'
import { convertAmount, formatClock, formatTokens, formatWatermark } from './format.ts'
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

/** 弹层的定位参数：展开方向、对齐方式与可用高度。 */
export interface FloatingPanelRect {
  placement: { vertical: 'down' | 'up'; align: 'start' | 'end' }
  /** 按钮到视口边缘的剩余空间，用于收住最大高度。 */
  available: number
}

/** 弹层属性。 */
export interface FloatingPanelProps {
  store: UsageStoreView
  t: Translate
  onClose: () => void
  /** 由按钮在视口中的位置决定。 */
  rect: FloatingPanelRect
}

/** 视口尺寸；SSR（没有 window）时用一个保守的默认值。 */
function readViewport(): FabSize {
  if (typeof window === 'undefined') return { width: 1280, height: 800 }
  return { width: window.innerWidth, height: window.innerHeight }
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
 * 弹层相对按钮的定位样式。
 *
 * 按钮盒子就是 `.fabRoot` 的盒子，所以 `100%` 就是按钮高度：换边只改
 * top/bottom 与 left/right。
 *
 * @param rect - 展开方向、对齐方式与可用高度。
 * @returns React 内联样式。
 */
function popupPositionStyle(rect: FloatingPanelRect): Record<string, string> {
  const { placement } = rect
  // 下界保证还有可读的滚动区；上界沿用 CSS 里的 640px。
  const maxHeight = Math.max(180, Math.min(640, rect.available))
  return {
    [placement.vertical === 'down' ? 'top' : 'bottom']: `calc(100% + ${POPUP_GAP}px)`,
    [placement.align === 'end' ? 'right' : 'left']: '0',
    maxHeight: `${Math.round(maxHeight)}px`,
  }
}

/** 弹层与按钮之间的间距。 */
const POPUP_GAP = 8

/** 弹层与视口边缘之间至少留出的空隙。 */
const POPUP_VIEWPORT_MARGIN = 12

/**
 * 展开的速览弹层。
 *
 * 单独导出以便测试直接渲染（不需要先点按钮）。
 *
 * @param props - store、翻译函数与关闭回调。
 * @returns 弹层元素。
 */
export function FloatingPanel({ store, t, onClose, rect }: FloatingPanelProps): ReactNode {
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
      style: popupPositionStyle(rect),
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
  // 记住的位置；null = 还没量到/没存过 —— 此时用 CSS 默认的右上角。
  const [position, setPosition] = useState<FabPoint | null>(() => readFabPosition())
  const [viewport, setViewport] = useState<FabSize>(readViewport)
  const [dragging, setDragging] = useState(false)
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const wrapper = useRef<HTMLDivElement | null>(null)
  /** 本次指针交互的起点、原始坐标与最新坐标；null 表示当前没有按下。 */
  const drag = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
    lastX: number
    lastY: number
    moved: boolean
  } | null>(null)
  /** 刚结束的那次交互是拖动 → 抑制紧随其后的 click。 */
  const suppressClick = useRef(false)
  /** 最近一次已知的按钮尺寸，供钳制与换边计算用。 */
  const size = useRef<FabSize>({ width: 0, height: 0 })
  const positionRef = useRef<FabPoint | null>(position)
  positionRef.current = position

  const measure = useCallback((): FabSize => {
    const rect = wrapper.current?.getBoundingClientRect()
    const measured = rect === undefined
      ? size.current
      : { width: rect.width, height: rect.height }
    if (measured.width > 0) size.current = measured
    return measured
  }, [])

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

  // 首帧把 CSS 默认位置"量"成显式坐标：之后换边、钳制、拖动都只认坐标。
  useEffect(() => {
    if (position !== null) return
    const rect = wrapper.current?.getBoundingClientRect()
    if (rect === undefined || rect.width === 0) return
    size.current = { width: rect.width, height: rect.height }
    setPosition({ x: rect.left, y: rect.top })
  }, [position])

  // 窗口尺寸变化：把按钮重新钳回可见区域（并把结果记住）。
  useEffect(() => {
    const onResize = (): void => {
      const next = readViewport()
      setViewport(next)
      const current = positionRef.current
      if (current === null) return
      const clamped = clampFabPosition(current, measure(), next)
      setPosition(clamped)
      storeFabPosition(clamped)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [measure])

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

  /** 按下：记录起点，并接管后续指针事件（移出按钮也跟手）。 */
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    suppressClick.current = false
    const rect = wrapper.current?.getBoundingClientRect()
    if (rect === undefined) return
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      lastX: rect.left,
      lastY: rect.top,
      moved: false,
    }
    size.current = { width: rect.width, height: rect.height }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // jsdom 等环境可能没实现指针捕获；不影响"指针没移出按钮"的常规拖动。
    }
  }

  /** 移动：超过阈值才算拖动，避免手抖把点击变成拖动。 */
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const current = drag.current
    if (current === null) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.moved && Math.hypot(dx, dy) < FAB_DRAG_THRESHOLD) return
    if (!current.moved) {
      current.moved = true
      setDragging(true)
      // 拖动中收起弹层：弹层相对按钮定位，跟着飞会晃眼。
      setOpen(false)
    }
    current.lastX = event.clientX
    current.lastY = event.clientY
    setPosition(clampFabPosition(
      { x: current.originX + dx, y: current.originY + dy },
      size.current,
      viewport,
    ))
  }

  /** 抬起：拖动过就记住位置，并抑制紧随其后的 click。 */
  const onPointerUp = (): void => {
    const current = drag.current
    drag.current = null
    setDragging(false)
    if (current?.moved !== true) return
    suppressClick.current = true
    // 用记录到的指针坐标重算一次终值，不依赖"上一次 setState 是否已经渲染"。
    const finalPosition = clampFabPosition(
      { x: current.originX + (current.lastX - current.startX), y: current.originY + (current.lastY - current.startY) },
      size.current,
      viewport,
    )
    setPosition(finalPosition)
    storeFabPosition(finalPosition)
  }

  const onClick = (): void => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    setOpen((value) => !value)
  }

  const total = state.data?.usage?.totals.total
  const remainEntry = sumMonthRemain(state.data?.respack?.items ?? [])
  const remain = remainEntry === undefined ? null : convertAmount(remainEntry.value, remainEntry.unit)
  const remainText = remain === null
    ? ''
    : (remain.unitLabel === '' ? remain.text : `${remain.text} ${remain.unitLabel}`)
  // 按钮高度在首帧还没量到 —— 用 CSS 里的 34px 顶上，免得弹层位置算偏。
  const buttonSize = { width: size.current.width, height: size.current.height || 34 }
  // 位置也同理：还没量到时按"CSS 默认的右上角"估一个，保证首帧弹层就朝对的方向开。
  const anchor = position ?? {
    x: viewport.width - FAB_DEFAULT_INSET.right - buttonSize.width,
    y: FAB_DEFAULT_INSET.top,
  }
  const placement = fabPopupPlacement({ ...anchor, ...buttonSize }, viewport)
  const popupRect: FloatingPanelRect = {
    placement,
    // 弹层不能顶出视口：按按钮到视口边缘的剩余空间收一下最大高度。
    available: placement.vertical === 'down'
      ? viewport.height - (anchor.y + buttonSize.height + POPUP_GAP) - POPUP_VIEWPORT_MARGIN
      : anchor.y - POPUP_GAP - POPUP_VIEWPORT_MARGIN,
  }

  return createElement(
    'div',
    {
      className: cls.fabRoot,
      ref: wrapper,
      // 量到位置之前用 CSS 默认的右上角（不写内联坐标）；量到之后改走显式坐标。
      style: position === null ? undefined : { left: `${position.x}px`, top: `${position.y}px`, right: 'auto' },
    },
    createElement('style', null, PANEL_CSS),
    createElement(
      'button',
      {
        type: 'button',
        className: dragging ? `${cls.fab} ${cls.fabDragging}` : cls.fab,
        'aria-label': t('qiniu.fab.open'),
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        title: remain === null
          ? t('qiniu.fab.dragHint')
          : `${t('qiniu.fab.remainTitle', { amount: remainText })} · ${t('qiniu.fab.dragHint')}`,
        onClick,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
      },
      createElement(UsageIcon, null),
      createElement('span', null, t('qiniu.fab.button')),
      // 数据到手后把总量与当月剩余显示在按钮上，省得每次都要点开看
      total === undefined
        ? null
        : createElement('span', { className: cls.fabTotal }, formatTokens(total)),
      total === undefined || remain === null
        ? null
        : createElement('span', { className: cls.fabSep }, '·'),
      total === undefined || remain === null
        ? null
        : createElement(
            'span',
            { className: cls.fabRemain },
            `${t('qiniu.fab.remain')} ${remain.text}`,
          ),
    ),
    open
      ? createElement(FloatingPanel, { store, t, rect: popupRect, onClose: () => setOpen(false) })
      : null,
  )
}
