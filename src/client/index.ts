// 安全不变量：浏览器半区不存在任何读取 AK/SK 的路径，`test/bundle.test.ts` 断言这一点。
import type {Context as ClientContext} from '@deepseek-ai/cordis'
// 仅类型：拉入 ctx.locale / ctx.slots / connection 的 Context 合并。
import type {SlotComponent} from '@deepseek-ai/dsh-client-ui-slots'
import type {Config} from '../config.ts'
import {en, NS, zh} from './locales.ts'
import {mountSidebarCard, type SidebarCardHandle} from './sidebar-mount.tsx'
import {type Translate, UsageSection, type UsageSectionFace, type UsageSectionProps} from './UsageSection.tsx'
import type {SettingsScope, SettingsScopeBinder} from './settings-scope.ts'
import {createUsageStore} from './usage-store.ts'

/**
 * 必需服务：cordis 服务名，与 package.json `dsh.client.inject` 的包名列表是两回事。
 * 不要把 `settingsScope` 加回来：dsh 0.2.0 起客户端不再提供，声明为必需会让插件永远
 * pending。设置作用域走下面的 `ctx.inject(['webUiSettings'], …)` 可选注入。
 */
export const inject = ['slots', 'locale', 'connection', 'remote']

/** 一级设置分区位置：紧跟「使用统计」（order 151）之后。 */
const SECTION_ORDER = 152

/** 设置命名空间；必须与宿主半区的 `SETTINGS_NAMESPACE` 一致。 */
const SETTINGS_NS = 'dsh-qiniu-usage'

const SECTION_ID = 'dsh-qiniu-usage'

declare module '@deepseek-ai/cordis' {
  interface Context {
      // 由 dsh-web-settings 家族提供；group plugin 未装时缺失，调用方须把「读不到配置」当正常状态。
    webUiSettings?: SettingsScopeBinder
  }
}

// 面板的注入面与完整 props 形状（对外形状）。
export type { UsageSectionFace, UsageSectionProps } from './UsageSection.tsx'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-qiniu-usage: dictionaries')

    // 设置分区走框架注入的 `t`；卡片不是 slot 组件，拿不到框架注入，必须自己绑定。
  const boundT = (): Translate => {
    const bound = ctx.locale.bind(NS)
    return (key, params) => bound(key as Parameters<typeof bound>[0], params)
  }

    // 设置面板与卡片各用各的 store：挂载周期不同（设置页开关 vs 侧栏常驻），共用一个
    // 会让一方 stop() 掐掉另一方轮询；上游有宿主缓存与 single-flight，不会重复请求。
  const sectionStore = createUsageStore({ pollIntervalMs: 0 })
  const cardStore = createUsageStore({ pollIntervalMs: 0 })

    // 设置作用域句柄；binder 就绪时由下面的可选注入填上。
  let settingsScope: SettingsScope<Config> | undefined

    /** 配置缺失时默认开启。 */
  const cardEnabled = (): boolean =>
    settingsScope?.getSnapshot().value?.sidebarCard ?? true

    // 配置异步同步过来：初始纯手动（0），待 `pollIntervalSec > 0` 再应用；作用域缺席时保持纯手动。
  const applySettings = (): void => {
    try {
      const configured = settingsScope?.getSnapshot().value?.pollIntervalSec
      const interval = typeof configured === 'number' ? configured * 1000 : 0
      sectionStore.actions.setPollIntervalMs(interval)
      cardStore.actions.setPollIntervalMs(interval)
    } catch {
      // 读不到配置就维持现状。
    }
  }

    // 设置作用域：只认 dsh-web-settings 家族的 `webUiSettings` binder。用 `ctx.inject` 而非写进
    // `inject` 数组 —— 前者可选：服务缺席时插件照常激活；写成必需会让客户端插件永远 pending。
  ctx.inject(['webUiSettings'], (settingsCtx) => {
    let unsubscribe: (() => void) | undefined
    try {
      const binder = settingsCtx.get('webUiSettings')
      if (binder === undefined) return
      const scope = binder.bind<Config>({ namespace: SETTINGS_NS })
      settingsScope = scope
      applySettings()
      unsubscribe = scope.subscribe(applySettings)
    } catch {
      // 设置服务形态存在差异时不致命：面板仍可用，只是读不到用户配置的轮询间隔。
      settingsScope = undefined
    }
    return () => {
      unsubscribe?.()
      settingsScope = undefined
    }
  })

  /**
   * 注入面工厂：不返回 `t`（`locale: NS` 会让框架注入 `t`，自己再给会冲突）。
   * 成员会被摊平成组件 props（`props.store` / `props.settings`），不是 `face` 属性。
   */
  const face = (): UsageSectionFace => ({
    store: sectionStore,
    ...(settingsScope === undefined ? {} : { settings: settingsScope }),
  })

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
        UsageSection as SlotComponent<UsageSectionProps>,
      )
      return () => {
        unregister()
      }
    } catch {
      return () => {}
    }
  })

    // 侧栏速览卡片：挂在左侧会话列表下方（Settings 行之上）。不走 slot 的原因见
    // `sidebar-mount.tsx`；容器自带独立 React root，不干扰 shell 的 reconciliation。
  ctx.effect(() => {
    let handle: SidebarCardHandle | undefined

      // 用当前语言重新渲染卡片。
    const render = (): void => {
      handle?.render({ store: cardStore, t: boundT() })
    }

    const sync = (): void => {
      if (cardEnabled()) {
        if (handle === undefined) handle = mountSidebarCard({ store: cardStore, t: boundT() })
        else render()
      } else {
        handle?.dispose()
        handle = undefined
      }
    }

    sync()
    const disposers: (() => void)[] = []
    try {
      const offSettings = settingsScope?.subscribe(sync)
      if (offSettings !== undefined) disposers.push(offSettings)
    } catch {
      // 设置不可订阅时只在启动期决定一次。
    }
    try {
      disposers.push(ctx.locale.subscribe(render))
    } catch {
      // 语言不可订阅时保持启动期语言。
    }

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // fiber 已销毁。
        }
      }
      handle?.dispose()
      handle = undefined
    }
  }, 'dsh-qiniu-usage: sidebar card')
}
