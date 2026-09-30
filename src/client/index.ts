/**
 * dsh-qiniu-usage 浏览器半区。
 *
 * 只做五件事：注册文案字典、绑定设置命名空间、落一个一级设置分区、把速览卡片挂到
 * 左侧栏底部、按语言/配置刷新这两个界面。所有凭据处理与上游调用都在宿主半区完成
 * —— 这个 bundle 里不存在任何读取 AK/SK 的路径（`test/bundle.test.ts` 会断言这一点）。
 *
 * 轮询与取数都挂在**组件挂载周期**上：设置页关闭 → 零请求；侧栏卡片常驻，因此
 * 它按配置的轮询间隔取数（默认纯手动）。
 *
 * @module dsh-qiniu-usage/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 仅类型：拉入 ctx.locale / ctx.slots / connection 的 Context 合并。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Config } from '../config.ts'
import { NS, en, zh } from './locales.ts'
import { mountSidebarCard, type SidebarCardHandle } from './sidebar-mount.tsx'
import { UsageSection, type UsageSectionFace, type UsageSectionProps , type Translate } from './UsageSection.tsx'
import type { SettingsScope, SettingsScopeBinder } from './settings-scope.ts'
import { createUsageStore } from './usage-store.ts'

/**
 * 必需服务。
 *
 * **注意**：这是 cordis 服务名，与 package.json 里 `dsh.client.inject` 的
 * **包名**列表是两回事，不要互相抄。
 *
 * **不要**把 `settingsScope` 加回来：dsh 0.2.0 起官方客户端不再提供该服务，
 * 声明为必需会让本插件永远停在 pending（表现为 web boot 报
 * `dsh-qiniu-usage: pending (waiting for service: settingsScope)`）。
 * 设置作用域走下面的 `ctx.inject(['webUiSettings'], …)` 可选注入。
 */
export const inject = ['slots', 'locale', 'connection', 'remote']

/** 一级设置分区位置：紧跟「使用统计」（order 151）之后。 */
const SECTION_ORDER = 152

/** 设置命名空间；必须与宿主半区的 `SETTINGS_NAMESPACE` 一致。 */
const SETTINGS_NS = 'dsh-qiniu-usage'

/** 分区 ID。 */
const SECTION_ID = 'dsh-qiniu-usage'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * 设置 binder，由 dsh-web-settings 家族插件（`@linxin666/dsh-client-ui-web-ui-settings`）
     * 提供。该 group plugin 未安装时缺失，因此调用方必须把「读不到配置」当作正常状态。
     */
    webUiSettings?: SettingsScopeBinder
  }
}

/** 面板的注入面与完整 props 形状（供外部按需引用）。 */
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

  /**
   * 绑定当前语言的翻译函数。
   *
   * 设置分区走框架注入的 `t`；悬浮按钮不是 slot 组件，拿不到框架注入，
   * 必须自己绑定（并在语言切换时重新渲染）。
   */
  const boundT = (): Translate => {
    const bound = ctx.locale.bind(NS)
    return (key, params) => bound(key as Parameters<typeof bound>[0], params)
  }

  // 设置面板与侧栏卡片**各用各的 store**：两者的挂载周期不同（设置页开关 vs
  // 侧栏常驻），共用一个会让一方的 stop() 掐掉另一方的轮询。上游有宿主缓存与
  // single-flight 兜着，所以两个 store 不会带来重复请求。
  const sectionStore = createUsageStore({ pollIntervalMs: 0 })
  const cardStore = createUsageStore({ pollIntervalMs: 0 })

  /** 设置作用域句柄；由下面的可选注入在 binder 就绪时填上。 */
  let settingsScope: SettingsScope<Config> | undefined

  /** 侧栏卡片是否启用（配置缺失时默认开启）。 */
  const cardEnabled = (): boolean =>
    settingsScope?.getSnapshot().value?.sidebarCard ?? true

  /**
   * 把当前作用域里的用户配置灌进两个 store。
   *
   * 轮询间隔来自用户配置，而配置是异步同步过来的 —— 初始为 0（纯手动），
   * 待设置作用域给出 `pollIntervalSec > 0` 时再应用。作用域缺席时保持纯手动刷新。
   */
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

  // 设置作用域：只认 dsh-web-settings 家族提供的 `webUiSettings` binder。
  //
  // 用 `ctx.inject` 而不是把它写进 `inject` 数组：前者是**可选**依赖 —— 服务缺席
  // 时回调不跑、插件照常激活；服务迟到时回调补跑。写成必需服务会让整个客户端插件
  // 永远 pending，进而让 web boot 报「1 entry did not activate」。
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
   * 注入面工厂。
   *
   * **不返回 `t`** —— 注册时声明了 `locale: NS`，框架会按 `PropsLocale` 注入
   * `t: TranslateNS<NS>`。自己再给一个会与框架的注入冲突。
   *
   * 这些成员会被**摊平成组件 props**（`props.store` / `props.settings`），
   * 不是一个 `face` 属性。
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

  // 侧栏速览卡片：挂在左侧会话列表下方（Settings 行之上）。
  //
  // 不走 slot 的原因见 `sidebar-mount.tsx`（侧栏底部唯一的扩展位是 flex 行，
  // 和宿主自己的按钮抢同一行）。容器自带独立 React root，因此不会干扰 shell
  // 的 reconciliation。
  ctx.effect(() => {
    let handle: SidebarCardHandle | undefined

    /** 用当前语言重新渲染卡片（语言切换、配置变化时都要）。 */
    const render = (): void => {
      handle?.render({ store: cardStore, t: boundT() })
    }

    /** 配置变化时增删卡片；语言变化时重渲染。 */
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
