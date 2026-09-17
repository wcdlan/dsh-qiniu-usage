/**
 * 展示层格式化：Token 数量、比率、时间。
 *
 * 纯函数，单独可测 —— UI 里最容易出错的"数量级/单位/边界"都集中在这里。
 *
 * @module dsh-qiniu-usage/client/format
 */

/** SI 千分进位。 */
const SI_UNITS = [
  { limit: 1e9, suffix: 'B', divisor: 1e9 },
  { limit: 1e6, suffix: 'M', divisor: 1e6 },
  { limit: 1e3, suffix: 'K', divisor: 1e3 },
] as const

/**
 * 把 Token 数量格式化为紧凑形式（K/M/B），保留两位有效小数。
 *
 * 不足 1000 时原样显示整数。`undefined` / 非有限值返回 `0`。
 *
 * @param value - Token 数量。
 * @returns 紧凑字符串，例如 `2.08M`。
 */
export function formatTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0'
  const absolute = Math.abs(value)
  for (const unit of SI_UNITS) {
    if (absolute >= unit.limit) {
      const scaled = value / unit.divisor
      // 去掉多余的尾随 0：2.00M → 2M，2.50M → 2.5M
      return `${Number(scaled.toFixed(2))}${unit.suffix}`
    }
  }
  return String(Math.round(value))
}

/**
 * 把 0..1 的比率格式化为百分比整数。
 *
 * @param value - 比率。
 * @returns 百分比字符串，例如 `68%`。
 */
export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0%'
  return `${Math.round(value * 100)}%`
}

/**
 * 按东八区把时间戳格式化为 `HH:MM:SS`。
 *
 * 面板显示的是七牛口径的时间（东八区），因此不跟随浏览器时区，
 * 避免用户看到与官方控制台不一致的时刻。
 *
 * @param timestampMs - 毫秒时间戳。
 * @returns `HH:MM:SS`；无法解析时为空串。
 */
export function formatClock(timestampMs: number | null | undefined): string {
  if (timestampMs === null || timestampMs === undefined || !Number.isFinite(timestampMs)) return ''
  const shifted = new Date(timestampMs + 8 * 3600 * 1000)
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  const ss = String(shifted.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/**
 * 把 ISO 时间文本格式化为东八区的 `MM-DD`。
 *
 * @param iso - ISO 时间文本（通常带 `+08:00`）。
 * @returns `MM-DD`；无法解析时原样返回。
 */
export function formatMonthDay(iso: string | undefined): string {
  if (iso === undefined || iso === '') return ''
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  const shifted = new Date(parsed + 8 * 3600 * 1000)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${month}-${day}`
}

/**
 * 把数值格式化为带单位的分段用量，用于资源包行。
 *
 * @param value - 数值。
 * @param unit - 单位（如 `GB`）。
 * @returns 形如 `1.28K GB` 的字符串。
 */
export function formatAmount(value: number | undefined, unit: string): string {
  const text = formatTokens(value)
  return unit === '' ? text : `${text} ${unit}`
}

/**
 * 水位线文本：从 ISO 时间取东八区的 `HH:MM`。
 *
 * @param iso - ISO 时间文本。
 * @returns `HH:MM`；无法解析时为空串。
 */
export function formatWatermark(iso: string | undefined): string {
  if (iso === undefined || iso === '') return ''
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return ''
  const shifted = new Date(parsed + 8 * 3600 * 1000)
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * 按长度截断模型名，避免长 id 撑破表格。
 *
 * @param name - 模型名。
 * @param max - 最大字符数。
 * @returns 截断后的名称。
 */
export function truncate(name: string, max = 28): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`
}
