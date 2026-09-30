import {strict as assert} from 'node:assert'
import {existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, it} from 'vitest'
import {Context} from '@deepseek-ai/cordis'
import type {WebRoute} from '@deepseek-ai/dsh-host-webserver'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_BUNDLE = resolve(root, 'lib/index.js')

// 复刻 cordis-plugin-loader 的 unwrapExports：`exports.default ?? exports`，再在 __esModule 时剥一层。
// 真事故：src/index.ts 曾导出 default，loader 取到裸函数、丢掉 inject，dsh web 启动即崩。
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

/** 最小 IncomingMessage 替身（本文件只走凭据路由，够用即可）。 */
function makeReq(method: string, body?: unknown): unknown {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
  return {
    method,
    url: '/api/dsh-qiniu-usage/credentials',
    headers: {
      host: '127.0.0.1:3080',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload !== undefined) yield payload
    },
    destroy: () => {},
  }
}

/** 已挂载的 fiber，测试结束要 dispose（否则 mountOnce 的全局登记会挡住后续用例）。 */
const mounted: { dispose(): unknown }[] = []

afterEach(() => {
  while (mounted.length > 0) {
    const fiber = mounted.pop()
    try {
      fiber?.dispose()
    } catch {
    }
  }
})

// 造一个装好 webServer 桩的 Context，并按 loader 的方式应用本插件。
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

  await new Promise((resolve) => setTimeout(resolve, 20))

  return { ctx, routes: stub.routes }
}

describe('宿主装载 · 走 cordis 的 inject 解析与应用', () => {
  it('提供 webServer 后插件能成功应用，并注册全部 5 条路由（路径唯一）', async () => {
    const { routes } = await bootPlugin()

    const paths = routes.map((route) => route.path).sort()
    assert.deepEqual(
      paths,
      [
        '/api/dsh-qiniu-usage/credentials',
        '/api/dsh-qiniu-usage/keys',
        '/api/dsh-qiniu-usage/overview',
        '/api/dsh-qiniu-usage/refresh',
        '/api/dsh-qiniu-usage/respack/detail',
      ].sort(),
      `注册到的路由与预期不符：${JSON.stringify(paths)}`,
    )
    // 桩服务不校验重名，但真实 webServer 会 —— 所以这里显式断言唯一性。
    assert.equal(new Set(paths).size, paths.length, '路径不得重复注册')
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
    assert.equal(routes.length, 5)

    // dispose 这次挂载的 fiber（afterEach 也会兜底）。
    const fiber = mounted.pop()
    fiber?.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(routes, [], 'fiber 销毁后路由应被 dispose')
  })

  it('凭据服务晚于插件激活时仍能被识别（惰性解析，真实踩过的坑）', async () => {
    const { ctx, routes } = await bootPlugin()
    const credsRoute = routes.find((route) => route.path.endsWith('/credentials'))
    assert.ok(credsRoute !== undefined)

    /** 调一次 /credentials 并解析响应体。 */
    const getCredentials = async (): Promise<Record<string, unknown>> => {
      const captured: { status?: number; body?: unknown } = {}
      const res = {
        writeHead: (status: number) => {
          captured.status = status
          return res
        },
        end: (payload?: string) => {
          captured.body = payload === undefined ? undefined : JSON.parse(payload)
        },
      } as unknown as Parameters<typeof credsRoute.handler>[1]
      await credsRoute.handler(
        makeReq('GET') as Parameters<typeof credsRoute.handler>[0],
        res,
      )
      return captured.body as Record<string, unknown>
    }

    // 插件 apply 时 credentials 还不存在（真实现象：并发应用 + 服务异步激活）
    const before = (await getCredentials()).credentials as { hasStore: boolean; accessKey: { writable: boolean } }
    assert.equal(before.hasStore, false, '服务未激活时应报告无凭据库')
    assert.equal(before.accessKey.writable, false, '无凭据库时表单应只读')

    // 之后才提供 credentials（复刻"提供方 fiber 稍后激活"）
    const store = { values: {} as Record<string, string>, sets: [] as string[] }
    const provideDisposer = ctx.provide('credentials', {
      resolve: async (ref: string) =>
        store.values[ref] === undefined ? undefined : { value: store.values[ref], source: 'file' },
      describe: async (ref: string) => ({
        configured: store.values[ref] !== undefined,
        writable: true,
      }),
      set: async (ref: string, value: string) => {
        store.sets.push(ref)
        store.values[ref] = value
      },
      unset: async (ref: string) => {
        delete store.values[ref]
      },
    } as never)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const after = (await getCredentials()).credentials as { hasStore: boolean; accessKey: { writable: boolean } }
    assert.equal(after.hasStore, true, '服务出现后必须实时识别 —— 不能缓存构造时的 undefined')
    assert.equal(after.accessKey.writable, true, '有凭据库后表单应变为可写')

    // 写入应真的落到凭据库
    const captured: { status?: number; body?: unknown } = {}
    const res = {
      writeHead: (status: number) => {
        captured.status = status
        return res
      },
      end: (payload?: string) => {
        captured.body = payload === undefined ? undefined : JSON.parse(payload)
      },
    } as unknown as Parameters<typeof credsRoute.handler>[1]
    await credsRoute.handler(
      makeReq('POST', { ref: 'QINIU_ACCESS_KEY', action: 'set', value: 'MY_AK' }) as Parameters<
        typeof credsRoute.handler
      >[0],
      res,
    )
    assert.deepEqual(store.sets, ['QINIU_ACCESS_KEY'], '应写入凭据库')
    assert.equal(store.values.QINIU_ACCESS_KEY, 'MY_AK')
    assert.ok(!JSON.stringify(captured.body).includes('MY_AK'), '响应不得回显凭据值')

    provideDisposer()
  })

  it('缺 settings 服务时走降级路径而不是崩溃', async () => {
    // bootPlugin 没有提供 settings，能成功 apply 本身就说明降级路径可用。
    const { routes } = await bootPlugin()
    assert.equal(routes.length, 5)
  })
})
