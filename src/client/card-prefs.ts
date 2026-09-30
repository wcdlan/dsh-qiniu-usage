// 侧栏卡片的展示偏好（持久化在 `localStorage`）。单独成模块是为了让偏好读写成为
// 可单测的纯逻辑。隐私模式下 `localStorage` 会直接抛错，所有读写都必须吞异常并退回
// 默认值 —— 卡片绝不能因为存不了偏好就渲染不出来。

// 展开状态的存储键（`'1'` = 展开）。
export const CARD_EXPANDED_KEY = 'dsh-qiniu-usage:sidebar-card:expanded'

// 默认**收起**：侧栏是常驻区域，首屏塞进一堆模型行会挤压会话列表；收起时的一行速览
// 已够"瞟一眼"。
export function readCardExpanded(): boolean {
  try {
    return window.localStorage.getItem(CARD_EXPANDED_KEY) === '1'
  } catch {
    // 存储不可用（隐私模式 / 沙箱）：保持默认的收起态。
    return false
  }
}

export function writeCardExpanded(expanded: boolean): void {
  try {
    window.localStorage.setItem(CARD_EXPANDED_KEY, expanded ? '1' : '0')
  } catch {
    // 存储不可用：本次会话内状态照常翻转，只是下次打开回到默认。
  }
}
