/**
 * 宿主单实例守卫。
 *
 * 与 `@linxin666/dsh-usage/src/mount-once.ts` 同构（该文件是 web 插件家族的
 * 共享副本，由 `scripts/sync-shared.mjs` 生成）。语义：
 *
 * - family bundle 会给每个子行 id 加命名空间（`web-ui-*`），因此 Loader 允许
 *   同一包的独立安装与之并存；但没有这道守卫时，第二个实例仍会重复注册同一批
 *   webserver 路由、设置命名空间与系统提示词段落，导致启动失败。
 * - `mountOnce` 让第二次 mount 在第一个实例存活期间变成 no-op。
 * - 注册表挂在 global symbol 上，因此同一包的两个模块实例（npm 副本 vs 仓库
 *   link）仍共享同一个判定结果。
 * - cordis 的 `ctx.effect` 会**立即**执行回调，并把回调的返回值当作 fiber 的
 *   disposer —— 所以这里 `return` 的是注销函数，而不是就地执行它。
 *
 * @module dsh-qiniu-usage/mount-once
 *
 * 来源声明：改编自 `@linxin666/dsh-usage/src/mount-once.ts`（Apache-2.0），
 * 该文件本身由 `scripts/sync-shared.mjs` 从共享源生成。此处的语义被**刻意**
 * 保留不变，以便同一进程内两个插件共享同一个判定结果。详见 NOTICE。
 */

const MOUNTED = Symbol.for('dsh-web.mounted-plugins')

interface MountRegistry {
  [MOUNTED]?: Set<string>
}

function mountedSet(): Set<string> {
  const registry = globalThis as MountRegistry
  return (registry[MOUNTED] ??= new Set())
}

/**
 * 包装一个 cordis 插件 apply，使该包在每个进程内至多运行一次。
 *
 * 首次 mount 正常注册，并在其 fiber 销毁时解除标记；之后任何对同一包名的
 * mount 都是 no-op。
 *
 * @param packageName - 所有安装来源共享的 npm 包标识。
 * @param fn - 原始插件 apply。
 * @returns 形态相同的 apply。
 */
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
