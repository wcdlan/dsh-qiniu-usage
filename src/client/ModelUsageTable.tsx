/**
 * 各模型用量表：条形图 + 输入/输出/合计。
 *
 * 设计文档 §9.2 / §6.1：默认展示全部，超过 20 行折叠为"其余 N 个模型合计"。
 *
 * @module dsh-qiniu-usage/client/ModelUsageTable
 */

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import type { UsageModel } from '../qiniu/usage.ts'
import { formatPercent, formatTokens, truncate } from './format.ts'
import {
  barFillStyle,
  barTrackStyle,
  buttonStyle,
  captionStyle,
  mutedStyle,
  sectionTitleStyle,
  tableStyle,
  tdNumericStyle,
  tdStyle,
  thNumericStyle,
  thStyle,
} from './styles.ts'

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

/** 单行：模型名 + 占比条 + 三个数字。 */
function renderRow(model: UsageModel, grandTotal: number, t: Translate, key: string): ReactNode {
  const fraction = grandTotal > 0 ? model.total / grandTotal : 0
  const cachedRead = model.totalsByKind.cachedInput
  const cachedWrite = model.totalsByKind.cachedWrite
  const other = model.totalsByKind.other

  // 悬停提示里给出原始值，便于与官方控制台对数（设计文档 §6.1）。
  const rawDetail = model.items
    .map((item) => `${item.name}: ${item.totalRaw} ${item.unit}`)
    .join('\n')

  const extras: string[] = []
  if (cachedRead > 0) extras.push(`${t('qiniu.usage.cachedInput')} ${formatTokens(cachedRead)}`)
  if (cachedWrite > 0) extras.push(`${t('qiniu.usage.cachedWrite')} ${formatTokens(cachedWrite)}`)
  if (other > 0) extras.push(`${t('qiniu.usage.other')} ${formatTokens(other)}`)

  return createElement(
    'tr',
    { key },
    createElement(
      'td',
      { style: tdStyle, title: rawDetail === '' ? model.id : rawDetail },
      createElement('div', { style: { fontWeight: 500 } }, truncate(model.name)),
      extras.length > 0
        ? createElement('div', { style: captionStyle }, extras.join(' · '))
        : null,
    ),
    createElement(
      'td',
      { style: { ...tdStyle, width: '34%' } },
      createElement(
        'div',
        { style: barTrackStyle, title: formatPercent(fraction) },
        createElement('div', { style: barFillStyle(fraction, 'normal') }),
      ),
    ),
    createElement('td', { style: tdNumericStyle }, formatTokens(model.totalsByKind.input)),
    createElement('td', { style: tdNumericStyle }, formatTokens(model.totalsByKind.output)),
    createElement('td', { style: { ...tdNumericStyle, fontWeight: 600 } }, formatTokens(model.total)),
  )
}

/** 折叠摘要行。 */
function renderSummaryRow(
  hiddenCount: number,
  hiddenTotal: number,
  t: Translate,
): ReactNode {
  return createElement(
    'tr',
    { key: '__more__' },
    createElement(
      'td',
      { style: { ...tdStyle, ...mutedStyle } as CSSProperties, colSpan: 5 },
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
    { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    createElement('h4', { style: sectionTitleStyle }, t('qiniu.usage.heading')),
    createElement(
      'table',
      { style: tableStyle },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          createElement('th', { style: thStyle }, t('qiniu.usage.model')),
          createElement('th', { style: thStyle }, ''),
          createElement('th', { style: thNumericStyle }, t('qiniu.usage.input')),
          createElement('th', { style: thNumericStyle }, t('qiniu.usage.output')),
          createElement('th', { style: thNumericStyle }, t('qiniu.usage.total')),
        ),
      ),
      createElement(
        'tbody',
        null,
        ...visible.map((model) => renderRow(model, grandTotal, t, model.id)),
        ...(hidden.length > 0 ? [renderSummaryRow(hidden.length, hiddenTotal, t)] : []),
      ),
    ),
    needsCollapse
      ? createElement(
          'button',
          {
            type: 'button',
            style: { ...buttonStyle, alignSelf: 'flex-start' },
            onClick: () => setExpanded((value) => !value),
          },
          expanded
            ? t('qiniu.usage.collapse')
            : t('qiniu.usage.expand', { count: models.length }),
        )
      : null,
    createElement('div', { style: captionStyle }, t('qiniu.usage.unitHint')),
  )
}
