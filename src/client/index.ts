/**
 * dsh-qiniu-usage 浏览器半区。
 *
 * 只做四件事：注册文案字典、绑定设置命名空间、落一个一级设置分区、渲染面板。
 * 所有凭据处理与上游调用都在宿主半区完成 —— 这个 bundle 里不存在任何读取
 * AK/SK 的路径（`test/bundle.test.ts` 会断言这一点）。
 *
 * 轮询与取数都挂在**组件挂载周期**上：设置页关闭 → 零请求。
 *
 * @module dsh-qiniu-usage/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 仅类型：拉入 ctx.locale / ctx.slots / ctx.settingsScope / connection 的 Context 合并。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  SettingsScope,
  SettingsScopeSpec,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SlotComponent, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Config } from '../config.ts'
import { NS, en, zh } from './locales.ts'
import { UsageSection, type UsageSectionFace } from './UsageSection.tsx'
import { createUsageStore } from './usage-store.ts'

/**
 * 必需服务。
 *
 * **注意**：这是 cordis 服务名，与 package.json 里 `dsh.client.inject` 的
 * **包名**列表是两回事，不要互相抄。
 */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/** 一级设置分区位置：紧跟「使用统计」（order 151）之后。 */
const SECTION_ORDER = 152

/** 设置命名空间；必须与宿主半区的 `SETTINGS_NAMESPACE` 一致。 */
const SETTINGS_NS = 'dsh-qiniu-usage'

/** 分区 ID。 */
const SECTION_ID = 'dsh-qiniu-usage'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * rc.6 兼容 binder，由 dsh-web-settings 提供；该 group plugin 未安装时缺失，
     * 因此调用方必须回退到官方 `ctx.settingsScope`。
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

/** 注入给面板的面的形状（与 {@link UsageSectionFace} 一致，这里再导出一次）。 */
export type { UsageSectionFace, UsageSectionProps } from './UsageSection.tsx'

/**
 * 客户端插件主体。
 *
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-qiniu-usage: dictionaries')

  // 设置作用域：兼容 binder 优先，缺失时回退官方服务。
  let settingsScope: SettingsScope<Config> | undefined
  try {
    const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
    settingsScope = binder.bind<Config>({ namespace: SETTINGS_NS })
  } catch {
    // 设置服务形态存在差异时不致命：面板仍可用，只是读不到用户配置的轮询间隔。
    settingsScope = undefined
  }

  // 一个 apply body 一个 store；组件挂载/卸载由 store 的 start/stop 管生命周期，
  // store 本身在会话内保留，因此再次打开设置页能立即渲染上次的数据。
  //
  // 轮询间隔来自用户配置，而配置是异步同步过来的 —— 所以初始为 0（纯手动），
  // 待设置作用域给出 `pollIntervalSec > 0` 时按该值重建 store。
  const store = createUsageStore({ pollIntervalMs: 0 })

  try {
    const applySettings = (): void => {
      const configured = settingsScope?.getSnapshot().value?.pollIntervalSec
      store.actions.setPollIntervalMs(typeof configured === 'number' ? configured * 1000 : 0)
    }
    applySettings()
    settingsScope?.subscribe(applySettings)
  } catch {
    // 读不到配置就保持纯手动刷新。
  }

  /**
   * 注入面工厂。
   *
   * `t` 从当前 locale 绑定；每次注入时重新绑定，因此语言切换后面板文案会跟随。
   */
  const face = (): UsageSectionFace => {
    const bound = ctx.locale.bind(NS) as unknown as TranslateNS<typeof NS>
    return {
      store,
      ...(settingsScope === undefined ? {} : { settings: settingsScope }),
      t: (key, params) => bound(key as Parameters<typeof bound>[0], params),
    }
  }

  ctx.slots.inject('settings.section', () => {
    try {
      const unregister = ctx.slots.register(
        {
          name: 'settings.section',
          id: SECTION_ID,
          order: SECTION_ORDER,
          label: () => ctx.locale.bind(NS)('qiniu.title'),
          locale: NS,
          inject: face,
        },
        UsageSection as SlotComponent<{ face?: UsageSectionFace }>,
      )
      return () => {
        unregister()
      }
    } catch {
      return () => {}
    }
  })
}
