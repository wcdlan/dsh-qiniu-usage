/**
 * 把侧栏速览卡片挂进 shell 的侧栏底部区域（Settings 行之上）。
 *
 * **为什么不走 slot**：侧栏底部只有一个扩展位 `sidebar.footer.action`，它是一条
 * `display:flex` 的行 —— 里面还坐着宿主自己的 cordis-panel 按钮，塞进去会和它抢
 * 同一行、把宿主按钮挤扁，也放不下整块卡片。所以这里按参考实现
 * （`@linxin666/dsh-usage` 的用量速览卡）同款做法，把容器**直接插进** shell 的
 * `footArea`（`settingsArea` 之前）。**不要**把 `sidebar.workspaces.directoryFlow`
 * 当成展示位：那是目录选择流的 hook 位，占用它会让左上角的「+」出现并把卡片渲染进
 * 工作区弹层里。
 *
 * 代价是依赖 shell 的类名（`sidebarCol` / `footArea` / `settingsArea`，都是 CSS
 * Modules 的哈希名，用 `[class*=…]` 子串匹配），所以配了一个自愈观察者：shell
 * 重渲染把容器挤掉之后，下一帧就把它放回去。
 *
 * 容器自带一个独立 React root（而不是塞进 shell 的 React 树），因此永远不会干扰
 * shell 自己的 reconciliation。
 *
 * @module dsh-qiniu-usage/client/sidebar-mount
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SidebarUsageCard, type SidebarUsageCardProps } from './SidebarUsageCard.tsx'

/** 容器上的稳定标识（自愈与幂等检查都靠它）。 */
export const SIDEBAR_CARD_ATTR = 'data-dsh-qiniu-usage-sidebar-card'

/** 容器选择器。 */
export const SIDEBAR_CARD_SELECTOR = `[${SIDEBAR_CARD_ATTR}]`

/** 挂载句柄：语言切换时用 `render` 换文案，卸载时 `dispose`。 */
export interface SidebarCardHandle {
  /** 用新的 props 重新渲染（不改容器位置）。 */
  render(props: SidebarUsageCardProps): void
  /** 卸载 React root、移除容器并断开观察者。 */
  dispose(): void
}

/** shell 的侧栏列（CSS Modules 哈希名，只能按子串匹配）。 */
function sidebarColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>('[class*="sidebarCol"]') ?? undefined
}

/** 侧栏底部区域：Footer 动作行 + Settings 行。 */
function footArea(): HTMLElement | undefined {
  return sidebarColumn()?.querySelector<HTMLElement>('[class*="footArea"]') ?? undefined
}

/**
 * 订阅"页面 DOM 变了"，每帧最多回调一次。
 *
 * 只看结构变化（`childList` + `subtree`），且**不留存** mutation 记录：回调里
 * 直接重新定位，不需要知道变了什么。没有 `MutationObserver` 时退化为 no-op
 * （容器就停在首次落位处）。
 *
 * @param place - 重新定位回调；必须可重复执行且幂等。
 * @returns 取消订阅的函数。
 */
function observePlacement(place: () => void): () => void {
  if (typeof MutationObserver !== 'function' || typeof document === 'undefined') {
    return () => {}
  }
  /** 已排队的帧；非空表示"这一帧已经安排过了"。 */
  let cancel: (() => void) | undefined
  const schedule = (): void => {
    if (cancel !== undefined) return
    if (typeof requestAnimationFrame === 'function') {
      const id = requestAnimationFrame(() => {
        cancel = undefined
        place()
      })
      cancel = () => cancelAnimationFrame(id)
    } else {
      const id = setTimeout(() => {
        cancel = undefined
        place()
      }, 16)
      cancel = () => clearTimeout(id)
    }
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    cancel?.()
    cancel = undefined
  }
}

/**
 * 挂载侧栏速览卡片。
 *
 * 找不到侧栏（首帧、或宿主布局变化）时不报错：容器先留在手上，等观察者下一帧
 * 再把它们对上。同一个页面里绝不会出现第二个容器（DOM 级幂等）。
 *
 * @param props - store 与翻译函数。
 * @returns 挂载句柄。
 */
export function mountSidebarCard(props: SidebarUsageCardProps): SidebarCardHandle {
  // DOM 级幂等：上一个 bundle 实例（客户端热重载）可能留下过容器，
  // 先清干净，保证整页只有一个侧栏卡片。
  for (const stale of Array.from(document.querySelectorAll(SIDEBAR_CARD_SELECTOR))) {
    stale.remove()
  }
  // 顺带清掉**旧版悬浮按钮**留下的宿主级容器：客户端热重载（不刷新页面）时它可能
  // 还挂在 body 上，不清就会新旧两个入口同时出现。
  for (const legacy of Array.from(document.querySelectorAll('div[data-dsh-qiniu-usage-root]'))) {
    legacy.remove()
  }
  const container = document.createElement('div')
  container.setAttribute(SIDEBAR_CARD_ATTR, '')
  const root: Root = createRoot(container)
  root.render(createElement(SidebarUsageCard, props))

  /**
   * 把容器放到 Settings 行之前的**任意位置**；已经在前面就什么也不做。
   *
   * ⚠ **判据只能是"排在 Settings 之前"，不能是"紧邻 Settings"**。参考实现
   * （`@linxin666/dsh-usage` 的用量速览卡）用的是"紧邻"：
   *
   * ```js
   * if (container.nextElementSibling !== settings) foot.insertBefore(container, settings)
   * ```
   *
   * 于是两张卡都在场时：我插到 Settings 前 → 它的下一兄弟变成了我、不是 Settings
   * → 它把自己挪到 Settings 前（排到我后面）→ 我的下一兄弟变成它、不是 Settings
   * → 我再挪……**两张卡从此每帧互推**。后果不只是位置抖：节点在 pointerdown 与
   * pointerup 之间被移动时，浏览器会把 click 派发到两者最近的共同祖先而不是按钮上，
   * 于是"点卡片没反应"——实测就是这样坏的。
   *
   * 只看"在 Settings 之前"就没有争抢：谁先来谁在前，双方都满意，DOM 稳定。
   */
  const place = (): void => {
    const foot = footArea()
    if (foot === undefined) return
    const settings = foot.querySelector<HTMLElement>('[class*="settingsArea"]')
    if (settings !== null) {
      const relative = container.compareDocumentPosition(settings)
      // DISCONNECTED 必须单独判：容器游离在 DOM 之外时规范允许结果里**同时**带上
      // FOLLOWING 位（jsdom 就会），只测 FOLLOWING 会让容器永远挂不上去。
      const attached = (relative & Node.DOCUMENT_POSITION_DISCONNECTED) === 0
      // FOLLOWING 位表示 settings 排在我后面 ⇒ 我已经在它前面了。
      if (attached && (relative & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return
      foot.insertBefore(container, settings)
      return
    }
    // 没有 Settings 落点（shell 改版）：退化成挂在尾部。
    if (foot.lastElementChild !== container) foot.append(container)
  }

  place()
  const stopObserving = observePlacement(place)

  return {
    render(next: SidebarUsageCardProps): void {
      root.render(createElement(SidebarUsageCard, next))
      // 重渲染不会动容器，但 shell 可能刚把它挤掉，顺手对一次。
      place()
    },
    dispose(): void {
      stopObserving()
      root.unmount()
      container.remove()
    },
  }
}
