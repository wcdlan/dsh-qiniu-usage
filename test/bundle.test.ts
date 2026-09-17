/**
 * 构建产物契约测试。
 *
 * M0 的验收标准之一是"空插件能被 `dsh web` 加载不报错"、"打通 lib/client.js
 * 构建格式"。这两条无法在单测里真起一个 dsh web，但可以断言**产物契约** ——
 * 而契约漂移正是真实踩坑的地方。
 *
 * 依赖 `pnpm build:js` 的产物；产物缺失时测试会明确失败并提示先构建，而不是
 * 静默跳过。
 *
 * @module dsh-qiniu-usage/test/bundle
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_BUNDLE = resolve(root, 'lib/index.js')
const CLIENT_BUNDLE = resolve(root, 'lib/client.js')

/** 产物缺失时给出可执行的修复提示，而不是让它变成一个费解的导入错误。 */
function assertBuilt(path: string, label: string): void {
  assert.ok(
    existsSync(path),
    `${label} 不存在：${path}\n  先运行：npm run build:js`,
  )
}

describe('产物 · 宿主半区 lib/index.js', () => {
  it('导出 dsh 插件契约所需的全部具名符号', async () => {
    assertBuilt(HOST_BUNDLE, '宿主产物')
    const mod = (await import(HOST_BUNDLE)) as Record<string, unknown>

    assert.equal(mod.name, 'dsh-qiniu-usage')
    assert.deepEqual(mod.inject, ['webServer'])
    assert.equal(typeof mod.apply, 'function', 'apply 必须是函数（mountOnce 返回值）')
    assert.ok(mod.Config, '必须导出 Config schema')
    assert.equal(mod.SETTINGS_NAMESPACE, 'dsh-qiniu-usage')
    assert.equal(typeof mod.resolveConfig, 'function')
    // ⚠ 这条断言在 M0 时写反过：当时断言 default 必须存在（因为源码里有
    // `export default apply`），结果把一个**会导致 dsh web 启动失败**的形状
    // 当成了正确行为。cordis-plugin-loader 的 `unwrapExports` 会优先取 default，
    // 拿到裸函数后丢失整份命名空间（含 inject），启动期报
    // `cannot get property "webServer" without inject`。
    assert.equal(
      mod.default,
      undefined,
      '本模块不得导出 default —— loader 会优先取它并丢掉 inject',
    )
  })

  it('resolveConfig 对空配置给出完整默认值', async () => {
    assertBuilt(HOST_BUNDLE, '宿主产物')
    const { resolveConfig } = (await import(HOST_BUNDLE)) as {
      resolveConfig: (c?: unknown) => Record<string, unknown>
    }

    const resolved = resolveConfig()
    assert.equal(resolved.enabled, true)
    assert.equal(resolved.accessKeyRef, 'QINIU_ACCESS_KEY')
    assert.equal(resolved.secretKeyRef, 'QINIU_SECRET_KEY')
    assert.equal(resolved.usageBaseUrl, 'https://api.qnaigc.com')
    assert.equal(resolved.financeBaseUrl, 'https://api.qiniu.com')
    assert.equal(resolved.timezone, 'Asia/Shanghai')
    assert.equal(resolved.pollIntervalSec, 0, '默认应为纯手动刷新')
    assert.deepEqual(resolved.apiKeys, [])
  })

  it('端口不应被错误地写进默认基地址', async () => {
    assertBuilt(HOST_BUNDLE, '宿主产物')
    const { resolveConfig } = (await import(HOST_BUNDLE)) as {
      resolveConfig: (c?: Record<string, unknown>) => Record<string, unknown>
    }
    assert.equal(
      resolveConfig({ usageBaseUrl: 'https://api.qnaigc.com/' }).usageBaseUrl,
      'https://api.qnaigc.com',
      '尾部 / 应被去掉，避免拼出 //v3/stat/usage',
    )
  })
})

describe('产物 · 客户端半区 lib/client.js', () => {
  /** 在受控的 vm 上下文里执行客户端 bundle，返回注册信息。 */
  async function loadClientBundle(): Promise<{
    id: string
    exports: Record<string, unknown>
    requiredSpecifiers: string[]
  }> {
    assertBuilt(CLIENT_BUNDLE, '客户端产物')
    const source = await readFile(CLIENT_BUNDLE, 'utf8')

    const requiredSpecifiers: string[] = []
    // 平台冻结模块表里可用的外部模块。只给最小替身：本测试关心的是"走了 require
    // 通道"，不是渲染结果。
    //
    // 这份清单就是本插件对宿主平台的**依赖面**：加一项都要有意识（例如悬浮按钮需要
    // react-dom/client 才能在 body 上挂 React root）。
    const PLATFORM_MODULES: Record<string, unknown> = {
      react: { createElement: () => null },
      'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: null },
      'react-dom': {},
      'react-dom/client': { createRoot: () => ({ render: () => {}, unmount: () => {} }) },
    }
    const requireShim = (spec: string): unknown => {
      requiredSpecifiers.push(spec)
      if (spec in PLATFORM_MODULES) return PLATFORM_MODULES[spec]
      throw new Error(`意外的外部模块请求：${spec}（不在平台冻结模块表内）`)
    }

    let captured: { id: string; factory: (r: unknown) => unknown } | undefined
    const sandbox = {
      window: {
        __ModuleLoader__: {
          load: (registration: { id: string; factory: (r: unknown) => unknown }) => {
            captured = registration
          },
        },
      },
      console,
      Symbol,
      Object,
    }

    vm.createContext(sandbox)
    vm.runInContext(source, sandbox, { filename: 'lib/client.js' })

    assert.ok(captured, '客户端 bundle 必须调用 window.__ModuleLoader__.load({...})')
    const registration = captured as { id: string; factory: (r: unknown) => unknown }
    return {
      id: registration.id,
      exports: registration.factory(requireShim) as Record<string, unknown>,
      requiredSpecifiers,
    }
  }

  it('以 __ModuleLoader__.load 注册，且 id 为包名', async () => {
    const { id } = await loadClientBundle()
    assert.equal(id, 'dsh-qiniu-usage')
  })

  it('factory 返回真正的 exports 对象，并导出 apply 与 inject', async () => {
    const { exports } = await loadClientBundle()
    assert.equal(typeof exports.apply, 'function')
    // vm 上下文里的数组原型与宿主不同，先摊平成宿主数组再比较。
    assert.deepEqual(Array.from(exports.inject as string[]), [
      'slots',
      'locale',
      'connection',
      'settingsScope',
      'remote',
    ])
  })

  it('外部依赖只来自平台冻结模块表，且未被打进 bundle', async () => {
    const { requiredSpecifiers } = await loadClientBundle()
    const allowed = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']
    assert.ok(requiredSpecifiers.length > 0, '应至少请求一个平台模块')
    for (const spec of requiredSpecifiers) {
      assert.ok(
        allowed.includes(spec),
        `客户端 bundle 请求了平台表之外的模块：${spec}（实际：${requiredSpecifiers.join(', ')}）`,
      )
    }
    assert.ok(
      requiredSpecifiers.includes('react'),
      'react 应走 require 通道而不是被打进 bundle',
    )
  })

  it('不包含任何凭据来源读取路径（安全底线）', async () => {
    const source = await readFile(CLIENT_BUNDLE, 'utf8')
    // 客户端 bundle 里不得有任何"自己去取凭据"的路径：
    // - 环境变量直读（那是宿主半区的事）
    // - 硬编码的引用名（引用名一律由宿主 describe 回传，客户端不预置）
    for (const forbidden of ['process.env', 'QINIU_ACCESS_KEY', 'QINIU_SECRET_KEY']) {
      assert.ok(
        !source.includes(forbidden),
        `客户端 bundle 不应出现 "${forbidden}" —— 浏览器永不接触凭据`,
      )
    }
    // `secretKey` 作为 describe 结果的属性名是合法的（表单要显示它的状态），
    // 但绝不能出现"把它的值取出来"的读法。
    for (const forbidden of ['secretKey.value', 'secretKey?.value']) {
      assert.ok(!source.includes(forbidden), `客户端不应读取 ${forbidden}`)
    }
  })

  it('客户端只访问本插件的既定路由，其中凭据路由仅用 describe 形状', async () => {
    const source = await readFile(CLIENT_BUNDLE, 'utf8')
    // 允许的路由（前缀常量 + 各路径片段）。
    for (const allowed of ['/overview', '/refresh', '/keys', '/credentials', '/respack/detail']) {
      assert.ok(source.includes(allowed), `客户端应当访问 ${allowed}`)
    }
    // 客户端确实会发送被写入的值（这是它必须做的），但**不得**出现任何把
    // "字段名 + 值"读到本地并渲染的路径。用正则可读的形式钉住这一点：
    // `accessKey` / `secretKey` 只应作为 describe 结果的对象属性出现在类型位置，
    // 不应作为读取源（例如 `.accessKey.value`）。
    for (const forbidden of ['accessKey.value', 'secretKey.value', 'accessKey?.value', 'secretKey?.value']) {
      assert.ok(!source.includes(forbidden), `客户端不应读取 ${forbidden}`)
    }
  })
})

/**
 * 产物**新鲜度**检查。
 *
 * 这个文件其余用例断言的都是"磁盘上那个 lib/*.js 长什么样"，而磁盘上的产物
 * 可能比源码旧 —— 源码改坏之后旧产物仍在，测试全绿。真踩过：
 * `sumMonthRemain` 被放进 `qiniu/respack.ts`（经 `sign.ts` → `node:crypto`），
 * 浏览器产物其实已经构建不出来了，但 `npm test` 读的是上一次成功构建的旧
 * `lib/client.js`，一路绿到 `npm run build` 才暴露。
 *
 * 依赖图本身的守卫在 `test/client-graph.test.ts`（真跑 esbuild）；这里只负责
 * 让"拿旧产物当证据"这件事没法悄悄发生。
 */
describe('产物 · 新鲜度', () => {
  it('lib/ 产物不早于源码（否则请先 npm run build）', async () => {
    /** 收集一个路径（目录则递归）下最新的 mtime。 */
    async function newestMtime(path: string): Promise<{ path: string; mtime: number }> {
      const info = await stat(path)
      if (info.isFile()) return { path, mtime: info.mtimeMs }

      let newest = { path: '', mtime: 0 }
      const entries = await readdir(path, { withFileTypes: true, recursive: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const file = resolve(entry.parentPath, entry.name)
        const { mtimeMs } = await stat(file)
        if (mtimeMs > newest.mtime) newest = { path: file, mtime: mtimeMs }
      }
      return newest
    }

    // 两次构建的共同输入：src/ 全部文件 + 共享的 esbuild 选项模块。
    let newestSource = { path: '', mtime: 0 }
    for (const input of [resolve(root, 'src'), resolve(root, 'scripts/build-options.mjs')]) {
      const candidate = await newestMtime(input)
      if (candidate.mtime > newestSource.mtime) newestSource = candidate
    }

    for (const [artifact, label] of [
      [HOST_BUNDLE, '宿主产物'],
      [CLIENT_BUNDLE, '客户端产物'],
    ] as const) {
      assertBuilt(artifact, label)
      const { mtimeMs } = await stat(artifact)
      assert.ok(
        mtimeMs >= newestSource.mtime,
        `${label} 比源码旧，测试会对着过期产物报结论：\n` +
          `  产物：${artifact}\n` +
          `  更新的输入：${newestSource.path}\n` +
          '  先运行：npm run build',
      )
    }
  })
})
