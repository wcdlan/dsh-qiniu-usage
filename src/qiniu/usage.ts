/**
 * 用量响应归一：三种 `data` 形态 → {@link UsageSnapshot}。
 *
 * 设计文档 §3.1 与 §6.1。三个关键决定：
 *
 * 1. **单位以响应里的 `unit` 字段为权威**。文档样例为 `kToken`，但真实值待确认，
 *    所以不硬编码：`kToken` → ×1000，`mToken`/`millionToken` → ×1e6，
 *    未识别的单位按 1:1 计数并记入 `warnings`。
 * 2. **区间汇总直接用 `items[].total`**，不去遍历 `categories[].values[]` 求和 ——
 *    与官方口径一致，也不会因为漏掉某个 categories 条目而算错。
 * 3. **形态判定不靠猜**：`data[]` 的元素带 `api_key` 即为形态 2；否则用调用方
 *    声明的鉴权方式区分形态 1 与 3（二者结构相同，只能靠鉴权方式分辨）。
 *
 * @module dsh-qiniu-usage/qiniu/usage
 */

import type { RawItem, RawKeyGroup, RawModel, RawUsageData } from './types.ts'

/** 一个计费项归一后的形态。 */
export interface UsageItem {
  /** 原始计费项名（未识别时 UI 原样展示）。 */
  name: string
  /** 上游给出的单位原文。 */
  unit: string
  /** 上游给出的原始数值（便于与官方控制台对数）。 */
  totalRaw: number
  /** 按 `unit` 换算成 token 数后的值。 */
  total: number
}

/** 按计费项名归类后的合计。 */
export interface UsageTotalsByKind {
  input: number
  output: number
  cachedInput: number
  cachedWrite: number
  other: number
}

/** 单个模型的用量。 */
export interface UsageModel {
  id: string
  name: string
  items: UsageItem[]
  totalsByKind: UsageTotalsByKind
  total: number
}

/** 一次用量查询的归一结果。 */
export interface UsageSnapshot {
  source: 'bearer' | 'aksk'
  /** Key 的展示标签（`name` 或掩码）。 */
  keyLabel: string
  /** Key 的掩码形式；无可展示名时为空串。 */
  keyMasked: string
  /** 该 Key 的原始 api_key（AK/SK 形态才有）。 */
  apiKey?: string
  /** 归一后的日期 `YYYY-MM-DD`。 */
  day: string
  granularity: 'day' | 'hour'
  range: { start: string; end: string; timezone: string }
  /** 按 `total` 降序。 */
  models: UsageModel[]
  totals: { input: number; output: number; total: number }
  /**
   * 水位线：小时粒度下最后一个**有数据**的时间桶。
   * 用于提示"当天数据可能延迟"。
   */
  watermark?: string
  warnings: string[]
  fetchedAt: string
}

/** {@link normalizeUsage} 的入参。 */
export interface NormalizeUsageInput {
  /** 上游 `data` 字段。 */
  data: unknown
  /** 本次查询的鉴权方式，用于消解形态 1 与 3 的歧义。 */
  auth: 'bearer' | 'aksk'
  /** 本次查询的参数（回填 range 与 day）。 */
  query: { granularity: 'day' | 'hour'; start: string; end: string; timezone: string }
  /** 归一后的日期 `YYYY-MM-DD`。 */
  day: string
  /** 无 `name` 可展示时使用的 Key 标签，例如 Bearer 模式下的 `当前 Key`。 */
  fallbackKeyLabel: string
  /**
   * 只保留某一个 Key：支持按 `api_key`、掩码或上游 `name` 匹配（大小写不敏感）。
   * 省略或传空串表示**账号级汇总**（全部 Key 合并）。
   */
  keySelector?: string
}

/** 未识别的单位：按 1:1 计数，并提示用户核对数量级。 */
const UNKNOWN_UNIT = 1

/**
 * 把上游的 `unit` 解析成"换算倍数 + 基础单位标签"。
 *
 * **必须先把分隔符归一掉**：上游真实返回的写法不止 `kToken`，实测资源包接口会给出
 * **`k/tokens`**（带斜杠）。原先只匹配 `ktoken(s)`，于是 `k/tokens` 落到"未识别"分支，
 * 界面显示成 `50K k/tokens` —— 实际值是 50,000 k/tokens = 50,000,000 tokens，两个量级
 * 叠在一起，用户会以为那是 5 万。
 *
 * 归一规则：去掉空白与 `/ _ - . · *` 等分隔符后小写化，再匹配。
 * 这样 `kToken` / `ktokens` / `KTokens` / `k/tokens` / `k tokens` 都归一到 `ktokens`。
 *
 * @param unit - 上游给出的单位原文。
 * @returns `{ factor, label }`；`undefined` 表示单位未被识别（如 `GB`）。
 */
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

/**
 * 把上游的 `unit` 换算为 token 倍数。
 *
 * @param unit - 上游给出的单位。
 * @returns 倍数；`undefined` 表示单位未被识别。
 */
export function unitMultiplier(unit: string): number | undefined {
  return parseUnit(unit)?.factor
}

/** 计费项归类：按名称关键字匹配。 */
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

/** 取 item 的汇总原始值：优先 `total`，缺失时退回 values 求和。 */
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

/** 收集一个 model 下所有时间桶的时间戳。 */
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

/** 归一单个模型。 */
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

/**
 * 判断一个 `data[]` 元素是否为形态 2 的每 Key 分组。
 */
function isKeyGroup(value: RawModel | RawKeyGroup): value is RawKeyGroup {
  return typeof (value as RawKeyGroup).api_key === 'string'
    || Array.isArray((value as RawKeyGroup).models)
}

/** 把 `data` 归一为"每 Key 一组模型"的形态，供单 Key 与账号级两条路径共用。 */
function toKeyGroups(data: unknown): RawKeyGroup[] {
  if (!Array.isArray(data)) return []
  return (data as (RawModel | RawKeyGroup)[]).map((entry) =>
    isKeyGroup(entry) ? entry : { models: [entry as RawModel] },
  )
}

/** 从分组里挑出匹配 `keySelector` 的那一组，支持按 api_key / 掩码 / 名称匹配。 */
function findKeyGroup(
  groups: RawKeyGroup[],
  keySelector: string,
): RawKeyGroup | undefined {
  const needle = keySelector.trim().toLowerCase()
  if (needle === '') return undefined
  return groups.find((group) => {
    const apiKey = typeof group.api_key === 'string' ? group.api_key : ''
    const name = typeof group.name === 'string' ? group.name : ''
    return apiKey === keySelector
      || apiKey.toLowerCase() === needle
      || maskApiKey(apiKey).toLowerCase() === needle
      || name.toLowerCase() === needle
  })
}

/**
 * 把上游用量响应归一为 {@link UsageSnapshot}。
 *
 * 传 `keySelector` 时只保留匹配的那一个 Key（按 `api_key`、掩码或名称匹配）；
 * 不传则把全部 Key 的用量**合并**为账号级视图 —— 同名模型会相加，而不是并列
 * 出现两行。这正是 AK/SK 模式下"指定 Key"的实现方式：拉全账号 + 本地筛选。
 *
 * @param input - 原始 `data`、鉴权方式与查询元信息。
 * @returns 归一快照；`data` 不是数组时返回空快照。
 */
export function normalizeUsage(input: NormalizeUsageInput): UsageSnapshot {
  const { data, auth, query, day, fallbackKeyLabel, keySelector } = input
  const warnings = new Set<string>()

  let groups = toKeyGroups(data)
  if (keySelector !== undefined && keySelector.trim() !== '') {
    const matched = findKeyGroup(groups, keySelector)
    // 选中的 Key 当日零用量时上游不会返回它 —— 这不是错误，回落到空快照，
    // 由 UI 显示"无用量"而不是"找不到 Key"（设计文档 §7.1 的已知边界）。
    groups = matched === undefined ? [] : [matched]
  }

  const allTimes: string[] = []
  // 同名模型跨 Key 合并：key 为 model.id，value 为已归一模型与来源 Key 集合。
  const merged = new Map<string, { model: UsageModel; keys: Set<string> }>()

  for (const group of groups) {
    const groupKey = typeof group.api_key === 'string' && group.api_key !== ''
      ? group.api_key
      : 'unknown'
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

  // Key 标签：优先取上游给的 name，其次掩码，最后调用方给的兜底标签。
  const first = groups[0]
  const keyLabel = first?.name !== undefined && first.name !== ''
    ? first.name
    : (first?.api_key !== undefined && first.api_key !== '' ? maskApiKey(first.api_key) : fallbackKeyLabel)
  const keyMasked = first?.api_key !== undefined && first.api_key !== '' ? maskApiKey(first.api_key) : ''

  const watermark = allTimes.length === 0
    ? undefined
    : allTimes.reduce((latest, time) => (time > latest ? time : latest))

  return {
    source: auth,
    keyLabel,
    keyMasked,
    ...(first?.api_key === undefined || first.api_key === '' ? {} : { apiKey: first.api_key }),
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

/**
 * 掩码化一个 API Key：保留前 5 位与后 2 位。
 *
 * 设计文档 §11.3：日志与界面里的 Key 一律掩码。
 *
 * @param key - 原始 Key。
 * @returns 掩码后的 Key；过短时整体打码。
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length)
  return `${key.slice(0, 5)}*****${key.slice(-2)}`
}

/**
 * 从用量响应中提取 Key 清单（供 `/keys` 使用）。
 *
 * **已知边界**：当日零用量的 Key 不会出现在上游响应里，因此只能枚举"有用量"的
 * Key —— 其余由用户在配置里登记名称。见设计文档 §7.1。
 *
 * @param data - 上游 `data` 字段。
 * @returns 每个出现过的 Key 的掩码与名称。
 */
export function extractUsageKeys(data: unknown): { apiKey: string; masked: string; name?: string }[] {
  if (!Array.isArray(data)) return []
  const seen = new Map<string, { apiKey: string; masked: string; name?: string }>()
  for (const entry of data as (RawModel | RawKeyGroup)[]) {
    if (!isKeyGroup(entry)) continue
    const apiKey = entry.api_key
    if (typeof apiKey !== 'string' || apiKey === '' || seen.has(apiKey)) continue
    seen.set(apiKey, {
      apiKey,
      masked: maskApiKey(apiKey),
      ...(typeof entry.name === 'string' && entry.name !== '' ? { name: entry.name } : {}),
    })
  }
  return [...seen.values()]
}
