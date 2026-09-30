// 宿主半区（设计文档 §4）：`webServer` 注册 loopback-fenced JSON 路由，AK/SK 永不出现在浏览器侧。
// 可选依赖降级：缺 `credentials` 退回环境变量直读；缺 `settings` 不支持热更新；
// 缺 `webServer`（headless）则 `inject` 不满足，插件整个不装载。

import type {Context} from '@deepseek-ai/cordis'
// 仅类型：把 host-webserver 的 `ctx.webServer` 合并进 Context。抹掉这几行会让
// `ctx.settings` / `ctx.webServer` 报 TS2339 —— 纯副作用 import，没有绑定，别当冗余删。
import type {} from '@deepseek-ai/dsh-host-webserver'
// 仅类型：把 settings 的 `ctx.settings` 合并进 Context。
import type {} from '@deepseek-ai/dsh-settings'
import {Config, type Config as ConfigShape, resolveConfig, type ResolvedConfig, SETTINGS_NAMESPACE,} from './config.ts'
import {CredentialAccess} from './credentials.ts'
import {mountOnce} from './mount-once.ts'
import {makeRoutes} from './routes.ts'
import {QiniuUsageService} from './service.ts'

export const name = 'dsh-qiniu-usage'

/** 必需服务：headless profile 缺 `webServer` 时本插件不适用。 */
export const inject = ['webServer']

// 本模块绝不能有 `export default`：cordis-plugin-loader 的 `unwrapExports` 取
// `exports.default ?? exports`，一旦有 default，loader 拿到裸函数、整个命名空间（含
// `inject` 与 `name`）被丢弃，启动期抛 `cannot get property "webServer" without inject`。
// `test/contract.test.ts` 有回归测试直接复刻 `unwrapExports` 钉住这一点。

export { Config, SETTINGS_NAMESPACE, resolveConfig }
export type { ConfigShape, ResolvedConfig }

// 包标识：所有安装来源共享。
const PACKAGE_NAME = 'dsh-qiniu-usage'

// 被 {@link mountOnce} 包装：同一进程内重复 mount 会变成 no-op；`config` 作为设置命名空间的 base 层与回退值。
export const apply = mountOnce(PACKAGE_NAME, (ctx: Context, config?: ConfigShape): void => {
    // 当前权威配置来源；`installSection` 会在挂载时分派真实来源。
  let source: () => ConfigShape = () => config ?? {}
  let resolved: ResolvedConfig | undefined
    // 当前服务实例；配置或设置源变化时整体重建以清空响应缓存。
  let service: QiniuUsageService | undefined
  let disposeRoutes: (() => void) | undefined

  const currentConfig = (): ResolvedConfig => {
    resolved ??= resolveConfig(source())
    return resolved
  }

  const teardown = (): void => {
    disposeRoutes?.()
    disposeRoutes = undefined
    service = undefined
  }

    // 配置热更新时整体重建而不是复用实例：缓存键含时区与 TTL，复用会让旧配置结果漏到新配置下。
  const rearm = (): void => {
    const current = currentConfig()

    if (!current.enabled) {
      teardown()
      return
    }

    if (service === undefined) {
      const next = new QiniuUsageService({
        config: current,
        credentials: CredentialAccess.fromContext(ctx),
      })
      service = next
      const disposers = makeRoutes(next).map((route) => ctx.webServer.register(route))
      disposeRoutes = () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // 路由 fiber 已经随 shutdown 消失。
          }
        }
      }
      return
    }

    service.applyConfig(current)
  }

  // 可选依赖：设置服务。缺失时只用启动期 config，不支持热更新。
  ctx.inject(['settings'], (settingsCtx) => {
    try {
      if (typeof settingsCtx.settings?.installSection !== 'function') return
      settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config ?? {}, {
        setSource: (next) => {
          source = next
          resolved = undefined
          rearm()
        },
        onChange: () => {
          resolved = undefined
          rearm()
        },
      })
    } catch {
      // 设置服务形态存在差异时不致命：退回"只有启动期 config"的模式。
    }
  })

  ctx.effect(
    () => {
      rearm()
      return () => {
        teardown()
        resolved = undefined
      }
    },
    'dsh-qiniu-usage: runtime',
  )
})
