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
import { readFile } from 'node:fs/promises'
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
    assert.equal(mod.default, mod.apply, 'default 导出应指向 apply')
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
    // react 只给最小替身：本测试关心的是"走了 require 通道"，不是渲染结果。
    const requireShim = (spec: string): unknown => {
      requiredSpecifiers.push(spec)
      if (spec === 'react') return { createElement: () => null }
      if (spec === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: null }
      throw new Error(`意外的外部模块请求：${spec}`)
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

  it('react 走 require 通道（未被打进 bundle）', async () => {
    const { requiredSpecifiers } = await loadClientBundle()
    assert.ok(
      requiredSpecifiers.every((s) => s === 'react' || s === 'react/jsx-runtime'),
      `客户端 bundle 只应请求平台冻结模块，实际请求：${requiredSpecifiers.join(', ')}`,
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
