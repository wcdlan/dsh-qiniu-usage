/**
 * 面板样式。
 *
 * 两条硬约束（来自设计文档 §9.3）：
 *
 * 1. **只用宿主主题 token**（`--dsw-alias-*`），不引 UI 库、不引 Tailwind，
 *    保持与现有设置页一致。因此不做自定义字体/配色/图像。
 * 2. 宿主 token 缺失时每个变量都带兜底值，退化为可读的默认色而不是全白/全黑。
 *
 * 为什么用 CSS 类而不是内联样式：`hover` / `active` / `focus-visible` 与过渡
 * 无法用内联样式表达，而焦点环是无障碍要求（不能省）。所有类名以 `dsh-qiniu-`
 * 前缀隔离，避免与宿主样式碰撞。
 *
 * 间距节奏统一走 4px 基准：2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20。
 *
 * @module dsh-qiniu-usage/client/styles
 */

/** 类名前缀（也是 keyframes 前缀）。 */
const NS = 'dsh-qiniu'

/** 组件里用到的类名常量（避免字符串散落各处）。 */
export const cls = {
  panel: `${NS}-panel`,
  head: `${NS}-head`,
  title: `${NS}-title`,
  subtitle: `${NS}-subtitle`,
  toolbar: `${NS}-toolbar`,
  field: `${NS}-field`,
  label: `${NS}-label`,
  select: `${NS}-select`,
  btn: `${NS}-btn`,
  btnGhost: `${NS}-btn-ghost`,
  input: `${NS}-input`,
  card: `${NS}-card`,
  cardHead: `${NS}-card-head`,
  cardTitle: `${NS}-card-title`,
  cardNote: `${NS}-card-note`,
  subhead: `${NS}-subhead`,
  subheadTitle: `${NS}-subhead-title`,
  badge: `${NS}-badge`,
  badgeSoft: `${NS}-badge-soft`,
  badgeInactive: `${NS}-badge-inactive`,
  token: `${NS}-token`,
  table: `${NS}-table`,
  tableHead: `${NS}-table-head`,
  row: `${NS}-row`,
  model: `${NS}-model`,
  modelName: `${NS}-model-name`,
  modelBar: `${NS}-model-bar`,
  modelBarFill: `${NS}-model-bar-fill`,
  num: `${NS}-num`,
  numStrong: `${NS}-num-strong`,
  muted: `${NS}-muted`,
  bar: `${NS}-bar`,
  barFill: `${NS}-bar-fill`,
  items: `${NS}-items`,
  item: `${NS}-item`,
  itemHead: `${NS}-item-head`,
  itemName: `${NS}-item-name`,
  packsGroup: `${NS}-packs-group`,
  packs: `${NS}-packs`,
  packPercent: `${NS}-pack-percent`,
  pack: `${NS}-pack`,
  packDone: `${NS}-pack-done`,
  packHead: `${NS}-pack-head`,
  packName: `${NS}-pack-name`,
  packFigures: `${NS}-pack-figures`,
  packRow: `${NS}-pack-row`,
  packBar: `${NS}-pack-bar`,
  packMeta: `${NS}-pack-meta`,
  callout: `${NS}-callout`,
  calloutWarn: `${NS}-callout-warn`,
  calloutError: `${NS}-callout-error`,
  empty: `${NS}-empty`,
  skeleton: `${NS}-skeleton`,
  skelLine: `${NS}-skel-line`,
  progress: `${NS}-progress`,
  credRow: `${NS}-cred-row`,
  credHead: `${NS}-cred-head`,
  credName: `${NS}-cred-name`,
  credStatus: `${NS}-cred-status`,
  credInputRow: `${NS}-cred-input-row`,
  detail: `${NS}-detail`,
  detailTable: `${NS}-detail-table`,
  warnList: `${NS}-warn-list`,

  // 对话页悬浮按钮与弹层
  fabRoot: `${NS}-fab-root`,
  fab: `${NS}-fab`,
  fabIcon: `${NS}-fab-icon`,
  fabTotal: `${NS}-fab-total`,
  popup: `${NS}-popup`,
  popupHead: `${NS}-popup-head`,
  popupTitle: `${NS}-popup-title`,
  popupBody: `${NS}-popup-body`,
  popupFoot: `${NS}-popup-foot`,
} as const

/** 主题 token 的简写读取（每个都带兜底值）。 */
const v = (name: string, fallback: string): string => `var(--dsw-alias-${name}, ${fallback})`

/**
 * 面板全部样式。
 *
 * 由面板根节点渲染一个 `<style>` 注入；类名带包前缀，重复注入是幂等的。
 */
export const PANEL_CSS = `
.${cls.panel} {
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 13px;
  line-height: 1.55;
  color: ${v('label-primary', 'inherit')};
}

/* ── 面板头 ─────────────────────────────────────────── */
.${cls.head} { display: flex; flex-direction: column; gap: 3px; }
.${cls.title} { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .01em; }
.${cls.subtitle} {
  font-size: 12px;
  color: ${v('label-tertiary', 'rgba(128,128,128,.9)')};
  text-wrap: pretty;
}

/* ── 工具条 ─────────────────────────────────────────── */
.${cls.toolbar} { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.${cls.field} { display: inline-flex; align-items: center; gap: 6px; }
.${cls.label} { font-size: 11.5px; color: ${v('label-tertiary', 'rgba(128,128,128,.9)')}; }

.${cls.select} {
  font: inherit;
  font-size: 12px;
  height: 26px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid ${v('border-l2', 'rgba(128,128,128,.35)')};
  background: ${v('bg-layer-1', 'transparent')};
  color: ${v('label-primary', 'inherit')};
  max-width: 200px;
  transition: border-color .16s ease, background-color .16s ease;
}
.${cls.select}:hover { border-color: ${v('border-l3', 'rgba(128,128,128,.5)')}; }
.${cls.select}:focus-visible {
  outline: 2px solid ${v('brand-primary', '#4c8dff')};
  outline-offset: 1px;
}

.${cls.btn} {
  font: inherit;
  font-size: 12px;
  height: 26px;
  padding: 0 11px;
  border-radius: 7px;
  border: 1px solid ${v('border-l2', 'rgba(128,128,128,.35)')};
  background: ${v('bg-layer-1', 'transparent')};
  color: ${v('label-primary', 'inherit')};
  cursor: pointer;
  transition: background-color .16s ease, border-color .16s ease, transform .08s ease;
}
.${cls.btn}:hover:not(:disabled) { background: ${v('interactive-bg-hover', 'rgba(128,128,128,.14)')}; }
.${cls.btn}:active:not(:disabled) { transform: translateY(.5px); }
.${cls.btn}:focus-visible { outline: 2px solid ${v('brand-primary', '#4c8dff')}; outline-offset: 1px; }
.${cls.btn}:disabled { opacity: .5; cursor: default; }

.${cls.btnGhost} {
  border-color: transparent;
  background: transparent;
  color: ${v('label-secondary', 'rgba(128,128,128,.95)')};
  padding: 0 8px;
}
.${cls.btnGhost}:hover:not(:disabled) { background: ${v('interactive-bg-hover', 'rgba(128,128,128,.14)')}; }

/* ── 卡片 ───────────────────────────────────────────── */
.${cls.card} {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 15px;
  border: 1px solid ${v('border-l1', 'rgba(128,128,128,.22)')};
  border-radius: 10px;
  background: ${v('bg-layer-1', 'transparent')};
}
.${cls.cardHead} { display: flex; align-items: center; gap: 8px; }
.${cls.cardTitle} { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .01em; }
.${cls.cardNote} {
  margin-left: auto;
  font-size: 11px;
  color: ${v('label-caption', 'rgba(128,128,128,.8)')};
  font-variant-numeric: tabular-nums;
}
.${cls.subhead} { display: flex; align-items: center; gap: 8px; }
.${cls.subheadTitle} { font-size: 12px; font-weight: 600; color: ${v('label-secondary', 'rgba(128,128,128,.95)')}; }
.${cls.muted} { color: ${v('label-tertiary', 'rgba(128,128,128,.9)')}; }

/* ── 徽标 ───────────────────────────────────────────── */
.${cls.badge} {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 5px;
  border: 1px solid ${v('border-l2', 'rgba(128,128,128,.35)')};
  font-size: 10.5px;
  line-height: 1;
  color: ${v('label-secondary', 'rgba(128,128,128,.95)')};
  white-space: nowrap;
}
.${cls.badgeSoft} { border-color: transparent; background: ${v('bg-layer-3', 'rgba(128,128,128,.16)')}; }
/* 已用完 / 已过期：填充式徽标，与"使用中"的描边式区分 */
.${cls.badgeInactive} { border-color: transparent; background: ${v('bg-layer-3', 'rgba(128,128,128,.16)')}; color: ${v('label-tertiary', 'rgba(128,128,128,.9)')}; }
.${cls.token} {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 5px;
  background: ${v('bg-layer-3', 'rgba(128,128,128,.16)')};
  color: ${v('label-secondary', 'rgba(128,128,128,.95)')};
}

/* ── 用量表：CSS Grid 定列，数字右对齐且等宽 ───────────── */
.${cls.table} { display: flex; flex-direction: column; }
/* 4 列：名字（内含占比条）| 输入 | 输出 | 合计。
   面板内容宽约 548px，5 列会把模型名挤到必须省略 —— 名字是主标识，优先保它。
   占比条移到名字下方，既省一列又让"条属于哪个模型"一目了然。 */
.${cls.tableHead},
.${cls.row} {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px 72px 82px;
  align-items: center;
  gap: 12px;
}
.${cls.tableHead} {
  padding-bottom: 6px;
  border-bottom: 1px solid ${v('border-l1', 'rgba(128,128,128,.22)')};
  font-size: 11.5px;
  color: ${v('label-tertiary', 'rgba(128,128,128,.9)')};
}
.${cls.tableHead} > :not(:first-child) { text-align: right; }

.${cls.row} {
  padding: 8px 0;
  border-bottom: 1px solid ${v('border-l1', 'rgba(128,128,128,.16)')};
}
.${cls.row}:last-child { border-bottom: none; padding-bottom: 2px; }

/* 名字 + 占比条堆叠；名字是主标识，绝不为次要信息让位而被截断 */
.${cls.model} { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.${cls.modelName} {
  font-size: 12.5px;
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 行内占比条：贴在名字下方，宽度随名字列自适应 */
.${cls.modelBar} { height: 4px; border-radius: 999px; background: ${v('bg-layer-3', 'rgba(128,128,128,.16)')}; overflow: hidden; }
.${cls.modelBarFill} { height: 100%; border-radius: 999px; transition: width .2s ease; }

.${cls.num} {
  font-size: 12.5px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.${cls.numStrong} { font-weight: 600; }

/* 条形图：固定宽度列，不再是撑满剩余空间的"浮岛" */
.${cls.bar} {
  height: 6px;
  border-radius: 999px;
  background: ${v('bg-layer-3', 'rgba(128,128,128,.16)')};
  overflow: hidden;
}
.${cls.barFill} { height: 100%; border-radius: 999px; transition: width .2s ease; }

/* ── 资源包：当月口径 ───────────────────────────────── */
.${cls.items} { display: flex; flex-direction: column; gap: 16px; }
.${cls.item} { display: flex; flex-direction: column; gap: 5px; }
.${cls.itemHead} { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.${cls.itemName} { font-size: 12.5px; font-weight: 500; min-width: 0; text-wrap: pretty; }

/* ── 资源包：逐包。行间加分隔线，避免条形图像是"串"到下一个包 */
/* 逐包区块：与上方"当月口径"之间加分隔线，强调口径不同（设计文档 §3.3 的提醒） */
.${cls.packsGroup} {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid ${v('border-l2', 'rgba(128,128,128,.35)')};
}
.${cls.packs} { display: flex; flex-direction: column; }
.${cls.pack} {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 0;
  border-top: 1px solid ${v('border-l1', 'rgba(128,128,128,.16)')};
}
.${cls.pack}:first-child { border-top: none; padding-top: 2px; }
.${cls.pack}:last-child { padding-bottom: 2px; }
.${cls.packDone} { opacity: .72; }

.${cls.packHead} { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.${cls.packName} { font-size: 12.5px; font-weight: 500; min-width: 0; text-wrap: pretty; }
.${cls.packFigures} {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 10px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
}
/* 百分比定宽右对齐，使各行形成一列（跨行可比较） */
.${cls.packPercent} { min-width: 38px; text-align: right; font-weight: 600; }
.${cls.packRow} { display: flex; align-items: center; gap: 10px; }
.${cls.packBar} { flex: 1 1 auto; min-width: 110px; }
.${cls.packMeta} {
  font-size: 11px;
  color: ${v('label-caption', 'rgba(128,128,128,.8)')};
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ── 提示条 / 空状态 / 骨架 ─────────────────────────── */
.${cls.callout} {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid ${v('border-l2', 'rgba(128,128,128,.35)')};
  background: ${v('bg-layer-2', 'transparent')};
  font-size: 12px;
}
.${cls.calloutWarn} { border-color: ${v('state-warn-primary', '#e0a03a')}; }
.${cls.calloutError} { border-color: ${v('state-error-primary', '#f0635f')}; }
.${cls.callout} strong { font-weight: 600; }

.${cls.empty} {
  padding: 18px 16px;
  border: 1px dashed ${v('border-l2', 'rgba(128,128,128,.35)')};
  border-radius: 8px;
  text-align: center;
  font-size: 12px;
  color: ${v('label-tertiary', 'rgba(128,128,128,.9)')};
  text-wrap: pretty;
}

.${cls.skeleton} { display: flex; flex-direction: column; gap: 10px; }
.${cls.skelLine} {
  height: 10px;
  border-radius: 5px;
  background: ${v('bg-layer-3', 'rgba(128,128,128,.16)')};
  animation: ${NS}-pulse 1.4s ease-in-out infinite;
}

/* 顶部细进度条：刷新时保留旧数据，不闪空 */
.${cls.progress} {
  height: 2px;
  border-radius: 999px;
  background: ${v('state-business-primary', '#4c8dff')};
  animation: ${NS}-pulse 1.2s ease-in-out infinite;
}

/* ── 凭据：键名只读 + 值输入框两层 ──────────────────── */
.${cls.credRow} { display: flex; flex-direction: column; gap: 6px; }
.${cls.credHead} { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.${cls.credName} { font-size: 12.5px; font-weight: 500; }
.${cls.credStatus} { margin-left: auto; font-size: 11px; color: ${v('label-caption', 'rgba(128,128,128,.8)')}; }
.${cls.credInputRow} { display: flex; align-items: center; gap: 8px; }

.${cls.input} {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: 12px;
  height: 28px;
  padding: 0 9px;
  border-radius: 7px;
  border: 1px solid ${v('border-l2', 'rgba(128,128,128,.35)')};
  background: ${v('bg-base', 'transparent')};
  color: ${v('label-primary', 'inherit')};
  transition: border-color .16s ease;
}
.${cls.input}:hover:not(:disabled) { border-color: ${v('border-l3', 'rgba(128,128,128,.5)')}; }
.${cls.input}:focus-visible { outline: 2px solid ${v('brand-primary', '#4c8dff')}; outline-offset: 1px; }
.${cls.input}:disabled { opacity: .55; cursor: default; }

/* ── 下钻明细 ───────────────────────────────────────── */
.${cls.detail} { padding: 2px 0 4px; }
.${cls.detailTable} { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.${cls.detailTable} th {
  text-align: left;
  font-weight: 500;
  color: ${v('label-tertiary', 'rgba(128,128,128,.9)')};
  padding: 0 8px 5px 0;
}
.${cls.detailTable} td { padding: 3px 8px 3px 0; }
.${cls.detailTable} th:last-child,
.${cls.detailTable} td:last-child { text-align: right; padding-right: 0; }
.${cls.detailTable} td:last-child { font-variant-numeric: tabular-nums; }

/* ── 告警清单 ───────────────────────────────────────── */
.${cls.warnList} { display: flex; flex-direction: column; gap: 3px; }

/* ── 对话页悬浮按钮与弹层 ───────────────────────────────
   宿主级浮动 UI：挂在 document.body 的独立 React root 上（不走 slot），
   因为新会话页没有 session，slot 化会在那里消失。见 FloatingUsage。 */
.${cls.fabRoot} {
  position: fixed;
  right: 20px;
  bottom: 88px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  /* 宿主级图层；不拦截下层交互（仅按钮与弹层自身可点） */
  pointer-events: none;
}
.${cls.fabRoot} > * { pointer-events: auto; }

.${cls.fab} {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 13px;
  border-radius: 999px;
  border: 1px solid ${v('border-l2', 'rgba(128,128,128,.35)')};
  /* 宿自带的浮动按钮底色，保证与原生浮动控件一致 */
  background: ${v('button-floating-fill', v('bg-layer-1', '#1d1d22'))};
  color: ${v('label-primary', 'inherit')};
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .28);
  transition: background-color .16s ease, transform .08s ease;
}
.${cls.fab}:hover { background: ${v('button-floating-hover', v('interactive-bg-hover', 'rgba(128,128,128,.16)'))}; }
.${cls.fab}:active { transform: translateY(.5px); }
.${cls.fab}:focus-visible { outline: 2px solid ${v('brand-primary', '#4c8dff')}; outline-offset: 2px; }
.${cls.fabIcon} { display: block; flex: 0 0 auto; opacity: .85; }
.${cls.fabTotal} { font-variant-numeric: tabular-nums; font-weight: 600; }

.${cls.popup} {
  /* 460px 时模型名会被截断（数字列占了固定宽度）；520px 够放下常见模型 id */
  width: min(520px, calc(100vw - 40px));
  max-height: min(68vh, 640px);
  overflow: auto;
  padding: 14px 16px 16px;
  border-radius: 12px;
  border: 1px solid ${v('border-l2', 'rgba(128,128,128,.35)')};
  background: ${v('bg-overlay', v('bg-layer-1', '#1d1d22'))};
  box-shadow: 0 10px 30px rgba(0, 0, 0, .34);
  color: ${v('label-primary', 'inherit')};
  animation: ${NS}-pop 140ms ease-out;
  overscroll-behavior: contain;
}
.${cls.popupHead} {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid ${v('border-l1', 'rgba(128,128,128,.22)')};
}
.${cls.popupTitle} { margin: 0; font-size: 13px; font-weight: 600; }
.${cls.popupBody} { display: flex; flex-direction: column; gap: 14px; }
.${cls.popupFoot} {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid ${v('border-l1', 'rgba(128,128,128,.22)')};
  font-size: 11px;
  color: ${v('label-caption', 'rgba(128,128,128,.8)')};
}

@keyframes ${NS}-pulse {
  0%, 100% { opacity: .45; }
  50% { opacity: .9; }
}

@keyframes ${NS}-pop {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
`

/**
 * 利用率条的颜色档位：≥90% 危险、≥75% 警告，其余用业务色。
 *
 * @param fraction - 0..1 的利用率。
 * @returns 颜色档位。
 */
export function barTone(fraction: number): 'normal' | 'warn' | 'danger' {
  if (fraction >= 0.9) return 'danger'
  if (fraction >= 0.75) return 'warn'
  return 'normal'
}

/**
 * 条形填充的内联样式（宽度是动态值，只能内联）。
 *
 * @param fraction - 0..1 的占比。
 * @param tone - 颜色档位。
 * @returns 内联样式对象。
 */
export function barFillStyle(
  fraction: number,
  tone: 'normal' | 'warn' | 'danger' = 'normal',
): { width: string; background: string } {
  const clamped = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1)
  // 极小占比也留 3px 可见宽度，否则 1% 的条看起来像"没有数据"。
  const width = clamped <= 0 ? '0%' : `max(${(clamped * 100).toFixed(2)}%, 3px)`
  const color = tone === 'danger'
    ? v('state-error-primary', '#f0635f')
    : tone === 'warn'
      ? v('state-warn-primary', '#e0a03a')
      : v('state-business-primary', '#4c8dff')
  return { width, background: color }
}
