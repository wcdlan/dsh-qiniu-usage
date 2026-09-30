/**
 * 视觉预览：把面板渲染成 HTML，供 headless Chrome 截图查看。
 *
 * 生成五份：设置页、侧栏卡片（收起 / 展开）、详情弹窗的两个栏目。
 * 侧栏那两份是**模拟 shell 侧栏**渲染的（会话列表 + 宿主自带的「今日用量」速览卡
 * + 我们的卡片 + 设置行），因为卡片的高度、间距、截断只有在真实宽度下才看得出来。
 *
 * 用途：改样式时能**真的看到**效果，而不是盲改 CSS。开发期工具，不参与构建产物。
 *
 * ```bash
 * node scripts/preview.mjs                    # 生成 .tmp/preview.html
 * node scripts/preview.mjs --theme light      # 换浅色主题再生成（默认 dark）
 * # 再用 Chrome 截图：
 * #   --window-size=820,1600  --screenshot=out.png  file://.../.tmp/preview.html
 * ```
 *
 * URL 参数（调试用）：
 * - `?w=420`  —— 把模拟面板宽度固定为 420px。
 *   必须用参数而不是 `--window-size`：Chrome 会把窗口宽度夹到最小值（约 500px），
 *   若按更小的 window-size 出图，只会把右侧**裁掉**，看起来像布局溢出，实为假象。
 * - `?diag=1` —— 在页面顶部显示溢出诊断（哪个元素超出了面板宽度）。
 * - `.tmp/preview-keyed.html` —— 选中单个 Key、当天上游未归属的提示态。
 *
 * @module dsh-qiniu-usage/scripts/preview
 */

import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = resolve(root, '.tmp')
const bundlePath = resolve(tmp, 'preview.bundle.mjs')
const htmlPath = resolve(tmp, 'preview.html')
const cardHtmlPath = resolve(tmp, 'preview-card.html')
const cardExpandedHtmlPath = resolve(tmp, 'preview-card-expanded.html')
const detailHtmlPath = resolve(tmp, 'preview-detail.html')
const detailPacksHtmlPath = resolve(tmp, 'preview-detail-packs.html')

/**
 * 预览主题 token（`--dsw-alias-*` 只写后缀名）。
 *
 * - `dark` —— 调校过的近似值：观感贴近宿主暗色真机，也不随上游 token 改名漂移；
 * - `light` —— 直接采用宿主真实 token（取自宿主 bundle 里 `body` 规则的
 *   `--dsw-alias-*` 定义），因为浅色下卡片靠「白底 + 极淡描边」分层，
 *   近似值会糊成一片。
 *
 * `pageBg` / `sidebarBg` 等不是宿主 token，而是预览自己的舞台布景，只求与卡片
 * 之间有一层浅浅的分离。
 */
const THEMES = {
  dark: {
    scheme: 'dark',
    pageBg: '#101014',
    sidebarBg: '#17171c',
    sidebarActive: '#24242c',
    sidebarDot: '#3a3a44',
    vars: {
      'label-primary': '#e8e8ea',
      'label-secondary': '#b9b9bf',
      'label-tertiary': '#8b8b93',
      'label-caption': '#7a7a82',
      'label-dimmed': '#6a6a72',
      'bg-base': '#16161a',
      'bg-layer-1': '#1d1d22',
      'bg-layer-2': '#232329',
      'bg-layer-3': '#2c2c34',
      'bg-overlay': '#202027',
      'bg-mask': 'rgba(0, 0, 0, .55)',
      'border-l1': '#2a2a31',
      'border-l2': '#383842',
      'border-l3': '#44444f',
      'border-l4': '#55555f',
      'interactive-bg-hover': '#2a2a32',
      'state-business-primary': '#4c8dff',
      'state-success-primary': '#35c07a',
      'state-warn-primary': '#e0a03a',
      'state-error-primary': '#f0635f',
      'brand-primary': '#4c8dff',
    },
  },
  light: {
    scheme: 'light',
    pageBg: '#ffffff',
    sidebarBg: '#f5f6f8',
    sidebarActive: '#e8ebf0',
    sidebarDot: '#d3d7dd',
    vars: {
      'label-primary': '#0f1115',
      'label-secondary': '#61666b',
      'label-tertiary': '#81858c',
      'label-caption': '#adb2b8',
      'label-dimmed': '#e1e5ee',
      'bg-base': '#ffffff',
      'bg-layer-1': '#ffffff',
      'bg-layer-2': '#ffffff',
      'bg-layer-3': '#ffffff',
      'bg-overlay': '#e9ecf2',
      // 宿主没有 `--dsw-alias-bg-mask`（只有 mask-1/2/3），真实运行时用的是插件
      // CSS 里的兜底值，这里照抄兜底值，遮罩浓度才与真机一致。
      'bg-mask': 'rgba(0, 0, 0, .38)',
      'border-l1': '#0000000a',
      'border-l2': '#0000001a',
      'border-l3': '#0000001f',
      'border-l4': '#00000029',
      'interactive-bg-hover': '#2631480f',
      'state-business-primary': '#4176e6',
      'state-success-primary': '#22c55e',
      'state-warn-primary': '#f59e0b',
      'state-error-primary': '#ec1313',
      'brand-primary': '#0f1115',
    },
  },
}

/**
 * 取某个主题的配置（未知主题回落到 `dark`）。
 *
 * @param theme - `dark` 或 `light`。
 * @returns 主题配置。
 */
function themeOf(theme) {
  return THEMES[theme] ?? THEMES.dark
}

/**
 * 把主题 token 拼成 `:root { … }` 规则。
 *
 * @param theme - `dark` 或 `light`。
 * @returns CSS 文本。
 */
function themeBlock(theme) {
  const tokens = themeOf(theme)
  const vars = Object.entries(tokens.vars)
    .map(([name, value]) => `--dsw-alias-${name}: ${value};`)
    .join('\n    ')
  return `:root {\n    color-scheme: ${tokens.scheme};\n    ${vars}\n  }`
}

/** 把预览入口打成 Node 可执行的 ESM（react 走 node_modules，不打进包）。 */
async function buildPreview() {
  await build({
    entryPoints: [resolve(root, 'scripts/preview-entry.tsx')],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server'],
    logLevel: 'warning',
  })
}

/**
 * 侧栏视图：模拟 shell 的左侧栏（会话列表 + 底部区域），把卡片放进真实位置。
 *
 * 底部区域里刻意复刻了宿主自带的「今日用量」速览卡：两张卡片的圆角、底色、
 * 字号、留白是否协调，一眼就能比出来。顺序也照实排：真实运行时
 * `@linxin666/dsh-usage` 的卡坚持紧邻 Settings 行，所以稳定后是"我们的卡在上、
 * 宿主的卡在下"。
 *
 * @param cardHtml - 卡片的静态 HTML。
 * @param options - `expanded` 用于标题；`dialogHtml` 非空时叠一层详情弹窗；
 *   `theme` 选 `dark` / `light`。
 * @returns 完整 HTML 文档。
 */
function wrapSidebarDocument(cardHtml, options = {}) {
  const theme = themeOf(options.theme)
  const sessions = Array.from({ length: 12 }, (_, index) =>
    `<div class="session${index === 0 ? ' active' : ''}">`
    + `<span class="dot"></span>会话 ${index + 1} —— 一段会被截断的很长很长的标题`
    + '</div>').join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-qiniu-usage 预览（左侧栏卡片）</title>
<style>
  ${themeBlock(options.theme)}
  html, body { margin: 0; background: ${theme.pageBg}; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; -webkit-font-smoothing: antialiased; }
  .frame { display: flex; height: 100vh; }
  /* 侧栏：宿主默认 280px */
  .sidebarCol { width: 280px; flex: none; box-sizing: border-box; padding: 8px 8px 6px;
                display: flex; flex-direction: column; background: ${theme.sidebarBg}; }
  .regionArea { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
  .session { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; border-radius: 8px;
             font-size: 12.5px; color: var(--dsw-alias-label-secondary);
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .session.active { background: ${theme.sidebarActive}; color: var(--dsw-alias-label-primary); }
  .dot { width: 6px; height: 6px; border-radius: 999px; background: ${theme.sidebarDot}; flex: none; }
  .footArea { flex: none; display: flex; flex-direction: column; }
  /* 宿主自带的「今日用量」速览卡（复刻形态，用来对比） */
  .hostCard { box-sizing: border-box; width: 100%; margin: 2px 0 4px; padding: 8px;
              border-radius: 12px; background: color-mix(in srgb, currentColor 4%, transparent);
              color: var(--dsw-alias-label-primary); font-size: 12px; display: flex; align-items: baseline; gap: 8px; }
  .hostCard .label { opacity: .65; }
  .hostCard .value { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
  .settingsArea { height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 8px;
                  border-radius: 8px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
  .center { flex: 1; display: flex; align-items: center; justify-content: center;
            color: var(--dsw-alias-label-caption); font-size: 12px; }
</style>
</head>
<body>
<div class="frame">
  <div class="sidebarCol">
    <div class="regionArea">${sessions}</div>
    <div class="footArea">
      ${cardHtml}
      <div class="hostCard"><span class="label">今日用量</span><span class="value">2.18M tokens</span></div>
      <div class="settingsArea">⚙ 设置</div>
    </div>
  </div>
  <div class="center">会话内容区（卡片应贴在左侧栏底部、设置行之上）</div>
</div>
${options.dialogHtml ?? ''}
</body>
</html>
`
}

/** 包一层宿主设置页那样的容器（主题 token 见 `THEMES`）。 */
function wrapDocument(panelHtml, options = {}) {
  const theme = themeOf(options.theme)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-qiniu-usage 预览</title>
<style>
  ${themeBlock(options.theme)}
  html, body { margin: 0; padding: 0; background: ${theme.pageBg}; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* 模拟设置页右侧内容区：宽度由 ?w= 决定，缺省占满窗口。
     用容器宽度而不是窗口宽度来测窄布局，可绕开 Chrome 的最小窗口宽度限制。 */
  .shell { padding: 20px; background: var(--dsw-alias-bg-base); min-height: 100vh; box-sizing: border-box; }
</style>
</head>
<body><div class="shell" id="shell"><pre id="diag" style="display:none;margin:0 0 12px;padding:8px;background:#3a1d1d;color:#ffb4b0;font:11px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap;border-radius:6px"></pre>${panelHtml}</div>
<script>
  var params = new URLSearchParams(location.search);
  var shell = document.getElementById('shell');
  var w = params.get('w');
  if (w) shell.style.width = w + 'px';

  if (params.get('diag') === '1') {
    var diag = document.getElementById('diag');
    diag.style.display = 'block';
    var out = [
      'viewport=' + document.documentElement.clientWidth,
      'shellContent=' + shell.clientWidth,
      'docScrollWidth=' + document.documentElement.scrollWidth
    ];
    var shellRight = shell.getBoundingClientRect().right;
    var bad = [];
    var all = shell.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === 'diag') continue;
      var r = el.getBoundingClientRect();
      if (r.right > shellRight + 0.5) {
        var cls = (typeof el.className === 'string' && el.className) ? el.className : el.tagName.toLowerCase();
        bad.push(Math.round(r.width) + 'px [' + cls + '] "' + (el.textContent || '').slice(0, 24) + '"');
      }
    }
    out.push('overflowing=' + bad.length);
    out = out.concat(bad.slice(0, 10));
    diag.textContent = out.join('  \u00b7  ');
  }
</script>
</body>
</html>
`
}

async function main() {
  // 主题：默认暗色（与历史一致）；`--theme light` 出浅色一套，供 README 截图用。
  const themeArg = process.argv.indexOf('--theme')
  const theme = themeArg === -1 ? 'dark' : (process.argv[themeArg + 1] ?? 'dark')
  if (theme !== 'dark' && theme !== 'light') {
    console.error(`未知主题：${theme}（可选 dark / light）`)
    process.exit(2)
  }

  await mkdir(tmp, { recursive: true })
  await buildPreview()

  const mod = await import(`${bundlePath}?t=${Date.now()}`)
  const panelHtml = await mod.renderPanel()
  await writeFile(htmlPath, wrapDocument(panelHtml, { theme }), 'utf8')
  console.log(`预览已生成：${htmlPath}（${theme}）`)

  // 侧栏卡片：收起态（默认）与展开态各出一张，放在模拟的侧栏里。
  const collapsed = await mod.renderSidebarCard({ expanded: false })
  await writeFile(cardHtmlPath, wrapSidebarDocument(collapsed, { theme }), 'utf8')
  console.log(`预览已生成：${cardHtmlPath}`)

  const expanded = await mod.renderSidebarCard({ expanded: true })
  await writeFile(cardExpandedHtmlPath, wrapSidebarDocument(expanded, { expanded: true, theme }), 'utf8')
  console.log(`预览已生成：${cardExpandedHtmlPath}`)

  // 详情弹窗：叠在侧栏视图之上，检验遮罩与居中。两个栏目各一张。
  const dialog = await mod.renderDetailDialog({ tab: 'usage' })
  await writeFile(
    detailHtmlPath,
    wrapSidebarDocument(expanded, { expanded: true, dialogHtml: dialog, theme }),
    'utf8',
  )
  console.log(`预览已生成：${detailHtmlPath}`)

  const packsDialog = await mod.renderDetailDialog({ tab: 'respack' })
  await writeFile(
    detailPacksHtmlPath,
    wrapSidebarDocument(expanded, { expanded: true, dialogHtml: packsDialog, theme }),
    'utf8',
  )
  console.log(`预览已生成：${detailPacksHtmlPath}`)
  process.exit(0)
}

await main()
