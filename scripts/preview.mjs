/**
 * 视觉预览：把面板渲染成 HTML，供 headless Chrome 截图查看。
 *
 * 用途：改样式时能**真的看到**效果，而不是盲改 CSS。开发期工具，不参与构建产物。
 *
 * ```bash
 * node scripts/preview.mjs                    # 生成 .tmp/preview.html
 * # 再用 Chrome 截图：
 * #   --window-size=820,1600  --screenshot=out.png  file://.../.tmp/preview.html
 * ```
 *
 * URL 参数（调试用）：
 * - `?w=420`  —— 把模拟面板宽度固定为 420px。
 *   必须用参数而不是 `--window-size`：Chrome 会把窗口宽度夹到最小值（约 500px），
 *   若按更小的 window-size 出图，只会把右侧**裁掉**，看起来像布局溢出，实为假象。
 * - `?diag=1` —— 在页面顶部显示溢出诊断（哪个元素超出了面板宽度）。
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
const floatingHtmlPath = resolve(tmp, 'preview-floating.html')

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
 * 对话页视图：给浮层一个"聊天内容"背景，才能看清它压在上面是否可读。
 *
 * @param floatingHtml - 浮层的静态 HTML。
 * @returns 完整 HTML 文档。
 */
function wrapFloatingDocument(floatingHtml) {
  const bubbles = Array.from({ length: 14 }, (_, index) => {
    const side = index % 2 === 0 ? 'left' : 'right'
    const width = 40 + ((index * 17) % 45)
    return `<div class="row ${side}"><div class="bubble" style="width:${width}%">`
      + '这里是对话内容，用来检验浮层压在其上的可读性与层次。'.repeat(index % 3 === 0 ? 1 : 2)
      + '</div></div>'
  }).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-qiniu-usage 预览（对话页浮层）</title>
<style>
  :root {
    color-scheme: dark;
    --dsw-alias-label-primary: #e8e8ea; --dsw-alias-label-secondary: #b9b9bf;
    --dsw-alias-label-tertiary: #8b8b93; --dsw-alias-label-caption: #7a7a82;
    --dsw-alias-bg-base: #16161a; --dsw-alias-bg-layer-1: #1d1d22;
    --dsw-alias-bg-layer-2: #232329; --dsw-alias-bg-layer-3: #2c2c34;
    --dsw-alias-bg-overlay: #202027;
    --dsw-alias-border-l1: #2a2a31; --dsw-alias-border-l2: #383842; --dsw-alias-border-l3: #44444f;
    --dsw-alias-interactive-bg-hover: #2a2a32;
    --dsw-alias-state-business-primary: #4c8dff; --dsw-alias-state-warn-primary: #e0a03a;
    --dsw-alias-state-error-primary: #f0635f;
    --dsw-alias-brand-primary: #4c8dff;
    --dsw-alias-button-floating-fill: #24242c; --dsw-alias-button-floating-hover: #2c2c36;
  }
  html, body { margin: 0; background: #101014; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; -webkit-font-smoothing: antialiased; }
  .chat { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .row { display: flex; }
  .row.right { justify-content: flex-end; }
  .bubble { padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.6;
            background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
  .row.right .bubble { background: #26303f; color: var(--dsw-alias-label-primary); }
</style>
</head>
<body><div class="chat">${bubbles}</div>${floatingHtml}</body>
</html>
`
}

/** 包一层宿主设置页那样的容器，颜色用中性值近似宿主主题。 */
function wrapDocument(panelHtml) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-qiniu-usage 预览</title>
<style>
  :root {
    color-scheme: dark;
    /* 近似的宿主主题 token；仅为预览，真实运行由宿主注入 */
    --dsw-alias-label-primary: #e8e8ea;
    --dsw-alias-label-secondary: #b9b9bf;
    --dsw-alias-label-tertiary: #8b8b93;
    --dsw-alias-label-caption: #7a7a82;
    --dsw-alias-label-dimmed: #6a6a72;
    --dsw-alias-bg-base: #16161a;
    --dsw-alias-bg-layer-1: #1d1d22;
    --dsw-alias-bg-layer-2: #232329;
    --dsw-alias-bg-layer-3: #2c2c34;
    --dsw-alias-border-l1: #2a2a31;
    --dsw-alias-border-l2: #383842;
    --dsw-alias-border-l3: #44444f;
    --dsw-alias-border-l4: #55555f;
    --dsw-alias-interactive-bg-hover: #2a2a32;
    --dsw-alias-state-business-primary: #4c8dff;
    --dsw-alias-state-success-primary: #35c07a;
    --dsw-alias-state-warn-primary: #e0a03a;
    --dsw-alias-state-error-primary: #f0635f;
    --dsw-alias-brand-primary: #4c8dff;
  }
  html, body { margin: 0; padding: 0; background: #101014; }
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
  await mkdir(tmp, { recursive: true })
  await buildPreview()

  const mod = await import(`${bundlePath}?t=${Date.now()}`)
  const panelHtml = await mod.renderPanel()
  await writeFile(htmlPath, wrapDocument(panelHtml), 'utf8')
  console.log(`预览已生成：${htmlPath}`)

  const floatingHtml = await mod.renderFloating()
  await writeFile(floatingHtmlPath, wrapFloatingDocument(floatingHtml), 'utf8')
  console.log(`预览已生成：${floatingHtmlPath}`)
  process.exit(0)
}

await main()
