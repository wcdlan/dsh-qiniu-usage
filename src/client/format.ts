// 展示层格式化：Token 数量、比率、时间。纯函数，单独可测。

import {parseUnit} from '../qiniu/usage.ts'

const SI_UNITS = [
  { limit: 1e9, suffix: 'B', divisor: 1e9 },
  { limit: 1e6, suffix: 'M', divisor: 1e6 },
  { limit: 1e3, suffix: 'K', divisor: 1e3 },
] as const

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

export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0%'
  return `${Math.round(value * 100)}%`
}

// 面板显示七牛口径的时间（东八区），不跟随浏览器时区，避免与官方控制台不一致。
export function formatClock(timestampMs: number | null | undefined): string {
  if (timestampMs === null || timestampMs === undefined || !Number.isFinite(timestampMs)) return ''
  const shifted = new Date(timestampMs + 8 * 3600 * 1000)
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  const ss = String(shifted.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function formatMonthDay(iso: string | undefined): string {
  if (iso === undefined || iso === '') return ''
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  const shifted = new Date(parsed + 8 * 3600 * 1000)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${month}-${day}`
}

// 上游的资源包单位可能自带量级（如 `kTokens`），再叠加 SI 紧凑表示会得到
// `75.14K kTokens` 这种两套量级叠加的写法，用户极易读错数量级 —— 所以先换算成基础
// 单位（tokens），标签只留一次。
export function convertAmount(
  value: number | undefined,
  unit: string,
): { text: string; unitLabel: string } {
  // 空单位表示"上游没给单位" —— 不能替它断言成 tokens，只显示数值。
  if (unit.trim() === '') return { text: formatTokens(value), unitLabel: '' }

  const parsed = parseUnit(unit)
  if (parsed === undefined) {
    // 未识别的单位（如 GB）：不知道它是否自带量级，保持原样 + 紧凑表示。
    return { text: formatTokens(value), unitLabel: unit }
  }
  return { text: formatTokens((value ?? 0) * parsed.factor), unitLabel: parsed.label }
}

export function formatAmount(value: number | undefined, unit: string): string {
  const { text, unitLabel } = convertAmount(value, unit)
  return unitLabel === '' ? text : `${text} ${unitLabel}`
}

export function formatAmountPair(
  used: number | undefined,
  total: number | undefined,
  unit: string,
): string {
  const left = convertAmount(used, unit)
  const right = convertAmount(total, unit)
  const label = right.unitLabel === '' ? '' : ` ${right.unitLabel}`
  return `${left.text} / ${right.text}${label}`
}

export function formatWatermark(iso: string | undefined): string {
  if (iso === undefined || iso === '') return ''
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return ''
  const shifted = new Date(parsed + 8 * 3600 * 1000)
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function truncate(name: string, max = 28): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`
}
