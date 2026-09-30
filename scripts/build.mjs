/**
 * 构建脚本：产物形态与 ModuleLoader 外壳契约见 DESIGN.md §15.9；esbuild 选项与
 * `test/client-graph.test.ts` 共用（见 scripts/build-options.mjs），测试不能另抄一份。
 *
 * `lib/types/**` 由 `tsc -p tsconfig.build.json` 单独产出（见 package.json）。
 *
 * @module dsh-qiniu-usage/scripts/build
 */

import {build} from 'esbuild'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    CLIENT_EXTERNALS,
    clientBuildOptions,
    hostBuildOptions,
    PACKAGE_NAME,
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

    // 先自检、后落盘：否则会留下写坏的 lib/client.js，而 test/bundle.test.ts 读的正是它。
  verifyClientBundleSource(wrapped)

  await mkdir(resolve(root, 'lib'), { recursive: true })
  await writeFile(resolve(root, 'lib/client.js'), wrapped, 'utf8')

  const bytes = Buffer.byteLength(wrapped, 'utf8')
  console.log(`  ✓ lib/client.js         (client, __ModuleLoader__, ${(bytes / 1024).toFixed(1)} KB)`)
}

// 落盘前自检：客户端产物必须满足 ModuleLoader 契约，形态漂移即构建失败（M0 验收的可执行版本）。
function verifyClientBundleSource(source) {
    // 白名单外的 require 一律构建期硬失败：曾因客户端取值导入把 node:crypto 拖进产物（§15.11）。
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

    // 出现裸文件路径形式的 react 实现说明 external 失效。
  if (/node_modules[\\/]react[\\/]/.test(source)) {
    throw new Error('客户端 bundle 里打进了 react 实现：exclude 配置失效')
  }

  console.log(`  ✓ client bundle 契约自检通过（${checks.length} 项）`)
}

async function main() {
  console.log(`构建 ${PACKAGE_NAME} …`)
  await mkdir(resolve(root, 'lib'), { recursive: true })
    // 先清旧类型声明：tsc 不会删除已改名/已删除模块留下的幽灵 .d.ts，它们会被当成仍然存在的 API。
  await rm(resolve(root, 'lib/types'), { recursive: true, force: true })
  await buildHost()
  await buildClient()
  console.log('JS 产物构建完成。类型声明由 tsc -p tsconfig.build.json 产出。')
}

await main()
