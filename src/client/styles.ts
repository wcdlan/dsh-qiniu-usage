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

  // 设置页里的自检
  formRow: `${NS}-form-row`,
  dangerText: `${NS}-danger-text`,
  keyTable: `${NS}-key-table`,
  keyRow: `${NS}-key-row`,
  keyRowActive: `${NS}-key-row-active`,
  keyHead: `${NS}-key-head`,
  keyCell: `${NS}-key-cell`,
  keyMasked: `${NS}-key-masked`,

  // 侧栏卡片（左侧列表下方）
  sideCard: `${NS}-side-card`,
  sideCardMain: `${NS}-side-main`,
  sideBody: `${NS}-side-body`,
  sideStrip: `${NS}-side-strip`,
  sideStripLabel: `${NS}-side-strip-label`,
  sideStripValue: `${NS}-side-strip-value`,
  sideTitle: `${NS}-side-title`,
  sideHead: `${NS}-side-head`,
  sideValue: `${NS}-side-value`,
  sideToggle: `${NS}-side-toggle`,
  sideIcon: `${NS}-side-icon`,
  sideNote: `${NS}-side-note`,
  sideModels: `${NS}-side-models`,
  sideModel: `${NS}-side-model`,
  sideModelRow: `${NS}-side-model-row`,
  sideModelName: `${NS}-side-model-name`,
  sideModelValue: `${NS}-side-model-value`,
  sideModelBar: `${NS}-side-model-bar`,
  sideModelFill: `${NS}-side-model-fill`,
  sideMore: `${NS}-side-more`,
  sideActions: `${NS}-side-actions`,
  sideMeta: `${NS}-side-meta`,
  sideError: `${NS}-side-error`,

  // 详情弹窗
  overlay: `${NS}-overlay`,
  tabBar: `${NS}-tab-bar`,
  tab: `${NS}-tab`,
  tabActive: `${NS}-tab-active`,
  dialog: `${NS}-dialog`,
  dialogHead: `${NS}-dialog-head`,
  dialogTitle: `${NS}-dialog-title`,
  dialogBody: `${NS}-dialog-body`,
  dialogFoot: `${NS}-dialog-foot`,
} as const

/** 主题 token 的简写读取（每个都带兜底值）。 */
const v = (name: string, fallback: string): string => `var(--dsw-alias-${name}, ${fallback})`

/**
 * 面板全部样式（**注入 DOM 前先剥掉注释**）。
 *
 * 注释只服务于源码阅读：它们会随 `<style>` 进入 DOM，既白占字节，又会让
 * "界面上有没有这段文案"这类断言被注释里的词误伤（真踩过：「详情」只出现在
 * 注释里，却让"收起态不该有详情按钮"的用例红了）。
 */
const RAW_CSS = `
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
.${cls.select}:disabled {
  opacity: .55;
  cursor: not-allowed;
  border-color: ${v('border-l1', 'rgba(128,128,128,.22)')};
}
.${cls.select}:disabled:hover { border-color: ${v('border-l1', 'rgba(128,128,128,.22)')}; }
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

/* ── 设置页里的表单行 ───────────────────────────────── */
.${cls.formRow} {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.${cls.dangerText} { color: ${v('state-error-primary', '#f0635f')}; font-weight: 600; }

/* Key 表格：名称 + 掩码 + 当日状态，只做展示。 */
.${cls.keyTable} {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  overflow: auto;
  border: 1px solid ${v('border-l1', 'rgba(128,128,128,.22)')};
  border-radius: 8px;
}
.${cls.keyRow} {
  /* 行是 div（数据行不再可点）—— 少了这条，width:100% 会把 20px 内边距加到外面，
     第三列被容器裁掉。按钮时代没事是因为 UA 样式默认给了 border-box。 */
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-bottom: 1px solid ${v('border-l1', 'rgba(128,128,128,.16)')};
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.${cls.keyRow}:last-child { border-bottom: none; }
.${cls.keyRow}:hover { background: ${v('interactive-bg-hover', 'rgba(128,128,128,.14)')}; }
.${cls.keyRow}:focus-visible { outline: 2px solid ${v('brand-primary', '#4c8dff')}; outline-offset: -2px; }
.${cls.keyRowActive} { background: color-mix(in srgb, currentColor 8%, transparent); font-weight: 600; }
/* 表头：不可点、略微压暗，与数据行区分开。 */
.${cls.keyHead} { cursor: default; opacity: .6; font-size: 10.5px; }
.${cls.keyHead}:hover { background: transparent; }
.${cls.keyCell} { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${cls.keyMasked} {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  opacity: .8;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 详情弹窗的栏目导航（用量 / 资源包） */
.${cls.tabBar} {
  display: flex;
  gap: 4px;
  flex: none;
  padding: 8px 14px 0;
  border-bottom: 1px solid ${v('border-l1', 'rgba(128,128,128,.22)')};
}
.${cls.tab} {
  appearance: none;
  padding: 6px 12px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  opacity: .65;
  transition: opacity .12s ease, background-color .12s ease;
}
.${cls.tab}:hover { opacity: .9; background: color-mix(in srgb, currentColor 6%, transparent); }
.${cls.tab}:focus-visible { outline: 2px solid ${v('brand-primary', '#4c8dff')}; outline-offset: -2px; }
.${cls.tabActive} { opacity: 1; font-weight: 600; border-bottom-color: ${v('brand-primary', '#4c8dff')}; }

/* ── 侧栏卡片（左侧列表下方） ──────────────────────────
   位置不是 slot 给的：sidebar.footer.action 是一条 flex 行（里面还坐着宿主
   自己的 cordis-panel 按钮），放不下整块卡片，所以容器由 sidebar-mount.tsx
   直接插进 shell 的 footArea（Settings 行之上）。样式形态对齐宿主自带的
   「今日用量」速览卡：圆角 12、极淡底色、悬停加深，整块可点。

   句法约定：.sideCard 是容器（position:relative），里面的 .sideCardMain 是
   唯一的整块按钮，箭头 .sideToggle 是它的**兄弟**按钮 —— 按钮里不能套按钮。 */
.${cls.sideCard} {
  box-sizing: border-box;
  position: relative;
  width: 100%;
  margin: 2px 0 4px;
  border-radius: 12px;
  color: ${v('label-primary', 'inherit')};
  background: color-mix(in srgb, currentColor 4%, transparent);
  transition: background-color .12s ease;
}
.${cls.sideCard}:hover { background: ${v('interactive-bg-hover', 'color-mix(in srgb, currentColor 8%, transparent)')}; }
/* 侧栏收成 56px 图标栏时整块隐藏：那里放不下任何文字卡片。 */
[data-sidebar-collapsed] .${cls.sideCard} { display: none; }

.${cls.sideCardMain} {
  appearance: none;
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.${cls.sideCardMain}:focus-visible { outline: 2px solid ${v('brand-primary', '#4c8dff')}; outline-offset: 1px; }

/* 卡片内边距的承载者：收起与展开共用同一圈留白，避免切换时卡片"跳一下"。 */
.${cls.sideBody} {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}

/* 收起态：一行速览（图标 + 标题 + 数值），右侧给箭头留出 20px。 */
.${cls.sideStrip} {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-right: 20px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
}
.${cls.sideStripLabel} { opacity: .65; overflow: hidden; text-overflow: ellipsis; }
.${cls.sideStripValue} {
  margin-left: auto;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.${cls.sideIcon} { flex: none; display: block; opacity: .65; }

/* 展开态：标题行 + 模型缩略 + 动作行 */
.${cls.sideHead} {
  display: flex;
  align-items: baseline;
  gap: 8px;
  /* 右上角的箭头是绝对定位的，标题行给它留出位置，数值不会被压到箭头底下。 */
  padding-right: 20px;
}
.${cls.sideTitle} { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; opacity: .65; min-width: 0; }
.${cls.sideValue} { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 600; white-space: nowrap; }
.${cls.sideNote} { font-size: 10.5px; color: ${v('label-caption', 'rgba(128,128,128,.8)')}; font-variant-numeric: tabular-nums; }
.${cls.sideError} { font-size: 11px; color: ${v('state-error-primary', '#f0635f')}; text-wrap: pretty; }

.${cls.sideModels} { display: flex; flex-direction: column; gap: 7px; }
.${cls.sideModel} { display: flex; flex-direction: column; gap: 3px; }
.${cls.sideModelRow} { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 11.5px; }
.${cls.sideModelName} {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: .85;
}
.${cls.sideModelValue} {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-weight: 500;
}
.${cls.sideModelBar} {
  display: block;
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 8%, transparent);
  overflow: hidden;
}
.${cls.sideModelFill} { display: block; height: 100%; border-radius: 999px; background: color-mix(in srgb, currentColor 45%, transparent); transition: width .2s ease; }
.${cls.sideMore} { font-size: 10.5px; color: ${v('label-caption', 'rgba(128,128,128,.8)')}; font-variant-numeric: tabular-nums; }

.${cls.sideActions} { display: flex; align-items: center; gap: 6px; }
.${cls.sideMeta} {
  margin-left: auto;
  font-size: 10.5px;
  color: ${v('label-caption', 'rgba(128,128,128,.8)')};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 展开/收起箭头：贴在卡片右上角，与整块主按钮互为兄弟。 */
.${cls.sideToggle} {
  appearance: none;
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: .55;
  transition: opacity .12s ease, background-color .12s ease;
}
.${cls.sideCard}:hover .${cls.sideToggle} { opacity: .8; }
.${cls.sideToggle}:hover { opacity: 1; background: color-mix(in srgb, currentColor 10%, transparent); }
.${cls.sideToggle}:focus-visible { outline: 2px solid ${v('brand-primary', '#4c8dff')}; outline-offset: 1px; }
.${cls.sideToggle} svg { display: block; }

/* ── 详情弹窗 ────────────────────────────────────────
   从卡片上的「详情」按钮打开：定位用 fixed，因此挂在侧栏 DOM 里也照样铺满视口。
   遮罩层吃掉点击（点空白关闭），弹窗本体是居中卡片。 */
.${cls.overlay} {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: ${v('bg-mask', 'rgba(0, 0, 0, .38)')};
  animation: ${NS}-fade 120ms ease-out;
}
.${cls.dialog} {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 48px));
  max-height: min(78vh, 720px);
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid ${v('border-l2', 'rgba(128,128,128,.35)')};
  background: ${v('bg-overlay', v('bg-layer-1', '#1d1d22'))};
  color: ${v('label-primary', 'inherit')};
  box-shadow: 0 18px 48px rgba(0, 0, 0, .38);
  animation: ${NS}-pop 140ms ease-out;
}
.${cls.dialogHead} {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 12px 14px 10px;
  border-bottom: 1px solid ${v('border-l1', 'rgba(128,128,128,.22)')};
}
.${cls.dialogTitle} { margin: 0; font-size: 13px; font-weight: 600; }
.${cls.dialogBody} {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  overflow: auto;
  overscroll-behavior: contain;
}
.${cls.dialogFoot} {
  flex: none;
  padding: 10px 14px;
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

@keyframes ${NS}-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 尊重"减少动态效果"：弹窗与弹层的入场动画直接关掉。顺带让静态截图能一次拍准
   —— 动画未跑完时截图会拍到半透明的中间帧。 */
@media (prefers-reduced-motion: reduce) {
  .${cls.overlay},
  .${cls.dialog},
  .${cls.skeleton},
  .${cls.progress} { animation: none; }
}
`

/** 去注释后的样式；注入 `<style>` 的就是它。 */
export const PANEL_CSS = RAW_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

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
