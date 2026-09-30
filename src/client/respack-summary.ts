// 资源包当月额度的展示层汇总。放在 `client/` 而非 `qiniu/respack.ts`：后者经 `sign.ts`
// 依赖 `node:crypto`，浏览器产物从它**取值导入**会让 esbuild 以
// `Could not resolve "node:crypto"` 失败（`import type` 在编译期抹掉，安全）。
// 这条边界由 `test/client-graph.test.ts` 用真实 esbuild 构建守住。

// 按单位分组后再求和：不同单位的数值不能相加，只报**剩余量最大**的那一组并带上单位原文。
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
