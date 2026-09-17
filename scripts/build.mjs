/**
 * 构建脚本。
 *
 * 三个产物的 esbuild 选项统一放在 `scripts/build-options.mjs` —— 构建回归测试
 * （`test/client-graph.test.ts`）必须用同一份选项，否则脚本改坏了测试也照样绿。
 *
 * 产出三个目标：
 *
 * 1. `lib/index.js` —— 宿主半区，自包含 ESM。
 *    对照参考产物（`@linxin666/dsh-usage/lib/index.js`）确认过：宿主 bundle
 *    不含任何外部 `require`，schemastery 等依赖都是打进去的。所以这里也
 *    `external: []`，避免在 profile 环境里因依赖解析失败而装不上。
 *
 * 2. `lib/client.js` —— 客户端半区，必须是
 *    `window.__ModuleLoader__.load({ id, factory })` 形态的自包含产物。
 *    内层用 esbuild 打成 CJS（`exports.apply = apply` 形态），外层再套
 *    ModuleLoader 外壳 —— 形态与 `@linxin666/dsh-usage` / `dsh-feng-gu`
 *    的产物逐项对齐：
 *
 *    ```js
 *    window.__ModuleLoader__.load({
 *      id: "<pkg>",
 *      factory: (require) => {
 *        var module = { exports: {} };
 *        var exports = module.exports;
 *        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
 *        <内层 CJS 产物>
 *        return module.exports;
 *      }
 *    });
 *    ```
 *
 *    注意 `Object.defineProperty` 必须在内层产物**之前** —— 内层开头就会
 *    `require("react")`，而 defineProperty 决定 exports 是否被识别为模块。
 *
 * 3. `lib/types/**` —— 由 `tsc -p tsconfig.build.json` 单独产出（见 package.json）。
 *
 * 浏览器运行时只保证提供 `react` 与 `react/jsx-runtime`（宿主冻结模块表），
 * 其余一律打进 bundle —— 所以这两个是唯一 external。
 *
 * @module dsh-qiniu-usage/scripts/build
 */

import { build } from 'esbuild'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLIENT_EXTERNALS,
  PACKAGE_NAME,
  clientBuildOptions,
  hostBuildOptions,
  wrapClientBundle,
} from './build-options.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function buildHost() {
  await build(hostBuildOptions(root))
  console.log('  ✓ lib/index.js          (host, esm, self-contained)')
}

async function buildClient() {
  const result = await build(clientBuildOptions(root))

  const inner = result.outputFiles[0].text
  const wrapped = wrapClientBundle(inner)

  // 先自检、后落盘。反过来的话，自检失败会留下一个**已经写坏**的
  // lib/client.js —— 而 `test/bundle.test.ts` 读的正是磁盘上这个文件，
  // 于是"构建失败"会污染成"测试失败"，让人查错方向。
  verifyClientBundleSource(wrapped)

  await mkdir(resolve(root, 'lib'), { recursive: true })
  await writeFile(resolve(root, 'lib/client.js'), wrapped, 'utf8')

  const bytes = Buffer.byteLength(wrapped, 'utf8')
  console.log(`  ✓ lib/client.js         (client, __ModuleLoader__, ${(bytes / 1024).toFixed(1)} KB)`)
}

/**
 * 落盘前自检：客户端产物必须满足 ModuleLoader 契约。
 *
 * 这几条断言是 M0 验收标准里"打通 lib/client.js 构建格式"的可执行版本 ——
 * 形态一旦漂移，构建就会失败而不是等到浏览器里才发现。
 *
 * @param source - 套好 ModuleLoader 外壳、尚未落盘的产物源码。
 * @throws 当产物不满足契约时。
 */
function verifyClientBundleSource(source) {
  // 产物里的每个 `require("…")` 都必须落在白名单内。
  //
  // 这条是踩坑后加的：`sumMonthRemain` 当初放在 `qiniu/respack.ts`，而那个模块
  // 经由 `sign.ts` 依赖 `node:crypto`，浏览器产物直接从取值导入处炸掉。esbuild
  // 的报错在宿主产物已经打印成功之后，容易被只看半截日志的人略过 —— 这里把
  // "产物里不许出现白名单外的模块请求"变成构建期硬失败。
  const requires = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
  const outsiders = [...new Set(requires)].filter((name) => !CLIENT_EXTERNALS.includes(name))

  const checks = [
    ['以 window.__ModuleLoader__.load( 开头', source.startsWith('window.__ModuleLoader__.load(')],
    ['注册 id 为包名', source.includes(`id: ${JSON.stringify(PACKAGE_NAME)},`)],
    ['factory 接收 require', source.includes('factory: (require) => {')],
    ['先声明 module.exports', source.includes('var module = { exports: {} };')],
    ['定义 Symbol.toStringTag', source.includes('Symbol.toStringTag')],
    ['返回 module.exports', source.includes('return module.exports;')],
    ['react 走 require（未被打进 bundle）', source.includes('require("react")')],
    ['产物内的外部模块请求都在白名单内', outsiders.length === 0],
  ]

  const failures = checks.filter(([, ok]) => !ok).map(([label]) => label)
  if (failures.length > 0) {
    const detail = outsiders.length === 0 ? '' : `\n  白名单外的请求：${outsiders.join(', ')}`
    throw new Error(
      `客户端 bundle 不符合 __ModuleLoader__ 契约：\n  - ${failures.join('\n  - ')}${detail}`,
    )
  }

  // 内层产物不应包含裸文件路径形式的 react 实现（说明 external 生效了）。
  if (/node_modules[\\/]react[\\/]/.test(source)) {
    throw new Error('客户端 bundle 里打进了 react 实现：exclude 配置失效')
  }

  console.log(`  ✓ client bundle 契约自检通过（${checks.length} 项）`)
}

async function main() {
  console.log(`构建 ${PACKAGE_NAME} …`)
  await mkdir(resolve(root, 'lib'), { recursive: true })
  await buildHost()
  await buildClient()
  console.log('JS 产物构建完成。类型声明由 tsc -p tsconfig.build.json 产出。')
}

await main()
