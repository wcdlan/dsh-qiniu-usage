// 逐包明细是生命周期累计口径，与 RespackMonth 的当月口径不同（见 DESIGN.md §3.3），单独一卡并带口径徽标。
import {createElement, type ReactNode, useState} from 'react'
import type {RespackDetail, RespackSnapshot} from '../qiniu/respack.ts'
import {convertAmount, formatAmountPair, formatMonthDay, formatPercent} from './format.ts'
import {barFillStyle, barTone, cls} from './styles.ts'

type Translate = (key: string, params?: Record<string, unknown>) => string

export interface RespackPacksProps {
  snapshot: RespackSnapshot
    // 键为 `orderHash:poId`。
  details: Record<string, RespackDetail>
  onLoadDetail: (orderHash: string, poId: number) => void
  t: Translate
}

function expiryText(pack: RespackSnapshot['packages'][number], t: Translate): string {
  if (pack.effectiveEnd === '') return ''
  if (pack.daysRemaining === undefined) {
    return t('qiniu.respack.expiresOn', { date: pack.effectiveEnd })
  }
  if (pack.daysRemaining < 0) return t('qiniu.respack.expired')
  return t('qiniu.respack.expires', { days: pack.daysRemaining })
}

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
