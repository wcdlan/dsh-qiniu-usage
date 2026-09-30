// 占比条放在名字下方而非单独一列：面板内容宽约 548px，单独一列会把模型名挤到必须省略。
import {createElement, type ReactNode, useState} from 'react'
import type {UsageModel} from '../qiniu/usage.ts'
import {formatTokens, truncate} from './format.ts'
import {barFillStyle, cls} from './styles.ts'

const COLLAPSE_THRESHOLD = 20

type Translate = (key: string, params?: Record<string, unknown>) => string

export interface ModelUsageTableProps {
  models: UsageModel[]
  grandTotal: number
  t: Translate
}

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
