/**
 * 构建脚本。
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
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 包名：与 package.json 的 name 一致，也是 ModuleLoader 的注册 id。 */
const PACKAGE_NAME = 'dsh-qiniu-usage'

/** 浏览器冻结模块表里可用的外部模块。 */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

/**
 * 套上 ModuleLoader 外壳。
 *
 * @param inner - esbuild 产出的 CJS 代码。
 * @returns 可直接被浏览器执行的 bundle 源码。
 */
function wrapClientBundle(inner) {
  // 内层产物自带 sourceMappingURL 注释，挪到最外层以免指向错位。
  const withoutMap = inner.replace(/\n?\/\/# sourceMappingURL=.*(\n|$)/, '\n')
  // esbuild 用两空格缩进，这里统一转成两制表符，保持产物可读且与参考产物风格一致。
  const indented = withoutMap
    .split('\n')
    .map((line) => {
      if (line.length === 0) return line
      const match = /^( +)/.exec(line)
      const levels = match === null ? 0 : Math.floor(match[1].length / 2)
      const body = line.slice(match === null ? 0 : match[1].length)
      return `\t\t${'\t'.repeat(levels)}${body}`
    })
    .join('\n')

  return `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PACKAGE_NAME)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${indented}\t\treturn module.exports;
\t}
});
`
}

async function buildHost() {
  await build({
    entryPoints: [resolve(root, 'src/index.ts')],
    outfile: resolve(root, 'lib/index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    // 与参考产物一致：宿主半区自包含，无外部 require。
    external: [],
    logLevel: 'warning',
  })
  console.log('  ✓ lib/index.js          (host, esm, self-contained)')
}

async function buildClient() {
  const result = await build({
    entryPoints: [resolve(root, 'src/client/index.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: CLIENT_EXTERNALS,
    sourcemap: false,
    write: false,
    logLevel: 'warning',
  })

  const inner = result.outputFiles[0].text
  const wrapped = wrapClientBundle(inner)

  await mkdir(resolve(root, 'lib'), { recursive: true })
  await writeFile(resolve(root, 'lib/client.js'), wrapped, 'utf8')

  const bytes = Buffer.byteLength(wrapped, 'utf8')
  console.log(`  ✓ lib/client.js         (client, __ModuleLoader__, ${(bytes / 1024).toFixed(1)} KB)`)
}

/**
 * 构建后自检：客户端产物必须满足 ModuleLoader 契约。
 *
 * 这几条断言是 M0 验收标准里"打通 lib/client.js 构建格式"的可执行版本 ——
 * 形态一旦漂移，构建就会失败而不是等到浏览器里才发现。
 *
 * @throws 当产物不满足契约时。
 */
async function verifyClientBundle() {
  const source = await readFile(resolve(root, 'lib/client.js'), 'utf8')

  const checks = [
    ['以 window.__ModuleLoader__.load( 开头', source.startsWith('window.__ModuleLoader__.load(')],
    ['注册 id 为包名', source.includes(`id: ${JSON.stringify(PACKAGE_NAME)},`)],
    ['factory 接收 require', source.includes('factory: (require) => {')],
    ['先声明 module.exports', source.includes('var module = { exports: {} };')],
    ['定义 Symbol.toStringTag', source.includes('Symbol.toStringTag')],
    ['返回 module.exports', source.includes('return module.exports;')],
    ['react 走 require（未被打进 bundle）', source.includes('require("react")')],
  ]

  const failures = checks.filter(([, ok]) => !ok).map(([label]) => label)
  if (failures.length > 0) {
    throw new Error(
      `客户端 bundle 不符合 __ModuleLoader__ 契约：\n  - ${failures.join('\n  - ')}`,
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
  await verifyClientBundle()
  console.log('JS 产物构建完成。类型声明由 tsc -p tsconfig.build.json 产出。')
}

await main()
