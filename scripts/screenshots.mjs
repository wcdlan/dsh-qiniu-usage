/**
 * 生成 README 用的界面截图：跑 preview.mjs（明 / 暗各一套）→ headless Chrome 按
 * **元素盒子**裁剪、2x 重栅格化 → 写进 `img/`，浅色图带 `-light` 后缀。产物参与 git，
 * 脚本本身不进构建、也不进 npm 包。
 *
 * 走 CDP 而非 `chrome --screenshot`：只有它能按元素盒子裁剪并 2x 重栅格化，得到"只有
 * 这块 UI"的干净图，而不是整页图再靠 Pillow 找边界。
 *
 * @module dsh-qiniu-usage/scripts/screenshots
 */

import {spawn} from 'node:child_process'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const previewScript = resolve(root, 'scripts', 'preview.mjs')
const tmp = resolve(root, '.tmp')
const outDir = resolve(root, 'img')
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** 每张图打开的预览页、裁剪元素与留白。 */
const SHOTS = [
  { url: 'preview.html?w=760', name: 'settings', box: 'panel', pad: 20, title: '设置分区' },
  { url: 'preview-card-expanded.html', name: 'sidebar-card', box: '[data-dsh-part="sidebar-card"]', pad: 0, title: '侧栏速览卡片' },
  { url: 'preview-detail.html', name: 'details-model', box: '[role="dialog"]', pad: 2, title: '详情弹窗 · 各模型用量' },
  { url: 'preview-detail-packs.html', name: 'details-respack', box: '[role="dialog"]', pad: 2, title: '详情弹窗 · 资源包利用' },
]

/** 极简 CDP 会话：够用就好，不引 puppeteer。 */
class Session {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.waiting = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== undefined) {
        const pending = this.waiting.get(msg.id)
        this.waiting.delete(msg.id)
        if (pending === undefined) return
        if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)))
        else pending.resolve(msg.result)
        return
      }
      for (const cb of this.listeners.get(msg.method) ?? []) cb(msg.params)
    })
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  once(method) {
    return new Promise((resolve) => {
      const cb = (params) => {
        this.listeners.set(method, (this.listeners.get(method) ?? []).filter((f) => f !== cb))
        resolve(params)
      }
      this.listeners.set(method, [...(this.listeners.get(method) ?? []), cb])
    })
  }
}

/**
 * 取目标元素的页面坐标盒子（含滚动偏移）。`panel` 不是选择器：设置页那版渲染在
 * `#shell` 里，取全部子元素的并集，免得依赖面板内部类名。
 */
const boxExpr = (selector) => (selector === 'panel'
  ? `(() => {
      const shell = document.getElementById('shell');
      const kids = [...shell.children].filter((el) => el.id !== 'diag');
      const r = kids.reduce((a, el) => {
        const b = el.getBoundingClientRect();
        return { l: Math.min(a.l, b.left), t: Math.min(a.t, b.top), r: Math.max(a.r, b.right), b: Math.max(a.b, b.bottom) };
      }, { l: 1e9, t: 1e9, r: -1e9, b: -1e9 });
      return JSON.stringify({ x: r.l, y: r.t, width: r.r - r.l, height: r.b - r.t });
    })()`
  : `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return 'null';
      const b = el.getBoundingClientRect();
      return JSON.stringify({ x: b.left, y: b.top, width: b.width, height: b.height });
    })()`)

async function evaluate(session, expression) {
  const { result } = await session.send('Runtime.evaluate', { expression, returnByValue: true })
  return JSON.parse(result.value)
}

async function measure(session, selector, pad) {
  const box = await evaluate(session, boxExpr(selector))
  if (box === null) throw new Error(`预览页里找不到元素：${selector}`)
  const scroll = await evaluate(session, 'JSON.stringify({ x: window.scrollX, y: window.scrollY })')
  return {
    x: Math.max(0, Math.round(box.x + scroll.x - pad)),
    y: Math.max(0, Math.round(box.y + scroll.y - pad)),
    width: Math.round(box.width + pad * 2),
    height: Math.round(box.height + pad * 2),
  }
}

function buildPreviews(theme) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [previewScript, '--theme', theme], { stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`preview.mjs 退出码 ${code}`))))
  })
}

async function launchChrome() {
  const profile = resolve(tmp, 'chrome-screenshots')
  await rm(profile, { recursive: true, force: true })
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-crashpad',
    `--crash-dumps-dir=${resolve(tmp, 'crash')}`,
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--window-size=1200,1600',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] })

  // `--remote-debugging-port=0` 会把真实端口写进 profile 目录，读它比猜端口可靠。
  const portFile = resolve(profile, 'DevToolsActivePort')
  for (let i = 0; i < 100; i += 1) {
    try {
      const port = (await readFile(portFile, 'utf8')).split('\n')[0].trim()
      if (port !== '') {
        for (let j = 0; j < 50; j += 1) {
          try {
            await fetch(`http://127.0.0.1:${port}/json/version`)
            return { chrome, port }
          } catch {
            await new Promise((r) => setTimeout(r, 100))
          }
        }
      }
    } catch {
      // 端口文件还没落盘
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  chrome.kill()
  throw new Error('headless Chrome 没起来（端口文件一直是空的）')
}

async function capture(session, theme) {
  const suffix = theme === 'dark' ? '' : `-${theme}`
  for (const shot of SHOTS) {
    const [file, query] = shot.url.split('?')
    const url = `file://${resolve(tmp, file)}${query === undefined ? '' : `?${query}`}`
    const loaded = session.once('Page.loadEventFired')
    await session.send('Page.navigate', { url })
    await loaded
      // 预览页无异步数据，但字体加载与布局稳定需要一帧。
    await new Promise((r) => setTimeout(r, 300))

    const clip = await measure(session, shot.box, shot.pad)
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { ...clip, scale: 2 },
    })
    const name = `${shot.name}${suffix}.png`
    await writeFile(resolve(outDir, name), Buffer.from(data, 'base64'))
    console.log(`img/${name}  ${clip.width}x${clip.height} @2x  ${shot.title}`)
  }
}

async function main() {
  const themeArg = process.argv.indexOf('--theme')
  const themes = themeArg === -1 ? ['dark', 'light'] : [process.argv[themeArg + 1] ?? 'dark']
  for (const theme of themes) {
    if (theme !== 'dark' && theme !== 'light') {
      console.error(`未知主题：${theme}（可选 dark / light）`)
      process.exit(2)
    }
  }

  await mkdir(outDir, { recursive: true })
  await mkdir(tmp, { recursive: true })

  const { chrome, port } = await launchChrome()
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = list.find((target) => target.type === 'page')
    if (page === undefined) throw new Error('没有可用的 page target')

    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', rej, { once: true })
    })
    const session = new Session(ws)
    await session.send('Page.enable')

    for (const theme of themes) {
      await buildPreviews(theme)
      await capture(session, theme)
    }
  } finally {
    chrome.kill()
  }
  process.exit(0)
}

await main()
