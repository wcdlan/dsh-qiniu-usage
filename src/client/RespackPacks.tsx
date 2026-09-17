/**
 * 资源包逐包明细：生命周期累计已用 / 总量、到期时间、按需下钻抵扣明细。
 *
 * 这是**生命周期口径**，与 {@link RespackMonth} 的当月口径是两回事，因此单独一张卡片
 * 并带自己的口径徽标（设计文档 §3.3 的提醒）。
 *
 * 布局：每行两段 —— 标题行（名称 + 状态徽标 + 已用/总量 + 百分比），明细行
 * （条形 + 到期/分配方式 + 下钻按钮）。包与包之间加分隔线，避免满宽条形图在视觉上
 * "串"到下一个包。已用完/已过期的包整体降透明度，而不是把 0 值藏起来。
 *
 * @module dsh-qiniu-usage/client/RespackPacks
 */

import { createElement, useState, type ReactNode } from 'react'
import type { RespackDetail, RespackSnapshot } from '../qiniu/respack.ts'
import { convertAmount, formatAmountPair, formatMonthDay, formatPercent } from './format.ts'
import { barFillStyle, barTone, cls } from './styles.ts'

/** 翻译函数签名。 */
type Translate = (key: string, params?: Record<string, unknown>) => string

/** 组件属性。 */
export interface RespackPacksProps {
  snapshot: RespackSnapshot
  /** 已缓存的下钻结果，键为 `orderHash:poId`。 */
  details: Record<string, RespackDetail>
  /** 请求下钻。 */
  onLoadDetail: (orderHash: string, poId: number) => void
  t: Translate
}

/** 到期文案：优先"还有 N 天"，已过期/无到期时间各有分支。 */
function expiryText(pack: RespackSnapshot['packages'][number], t: Translate): string {
  if (pack.effectiveEnd === '') return ''
  if (pack.daysRemaining === undefined) {
    return t('qiniu.respack.expiresOn', { date: pack.effectiveEnd })
  }
  if (pack.daysRemaining < 0) return t('qiniu.respack.expired')
  return t('qiniu.respack.expires', { days: pack.daysRemaining })
}

/** 下钻明细表。 */
function renderDetail(detail: RespackDetail | undefined, t: Translate): ReactNode {
  if (detail === undefined) {
    return createElement(
      'div',
      { className: `${cls.detail} ${cls.muted}`, style: { fontSize: '11.5px' } },
      t('qiniu.respack.detail.loading'),
    )
  }
  if (detail.deductDetails.length === 0) {
    return createElement(
      'div',
      { className: `${cls.detail} ${cls.muted}`, style: { fontSize: '11.5px' } },
      t('qiniu.respack.detail.none'),
    )
  }

  return createElement(
    'div',
    { className: cls.detail },
    createElement(
      'table',
      { className: cls.detailTable },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          createElement('th', null, t('qiniu.respack.detail.deductDate')),
          createElement('th', null, t('qiniu.respack.detail.deductStatus')),
          createElement(
            'th',
            null,
            `${t('qiniu.respack.detail.deductAmount')}${detail.unit === '' ? '' : ` (${detail.unit})`}`,
          ),
        ),
      ),
      createElement(
        'tbody',
        null,
        ...detail.deductDetails.map((row, index) =>
          createElement(
            'tr',
            { key: `${row.deductDate}-${index}` },
            createElement('td', null, formatMonthDay(row.deductDate)),
            createElement('td', { className: cls.muted }, row.deductStatusLabel),
            createElement('td', null, convertAmount(row.deductAmount, detail.unit).text),
          ),
        ),
      ),
    ),
  )
}

/**
 * 逐包明细列表。
 *
 * @param props - 快照、下钻缓存、下钻回调与翻译函数。
 * @returns 列表元素；没有资源包时给出空状态。
 */
export function RespackPacks({ snapshot, details, onLoadDetail, t }: RespackPacksProps): ReactNode {
  const [openPacks, setOpenPacks] = useState<Record<string, boolean>>({})

  if (snapshot.packages.length === 0) {
    return createElement('div', { className: cls.empty }, t('qiniu.empty.noRespack'))
  }

  const toggle = (key: string, orderHash: string, poId: number): void => {
    const next = openPacks[key] !== true
    setOpenPacks((current) => ({ ...current, [key]: next }))
    if (next) onLoadDetail(orderHash, poId)
  }

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    createElement(
      'div',
      { className: cls.packs },
      ...snapshot.packages.map((pack) => {
        const key = `${pack.orderHash}:${pack.poId}`
        const isOpen = openPacks[key] === true
        const detail = details[key]
        const done = pack.status === 3 || pack.utilization >= 1
        const expiry = expiryText(pack, t)

        return createElement(
          'div',
          { key, className: done ? `${cls.pack} ${cls.packDone}` : cls.pack },
          createElement(
            'div',
            { className: cls.packHead },
            createElement('span', { className: cls.packName }, pack.name),
            createElement(
              'span',
              { className: done ? `${cls.badge} ${cls.badgeInactive}` : cls.badge },
              pack.statusLabel,
            ),
            createElement(
              'span',
              { className: cls.packFigures },
              createElement('span', null, formatAmountPair(pack.usedAmount, pack.totalAmount, pack.unit)),
              createElement(
                'span',
                { className: `${cls.num} ${cls.packPercent}` },
                formatPercent(pack.utilization),
              ),
            ),
          ),
          createElement(
            'div',
            { className: cls.packRow },
            createElement(
              'div',
              { className: `${cls.bar} ${cls.packBar}` },
              createElement('div', {
                className: cls.barFill,
                style: barFillStyle(pack.utilization, barTone(pack.utilization)),
              }),
            ),
            createElement(
              'span',
              { className: cls.packMeta },
              [expiry, pack.carryOverLabel].filter((part) => part !== '').join(' · '),
            ),
            createElement(
              'button',
              {
                type: 'button',
                className: `${cls.btn} ${cls.btnGhost}`,
                onClick: () => toggle(key, pack.orderHash, pack.poId),
              },
              t('qiniu.respack.detail'),
            ),
          ),
          isOpen ? renderDetail(detail, t) : null,
        )
      }),
    ),
    createElement(
      'div',
      { className: cls.muted, style: { fontSize: '11px' } },
      t('qiniu.respack.scopeHint'),
    ),
  )
}
