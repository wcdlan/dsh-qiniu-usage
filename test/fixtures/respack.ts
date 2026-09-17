/**
 * 资源包 fixture —— 覆盖 month-overview / list / detail 三个接口。
 *
 * 字段名对着官方文档（2025-09-10 版）逐个核对过。
 *
 * @module dsh-qiniu-usage/test/fixtures/respack
 */

/** 当月概览的一页（默认 20 条一页时不足一页，触发"取完"判定）。 */
export const monthOverviewPage = [
  {
    item_name: 'CDN加速通用计费项',
    zone_name: '中国大陆',
    available_time: '全时段',
    total_surplus: 5120,
    month_used: 0,
    month_remain: 5120,
    respack_unit: 'GB',
  },
  {
    item_name: 'AI大模型融合资源包',
    zone_name: '中国大陆',
    available_time: '全时段',
    total_surplus: 100,
    month_used: 68,
    month_remain: 32,
    respack_unit: 'GB',
  },
]

/** 资源包列表的一页。 */
export const respackListPage = [
  {
    respack_name: '国内 HTTPS 10GB 动态加速闲时包年',
    effective_start: '2020-08-11T04:05:14+08:00',
    effective_end: '2026-08-11T04:05:14+08:00',
    carry_over_policy: 2,
    status: 4,
    total_amount: 10,
    used_amount: 0,
    respack_unit: 'GB',
    data_update_time: '2022-08-11T04:05:14+08:00',
    order_hash: '65abb4569ce66c6592571824d8492666',
    po_id: 524913,
  },
  {
    respack_name: '中国大陆全时段加速流量5TB',
    effective_start: '2024-01-01T00:00:00+08:00',
    effective_end: '2027-01-01T00:00:00+08:00',
    carry_over_policy: 1,
    status: 2,
    total_amount: 5120,
    used_amount: 1280,
    respack_unit: 'GB',
    data_update_time: '2026-01-01T00:00:00+08:00',
    order_hash: 'f9cefba946e0b547a72abb4a9d4acc3c',
    po_id: 1,
  },
]

/** 单包下钻。注意官方示例把 deduct_amount 写成了字符串里带数字（且 JSON 语法有误），
 *  这里刻意用**字符串**形态来验证解析容错。 */
export const respackDetailMixedTypes = {
  respack_name: '中国大陆全时段加速流量5TB',
  effective_start: '2024-01-01T00:00:00+08:00',
  effective_end: '2027-01-01T00:00:00+08:00',
  carry_over_policy: 1,
  status: 2,
  total_amount: 5120,
  used_amount: 1280,
  respack_unit: 'GB',
  is_combo_item: true,
  description: '全站加速DCDN-HTTP 流量、全站加速DCDN-HTTPS 流量，抵扣系数为1:1.15',
  item_code: 'fusion:dyn:transfer:https',
  deduct_details: [
    // deduct_amount 为字符串（官方文档标注类型为 string）
    { deduct_date: '2026-01-01T00:00:00+08:00', deduct_status: 2, deduct_amount: '1024' },
    // deduct_amount 为数字（官方示例实际写的是数字）
    { deduct_date: '2025-12-01T00:00:00+08:00', deduct_status: 1, deduct_amount: 256 },
  ],
}

/** 分页场景：第一页满 200 条，第二页不足，用于验证循环取页。 */
export function makeFullPage(count: number, offset = 0): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    item_name: `计费项-${offset + index}`,
    zone_name: '中国大陆',
    available_time: '全时段',
    total_surplus: 1000,
    month_used: 100,
    month_remain: 900,
    respack_unit: 'GB',
  }))
}
