/**
 * 资源包客户端与归一：month-overview / list / detail。
 *
 * 设计文档 §3.3。字段名已对着官方文档逐个核对（2025-09-10 版），三处容易踩的坑：
 *
 * 1. **`page_size` 上限是 200**（官方文档明确"最大不超过 200"）。所以分页必须循环，
 *    且循环要有硬上限防止上游异常时跑飞。
 * 2. **`deduct_amount` 文档标为 `string`，但示例里写的是数字**，而且那段示例本身
 *    有 JSON 语法错误（`"deduct_amount: 1024` 少了引号）。解析必须两种都吃。
 * 3. **`month-overview` 也是分页接口**，不能当单页处理。
 *
 * 口径差异必须分别标注（设计文档 §3.3）：`list` 的 `used_amount` 是**资源包生命
 * 周期累计**，`month-overview` 的 `month_used` 是**当月口径**。混在一起展示会误导。
 *
 * @module dsh-qiniu-usage/qiniu/respack
 */

import { signQiniuRequest } from './sign.ts'
import { QiniuUpstreamError, fetchUpstreamData } from './http.ts'
import type {
  RawRespackDetail,
  RawRespackDeductDetail,
  RawRespackMonthItem,
  RawRespackPack,
} from './types.ts'

/** 财务 API 错误码 → 用户可读提示（官方文档错误码表）。 */
export const RESPACK_ERROR_MESSAGES: Record<number, string> = {
  1000: '请求参数不正确',
  1001: '账单数据获取失败',
  1002: '自定义账单数据获取失败',
  1003: '订单数据获取失败',
  1004: '月结算单获取失败',
  1005: '请求的时间不正确',
  1006: '流水数据获取失败',
  1007: '优惠券使用量获取失败',
  1008: '取消订单失败',
  1009: '资源包当月概览获取失败',
  1010: '资源包列表获取失败',
  1011: '资源包详情获取失败',
  1012: '资源包历史抵扣获取失败',
  1013: '账户余额获取失败',
  1014: '获取分账账单详情失败',
}

/** 单页请求的条数上限（官方文档：最大不超过 200）。 */
export const MAX_PAGE_SIZE = 200

/** 分页循环的硬上限，防止上游返回异常数据时无限翻页。 */
export const MAX_PAGES = 5

/** 资源包状态。 */
export const RESPACK_STATUS = {
  1: '未使用',
  2: '使用中',
  3: '已用完',
  4: '已过期',
} as const

/** 分配方式（`carry_over_policy`）。 */
export const CARRY_OVER_POLICY = {
  0: '按月分配可结转',
  1: '按月分配不可结转',
  2: '一次性分配',
} as const

/** 抵扣明细的出账状态。 */
export const DEDUCT_STATUS = {
  1: '未出账抵扣',
  2: '已出账抵扣',
} as const

/** 当月口径的一个计费项。 */
export interface RespackMonthItem {
  itemName: string
  zoneName: string
  availableTime: string
  unit: string
  /** 当月可用总量（含结转）。 */
  monthCapacity: number
  monthUsed: number
  monthRemain: number
  /** `monthUsed / monthCapacity`，0..1。 */
  utilization: number
}

/** 一个资源包（生命周期口径）。 */
export interface RespackPack {
  name: string
  unit: string
  status: number
  statusLabel: string
  effectiveStart: string
  effectiveEnd: string
  /** 距到期的天数（按东八区日期算）；无法解析时为 `undefined`。 */
  daysRemaining?: number
  carryOverPolicy: number
  carryOverLabel: string
  /** 生命周期总量。 */
  totalAmount: number
  /** 生命周期已用 —— 注意与 `monthUsed` 口径不同。 */
  usedAmount: number
  utilization: number
  orderHash: string
  poId: number
}

/** 单包下钻的一条抵扣明细。 */
export interface RespackDeductDetail {
  deductDate: string
  deductStatus: number
  deductStatusLabel: string
  deductAmount: number
}

/** 单包下钻结果。 */
export interface RespackDetail {
  name: string
  unit: string
  isCombo: boolean
  description: string
  itemCode: string
  totalAmount: number
  usedAmount: number
  deductDetails: RespackDeductDetail[]
}

/** 资源包快照。 */
export interface RespackSnapshot {
  items: RespackMonthItem[]
  packages: RespackPack[]
  fetchedAt: string
  warnings: string[]
}

/** 调用财务 API 所需的上下文。 */
export interface RespackClientOptions {
  baseUrl: string
  accessKey: string
  secretKey: string
  fetchImpl: typeof fetch
  /** 上游限速队列的入队函数；由 service 提供以保证与用量请求共用同一队列。 */
  schedule: <T>(task: () => Promise<T>) => Promise<T>
  /** 时钟，默认 `Date.now`。 */
  now?: () => number
  /** 重试睡眠实现，便于测试。 */
  sleepImpl?: (ms: number) => Promise<void>
}

/** 数字字段的安全解析：容忍字符串数字（上游类型不稳定）。 */
function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

/** 字符串字段的安全解析。 */
function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 把错误码翻译成用户可读提示；未知码保留原始信息。 */
export function describeRespackError(code: number | string | undefined, message: string): string {
  if (typeof code === 'number' && RESPACK_ERROR_MESSAGES[code] !== undefined) {
    return `${RESPACK_ERROR_MESSAGES[code]}（code=${code}）`
  }
  return message
}

/**
 * 计算 `YYYY-MM-DD` 与"现在"相差的天数（按东八区日期）。
 *
 * @param dateText - ISO 时间文本。
 * @param nowMs - 当前时间戳。
 * @returns 天数；无法解析时为 `undefined`。已过期则为负数。
 */
export function daysUntil(dateText: string, nowMs: number): number | undefined {
  const target = Date.parse(dateText)
  if (Number.isNaN(target)) return undefined
  const dayMs = 24 * 3600 * 1000
  // 折算到东八区后取日期，再按日零点相减，避免时刻差异污染天数。
  const targetDay = Math.floor((target + 8 * 3600 * 1000) / dayMs)
  const nowDay = Math.floor((nowMs + 8 * 3600 * 1000) / dayMs)
  return targetDay - nowDay
}

/** 安全计算比率；分母为 0 时返回 0（而不是 NaN/Infinity）。 */
export function ratio(used: number, capacity: number): number {
  if (capacity <= 0) return 0
  return Math.min(Math.max(used / capacity, 0), 1)
}

/** 归一一条 month-overview 记录。 */
export function normalizeMonthItem(raw: RawRespackMonthItem): RespackMonthItem {
  const monthCapacity = toNumber(raw.total_surplus)
  const monthUsed = toNumber(raw.month_used)
  const monthRemain = raw.month_remain === undefined ? monthCapacity - monthUsed : toNumber(raw.month_remain)
  return {
    itemName: toText(raw.item_name, '未知计费项'),
    zoneName: toText(raw.zone_name),
    availableTime: toText(raw.available_time),
    unit: toText(raw.respack_unit),
    monthCapacity,
    monthUsed,
    monthRemain,
    utilization: ratio(monthUsed, monthCapacity),
  }
}

/** 归一一个资源包。 */
export function normalizePack(raw: RawRespackPack, nowMs: number): RespackPack {
  const status = toNumber(raw.status)
  const carryOverPolicy = toNumber(raw.carry_over_policy)
  const totalAmount = toNumber(raw.total_amount)
  const usedAmount = toNumber(raw.used_amount)
  const effectiveEnd = toText(raw.effective_end)
  const remaining = effectiveEnd === '' ? undefined : daysUntil(effectiveEnd, nowMs)
  return {
    name: toText(raw.respack_name, '未命名资源包'),
    unit: toText(raw.respack_unit),
    status,
    statusLabel: RESPACK_STATUS[status as keyof typeof RESPACK_STATUS] ?? `未知状态(${status})`,
    effectiveStart: toText(raw.effective_start),
    effectiveEnd,
    ...(remaining === undefined ? {} : { daysRemaining: remaining }),
    carryOverPolicy,
    carryOverLabel:
      CARRY_OVER_POLICY[carryOverPolicy as keyof typeof CARRY_OVER_POLICY]
      ?? `未知分配方式(${carryOverPolicy})`,
    totalAmount,
    usedAmount,
    utilization: ratio(usedAmount, totalAmount),
    orderHash: toText(raw.order_hash),
    poId: toNumber(raw.po_id),
  }
}

/** 归一一条抵扣明细；`deduct_amount` 字符串与数字都接受。 */
export function normalizeDeductDetail(raw: RawRespackDeductDetail): RespackDeductDetail {
  const deductStatus = toNumber(raw.deduct_status)
  return {
    deductDate: toText(raw.deduct_date),
    deductStatus,
    deductStatusLabel:
      DEDUCT_STATUS[deductStatus as keyof typeof DEDUCT_STATUS] ?? `未知状态(${deductStatus})`,
    deductAmount: toNumber(raw.deduct_amount),
  }
}

/** 归一单包下钻。 */
export function normalizeDetail(raw: RawRespackDetail, pack?: RespackPack): RespackDetail {
  return {
    name: toText(raw.respack_name, pack?.name ?? '未命名资源包'),
    unit: toText(raw.respack_unit, pack?.unit ?? ''),
    isCombo: raw.is_combo_item === true,
    description: toText(raw.description),
    itemCode: toText(raw.item_code),
    totalAmount: raw.total_amount === undefined ? (pack?.totalAmount ?? 0) : toNumber(raw.total_amount),
    usedAmount: raw.used_amount === undefined ? (pack?.usedAmount ?? 0) : toNumber(raw.used_amount),
    deductDetails: Array.isArray(raw.deduct_details)
      ? raw.deduct_details.map(normalizeDeductDetail)
      : [],
  }
}

/**
 * 资源包 API 客户端。
 *
 * 所有请求都经 `schedule` 入队，因此与用量请求共享同一个 ≥250ms 的全局限速队列。
 */
export class RespackClient {
  readonly #options: RespackClientOptions

  /**
   * @param options - 基地址、凭据、fetch 与限速入队函数。
   */
  constructor(options: RespackClientOptions) {
    this.#options = options
  }

  /** 发一次已签名的 GET 并返回 `data`。 */
  async #get(
    path: string,
    query: Iterable<readonly [string, string | number | undefined]>,
  ): Promise<unknown> {
    const { url, headers } = signQiniuRequest(this.#options.accessKey, this.#options.secretKey, {
      method: 'GET',
      baseUrl: this.#options.baseUrl,
      path,
      query,
    })

    return this.#options.schedule(() =>
      fetchUpstreamData({ url, method: 'GET', headers }, 'qiniu', {
        fetchImpl: this.#options.fetchImpl,
        ...(this.#options.sleepImpl === undefined ? {} : { sleepImpl: this.#options.sleepImpl }),
      }),
    )
  }

  /**
   * 循环取全部页，直到某一页不足一页（或达到 {@link MAX_PAGES}）。
   *
   * @param path - 接口路径。
   * @param extraQuery - 除分页外的额外参数。
   * @param warnings - 触顶时写入告警的容器。
   * @returns 全部条目。
   */
  async #getAllPages(
    path: string,
    extraQuery: readonly (readonly [string, string | number | undefined])[],
    warnings: Set<string>,
  ): Promise<unknown[]> {
    const all: unknown[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await this.#get(path, [
        ...extraQuery,
        ['page', page],
        ['page_size', MAX_PAGE_SIZE],
      ])
      if (!Array.isArray(data)) {
        // 单页接口（或形态变化）：直接把对象当唯一一页返回。
        return all.length === 0 && data !== undefined && data !== null ? [data] : all
      }
      all.push(...data)
      if (data.length < MAX_PAGE_SIZE) return all
    }
    warnings.add(`结果超过 ${MAX_PAGES} 页，仅展示前 ${MAX_PAGES * MAX_PAGE_SIZE} 条`)
    return all
  }

  /**
   * 取当月概览与逐包明细。
   *
   * @returns 归一快照。
   * @throws {QiniuUpstreamError} 鉴权/权限/业务错误。
   */
  async snapshot(): Promise<RespackSnapshot> {
    const warnings = new Set<string>()
    const nowMs = this.#options.now?.() ?? Date.now()

    const [monthRaw, listRaw] = await Promise.all([
      this.#getAllPages('/billing-api/v1/respack/month-overview', [], warnings),
      this.#getAllPages('/billing-api/v1/respack/list', [], warnings),
    ])

    const items = monthRaw
      .filter((entry): entry is RawRespackMonthItem => typeof entry === 'object' && entry !== null)
      .map(normalizeMonthItem)
      .sort((a, b) => b.monthUsed - a.monthUsed)

    const packages = listRaw
      .filter((entry): entry is RawRespackPack => typeof entry === 'object' && entry !== null)
      .map((entry) => normalizePack(entry, nowMs))
      // 使用中优先，其次按到期时间升序（快过期的排前面）。
      .sort((a, b) => {
        if (a.status !== b.status) return a.status - b.status
        return (a.daysRemaining ?? Number.POSITIVE_INFINITY) - (b.daysRemaining ?? Number.POSITIVE_INFINITY)
      })

    return {
      items,
      packages,
      fetchedAt: new Date(nowMs).toISOString(),
      warnings: [...warnings],
    }
  }

  /**
   * 单包下钻。
   *
   * @param orderHash - 订单唯一编号（取自 `list`）。
   * @param poId - 商品订单编号（取自 `list`）。
   * @param pack - 可选：已归一的包，用于补齐上游未返回的字段。
   * @returns 归一后的详情。
   * @throws {QiniuUpstreamError} 参数缺失、鉴权或业务错误。
   */
  async detail(orderHash: string, poId: number, pack?: RespackPack): Promise<RespackDetail> {
    if (orderHash === '') {
      throw new QiniuUpstreamError('缺少 order_hash 参数', { code: 1000 })
    }
    const data = await this.#get('/billing-api/v1/respack/detail', [
      ['order_hash', orderHash],
      ['po_id', poId],
    ])
    if (typeof data !== 'object' || data === null) {
      throw new QiniuUpstreamError('资源包详情返回了无法解析的数据', { code: 1011 })
    }
    return normalizeDetail(data as RawRespackDetail, pack)
  }
}
