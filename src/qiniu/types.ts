// 大模型用量接口有三种 `data` 形态（设计文档 §3.1），必须全部兼容。

export interface RawValue {
  time?: string
  value?: number
}

/** 形态 1/2 才有 categories 层。 */
export interface RawCategory {
  name?: string
  values?: RawValue[]
}

/** `values` 与 `categories` 二者出现其一。 */
export interface RawItem {
  name?: string
  /** 单位，例如 `kToken`；**以它为准做换算**。 */
  unit?: string
  total?: number
  /** 形态 3 的扁平 values。 */
  values?: RawValue[]
  categories?: RawCategory[]
}

export interface RawModel {
  id?: string
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

export interface UsageQuery {
  granularity: 'day' | 'hour'
    /** RFC3339，或 `day` 粒度下的 `YYYY-MM-DD`。 */
  start: string
  end: string
  timezone: string
    /** 本设计不依赖它（语义未验证），默认不传。 */
  apiKey?: string
}

export type UsageAuthKind = 'bearer' | 'aksk'

/** 某计费项在某区域的当月口径。 */
export interface RawRespackMonthItem {
  item_name?: string
  zone_name?: string
  available_time?: string
  /** 当月可用总量（含结转）。 */
  total_surplus?: number
  month_used?: number
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

export interface RawRespackDeductDetail {
  deduct_date?: string
  deduct_status?: number
  deduct_amount?: number
}

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
