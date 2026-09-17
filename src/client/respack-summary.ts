/**
 * 资源包当月额度的展示层汇总。
 *
 * **为什么放在 `client/` 而不是 `qiniu/respack.ts`**：这个函数只服务于浏览器
 * 半区（悬浮按钮上的"余量"速览），而 `qiniu/respack.ts` 虽然大部分也是纯函数，
 * 却 `import` 了 `sign.ts`，`sign.ts` 又依赖 `node:crypto`。浏览器产物里只要从
 * 那个模块**取值导入**，esbuild 就会以
 * `Could not resolve "node:crypto"` 直接失败 —— 这个坑真踩过一次（宿主产物
 * 先构建成功、客户端产物才报错，容易只看到半截日志）。
 *
 * 类型导入不受影响：`import type` 在编译期就被抹掉，所以 `RespackMonth` /
 * `RespackPacks` 从 `qiniu/respack.ts` 引入类型是安全的。
 *
 * 这条边界由 `test/client-graph.test.ts` 用真实 esbuild 构建守住。
 *
 * @module dsh-qiniu-usage/client/respack-summary
 */

/**
 * 汇总"当月剩余"额度，用于悬浮按钮上的速览。
 *
 * **按单位分组后再求和**：不同单位的数值不能相加（`k/tokens` 与 `GB` 加在一起
 * 没有意义），所以只报**剩余量最大**的那一组，并在返回值里带上单位原文。
 * 面板里仍然逐项列出，不受这个汇总影响。
 *
 * @param items - `month-overview` 归一后的计费项。
 * @returns 剩余量与单位；没有计费项时返回 `undefined`。
 */
export function sumMonthRemain(
  items: { monthRemain: number; unit: string }[],
): { value: number; unit: string } | undefined {
  if (items.length === 0) return undefined
  const byUnit = new Map<string, number>()
  for (const item of items) {
    const remain = Number.isFinite(item.monthRemain) ? item.monthRemain : 0
    byUnit.set(item.unit, (byUnit.get(item.unit) ?? 0) + remain)
  }
  let best: { value: number; unit: string } | undefined
  for (const [unit, value] of byUnit) {
    if (best === undefined || value > best.value) best = { value, unit }
  }
  return best
}
