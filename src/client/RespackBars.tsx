/**
 * 资源包利用情况：当月利用率进度条 + 逐包已用/到期 + 按需下钻。
 *
 * 设计文档 §9.2 与 §3.3 的**口径提醒**：`month-overview` 是当月口径，
 * `list` 的 `used_amount` 是资源包**生命周期累计**。两者都展示时必须分别标注，
 * 否则用户会把生命周期用量误读成当月用量。
 *
 * @module dsh-qiniu-usage/client/RespackBars
 */

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import type { RespackDetail, RespackSnapshot } from '../qiniu/respack.ts'
import { formatAmount, formatMonthDay, formatPercent } from './format.ts'
import {
  badgeStyle,
  barFillStyle,
  barTrackStyle,
  buttonStyle,
  captionStyle,
  emptyStyle,
  mutedStyle,
  sectionTitleStyle,
  tableStyle,
  tdNumericStyle,
  tdStyle,
  thNumericStyle,
  thStyle,
} from './styles.ts'

/** 翻译函数签名。 */
type Translate = (key: string, params?: Record<string, unknown>) => string

/** 组件属性。 */
export interface RespackBarsProps {
  snapshot: RespackSnapshot
  /** 已缓存的下钻结果。 */
  details: Record<string, RespackDetail>
  /** 请求下钻。 */
  onLoadDetail: (orderHash: string, poId: number) => void
  t: Translate
}

/** 利用率条的颜色档位：>90% 危险，>75% 警告。 */
function utilizationTone(fraction: number): 'normal' | 'warn' | 'danger' {
  if (fraction >= 0.9) return 'danger'
  if (fraction >= 0.75) return 'warn'
  return 'normal'
}

/** 到期文案：优先"还有 N 天"，已过期/无到期时间各有分支。 */
function expiryText(
  pack: RespackSnapshot['packages'][number],
  t: Translate,
): string {
  if (pack.effectiveEnd === '') return ''
  if (pack.daysRemaining === undefined) return t('qiniu.respack.expiresOn', { date: pack.effectiveEnd })
  if (pack.daysRemaining < 0) return t('qiniu.respack.expired')
  return t('qiniu.respack.expires', { days: pack.daysRemaining })
}

/** 下钻明细表。 */
function renderDetail(detail: RespackDetail | undefined, t: Translate): ReactNode {
  if (detail === undefined) {
    return createElement('div', { style: { ...mutedStyle, padding: '4px 0' } }, t('qiniu.respack.detail.loading'))
  }
  if (detail.deductDetails.length === 0) {
    return createElement('div', { style: { ...mutedStyle, padding: '4px 0' } }, t('qiniu.respack.detail.none'))
  }
  return createElement(
    'table',
    { style: { ...tableStyle, marginTop: '4px' } },
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        createElement('th', { style: thStyle }, t('qiniu.respack.detail.deductDate')),
        createElement('th', { style: thStyle }, t('qiniu.respack.detail.deductStatus')),
        createElement('th', { style: thNumericStyle }, `${t('qiniu.respack.detail.deductAmount')} (${detail.unit})`),
      ),
    ),
    createElement(
      'tbody',
      null,
      ...detail.deductDetails.map((row, index) =>
        createElement(
          'tr',
          { key: `${row.deductDate}-${index}` },
          createElement('td', { style: tdStyle }, formatMonthDay(row.deductDate)),
          createElement('td', { style: { ...tdStyle, ...mutedStyle } as CSSProperties }, row.deductStatusLabel),
          createElement('td', { style: tdNumericStyle }, formatAmount(row.deductAmount, '')),
        ),
      ),
    ),
  )
}

/**
 * 资源包面板。
 *
 * @param props - 快照、下钻缓存、下钻回调与翻译函数。
 * @returns 面板元素；没有资源包时给出空状态。
 */
export function RespackBars({ snapshot, details, onLoadDetail, t }: RespackBarsProps): ReactNode {
  const [openPacks, setOpenPacks] = useState<Record<string, boolean>>({})

  if (snapshot.items.length === 0 && snapshot.packages.length === 0) {
    return createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      createElement('h4', { style: sectionTitleStyle }, t('qiniu.respack.heading')),
      createElement('div', { style: emptyStyle }, t('qiniu.empty.noRespack')),
    )
  }

  const toggle = (key: string, orderHash: string, poId: number): void => {
    const next = openPacks[key] !== true
    setOpenPacks((current) => ({ ...current, [key]: next }))
    if (next) onLoadDetail(orderHash, poId)
  }

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    createElement(
      'h4',
      { style: sectionTitleStyle },
      t('qiniu.respack.heading'),
      ' ',
      createElement('span', { style: badgeStyle }, t('qiniu.respack.monthScope')),
    ),

    // 当月利用率：每个计费项一条。
    ...snapshot.items.map((item) =>
      createElement(
        'div',
        { key: `${item.itemName}-${item.zoneName}`, style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        createElement(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
          createElement('span', { style: { fontWeight: 500 } }, item.itemName),
          item.zoneName === '' ? null : createElement('span', { style: mutedStyle }, item.zoneName),
          createElement('span', { style: { flex: '1 1 auto' } }),
          createElement('span', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 } }, formatPercent(item.utilization)),
        ),
        createElement(
          'div',
          { style: barTrackStyle },
          createElement('div', {
            style: barFillStyle(item.utilization, utilizationTone(item.utilization)),
          }),
        ),
        createElement(
          'div',
          { style: mutedStyle },
          `${t('qiniu.respack.capacity')} ${formatAmount(item.monthCapacity, item.unit)} · `
          + `${t('qiniu.respack.used')} ${formatAmount(item.monthUsed, item.unit)} · `
          + `${t('qiniu.respack.remain')} ${formatAmount(item.monthRemain, item.unit)}`,
        ),
      ),
    ),

    // 逐包明细：生命周期口径，单独标注。
    snapshot.packages.length > 0
      ? createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' } },
          createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
            createElement('span', { style: sectionTitleStyle }, t('qiniu.respack.packs')),
            createElement('span', { style: badgeStyle }, t('qiniu.respack.packLifecycle')),
          ),
          ...snapshot.packages.map((pack) => {
            const key = `${pack.orderHash}:${pack.poId}`
            const isOpen = openPacks[key] === true
            const detail = details[key]
            return createElement(
              'div',
              { key, style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
              createElement(
                'div',
                { style: { display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' } },
                createElement('span', { style: { fontWeight: 500 } }, pack.name),
                createElement('span', { style: badgeStyle }, pack.statusLabel),
                createElement('span', { style: { flex: '1 1 auto' } }),
                createElement(
                  'span',
                  { style: { fontVariantNumeric: 'tabular-nums' } },
                  `${formatAmount(pack.usedAmount, pack.unit)} / ${formatAmount(pack.totalAmount, pack.unit)}`
                  + ` (${formatPercent(pack.utilization)})`,
                ),
              ),
              createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                createElement(
                  'div',
                  { style: { ...barTrackStyle, flex: '1 1 auto' } },
                  createElement('div', { style: barFillStyle(pack.utilization, 'normal') }),
                ),
                createElement('span', { style: mutedStyle }, expiryText(pack, t)),
                pack.carryOverLabel === '' ? null : createElement('span', { style: badgeStyle }, pack.carryOverLabel),
                createElement(
                  'button',
                  {
                    type: 'button',
                    style: buttonStyle,
                    onClick: () => toggle(key, pack.orderHash, pack.poId),
                  },
                  t('qiniu.respack.detail'),
                ),
              ),
              isOpen ? renderDetail(detail, t) : null,
            )
          }),
          createElement('div', { style: captionStyle }, t('qiniu.respack.scopeHint')),
        )
      : null,
  )
}
