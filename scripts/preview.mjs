/**
 * 视觉预览：把面板渲染成 HTML 供 headless Chrome 截图。开发期工具，不参与构建产物。
 * URL 参数：`?w=<px>` 固定面板宽度（见下方 shell CSS 注释），`?diag=1` 显示溢出诊断。
 *
 * @module dsh-qiniu-usage/scripts/preview
 */

import {build} from 'esbuild'
import {mkdir, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = resolve(root, '.tmp')
const bundlePath = resolve(tmp, 'preview.bundle.mjs')
const htmlPath = resolve(tmp, 'preview.html')
const cardHtmlPath = resolve(tmp, 'preview-card.html')
const cardExpandedHtmlPath = resolve(tmp, 'preview-card-expanded.html')
const detailHtmlPath = resolve(tmp, 'preview-detail.html')
const detailPacksHtmlPath = resolve(tmp, 'preview-detail-packs.html')

/**
 * 预览主题 token（`--dsw-alias-*` 只写后缀名）。dark 用调校过的近似值以免随上游改名漂移；
 * light 采用宿主真实 token（浅色靠白底 + 极淡描边分层，近似值会糊成一片）。
 * `pageBg` / `sidebarBg` 等是预览自己的舞台布景，非宿主 token。
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
        // 宿主没有 `--dsw-alias-bg-mask`（只有 mask-1/2/3），照抄插件 CSS 的兜底值，遮罩浓度才与真机一致。
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

function themeOf(theme) {
  return THEMES[theme] ?? THEMES.dark
}

function themeBlock(theme) {
  const tokens = themeOf(theme)
  const vars = Object.entries(tokens.vars)
    .map(([name, value]) => `--dsw-alias-${name}: ${value};`)
    .join('\n    ')
  return `:root {\n    color-scheme: ${tokens.scheme};\n    ${vars}\n  }`
}

/** 把预览入口打成 Node 可执行的 ESM：react 走 node_modules，不打进包。 */
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
 * 侧栏视图：模拟 shell 左侧栏，把卡片放进真实位置 —— 卡片的高度、间距、截断只有在真实
 * 宽度下才看得出来；底部复刻宿主自带的「今日用量」速览卡，便于两张卡并排对比。
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

/** 包一层宿主设置页那样的容器。 */
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
  /* 模拟设置页右侧内容区：宽度由 ?w= 决定，缺省占满窗口。用容器宽度而非 --window-size
     测窄布局：Chrome 会把窗口宽度夹到约 500px，更小的 window-size 只会裁掉右侧，像溢出实为假象。 */
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
    // 默认暗色；`--theme light` 供 README 浅色截图用。
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

  const collapsed = await mod.renderSidebarCard({ expanded: false })
  await writeFile(cardHtmlPath, wrapSidebarDocument(collapsed, { theme }), 'utf8')
  console.log(`预览已生成：${cardHtmlPath}`)

  const expanded = await mod.renderSidebarCard({ expanded: true })
  await writeFile(cardExpandedHtmlPath, wrapSidebarDocument(expanded, { expanded: true, theme }), 'utf8')
  console.log(`预览已生成：${cardExpandedHtmlPath}`)

    // 详情弹窗叠在侧栏视图之上，检验遮罩与居中；两个栏目各一张。
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
