/**
 * 跨半区契约测试。
 *
 * 宿主半区与客户端半区是**两个独立 bundle**：客户端不能 import 宿主常量
 * （那会把宿主代码拖进浏览器），因此路由前缀、设置命名空间、分区 ID 这些
 * "两边都要写一遍"的字面量只能靠测试钉住一致性 —— 它们一旦漂移，表现是
 * "面板空白 / 404 / 读不到配置"，而不是编译错误。
 *
 * @module dsh-qiniu-usage/test/contract
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { API_PREFIX as HOST_API_PREFIX, makeRoutes } from '../src/routes.ts'
import { SETTINGS_NAMESPACE } from '../src/config.ts'
import { API_PREFIX as CLIENT_API_PREFIX } from '../src/client/usage-store.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 客户端源码里"必须与宿主一致"的字面量。 */
async function clientIndexSource(): Promise<string> {
  return readFile(resolve(root, 'src/client/index.ts'), 'utf8')
}

describe('跨半区契约 · 路由前缀', () => {
  it('客户端与宿主的 API 前缀一致', () => {
    assert.equal(
      CLIENT_API_PREFIX,
      HOST_API_PREFIX,
      '客户端 fetch 的前缀必须与宿主注册的路由前缀一致',
    )
  })

  it('前缀与包名一致（便于排查）', () => {
    assert.equal(HOST_API_PREFIX, '/api/dsh-qiniu-usage')
  })

  it('宿主注册的每条路由都以该前缀开头', () => {
    // 用一个最小替身取出路径即可，不需要真的调服务。
    const stub = {} as unknown as Parameters<typeof makeRoutes>[0]
    const paths = makeRoutes(stub).map((route) => route.path)
    assert.ok(paths.length >= 6, `路由数量异常：${paths.length}`)
    for (const path of paths) {
      assert.ok(path.startsWith(HOST_API_PREFIX), `${path} 未以 ${HOST_API_PREFIX} 开头`)
    }
    // 客户端会访问的路径必须都在宿主注册表里。
    for (const expected of [
      `${HOST_API_PREFIX}/overview`,
      `${HOST_API_PREFIX}/refresh`,
      `${HOST_API_PREFIX}/keys`,
      `${HOST_API_PREFIX}/respack/detail`,
      `${HOST_API_PREFIX}/credentials`,
    ]) {
      assert.ok(paths.includes(expected), `宿主缺少路由 ${expected}`)
    }
  })

  it('所有路由都是 exact 且 handler 是函数', () => {
    const stub = {} as unknown as Parameters<typeof makeRoutes>[0]
    for (const route of makeRoutes(stub)) {
      assert.equal(route.kind, 'exact', `${route.path} 应为 exact`)
      assert.equal(typeof route.handler, 'function', `${route.path} 缺少 handler`)
      assert.ok(!route.path.endsWith('/'), `${route.path} 不应以 / 结尾`)
    }
  })
})

describe('跨半区契约 · 设置命名空间与分区', () => {
  it('客户端绑定的命名空间与宿主注册的一致', async () => {
    const source = await clientIndexSource()
    assert.equal(
      SETTINGS_NAMESPACE,
      'dsh-qiniu-usage',
      '宿主命名空间应为本包名',
    )
    assert.ok(
      source.includes(`SETTINGS_NS = '${SETTINGS_NAMESPACE}'`),
      `客户端 SETTINGS_NS 必须等于宿主的 SETTINGS_NAMESPACE（${SETTINGS_NAMESPACE}）`,
    )
  })

  it('分区 order 为 152（紧跟使用统计的 151）', async () => {
    const source = await clientIndexSource()
    assert.ok(source.includes('SECTION_ORDER = 152'), '分区 order 应为 152')
  })

  it('locale 命名空间与包名一致', async () => {
    const source = await clientIndexSource()
    assert.ok(source.includes(`label: () => ctx.locale.bind(NS)`), 'label 应绑定本包 NS')
    assert.ok(source.includes(`locale: NS`), '分区应声明 locale 命名空间')
  })

  it('package.json 的 client.platform 与 bundle.patch 都已声明', async () => {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      dsh?: { client?: { platform?: string; inject?: string[] }; bundle?: { patch?: string } }
      exports?: Record<string, unknown>
    }
    assert.equal(pkg.dsh?.client?.platform, 'web')
    assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', '必须声明 patch，否则 dsh plugin add 不会挂上')
    assert.ok(pkg.exports?.['./client'] !== undefined, '必须导出 ./client 子路径')

    // dsh.client.inject 的语义是"包名"；这里断言不含服务名（写了会被静默忽略）。
    const inject = pkg.dsh?.client?.inject ?? []
    for (const entry of inject) {
      assert.ok(
        entry.startsWith('@') || entry.includes('/'),
        `dsh.client.inject 的 "${entry}" 看起来是服务名而不是包名（会被静默忽略）`,
      )
    }
  })

  it('cordis.patch.yml 插入的行 id 与包名正确', async () => {
    const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
    assert.ok(patch.includes('id: qiniu-usage'), 'patch 应插入 qiniu-usage 行')
    assert.ok(patch.includes('name: dsh-qiniu-usage'), 'patch 的 name 应为包名')
  })
})

describe('跨半区契约 · loader 装载形状（真实启动期踩过的坑）', () => {
  /**
   * 复刻 cordis-plugin-loader 的 `unwrapExports`：
   *
   * ```js
   * exports = exports.default ?? exports;
   * if (!exports.__esModule) return exports;
   * return exports.default ?? exports;
   * ```
   *
   * 宿主插件只要导出了 `default`，loader 就会拿到那个 `default` 而**丢掉整个模块
   * 命名空间** —— `inject` 随之消失，启动期就报
   * `cannot get property "webServer" without inject`。
   *
   * @param exports - 模块命名空间。
   * @returns loader 实际会拿去当插件的值。
   */
  function unwrapExports(exports: unknown): unknown {
    if (exports === null || exports === undefined) return exports
    let value = (exports as { default?: unknown }).default ?? exports
    if (!(value as { __esModule?: boolean }).__esModule) return value
    value = (value as { default?: unknown }).default ?? value
    return value
  }

  it('loader 归一后必须仍能读到 inject 与 apply（即：不能导出 default）', async () => {
    const hostBundle = resolve(root, 'lib/index.js')
    assert.ok(existsSync(hostBundle), '宿主产物不存在，先运行 npm run build:js')

    const namespace = (await import(hostBundle)) as Record<string, unknown>
    const plugin = unwrapExports(namespace) as Record<string, unknown>

    assert.ok(
      plugin !== null && typeof plugin === 'object',
      'loader 归一后拿到的不应是裸函数 —— 说明导出了 default，inject 会被丢弃',
    )
    assert.equal(typeof plugin.apply, 'function', 'loader 归一后必须能读到 apply')
    assert.deepEqual(
      Array.from((plugin.inject as string[]) ?? []),
      ['webServer'],
      'loader 归一后必须仍带 inject —— 否则启动期报 cannot get property webServer without inject',
    )
    assert.equal(plugin.name, 'dsh-qiniu-usage')
    assert.ok(
      namespace.default === undefined,
      '本模块不得导出 default：loader 的 unwrapExports 会优先取它并丢掉 inject',
    )
  })

  it('源码里也没有 export default（防止重新加回来）', async () => {
    const source = await readFile(resolve(root, 'src/index.ts'), 'utf8')
    assert.ok(
      !/^\s*export\s+default\b/m.test(source),
      'src/index.ts 不得出现 export default',
    )
  })
})

describe('跨半区契约 · 安全边界', () => {
  it('客户端源码不 import 任何宿主模块', async () => {
    const source = await clientIndexSource()
    // 客户端可以 import 类型（`import type`），但不能 import 宿主的运行时代码。
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\b)([^\n]+)$/gm)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined)
    for (const statement of runtimeImports) {
      assert.ok(
        !statement.includes('../../') && !statement.includes('../service') && !statement.includes('../credentials'),
        `客户端不应运行时 import 宿主代码：${statement}`,
      )
    }
  })

  it('客户端 store 不出现任何绝对地址或外部端点', async () => {
    const source = await readFile(resolve(root, 'src/client/usage-store.ts'), 'utf8')
    // 客户端只能通过 API_PREFIX 走同源相对路径；出现协议或绝对地址即为越界。
    for (const forbidden of ['http://', 'https://', '//api.', 'api.qiniu.com', 'api.qnaigc.com']) {
      assert.ok(!source.includes(forbidden), `客户端不应出现外部地址：${forbidden}`)
    }
    assert.ok(source.includes('API_PREFIX}'), '请求应统一由 API_PREFIX 拼接')
  })

  it('客户端实际请求的路径都由 API_PREFIX 组成（行为断言）', async () => {
    // 静态正则容易被模板串绕开，所以这里用行为断言：跑一次 store，看它请求了什么。
    const { createUsageStore } = await import('../src/client/usage-store.ts')
    const requested: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requested.push(String(input))
      return new Response(JSON.stringify({ ok: true, usage: null, respack: null, errors: [], keys: [], credentials: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const store = createUsageStore({ fetchImpl })
    store.actions.start()
    store.actions.loadKeys()
    store.actions.loadCredentials()
    store.actions.loadDetail('abc123', 7)
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.ok(requested.length >= 4, `应发出至少 4 个请求，实际 ${requested.length}`)
    for (const url of requested) {
      assert.ok(
        url.startsWith(`${HOST_API_PREFIX}/`),
        `客户端请求了前缀之外的地址：${url}`,
      )
    }
    const joined = requested.join(' ')
    for (const endpoint of ['/overview', '/keys', '/credentials', '/respack/detail']) {
      assert.ok(joined.includes(endpoint), `客户端应访问 ${endpoint}`)
    }
  })
})
