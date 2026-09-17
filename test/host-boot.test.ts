/**
 * 宿主装载测试：用真 cordis Context 实际 apply 一次插件。
 *
 * 这个文件的存在理由是**一次真实事故**：`src/index.ts` 曾经导出 `export default apply`，
 * loader 的 `unwrapExports` 优先取 `default`，于是拿到一个裸函数、丢掉模块命名空间的
 * `inject`，`dsh web` 启动期直接抛：
 *
 * ```
 * Error: dsh: plugin tree failed to load: … cannot get property "webServer" without inject
 * ```
 *
 * 单测与产物契约测试当时全绿也没拦住它 —— 因为它们只检查"模块导出了什么"，
 * 没有走 **cordis 的 inject 解析 + 应用** 这条路。所以这里补齐：
 * 提供 `webServer` 桩服务 → 应用插件 → 断言路由真的注册上了。
 *
 * @module dsh-qiniu-usage/test/host-boot
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_BUNDLE = resolve(root, 'lib/index.js')

/**
 * 复刻 cordis-plugin-loader 的 `unwrapExports`。
 *
 * 真实实现在 `cordis-plugin-loader/lib/index.js`：`exports = exports.default ?? exports`，
 * 再在 `__esModule` 时再剥一层。
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

/** 一个 webServer 桩服务，记录注册的路由。 */
function makeWebServerStub(): { service: unknown; routes: WebRoute[]; disposed: number } {
  const routes: WebRoute[] = []
  const state = { disposed: 0 }
  const service = {
    register(route: WebRoute): () => void {
      routes.push(route)
      return () => {
        state.disposed += 1
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }
  return {
    service,
    routes,
    get disposed() {
      return state.disposed
    },
  } as { service: unknown; routes: WebRoute[]; disposed: number }
}

/** 已挂载的 fiber，测试结束要 dispose（否则 mountOnce 的全局登记会挡住后续用例）。 */
const mounted: { dispose(): unknown }[] = []

afterEach(() => {
  while (mounted.length > 0) {
    const fiber = mounted.pop()
    try {
      fiber?.dispose()
    } catch {
      // 已经处理过。
    }
  }
})

/**
 * 造一个装好桩服务的 Context，并按 loader 的方式应用本插件。
 *
 * @param config - 插件配置。
 * @returns Context、桩与注册到的路由。
 */
async function bootPlugin(config: Record<string, unknown> = {}): Promise<{
  ctx: Context
  routes: WebRoute[]
}> {
  assert.ok(existsSync(HOST_BUNDLE), '宿主产物不存在，先运行 npm run build:js')

  const namespace = (await import(HOST_BUNDLE)) as Record<string, unknown>
  const plugin = unwrapExports(namespace) as { inject?: string[]; apply?: unknown }

  assert.ok(
    plugin !== null && typeof plugin === 'object' && Array.isArray(plugin.inject),
    'loader 归一后必须拿到带 inject 的插件对象 —— 拿到裸函数说明又导出了 default',
  )

  const ctx = new Context()
  const stub = makeWebServerStub()
  // 与 DSH 启动时一致：webServer 是必需依赖，插件通过 ctx.webServer 读取。
  ctx.provide('webServer', stub.service)

  const fiber = ctx.plugin(plugin as unknown as Parameters<Context['plugin']>[0], config as never)
  mounted.push(fiber as unknown as { dispose(): unknown })

  // 让 effect / inject 回调有机会跑完。
  await new Promise((resolve) => setTimeout(resolve, 20))

  return { ctx, routes: stub.routes }
}

describe('宿主装载 · 走 cordis 的 inject 解析与应用', () => {
  it('提供 webServer 后插件能成功应用，并注册全部 6 条路由', async () => {
    const { routes } = await bootPlugin()

    const paths = routes.map((route) => route.path).sort()
    assert.deepEqual(
      paths,
      [
        '/api/dsh-qiniu-usage/credentials',
        '/api/dsh-qiniu-usage/credentials',
        '/api/dsh-qiniu-usage/keys',
        '/api/dsh-qiniu-usage/overview',
        '/api/dsh-qiniu-usage/refresh',
        '/api/dsh-qiniu-usage/respack/detail',
      ].sort(),
      `注册到的路由与预期不符：${JSON.stringify(paths)}`,
    )
    for (const route of routes) {
      assert.equal(route.kind, 'exact')
      assert.equal(typeof route.handler, 'function')
    }
  })

  it('没有 webServer 服务时插件不会被应用（inject 未满足）', async () => {
    assert.ok(existsSync(HOST_BUNDLE), '宿主产物不存在，先运行 npm run build:js')
    const namespace = (await import(HOST_BUNDLE)) as Record<string, unknown>
    const plugin = unwrapExports(namespace) as { inject?: string[] }

    const ctx = new Context()
    let applied = false
    // 包一层以便观察 apply 是否被真正调用。
    const wrapped = {
      name: 'dsh-qiniu-usage-probe',
      inject: plugin.inject,
      apply: () => {
        applied = true
      },
    }
    const fiber = ctx.plugin(wrapped as unknown as Parameters<Context['plugin']>[0], {} as never)
    mounted.push(fiber as unknown as { dispose(): unknown })
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(applied, false, 'webServer 缺失时不应应用 —— headless profile 下插件应静默空转')
  })

  it('enabled=false 时不注册任何路由', async () => {
    const { routes } = await bootPlugin({ enabled: false })
    assert.deepEqual(routes, [], '禁用时不应注册路由')
  })

  it('卸载时 dispose 掉全部路由', async () => {
    const { ctx, routes } = await bootPlugin()
    assert.equal(routes.length, 6)

    // dispose 这次挂载的 fiber（afterEach 也会兜底）。
    const fiber = mounted.pop()
    fiber?.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(routes, [], 'fiber 销毁后路由应被 dispose')
  })

  it('缺 settings 服务时走降级路径而不是崩溃', async () => {
    // bootPlugin 没有提供 settings，能成功 apply 本身就说明降级路径可用。
    const { routes } = await bootPlugin()
    assert.equal(routes.length, 6)
  })
})
