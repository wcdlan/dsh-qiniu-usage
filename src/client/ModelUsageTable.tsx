/**
 * 各模型用量表。
 *
 * 布局决定（本次改版重点）：
 *
 * - **CSS Grid 四列**：名字（内含占比条）| 输入 | 输出 | 合计。三个数字列固定宽并
 *   右对齐、启用 `tabular-nums`，跨行数位对齐。
 * - 占比条放在**名字下方**而不是单独一列：面板内容宽约 548px，单独一列会把模型名
 *   挤到必须省略；名字是主标识，优先保它。条贴在名字下面也让归属关系更明确。
 * - 缓存/其他计费项的明细放在悬停提示里（该提示本来就列出每个原始计费项），
 *   表格本身保持单行高、行距一致。
 * - 超过 20 行折叠为"其余 N 个模型合计"。
 *
 * @module dsh-qiniu-usage/client/ModelUsageTable
 */

import { createElement, useState, type ReactNode } from 'react'
import type { UsageModel } from '../qiniu/usage.ts'
import { formatPercent, formatTokens, truncate } from './format.ts'
import { barFillStyle, cls } from './styles.ts'

/** 超过这个行数就折叠。 */
const COLLAPSE_THRESHOLD = 20

/** 翻译函数签名。 */
type Translate = (key: string, params?: Record<string, unknown>) => string

/** 组件属性。 */
export interface ModelUsageTableProps {
  models: UsageModel[]
  /** 全部模型合计，用于计算每行占比。 */
  grandTotal: number
  t: Translate
}

/** 模型行：名字 + 占比条 + 输入/输出/合计。 */
function renderRow(model: UsageModel, grandTotal: number, t: Translate): ReactNode {
  const fraction = grandTotal > 0 ? model.total / grandTotal : 0
  const cachedRead = model.totalsByKind.cachedInput
  const cachedWrite = model.totalsByKind.cachedWrite
  const other = model.totalsByKind.other

  // 悬停提示给出原始值与单位，便于与官方控制台对数（设计文档 §6.1）。
  const rawDetail = model.items
    .map((item) => `${item.name}: ${item.totalRaw} ${item.unit}`)
    .join('\n')

  // 缓存/其他计费项并入悬停提示，避免为次要信息挤掉模型名的宽度。
  const extras: string[] = []
  if (cachedRead > 0) extras.push(`${t('qiniu.usage.cachedInput')} ${formatTokens(cachedRead)}`)
  if (cachedWrite > 0) extras.push(`${t('qiniu.usage.cachedWrite')} ${formatTokens(cachedWrite)}`)
  if (other > 0) extras.push(`${t('qiniu.usage.other')} ${formatTokens(other)}`)
  const tooltip = [rawDetail, extras.join(' · ')].filter((part) => part !== '').join('\n')

  return createElement(
    'div',
    { className: cls.row, key: model.id },
    createElement(
      'div',
      { className: cls.model, title: tooltip === '' ? model.id : tooltip },
      createElement('span', { className: cls.modelName }, truncate(model.name, 48)),
      createElement(
        'div',
        { className: cls.modelBar },
        createElement('div', { className: cls.modelBarFill, style: barFillStyle(fraction) }),
      ),
    ),
    createElement('div', { className: cls.num }, formatTokens(model.totalsByKind.input)),
    createElement('div', { className: cls.num }, formatTokens(model.totalsByKind.output)),
    createElement('div', { className: `${cls.num} ${cls.numStrong}` }, formatTokens(model.total)),
  )
}

/** 折叠摘要行：跨越全部列。 */
function renderSummaryRow(hiddenCount: number, hiddenTotal: number, t: Translate): ReactNode {
  return createElement(
    'div',
    { className: cls.row, key: '__more__' },
    createElement(
      'div',
      { className: cls.muted, style: { gridColumn: '1 / -1', fontSize: '11.5px' } },
      t('qiniu.usage.more', { count: hiddenCount, total: formatTokens(hiddenTotal) }),
    ),
  )
}

/**
 * 模型用量表。
 *
 * @param props - 模型列表、总用量与翻译函数。
 * @returns 表格元素。
 */
export function ModelUsageTable({ models, grandTotal, t }: ModelUsageTableProps): ReactNode {
  const [expanded, setExpanded] = useState(false)

  const needsCollapse = models.length > COLLAPSE_THRESHOLD
  const visible = needsCollapse && !expanded ? models.slice(0, COLLAPSE_THRESHOLD) : models
  const hidden = needsCollapse && !expanded ? models.slice(COLLAPSE_THRESHOLD) : []
  const hiddenTotal = hidden.reduce((sum, model) => sum + model.total, 0)

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    createElement(
      'div',
      { className: cls.table },
      createElement(
        'div',
        { className: cls.tableHead },
        createElement('div', null, t('qiniu.usage.model')),
        createElement('div', null, t('qiniu.usage.input')),
        createElement('div', null, t('qiniu.usage.output')),
        createElement('div', null, t('qiniu.usage.total')),
      ),
      ...visible.map((model) => renderRow(model, grandTotal, t)),
      ...(hidden.length > 0 ? [renderSummaryRow(hidden.length, hiddenTotal, t)] : []),
    ),
    needsCollapse
      ? createElement(
          'button',
          {
            type: 'button',
            className: `${cls.btn} ${cls.btnGhost}`,
            style: { alignSelf: 'flex-start' },
            onClick: () => setExpanded((value) => !value),
          },
          expanded
            ? t('qiniu.usage.collapse')
            : t('qiniu.usage.expand', { count: models.length }),
        )
      : null,
    createElement(
      'div',
      { className: cls.muted, style: { fontSize: '11px' } },
      t('qiniu.usage.unitHint'),
    ),
  )
}
