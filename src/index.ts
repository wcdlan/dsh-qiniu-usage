/**
 * dsh-qiniu-usage 宿主半区。
 *
 * 职责（设计文档 §4）：
 *
 * - 通过 `webServer` 注册 loopback-fenced 的 JSON 路由，作为浏览器唯一的数据入口。
 * - 在宿主进程内解析凭据、签名并调用七牛上游；**AK/SK 永不出现在浏览器侧**。
 * - 通过 `settings.installSection` 挂载设置命名空间并支持热更新。
 *
 * 可选依赖的降级：
 *
 * - 缺 `credentials` → {@link CredentialAccess} 自动退回环境变量直读（`writable=false`）。
 * - 缺 `settings` → 只用启动期 config，不支持热更新。
 * - 缺 `webServer`（headless profile）→ `inject` 不满足，插件整个不装载、不报错。
 *
 * @module dsh-qiniu-usage
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：把 host-webserver 的 `ctx.webServer` 合并进 Context。
import type {} from '@deepseek-ai/dsh-host-webserver'
// 仅类型：把 settings 的 `ctx.settings` 合并进 Context。
import type {} from '@deepseek-ai/dsh-settings'
import {
  Config,
  SETTINGS_NAMESPACE,
  resolveConfig,
  type Config as ConfigShape,
  type ResolvedConfig,
} from './config.ts'
import { CredentialAccess } from './credentials.ts'
import { mountOnce } from './mount-once.ts'
import { makeRoutes } from './routes.ts'
import { QiniuUsageService } from './service.ts'

export const name = 'dsh-qiniu-usage'

/** 必需服务：headless profile 缺 `webServer` 时本插件不适用。 */
export const inject = ['webServer']

export { Config, SETTINGS_NAMESPACE, resolveConfig }
export type { ConfigShape, ResolvedConfig }

/** 包标识：所有安装来源共享，用于 {@link mountOnce}。 */
const PACKAGE_NAME = 'dsh-qiniu-usage'

/**
 * 插件 apply。
 *
 * 被 {@link mountOnce} 包装：同一进程内重复 mount 会变成 no-op。
 *
 * @param ctx - cordis 宿主上下文。
 * @param config - 启动期配置（作为设置命名空间的 base 层与回退值）。
 */
export const apply = mountOnce(PACKAGE_NAME, (ctx: Context, config?: ConfigShape): void => {
  /** 当前权威配置来源；`installSection` 会在挂载时分派真实来源。 */
  let source: () => ConfigShape = () => config ?? {}
  /** 归一化后的配置缓存。 */
  let resolved: ResolvedConfig | undefined
  /** 当前服务实例；配置或设置源变化时整体重建，以清空响应缓存。 */
  let service: QiniuUsageService | undefined
  /** 已注册路由的 dispose 函数。 */
  let disposeRoutes: (() => void) | undefined

  /** 取当前归一化配置（惰性、带缓存）。 */
  const currentConfig = (): ResolvedConfig => {
    resolved ??= resolveConfig(source())
    return resolved
  }

  /** 拆除服务与路由。 */
  const teardown = (): void => {
    disposeRoutes?.()
    disposeRoutes = undefined
    service = undefined
  }

  /**
   * 按当前配置（重）装配服务与路由。
   *
   * 配置热更新时**整体重建**而不是复用实例：缓存键里含时区与 TTL，复用会让
   * 旧配置的结果漏到新配置下。
   */
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

    // 服务已在运行：只更新配置并清空缓存。
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

export default apply
