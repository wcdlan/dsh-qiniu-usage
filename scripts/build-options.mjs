/**
 * 构建选项 —— `scripts/build.mjs` 与 `test/client-graph.test.ts` 共用。
 *
 * 抽出来的唯一目的是**避免两处漂移**：如果测试自己再写一份 esbuild 配置，那
 * 构建脚本改坏了（比如把 `platform` 从 `browser` 改成 `node`），测试仍会
 * 通过，回归就会重新漏出去。测试必须用**真实构建用的同一份选项**。
 *
 * @module dsh-qiniu-usage/scripts/build-options
 */

import { resolve } from 'node:path'

/** 包名：与 package.json 的 name 一致，也是 ModuleLoader 的注册 id。 */
export const PACKAGE_NAME = 'dsh-qiniu-usage'

/**
 * 浏览器冻结模块表里可用的外部模块。
 *
 * 宿主只提供 `react`；`react-dom` / `react-dom/client` 见于参考产物的用法，
 * 一并放行（早期一次 `意外的外部模块请求：react-dom/client` 就是漏了它）。
 */
export const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

/**
 * 宿主半区构建选项：自包含 ESM，对照参考产物确认过不含外部 `require`。
 *
 * JSDoc 里写明 `BuildOptions` 是必要的：测试用 `allowJs` 把本文件纳入了 TS
 * 程序，若不标注，TS 会把 `format` 推成 `string` 而不是 `'esm'` 字面量，
 * `build(...)` 调用处就会报类型不兼容。
 *
 * @param {string} root - 仓库根目录。
 * @returns {import('esbuild').BuildOptions} esbuild 构建选项。
 */
export function hostBuildOptions(root) {
  return {
    entryPoints: [resolve(root, 'src/index.ts')],
    outfile: resolve(root, 'lib/index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    external: [],
    logLevel: 'warning',
  }
}

/**
 * 客户端半区构建选项：浏览器 CJS + ModuleLoader 外壳，只留 react 系列 external。
 *
 * `write: false` —— 产物要交给 {@link wrapClientBundle} 套壳后再落盘。
 *
 * @param {string} root - 仓库根目录。
 * @returns {import('esbuild').BuildOptions} esbuild 构建选项。
 */
export function clientBuildOptions(root) {
  return {
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
  }
}

/**
 * 套上 ModuleLoader 外壳。
 *
 * `Object.defineProperty` 必须在内层产物**之前** —— 内层开头就会
 * `require("react")`，而 defineProperty 决定 exports 是否被识别为模块。
 *
 * @param {string} inner - esbuild 产出的 CJS 代码。
 * @returns {string} 可直接被浏览器执行的 bundle 源码。
 */
export function wrapClientBundle(inner) {
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
