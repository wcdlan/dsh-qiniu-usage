/**
 * 悬浮按钮的位置：默认右上角、可拖拽、位置记忆。
 *
 * 这里只放**纯函数**（坐标钳制、读写存储、决定弹层往哪边展开），DOM 与指针事件留在
 * {@link FloatingUsage} 里。这样"位置算得对不对"可以在 node 环境里直接测，不需要 jsdom。
 *
 * 存储用 `localStorage`（按浏览器各记各的），并且**所有访问都包 try/catch**：
 * 隐私模式下 `localStorage` 会直接抛异常，而浮层不能因此消失。
 *
 * @module dsh-qiniu-usage/client/fab-position
 */

/** 一个坐标点（视口坐标系，单位 px）。 */
export interface FabPoint {
  x: number
  y: number
}

/** 一个尺寸。 */
export interface FabSize {
  width: number
  height: number
}

/** 位置记忆的存储键。 */
export const FAB_POSITION_KEY = 'dsh-qiniu-usage:fab-position'

/** 距视口边缘的最小留白：拖到边缘也要留一点，免得贴死在边框上。 */
export const FAB_EDGE_MARGIN = 8

/** 默认位置：右上角。顶部留 56px 给页面顶栏让位，右侧留 20px。 */
export const FAB_DEFAULT_INSET = { top: 56, right: 20 } as const

/** 判定"算拖动还是算点击"的位移阈值（px）。 */
export const FAB_DRAG_THRESHOLD = 4

/**
 * 把坐标钳制在视口内，保证整个按钮可见。
 *
 * @param point - 期望的左上角坐标。
 * @param size - 按钮尺寸。
 * @param viewport - 视口尺寸。
 * @returns 钳制后的坐标。
 */
export function clampFabPosition(point: FabPoint, size: FabSize, viewport: FabSize): FabPoint {
  // 视口比按钮还小时 max 会小于 min，用 Math.max 兜住，避免钳出负数。
  const maxX = Math.max(FAB_EDGE_MARGIN, viewport.width - size.width - FAB_EDGE_MARGIN)
  const maxY = Math.max(FAB_EDGE_MARGIN, viewport.height - size.height - FAB_EDGE_MARGIN)
  const x = Number.isFinite(point.x) ? point.x : FAB_EDGE_MARGIN
  const y = Number.isFinite(point.y) ? point.y : FAB_EDGE_MARGIN
  return {
    x: Math.min(Math.max(x, FAB_EDGE_MARGIN), maxX),
    y: Math.min(Math.max(y, FAB_EDGE_MARGIN), maxY),
  }
}

/** 可注入的最小存储接口（便于测试）。 */
export interface FabStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 取默认存储；不可用时返回 `undefined`（SSR、隐私模式、被策略禁用）。
 *
 * @returns `localStorage` 或 `undefined`。
 */
export function defaultFabStorage(): FabStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    // 某些环境下**读取** localStorage 属性本身就会抛异常。
    return undefined
  }
}

/**
 * 读出记住的位置。
 *
 * @param storage - 存储；默认 `localStorage`。
 * @returns 坐标；没存过或数据坏了时返回 `null`（回落到默认右上角）。
 */
export function readFabPosition(storage: FabStorage | undefined = defaultFabStorage()): FabPoint | null {
  if (storage === undefined) return null
  try {
    const raw = storage.getItem(FAB_POSITION_KEY)
    if (raw === null || raw === '') return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { x, y } = parsed as { x?: unknown; y?: unknown }
    if (typeof x !== 'number' || typeof y !== 'number') return null
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x, y }
  } catch {
    // 存的是坏 JSON、或存储被禁用 —— 都只是"没记住"，不该让浮层挂掉。
    return null
  }
}

/**
 * 记住位置。
 *
 * @param point - 坐标。
 * @param storage - 存储；默认 `localStorage`。
 */
export function storeFabPosition(
  point: FabPoint,
  storage: FabStorage | undefined = defaultFabStorage(),
): void {
  if (storage === undefined) return
  try {
    storage.setItem(FAB_POSITION_KEY, JSON.stringify({ x: Math.round(point.x), y: Math.round(point.y) }))
  } catch {
    // 写不进去（配额/隐私模式）就算了：本次会话内位置仍然是对的。
  }
}

/**
 * 决定弹层往哪边展开。
 *
 * 按钮在上半屏 → 向下展开；在下半屏 → 向上展开。按钮在左半屏 → 弹层左对齐
 * （向右长）；在右半屏 → 右对齐（向左长），这样 520px 的弹层不会顶出视口。
 *
 * @param button - 按钮的左上角坐标与尺寸。
 * @param viewport - 视口尺寸。
 * @returns `vertical` 为 `'down'`/`'up'`，`align` 为 `'start'`/`'end'`。
 */
export function fabPopupPlacement(
  button: FabPoint & FabSize,
  viewport: FabSize,
): { vertical: 'down' | 'up'; align: 'start' | 'end' } {
  const centerY = button.y + button.height / 2
  const centerX = button.x + button.width / 2
  return {
    vertical: centerY <= viewport.height / 2 ? 'down' : 'up',
    align: centerX <= viewport.width / 2 ? 'start' : 'end',
  }
}
