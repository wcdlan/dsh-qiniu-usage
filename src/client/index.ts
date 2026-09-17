/**
 * dsh-qiniu-usage 浏览器半区。
 *
 * 只做三件事：注册文案字典、在「使用统计」之后落一个一级设置分区、渲染面板。
 * 所有凭据处理与上游调用都在宿主半区完成 —— 这个 bundle 里不存在任何读取
 * AK/SK 的路径（`test/bundle.test.ts` 会断言这一点）。
 *
 * M0 阶段面板是占位卡片，用来验证"客户端半区能被装载、分区能出现在设置页"；
 * 用量表、资源包进度条、Key/日期选择器与凭据表单在 M3/M4 落地。
 *
 * @module dsh-qiniu-usage/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 仅类型：拉入 ctx.locale / ctx.slots / ctx.settingsScope / connection 的 Context 合并。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createElement, type ReactNode } from 'react'
import { NS, en, zh } from './locales.ts'

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

/** 面板注入面。M3 起会挂上 store、poll、refresh 与 settings scope。 */
export interface QiniuUsageFace {
  /** 面板是否已接入真实数据源。 */
  wired?: boolean
}

/** 面板属性。 */
export interface QiniuUsageSectionProps {
  /** 由 `inject` 提供的注入面。 */
  face?: QiniuUsageFace
}

/**
 * 占位面板。
 *
 * 样式只用宿主主题 token（`--dsw-alias-*`），不引 UI 库、不引 Tailwind，
 * 保持与现有设置页一致。
 *
 * @param props - 注入面。
 * @returns 面板元素。
 */
function QiniuUsageSection({ face }: QiniuUsageSectionProps): ReactNode {
  const wired = face?.wired === true
  return createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '4px 0',
        color: 'var(--dsw-alias-text-primary, inherit)',
      },
    },
    createElement(
      'div',
      { style: { fontSize: '12px', opacity: 0.72, lineHeight: 1.6 } },
      wired ? '已接入数据源。' : '面板已装载，数据源尚未接入（M0 脚手架阶段）。',
    ),
  )
}

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

  ctx.slots.inject('settings.section', () => {
    try {
      const unregister = ctx.slots.register(
        {
          name: 'settings.section',
          id: 'dsh-qiniu-usage',
          order: SECTION_ORDER,
          label: () => ctx.locale.bind(NS)('qiniu.title'),
          locale: NS,
          // settings.section 的 inject 是必填项；M0 占位面板暂不消费注入面。
          inject: (): QiniuUsageFace => ({}),
        },
        QiniuUsageSection as SlotComponent<QiniuUsageSectionProps>,
      )
      return () => {
        unregister()
      }
    } catch {
      return () => {}
    }
  })
}
