/**
 * 资源包利用情况：当月利用率 + 逐包已用/到期 + 按需下钻。
 *
 * 设计文档 §9.2 与 §3.3 的**口径提醒**：`month-overview` 是当月口径，
 * `list` 的 `used_amount` 是资源包**生命周期累计**。两者都展示时必须分别标注，
 * 否则用户会把生命周期用量误读成当月用量 —— 两个区块各自带徽标。
 *
 * 布局决定（本次改版重点）：
 *
 * - 逐包**每一行加分隔线 + 上下留白**。原先条形图满宽且包与包之间没有分隔，
 *   视觉上会"串"到下一个包，让人以为条形属于下面的名字。
 * - 数量与百分比收进标题行右侧，用 `tabular-nums` 对齐；条形与到期信息、下钻按钮
 *   同处第二行，形成稳定的两行节奏。
 * - 已用完的包整体降透明度，而不是把 0 值藏起来。
 *
 * @module dsh-qiniu-usage/client/RespackBars
 */

import { createElement, useState, type ReactNode } from 'react'
import type { RespackDetail, RespackSnapshot } from '../qiniu/respack.ts'
import { convertAmount, formatAmountPair, formatMonthDay, formatPercent } from './format.ts'
import { barFillStyle, barTone, cls } from './styles.ts'

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
 * 资源包面板。
 *
 * @param props - 快照、下钻缓存、下钻回调与翻译函数。
 * @returns 面板元素；没有资源包时给出空状态。
 */
export function RespackBars({ snapshot, details, onLoadDetail, t }: RespackBarsProps): ReactNode {
  const [openPacks, setOpenPacks] = useState<Record<string, boolean>>({})

  if (snapshot.items.length === 0 && snapshot.packages.length === 0) {
    return createElement('div', { className: cls.empty }, t('qiniu.empty.noRespack'))
  }

  const toggle = (key: string, orderHash: string, poId: number): void => {
    const next = openPacks[key] !== true
    setOpenPacks((current) => ({ ...current, [key]: next }))
    if (next) onLoadDetail(orderHash, poId)
  }

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },

    // 当月口径
    snapshot.items.length > 0
      ? createElement(
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
      : null,

    // 生命周期口径：逐包
    snapshot.packages.length > 0
      ? createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          createElement(
            'div',
            { className: cls.subhead },
            createElement('span', { className: cls.subheadTitle }, t('qiniu.respack.packs')),
            createElement('span', { className: cls.badge }, t('qiniu.respack.packLifecycle')),
          ),
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
                    createElement(
                      'span',
                      null,
                      formatAmountPair(pack.usedAmount, pack.totalAmount, pack.unit),
                    ),
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
      : null,
  )
}
