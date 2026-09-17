/**
 * 面板共享样式。
 *
 * 只用宿主主题 token（`--dsw-alias-*`），不引 UI 库、不引 Tailwind —— 与现有设置页
 * 保持一致。每个 token 都带兜底值，这样在 token 名变化时退化为可读的默认色而不是
 * 全白/全黑。
 *
 * @module dsh-qiniu-usage/client/styles
 */

import type { CSSProperties } from 'react'

/** 颜色 token 的简写读取。 */
const token = (name: string, fallback: string): string => `var(--dsw-alias-${name}, ${fallback})`

/** 面板根容器。 */
export const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  fontSize: '13px',
  color: token('label-primary', 'inherit'),
}

/** 分区标题。 */
export const sectionTitleStyle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: token('label-primary', 'inherit'),
  margin: 0,
}

/** 次要文本。 */
export const mutedStyle: CSSProperties = {
  color: token('label-tertiary', 'rgba(128,128,128,0.9)'),
  fontSize: '12px',
}

/** 说明性小字。 */
export const captionStyle: CSSProperties = {
  color: token('label-caption', 'rgba(128,128,128,0.8)'),
  fontSize: '11px',
}

/** 工具条：靠左的一组选择器。 */
export const toolbarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px',
}

/** 工具条右侧推到底。 */
export const toolbarSpacerStyle: CSSProperties = { flex: '1 1 auto' }

/** 原生 select 的统一外观。 */
export const selectStyle: CSSProperties = {
  fontSize: '12px',
  padding: '3px 6px',
  borderRadius: '6px',
  border: `1px solid ${token('border-l2', 'rgba(128,128,128,0.35)')}`,
  background: token('bg-layer-1', 'transparent'),
  color: token('label-primary', 'inherit'),
  maxWidth: '200px',
}

/** 按钮。 */
export const buttonStyle: CSSProperties = {
  fontSize: '12px',
  padding: '3px 10px',
  borderRadius: '6px',
  border: `1px solid ${token('border-l2', 'rgba(128,128,128,0.35)')}`,
  background: token('bg-layer-1', 'transparent'),
  color: token('label-primary', 'inherit'),
  cursor: 'pointer',
}

/** 禁用的按钮。 */
export const buttonDisabledStyle: CSSProperties = {
  ...buttonStyle,
  opacity: 0.5,
  cursor: 'default',
}

/** 分区卡片。 */
export const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: `1px solid ${token('border-l1', 'rgba(128,128,128,0.25)')}`,
  background: token('bg-layer-1', 'transparent'),
}

/** 顶部细进度条（刷新时保留旧数据，不闪空）。 */
export const progressBarStyle: CSSProperties = {
  height: '2px',
  borderRadius: '1px',
  background: token('state-business-primary', '#3b82f6'),
  opacity: 0.8,
  animation: 'dsh-qiniu-usage-pulse 1.2s ease-in-out infinite',
}

/** 行内条形图轨道。 */
export const barTrackStyle: CSSProperties = {
  position: 'relative',
  height: '6px',
  borderRadius: '3px',
  background: token('bg-layer-3', 'rgba(128,128,128,0.18)'),
  overflow: 'hidden',
  minWidth: '80px',
}

/** 行内条形图填充。 */
export function barFillStyle(fraction: number, tone: 'normal' | 'warn' | 'danger'): CSSProperties {
  const color = tone === 'danger'
    ? token('state-error-primary', '#ef4444')
    : tone === 'warn'
      ? token('state-warn-primary', '#f59e0b')
      : token('state-business-primary', '#3b82f6')
  return {
    position: 'absolute',
    inset: 0,
    width: `${Math.min(Math.max(fraction, 0), 1) * 100}%`,
    background: color,
    borderRadius: '3px',
  }
}

/** 表格。 */
export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '12px',
}

/** 表头单元格。 */
export const thStyle: CSSProperties = {
  textAlign: 'left',
  fontWeight: 500,
  color: token('label-tertiary', 'rgba(128,128,128,0.9)'),
  padding: '2px 6px 4px 0',
  whiteSpace: 'nowrap',
}

/** 数字列右对齐。 */
export const thNumericStyle: CSSProperties = { ...thStyle, textAlign: 'right' }

/** 表体单元格。 */
export const tdStyle: CSSProperties = {
  padding: '3px 6px 3px 0',
  verticalAlign: 'middle',
  color: token('label-primary', 'inherit'),
}

/** 数字列右对齐。 */
export const tdNumericStyle: CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}

/** 错误提示。 */
export const errorStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '8px 10px',
  borderRadius: '6px',
  border: `1px solid ${token('state-error-primary', '#ef4444')}`,
  color: token('label-primary', 'inherit'),
  background: token('bg-layer-2', 'transparent'),
  fontSize: '12px',
}

/** 告警提示。 */
export const warnStyle: CSSProperties = {
  ...errorStyle,
  border: `1px solid ${token('state-warn-primary', '#f59e0b')}`,
}

/** 空状态。 */
export const emptyStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: '6px',
  border: `1px dashed ${token('border-l2', 'rgba(128,128,128,0.35)')}`,
  color: token('label-tertiary', 'rgba(128,128,128,0.9)'),
  fontSize: '12px',
  textAlign: 'center',
}

/** 骨架屏一行。 */
export const skeletonStyle: CSSProperties = {
  height: '10px',
  borderRadius: '4px',
  background: token('bg-layer-3', 'rgba(128,128,128,0.18)'),
  animation: 'dsh-qiniu-usage-pulse 1.2s ease-in-out infinite',
}

/** 徽标（状态、口径标注）。 */
export const badgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: '4px',
  fontSize: '10px',
  lineHeight: '16px',
  border: `1px solid ${token('border-l2', 'rgba(128,128,128,0.35)')}`,
  color: token('label-secondary', 'rgba(128,128,128,0.95)'),
  whiteSpace: 'nowrap',
}

/**
 * 本面板用到的 keyframes。
 *
 * 宿主 shell 里可能已存在同名 keyframes，所以名字带包前缀避免碰撞。
 * React 不支持在组件里直接声明 keyframes，因此通过一次性的 `<style>` 注入。
 */
export const KEYFRAMES = `@keyframes dsh-qiniu-usage-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
}`
