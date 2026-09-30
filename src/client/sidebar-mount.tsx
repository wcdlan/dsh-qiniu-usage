// 把侧栏速览卡片挂进 shell 的侧栏底部区域（Settings 行之上）。
// 不走 slot：侧栏底部唯一扩展位 `sidebar.footer.action` 是 flex 行，和宿主 cordis-panel
// 按钮抢同一行、放不下整块卡片，所以直接插进 shell 的 footArea（Settings 行之前）。
// 不要占用 `sidebar.workspaces.directoryFlow`（目录选择流的 hook 位，会把卡片渲进工作区弹层）。

import {createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {SidebarUsageCard, type SidebarUsageCardProps} from './SidebarUsageCard.tsx'

/** 容器稳定标识（自愈与幂等检查靠它）。 */
export const SIDEBAR_CARD_ATTR = 'data-dsh-qiniu-usage-sidebar-card'

export const SIDEBAR_CARD_SELECTOR = `[${SIDEBAR_CARD_ATTR}]`

export interface SidebarCardHandle {
  render(props: SidebarUsageCardProps): void
  dispose(): void
}

// shell 的侧栏列（CSS Modules 哈希名，只能按子串匹配）。
function sidebarColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>('[class*="sidebarCol"]') ?? undefined
}

/** 侧栏底部区域：Footer 动作行 + Settings 行。 */
function footArea(): HTMLElement | undefined {
  return sidebarColumn()?.querySelector<HTMLElement>('[class*="footArea"]') ?? undefined
}

/** 订阅"页面 DOM 变了"，每帧最多回调一次；只看结构变化、不留存 mutation 记录。 */
function observePlacement(place: () => void): () => void {
  if (typeof MutationObserver !== 'function' || typeof document === 'undefined') {
    return () => {}
  }
    // 已排队的帧；非空表示"这一帧已经安排过了"。
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

// 挂载侧栏速览卡片。找不到侧栏时不报错：容器留在手上，等观察者下一帧对上；容器自带独立
// React root，不会干扰 shell 的 reconciliation。
export function mountSidebarCard(props: SidebarUsageCardProps): SidebarCardHandle {
    // DOM 级幂等：热重载可能留下过容器，先清干净，保证整页只有一个侧栏卡片。
  for (const stale of Array.from(document.querySelectorAll(SIDEBAR_CARD_SELECTOR))) {
    stale.remove()
  }
    // 清掉旧版悬浮按钮留下的宿主级容器，否则热重载后会新旧两个入口同时出现。
  for (const legacy of Array.from(document.querySelectorAll('div[data-dsh-qiniu-usage-root]'))) {
    legacy.remove()
  }
  const container = document.createElement('div')
  container.setAttribute(SIDEBAR_CARD_ATTR, '')
  const root: Root = createRoot(container)
  root.render(createElement(SidebarUsageCard, props))

  /**
   * 把容器放到 Settings 行之前的任意位置；已在前面则不动。
   * 判据只能是「排在 Settings 之前」，不能是「紧邻」—— 后者在两卡共存时会每帧互推，
   * 使节点在 pointerdown/up 之间被移动、click 派发到共同祖先，表现为「点卡片没反应」。
   */
  const place = (): void => {
    const foot = footArea()
    if (foot === undefined) return
    const settings = foot.querySelector<HTMLElement>('[class*="settingsArea"]')
    if (settings !== null) {
      const relative = container.compareDocumentPosition(settings)
        // DISCONNECTED 必须单独判：容器游离时规范允许同时带上 FOLLOWING 位（jsdom 就会）。
      const attached = (relative & Node.DOCUMENT_POSITION_DISCONNECTED) === 0
        // FOLLOWING 位 ⇒ settings 排在我后面 ⇒ 我已经在它前面了。
      if (attached && (relative & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return
      foot.insertBefore(container, settings)
      return
    }
      // 没有 Settings 落点（shell 改版）时退化成挂在尾部。
    if (foot.lastElementChild !== container) foot.append(container)
  }

  place()
  const stopObserving = observePlacement(place)

  return {
    render(next: SidebarUsageCardProps): void {
      root.render(createElement(SidebarUsageCard, next))
        // 重渲染不动容器，但 shell 可能刚把它挤掉，顺手对一次。
      place()
    },
    dispose(): void {
      stopObserving()
      root.unmount()
      container.remove()
    },
  }
}
