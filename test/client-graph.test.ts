/**
 * 客户端半区**依赖图**测试：用真实构建选项把 `src/client/index.ts` 打成
 * 浏览器 bundle，断言它真的打得出来。
 *
 * 为什么需要这个文件：`test/bundle.test.ts` 检查的是**磁盘上的产物**
 * （`lib/client.js`），而产物的时间戳可能早于源码 —— 源码改坏之后
 * `lib/client.js` 还是上一次构建留下的旧文件，测试照样全绿。真踩过：
 * `sumMonthRemain` 一度放在 `src/qiniu/respack.ts`，那里经由 `sign.ts`
 * 依赖 `node:crypto`，浏览器产物直接 `Could not resolve "node:crypto"`，
 * 但当时 `npm test` 是绿的（读的是旧产物），一直没发现，直到跑 `npm run build`。
 *
 * 所以这里**不读产物**，而是自己跑一次 esbuild —— 走的是
 * `scripts/build-options.mjs` 里构建脚本用的同一份选项，脚本改坏了这里也一起红。
 *
 * @module dsh-qiniu-usage/test/client-graph
 */

import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, it } from 'vitest'

import {
  CLIENT_EXTERNALS,
  clientBuildOptions,
  wrapClientBundle,
} from '../scripts/build-options.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 只构建一次的共享结果：esbuild 虽快，但没必要每个用例都跑一遍。 */
let cached: Promise<string> | undefined

/**
 * 用构建脚本的选项把客户端入口打成 bundle。
 *
 * @returns 套好 ModuleLoader 外壳的产物源码。
 */
function buildClientOnce(): Promise<string> {
  cached ??= (async () => {
    const result = await build(clientBuildOptions(root))
    const output = result.outputFiles?.[0]?.text
    assert.ok(output !== undefined, 'esbuild 没有产出 outputFiles')
    return wrapClientBundle(output)
  })()
  return cached
}

describe('客户端产出 · 依赖图', () => {
  it('宿主半区的 node 依赖不会渗进浏览器产物（能构建成功）', async () => {
    // 断言点就是"不抛异常"：`node:crypto` 之类一旦被取值导入，esbuild 在
    // platform=browser 下会以 `Could not resolve "node:crypto"` 直接失败。
    const source = await buildClientOnce()
    assert.ok(source.length > 0, '产物不应为空')
  })

  it('产物里不出现任何 node: 协议的内置模块', async () => {
    const source = await buildClientOnce()
    const builtins = [...new Set(source.match(/node:[a-z_/]+/g) ?? [])]
    assert.deepEqual(
      builtins,
      [],
      `浏览器产物里出现了 node 内置模块：${builtins.join(', ')}\n` +
        '  通常是客户端取值导入了宿主模块（宿主模块会 import sign.ts → node:crypto）。\n' +
        '  类型导入（import type）不受影响；纯函数请放到 src/client/ 下。',
    )
  })

  it('产物里的外部模块请求都在白名单内', async () => {
    const source = await buildClientOnce()
    // `noUncheckedIndexedAccess` 下 `m[1]` 是 `string | undefined`；捕获组必然
    // 存在，用 `?? ''` 收敛类型（空串不可能命中白名单）。
    const requests = [
      ...new Set([...source.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1] ?? '')),
    ]
    const outsiders = requests.filter((name) => !CLIENT_EXTERNALS.includes(name))
    assert.deepEqual(outsiders, [], `白名单外的模块请求：${outsiders.join(', ')}`)
    assert.ok(requests.includes('react'), 'react 应以 require 形式外置，而不是被打进 bundle')
  })

  it('产物满足 __ModuleLoader__ 契约', async () => {
    const source = await buildClientOnce()
    assert.ok(source.startsWith('window.__ModuleLoader__.load('), '必须走 ModuleLoader 注册')
    assert.ok(source.includes('id: "dsh-qiniu-usage",'), '注册 id 必须是包名')
    assert.ok(source.includes('factory: (require) => {'), 'factory 必须接收 require')
    // defineProperty 必须在内层产物之前 —— 内层开头就 require("react")。
    const defineAt = source.indexOf('Symbol.toStringTag')
    const firstRequireAt = source.indexOf('require("react")')
    assert.ok(defineAt >= 0 && firstRequireAt >= 0 && defineAt < firstRequireAt, 'exports 标记要先于内层产物')
  })

  it('悬浮按钮的余量汇总住在浏览器半区，宿主模块不再导出它', async () => {
    // 锁住上面那个坑的**修法**：纯展示函数留在 src/client/ 下，别放回
    // qiniu/respack.ts（那里会牵出 node:crypto）。行为本身见
    // test/respack-summary.test.ts。
    const clientSide = (await import('../src/client/respack-summary.ts')) as Record<string, unknown>
    assert.equal(typeof clientSide.sumMonthRemain, 'function', 'sumMonthRemain 必须在 client 半区')

    const hostSide = (await import('../src/qiniu/respack.ts')) as Record<string, unknown>
    assert.equal(
      hostSide.sumMonthRemain,
      undefined,
      '宿主模块又导出了 sumMonthRemain —— 客户端一旦取值导入它就会拉进 node:crypto',
    )
  })
})
