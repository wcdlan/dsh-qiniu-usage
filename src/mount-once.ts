// 宿主单实例守卫。与 `@linxin666/dsh-usage/src/mount-once.ts` 同构（家族共享副本，
// 由 `scripts/sync-shared.mjs` 生成）。family bundle 给子行 id 加命名空间，Loader 允许
// 同一包的多份安装并存；但没有守卫时第二个实例会重复注册同一批路由、设置命名空间与
// 系统提示词段落而启动失败。注册表挂在 global symbol 上，因此同一包的两个模块实例
// （npm 副本 vs 仓库 link）仍共享同一判定结果。cordis 的 `ctx.effect` 会**立即**执行
// 回调，并把回调返回值当作 fiber 的 disposer —— 所以这里 `return` 注销函数而非就地执行。
// 改编自 `@linxin666/dsh-usage/src/mount-once.ts`（Apache-2.0），详见 NOTICE。

const MOUNTED = Symbol.for('dsh-web.mounted-plugins')

interface MountRegistry {
  [MOUNTED]?: Set<string>
}

function mountedSet(): Set<string> {
  const registry = globalThis as MountRegistry
  return (registry[MOUNTED] ??= new Set())
}

// 包装一个 cordis 插件 apply，使该包每进程至多运行一次：首次正常注册，fiber 销毁时
// 解除标记，之后同一包名的 mount 都是 no-op。
export function mountOnce<T extends (...args: any[]) => unknown>(packageName: string, fn: T): T {
  return ((...args: unknown[]) => {
    const mounted = mountedSet()
    if (mounted.has(packageName)) return
    mounted.add(packageName)
    const ctx = args[0] as { effect?: (effect: () => unknown) => unknown } | undefined
    ctx?.effect?.(() => () => {
      mounted.delete(packageName)
    })
    return fn(...args)
  }) as T
}
