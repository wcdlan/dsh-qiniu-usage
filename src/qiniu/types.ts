/**
 * 上游原始响应类型。
 *
 * 大模型用量接口有**三种** `data` 形态（设计文档 §3.1），必须全部兼容：
 *
 * 1. Bearer 鉴权 → `data[] = models[]`
 * 2. AK/SK + RFC3339 → `data[] = { api_key, name, models[] }`
 * 3. AK/SK + `YYYY-MM-DD` → `data[] = models[]`，且 `items[].values[]` **无 categories 层**
 *
 * 类型名一律带 `Raw` 前缀，以区别于规范化后的模型。
 *
 * @module dsh-qiniu-usage/qiniu/types
 */

/** 一个时间桶。 */
export interface RawValue {
  /** ISO 时间戳。 */
  time?: string
  /** 该桶的数值。 */
  value?: number
}

/** 带 categories 层的 item（形态 1/2）。 */
export interface RawCategory {
  name?: string
  values?: RawValue[]
}

/** 一个计费项。`values` 与 `categories` 二者出现其一。 */
export interface RawItem {
  name?: string
  /** 单位，例如 `kToken`；**以它为准做换算**。 */
  unit?: string
  /** 区间汇总值。 */
  total?: number
  /** 形态 3 的扁平 values。 */
  values?: RawValue[]
  /** 形态 1/2 的 categories 层。 */
  categories?: RawCategory[]
}

/** 一个模型的用量。 */
export interface RawModel {
  /** 模型 id。 */
  id?: string
  /** 模型显示名。 */
  name?: string
  items?: RawItem[]
}

/** 形态 2 的每 Key 分组。 */
export interface RawKeyGroup {
  api_key?: string
  name?: string
  models?: RawModel[]
}

/** 用量接口 `data` 字段的三种可能形态。 */
export type RawUsageData = (RawModel | RawKeyGroup)[]

/** 用量查询参数。 */
export interface UsageQuery {
  /** `day` 或 `hour`。 */
  granularity: 'day' | 'hour'
  /** 起始时间（RFC3339，或 `day` 粒度下的 `YYYY-MM-DD`）。 */
  start: string
  /** 结束时间。 */
  end: string
  /** IANA 时区名。 */
  timezone: string
  /** 可选的单 Key 过滤；**本设计不依赖它**（语义未验证），默认不传。 */
  apiKey?: string
}

/** 鉴权方式。 */
export type UsageAuthKind = 'bearer' | 'aksk'

// --- 资源包（M2） -----------------------------------------------------------

/** `month-overview` 的一行：某计费项在某区域的当月口径。 */
export interface RawRespackMonthItem {
  item_name?: string
  zone_name?: string
  available_time?: string
  /** 当月可用总量（含结转）。 */
  total_surplus?: number
  /** 当月已用。 */
  month_used?: number
  /** 当月剩余。 */
  month_remain?: number
  respack_unit?: string
}

/** `list` 的一个资源包。 */
export interface RawRespackPack {
  respack_name?: string
  /** 1 未使用 / 2 使用中 / 3 已用完 / 4 已过期。 */
  status?: number
  effective_start?: string
  effective_end?: string
  /** 0 按月可结转 / 1 按月不可结转 / 2 一次性。 */
  carry_over_policy?: number
  /** 生命周期总量。 */
  total_amount?: number
  /** 生命周期已用（注意与 month-overview 的当月口径不同）。 */
  used_amount?: number
  respack_unit?: string
  data_update_time?: string
  order_hash?: string
  po_id?: number
}

/** `detail` 的一条抵扣明细。 */
export interface RawRespackDeductDetail {
  deduct_date?: string
  deduct_status?: number
  deduct_amount?: number
}

/** `detail` 的单包下钻。 */
export interface RawRespackDetail {
  is_combo_item?: boolean
  description?: string
  deduct_details?: RawRespackDeductDetail[]
  item_code?: string
  respack_name?: string
  respack_unit?: string
  total_amount?: number
  used_amount?: number
  status?: number
  effective_start?: string
  effective_end?: string
}
