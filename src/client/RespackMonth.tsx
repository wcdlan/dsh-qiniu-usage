// 当月口径（month-overview）：与逐包明细的生命周期累计口径刻意分成两张卡（见 DESIGN.md §3.3）。
import {createElement, type ReactNode} from 'react'
import type {RespackSnapshot} from '../qiniu/respack.ts'
import {convertAmount, formatPercent} from './format.ts'
import {barFillStyle, barTone, cls} from './styles.ts'

type Translate = (key: string, params?: Record<string, unknown>) => string

export interface RespackMonthProps {
  snapshot: RespackSnapshot
  t: Translate
}

export function RespackMonth({ snapshot, t }: RespackMonthProps): ReactNode {
  if (snapshot.items.length === 0) {
    return createElement('div', { className: cls.empty }, t('qiniu.empty.noRespack'))
  }

  return createElement(
    'div',
    { className: cls.items },
    ...snapshot.items.map((item) => {
      const capacity = convertAmount(item.monthCapacity, item.unit)
      const used = convertAmount(item.monthUsed, item.unit)
      const remain = convertAmount(item.monthRemain, item.unit)
      const label = capacity.unitLabel
      return createElement(
        'div',
        { key: `${item.itemName}-${item.zoneName}`, className: cls.item },
        createElement(
          'div',
          { className: cls.itemHead },
          createElement('span', { className: cls.itemName }, item.itemName),
          item.zoneName === ''
            ? null
            : createElement(
                'span',
                { className: `${cls.badge} ${cls.badgeSoft}` },
                item.zoneName,
              ),
          createElement(
            'span',
            { className: `${cls.num} ${cls.numStrong}`, style: { marginLeft: 'auto' } },
            formatPercent(item.utilization),
          ),
        ),
        createElement(
          'div',
          { className: cls.bar },
          createElement('div', {
            className: cls.barFill,
            style: barFillStyle(item.utilization, barTone(item.utilization)),
          }),
        ),
        createElement(
          'div',
          { className: cls.packMeta },
          `${t('qiniu.respack.capacity')} ${capacity.text} · `
          + `${t('qiniu.respack.used')} ${used.text} · `
          + `${t('qiniu.respack.remain')} ${remain.text}`
          + (label === '' ? '' : ` ${label}`),
        ),
      )
    }),
  )
}
