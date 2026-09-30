// 三种 `data` 形态 → UsageSnapshot（设计文档 §3.1 与 §6.1）。

import type {RawItem, RawKeyGroup, RawModel} from './types.ts'

export interface UsageItem {
    /** 未识别时 UI 原样展示。 */
  name: string
  unit: string
    /** 上游原始值，便于与官方控制台对数。 */
  totalRaw: number
  total: number
}

export interface UsageTotalsByKind {
  input: number
  output: number
  cachedInput: number
  cachedWrite: number
  other: number
}

export interface UsageModel {
  id: string
  name: string
  items: UsageItem[]
  totalsByKind: UsageTotalsByKind
  total: number
}

export interface UsageSnapshot {
  source: 'bearer' | 'aksk'
  keyLabel: string
    /** 无可展示名时为空串。 */
  keyMasked: string
    /** 上游给的 `api_key`；**已是脱敏形式**，仅 AK/SK 形态才有。 */
  apiKey?: string
    /** 响应完全没有 Key 归属（当天 `api_key: "unknown"`）：按 Key 筛选不可用，UI 须提示"账号汇总"，不要渲染星号或谎报无用量。 */
  unattributedKeys?: true
  day: string
  granularity: 'day' | 'hour'
  range: { start: string; end: string; timezone: string }
  /** 按 `total` 降序。 */
  models: UsageModel[]
  totals: { input: number; output: number; total: number }
    /** 水位线：小时粒度下最后一个**有数据**的时间桶，用于提示"当天数据可能延迟"。 */
  watermark?: string
  warnings: string[]
  fetchedAt: string
}

export interface NormalizeUsageInput {
  data: unknown
    /** 鉴权方式，用于消解形态 1 与 3 的歧义。 */
  auth: 'bearer' | 'aksk'
  query: { granularity: 'day' | 'hour'; start: string; end: string; timezone: string }
  day: string
    /** 无 `name` 可展示时的 Key 标签，如 Bearer 模式下的 `当前 Key`。 */
  fallbackKeyLabel: string
    /** 按 `api_key`、掩码或上游 `name` 匹配（大小写不敏感）；省略或空串表示账号级汇总。 */
  keySelector?: string
}

// 未识别的单位按 1:1 计数，并提示用户核对数量级。
const UNKNOWN_UNIT = 1

// 上游"当天用量尚未归属"时的占位 `api_key`（实测，设计文档 §15.10）：它是哨兵值而非 Key，打码只会得到无意义星号，当筛选条件也永远匹配不到。
const UNATTRIBUTED_API_KEY = 'unknown'

/** 取上游 `api_key` 里可用的 Key 身份（已去空白）；是占位值或空串时返回 `''`。 */
export function keyIdentityOf(apiKey: unknown): string {
  if (typeof apiKey !== 'string') return ''
  const identity = apiKey.trim()
  if (identity === '' || identity.toLowerCase() === UNATTRIBUTED_API_KEY) return ''
  return identity
}

/** 解析 `unit` 为换算倍数 + 标签；必须先归一 `\s/_\-.·*` 分隔符 —— 实测资源包接口会给出 `k/tokens`，漏掉会把 50,000 k/tokens 显示成 50K，量级差两个数量级。 */
export function parseUnit(unit: string): { factor: number; label: string } | undefined {
  const key = unit.trim().toLowerCase().replace(/[\s/_\-.·*]+/g, '')
  switch (key) {
    case '':
    case 'token':
    case 'tokens':
      return { factor: 1, label: 'tokens' }
    case 'k':
    case 'ktoken':
    case 'ktokens':
      return { factor: 1_000, label: 'tokens' }
    case 'm':
    case 'mtoken':
    case 'mtokens':
    case 'milliontoken':
    case 'milliontokens':
      return { factor: 1_000_000, label: 'tokens' }
    case 'b':
    case 'btoken':
    case 'btokens':
    case 'billiontoken':
    case 'billiontokens':
      return { factor: 1_000_000_000, label: 'tokens' }
    // 财务接口还会用「千次」这类自带量级的中文单位：5000 千次 = 5,000,000 次。
    case '千次':
      return { factor: 1_000, label: '次' }
    default:
      return undefined
  }
}

export function unitMultiplier(unit: string): number | undefined {
  return parseUnit(unit)?.factor
}

export function classifyItem(name: string): keyof UsageTotalsByKind {
  const n = name.toLowerCase()
  // 顺序敏感：先判缓存，再判输入 —— 缓存项名通常同时含"输入/Token"字样。
  if (n.includes('cache') || n.includes('缓存')) {
    if (n.includes('write') || n.includes('写') || n.includes('creation') || n.includes('创建')) {
      return 'cachedWrite'
    }
    return 'cachedInput'
  }
  if (n.includes('output') || n.includes('输出') || n.includes('completion')) return 'output'
  if (n.includes('input') || n.includes('输入') || n.includes('prompt')) return 'input'
  return 'other'
}

// 优先取 `total`（与官方口径一致），缺失时才退回 values 求和。
export function itemTotalRaw(item: RawItem): number {
  if (typeof item.total === 'number' && Number.isFinite(item.total)) return item.total
  let sum = 0
  if (Array.isArray(item.values)) {
    for (const value of item.values) {
      if (typeof value?.value === 'number' && Number.isFinite(value.value)) sum += value.value
    }
  }
  if (Array.isArray(item.categories)) {
    for (const category of item.categories) {
      if (!Array.isArray(category?.values)) continue
      for (const value of category.values) {
        if (typeof value?.value === 'number' && Number.isFinite(value.value)) sum += value.value
      }
    }
  }
  return sum
}

function collectTimes(model: RawModel): string[] {
  const times: string[] = []
  for (const item of model.items ?? []) {
    if (Array.isArray(item.values)) {
      for (const value of item.values) if (typeof value?.time === 'string') times.push(value.time)
    }
    if (Array.isArray(item.categories)) {
      for (const category of item.categories) {
        if (!Array.isArray(category?.values)) continue
        for (const value of category.values) {
          if (typeof value?.time === 'string') times.push(value.time)
        }
      }
    }
  }
  return times
}

function normalizeModel(model: RawModel, warnings: Set<string>): UsageModel {
  const items: UsageItem[] = []
  const totalsByKind: UsageTotalsByKind = {
    input: 0,
    output: 0,
    cachedInput: 0,
    cachedWrite: 0,
    other: 0,
  }

  for (const raw of model.items ?? []) {
    const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : '未命名计费项'
    const unit = typeof raw.unit === 'string' ? raw.unit : ''
    const totalRaw = itemTotalRaw(raw)
    const multiplier = unitMultiplier(unit)
    if (multiplier === undefined) {
      warnings.add(`未识别的计量单位 "${unit}"（计费项 ${name}）：已按 1:1 计数，请核对数量级`)
    }
    const total = totalRaw * (multiplier ?? UNKNOWN_UNIT)
    items.push({ name, unit, totalRaw, total })
    totalsByKind[classifyItem(name)] += total
  }

  const total = Object.values(totalsByKind).reduce((sum, value) => sum + value, 0)
  return {
    id: typeof model.id === 'string' && model.id !== '' ? model.id : 'unknown',
    name: typeof model.name === 'string' && model.name !== '' ? model.name : String(model.id ?? 'unknown'),
    items,
    totalsByKind,
    total,
  }
}

function isKeyGroup(value: RawModel | RawKeyGroup): value is RawKeyGroup {
  return typeof (value as RawKeyGroup).api_key === 'string'
    || Array.isArray((value as RawKeyGroup).models)
}

function toKeyGroups(data: unknown): RawKeyGroup[] {
  if (!Array.isArray(data)) return []
  return (data as (RawModel | RawKeyGroup)[]).map((entry) =>
    isKeyGroup(entry) ? entry : { models: [entry as RawModel] },
  )
}

function findKeyGroup(
  groups: RawKeyGroup[],
  keySelector: string,
): RawKeyGroup | undefined {
  const needle = keySelector.trim().toLowerCase()
  if (needle === '') return undefined
  return groups.find((group) => {
      // 无归属分组（`api_key: "unknown"`）不参与匹配，否则掩码 "*******" 会变成一个永远筛不到东西的幽灵选项。
    const apiKey = keyIdentityOf(group.api_key)
    if (apiKey === '') return false
    const name = typeof group.name === 'string' ? group.name : ''
    return apiKey === keySelector
      || apiKey.toLowerCase() === needle
      || maskApiKey(apiKey).toLowerCase() === needle
      || name.toLowerCase() === needle
  })
}

/** 归一上游响应；传 `keySelector` 只保留匹配的那一个 Key，不传则把全部 Key 合并为账号级视图（同名模型相加，而非并列两行）。 */
export function normalizeUsage(input: NormalizeUsageInput): UsageSnapshot {
  const { data, auth, query, day, fallbackKeyLabel, keySelector } = input
  const warnings = new Set<string>()

  let groups = toKeyGroups(data)
  // 整份响应里是否存在可用的 Key 归属 —— 当天数据尚未归属时为 false。
  const unattributedKeys = groups.length > 0
    && groups.every((group) => keyIdentityOf(group.api_key) === '')
  if (keySelector !== undefined && keySelector.trim() !== '') {
    const matched = findKeyGroup(groups, keySelector)
    if (matched !== undefined) {
      groups = [matched]
    } else if (!unattributedKeys) {
        // 真有归属、只是这个 Key 当日零用量：上游不会返回它 —— 回落到空快照，由 UI 显示"无用量"（设计文档 §7.1）。
      groups = []
    }
      // 否则：上游完全没给归属信息（当天），既筛不了也不能谎报零用量 —— 保留账号汇总，由 `unattributedKeys` 让 UI 明说。
  }

  const allTimes: string[] = []
  // 同名模型跨 Key 合并：key 为 model.id，value 为已归一模型与来源 Key 集合。
  const merged = new Map<string, { model: UsageModel; keys: Set<string> }>()

  for (const group of groups) {
    const groupKey = keyIdentityOf(group.api_key) || 'unattributed'
    for (const model of group.models ?? []) {
      const normalized = normalizeModel(model, warnings)
      const existing = merged.get(normalized.id)
      if (existing === undefined) {
        merged.set(normalized.id, { model: normalized, keys: new Set([groupKey]) })
        continue
      }
      existing.keys.add(groupKey)
      const target = existing.model
      for (const item of normalized.items) {
        const sameItem = target.items.find((i) => i.name === item.name && i.unit === item.unit)
        if (sameItem === undefined) {
          target.items.push(item)
        } else {
          sameItem.totalRaw += item.totalRaw
          sameItem.total += item.total
        }
      }
      for (const kind of Object.keys(target.totalsByKind) as (keyof UsageTotalsByKind)[]) {
        target.totalsByKind[kind] += normalized.totalsByKind[kind]
      }
      target.total += normalized.total
    }
    for (const model of group.models ?? []) {
      for (const time of collectTimes(model)) allTimes.push(time)
    }
  }

  const models = [...merged.values()].map((entry) => entry.model)
  models.sort((a, b) => b.total - a.total)

  const totals = { input: 0, output: 0, total: 0 }
  for (const model of models) {
    totals.input += model.totalsByKind.input
    totals.output += model.totalsByKind.output
    totals.total += model.total
  }

    // Key 标签优先 name、次掩码、末兜底；`unknown` 分组经 keyIdentityOf 归零后自然落到兜底（「全部 Key」），而不是渲染成 "*******"。
  const first = groups[0]
  const firstIdentity = keyIdentityOf(first?.api_key)
  const firstName = typeof first?.name === 'string' ? first.name.trim() : ''
  const keyLabel = firstName !== ''
    ? firstName
    : (firstIdentity !== '' ? maskApiKey(firstIdentity) : fallbackKeyLabel)
  const keyMasked = firstIdentity === '' ? '' : maskApiKey(firstIdentity)

  const watermark = allTimes.length === 0
    ? undefined
    : allTimes.reduce((latest, time) => (time > latest ? time : latest))

  return {
    source: auth,
    keyLabel,
    keyMasked,
    ...(firstIdentity === '' ? {} : { apiKey: firstIdentity }),
    ...(unattributedKeys ? { unattributedKeys: true as const } : {}),
    day,
    granularity: query.granularity,
    range: { start: query.start, end: query.end, timezone: query.timezone },
    models,
    totals,
    ...(watermark === undefined ? {} : { watermark }),
    warnings: [...warnings],
    fetchedAt: new Date().toISOString(),
  }
}

/** 掩码化：保留前 5 位与后 2 位；入参已含 `*` 时原样返回 —— 上游给的 `api_key` 本身已是 `前5位*****后5位`，再打一次码只会把可读信息越改越少（设计文档 §11.3）。 */
export function maskApiKey(key: string): string {
  if (key.includes('*')) return key
  if (key.length <= 8) return '*'.repeat(key.length)
  return `${key.slice(0, 5)}*****${key.slice(-2)}`
}

/** 提取 Key 名册（供 `/keys` 用）：跳过 `unknown` 占位分组。已知边界：窗口内零用量的 Key 不出现在上游响应里，只能枚举有用量的 Key（设计文档 §7.1、§15.10）。 */
export function extractUsageKeys(data: unknown): { apiKey: string; masked: string; name?: string }[] {
  if (!Array.isArray(data)) return []
  const seen = new Map<string, { apiKey: string; masked: string; name?: string }>()
  for (const entry of data as (RawModel | RawKeyGroup)[]) {
    if (!isKeyGroup(entry)) continue
    const apiKey = keyIdentityOf(entry.api_key)
    if (apiKey === '' || seen.has(apiKey)) continue
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    seen.set(apiKey, {
      apiKey,
      masked: maskApiKey(apiKey),
      ...(name === '' ? {} : { name }),
    })
  }
  return [...seen.values()]
}
