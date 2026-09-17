/**
 * dsh-qiniu-usage 宿主半区。
 *
 * 职责（设计文档 §4）：
 *
 * - 通过 `webServer` 注册 loopback-fenced 的 JSON 路由，作为浏览器唯一的数据入口。
 * - 在宿主进程内解析凭据、签名并调用七牛上游；**AK/SK 永不出现在浏览器侧**。
 * - 通过 `settings.installSection` 挂载设置命名空间并支持热更新。
 * - 可选依赖：缺 `credentials` 时降级为环境变量直读；缺 `settings` 时只用启动期
 *   config；缺 `webServer`（headless profile）时整个插件静默空转，不报错。
 *
 * M0 阶段只落地脚手架与签名器：此处注册路由与服务的部分留到 M1/M2 填充，
 * 但生命周期骨架（mountOnce、settings 热更新、卸载清理）现在就搭好，
 * 以免后续改动波及。
 *
 * @module dsh-qiniu-usage
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：把 host-webserver 的 `ctx.webServer` 合并进 Context。
import type {} from '@deepseek-ai/dsh-host-webserver'
// 仅类型：把 settings 的 `ctx.settings` 合并进 Context。
import type {} from '@deepseek-ai/dsh-settings'
import { Config, SETTINGS_NAMESPACE, resolveConfig, type Config as ConfigShape, type ResolvedConfig } from './config.ts'
import { mountOnce } from './mount-once.ts'

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
  /** 归一化后的配置缓存；`undefined` 表示需要在下次读取时重算。 */
  let resolved: ResolvedConfig | undefined

  /**
   * 使配置缓存失效。
   *
   * `installSection` 的 `onChange` 与 `setSource` 都会调用它；M1 起还要在这里
   * 失效 service 的响应缓存键。
   */
  const invalidate = (): void => {
    resolved = undefined
  }

  // 可选依赖：设置服务。缺失时只用启动期 config，不支持热更新。
  ctx.inject(['settings'], (settingsCtx) => {
    try {
      if (typeof settingsCtx.settings?.installSection !== 'function') return
      settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config ?? {}, {
        setSource: (next) => {
          source = next
          invalidate()
        },
        onChange: invalidate,
      })
    } catch {
      // 设置服务形态存在差异时不致命：退回"只有启动期 config"的模式。
    }
  })

  ctx.effect(
    () => {
      const current = resolveConfig(source())
      resolved = current

      // M0：无路由、无服务。M1 起在此按 current 装配 QiniuUsageService 并注册路由，
      // 卸载时需返回 disposer 以 dispose 路由、清定时器。
      void resolved

      return () => {
        resolved = undefined
      }
    },
    'dsh-qiniu-usage: runtime',
  )
})

export default apply
