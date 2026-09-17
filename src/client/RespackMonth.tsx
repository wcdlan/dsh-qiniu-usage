/**
 * 资源包当月口径：各计费项的可用 / 已用 / 剩余与利用率。
 *
 * 设计文档 §3.3 的**口径提醒**：`month-overview` 是**当月口径**，而逐包明细里的
 * `used_amount` 是**生命周期累计**。两者刻意分成两张卡片（见 {@link RespackPacks}），
 * 各自带口径徽标，避免用户把生命周期用量误读成当月用量。
 *
 * @module dsh-qiniu-usage/client/RespackMonth
 */

import { createElement, type ReactNode } from 'react'
import type { RespackSnapshot } from '../qiniu/respack.ts'
import { convertAmount, formatPercent } from './format.ts'
import { barFillStyle, barTone, cls } from './styles.ts'

/** 翻译函数签名。 */
type Translate = (key: string, params?: Record<string, unknown>) => string

/** 组件属性。 */
export interface RespackMonthProps {
  snapshot: RespackSnapshot
  t: Translate
}

/**
 * 当月利用率列表。
 *
 * @param props - 快照与翻译函数。
 * @returns 列表元素；没有当月计费项时给出空状态。
 */
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
