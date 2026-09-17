/**
 * 「七牛云用量」设置分区主面板。
 *
 * 设计文档 §9。要点：
 *
 * - 轮询与取数都挂在**挂载周期**上：关掉设置页 → 零请求。
 * - 已有数据时刷新保留旧数据 + 顶部细进度条，避免闪空。
 * - 用量与资源包**分源展示错误**，互不遮蔽。
 *
 * 布局：面板头 → 工具条 → 告警 → 骨架/卡片 → 分源错误。卡片之间统一 16px，
 * 卡内 12px，形成稳定的纵向节奏（原先到处 2~4px，挤成一团）。
 *
 * @module dsh-qiniu-usage/client/UsageSection
 */

import { createElement, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UsageSnapshot } from '../qiniu/usage.ts'
import type { OverviewPayload } from '../service.ts'
import type { Config } from '../config.ts'
import { CredentialsForm } from './CredentialsForm.tsx'
import { ModelUsageTable } from './ModelUsageTable.tsx'
import { RespackMonth } from './RespackMonth.tsx'
import { RespackPacks } from './RespackPacks.tsx'
import { formatClock, formatTokens, formatWatermark } from './format.ts'
import { cls, PANEL_CSS } from './styles.ts'
import { keyOptions, type UsageStoreView } from './usage-store.ts'

/** 翻译函数签名（与 locale 提供的形态兼容）。 */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * 注册时由 `inject: face` 提供的注入面。
 *
 * ⚠ **注册返回对象的成员会被摊平成组件 props**，不是一个 `face` 属性。
 * 参考实现同款：`interface UsageSectionProps extends UsageSectionFace { close }`，
 * 组件里直接 `const { store, settings } = props`。
 *
 * 注意这里**故意不含 `t`**：只要注册时声明了 `locale: NS`，框架就会按
 * `PropsLocale<N>` 注入 `t: TranslateNS<N>`（见 dsh-client-ui-slots 的
 * "framework-injected `t` seat, present exactly on entries whose registration
 * declares `locale:`"）。自己在注入面里再塞一个 `t` 会与之冲突。
 */
export interface UsageSectionFace {
  store: UsageStoreView
  /** 设置作用域：读取 `pollIntervalSec` 等用户配置。 */
  settings?: SettingsScope<Config>
}

/** 组件属性 = 注入面 + 框架注入的 `t` + shell 提供的 `close`。 */
export interface UsageSectionProps extends UsageSectionFace {
  /** 框架按 `locale: NS` 注入的翻译函数。 */
  t?: Translate
  /** shell 提供的关闭回调（本面板不需要，仅为对齐契约）。 */
  close?: () => void
}

/** `/overview` 载荷里资源包部分的类型。 */
type OverviewRespack = NonNullable<OverviewPayload['respack']>

/** 日期选择器的选项值。 */
const DAY_OPTIONS = ['today', 'yesterday'] as const

/**
 * 用量分区主面板。
 *
 * 注入面的成员是**摊平**传进来的（`props.store` / `props.settings`），
 * `t` 由框架按 `locale:` 注入。
 *
 * @param props - 组件属性。
 * @returns 面板元素。
 */
export function UsageSection(props: UsageSectionProps): ReactNode {
  const { store, settings } = props
  // 翻译函数缺失时退化为"显示键名"而不是抛错 —— 面板绝不该因为一个文案而整块空白。
  const t: Translate = props.t ?? ((key) => key)

  if (store === undefined) {
    return createElement(
      'div',
      { className: cls.panel },
      createElement('style', null, PANEL_CSS),
    )
  }
  return createElement(UsageSectionInner, { store, settings, t })
}

/** 真正的面板主体；`store` 已保证存在。 */
function UsageSectionInner({ store, settings, t }: {
  store: UsageStoreView
  settings?: SettingsScope<Config>
  t: Translate
}): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  // 挂载周期 = 请求生命周期。卸载时 stop()，因此关掉设置页后零请求。
  useEffect(() => {
    store.actions.start()
    store.actions.loadKeys()
    store.actions.loadCredentials()
    return () => {
      store.actions.stop()
    }
  }, [store])

  const data = state.data
  const usage = data?.usage ?? null
  const respack = data?.respack ?? null
  const warnings = [...(usage?.warnings ?? []), ...(respack?.warnings ?? [])]
  const keys = keyOptions(state.keys, t('qiniu.account.all'))

  // 'idle' 是 effect 跑起来之前的那一帧；把它也算作加载中，否则首帧会闪出
  // "用量查询失败" 的错误卡片（store 一 start 就会变成 loading）。
  const isInitialLoading = data === null && state.status !== 'error'
  const showOnlyError = state.status === 'error' && data === null

  return createElement(
    'div',
    { className: cls.panel },
    createElement('style', null, PANEL_CSS),

    // 顶部细进度条：刷新时保留旧数据
    state.refreshing && data !== null ? createElement('div', { className: cls.progress }) : null,

    // 面板头
    createElement(
      'div',
      { className: cls.head },
      createElement('h3', { className: cls.title }, t('qiniu.title')),
      createElement('div', { className: cls.subtitle }, t('qiniu.subtitle')),
    ),

    // 工具条：筛选项靠左，动作靠右
    createElement(
      'div',
      { className: cls.toolbar },
      // Key 选择器：**始终渲染**，没有可选 Key 时置灰。
      // 不隐藏的理由：名册是异步到的，隐藏会让工具条在加载完成时突然多出一个
      // 控件（布局跳动）；置灰则位置稳定，并且诚实地说出"这个维度现在没得选"。
      createElement(
        'div',
        { className: cls.field },
        createElement('span', { className: cls.label }, t('qiniu.key')),
        createElement(
          'select',
          {
            className: cls.select,
            value: state.key,
            'aria-label': t('qiniu.key'),
            disabled: state.keys.length === 0,
            ...(state.keys.length === 0 ? { title: t('qiniu.key.unavailable') } : {}),
            onChange: (event: { target: { value: string } }) => store.actions.setKey(event.target.value),
          },
          ...keys.map((option) =>
            createElement(
              'option',
              { key: option.value, value: option.value },
              // 只有明确"当日有归属、但没有它"才标无用量；`undefined` = 上游
              // 当天没有归属信息，标"无用量"是在说谎。
              option.hasUsage === false ? `${option.label}（${t('qiniu.empty.noUsage')}）` : option.label,
            ),
          ),
          // 已选中的 Key 不在候选里（名册取不到）时补一个选项，避免显示错乱。
          state.key === '' || keys.some((option) => option.value === state.key)
            ? null
            : createElement('option', { key: state.key, value: state.key }, state.key),
        ),
      ),
      createElement(
        'div',
        { className: cls.field },
        createElement('span', { className: cls.label }, t('qiniu.day')),
        createElement(
          'select',
          {
            className: cls.select,
            value: state.day,
            'aria-label': t('qiniu.day'),
            onChange: (event: { target: { value: string } }) => store.actions.setDay(event.target.value),
          },
          ...DAY_OPTIONS.map((value) =>
            createElement('option', { key: value, value }, t(`qiniu.day.${value}`)),
          ),
          // 落在非今天/昨天的具体日期上时补一个选项，避免 select 显示错乱。
          DAY_OPTIONS.includes(state.day as (typeof DAY_OPTIONS)[number])
            ? null
            : createElement('option', { key: state.day, value: state.day }, state.day),
        ),
      ),
      createElement('div', { style: { flex: '1 1 auto' } }),
      state.updatedAt === null
        ? null
        : createElement(
            'span',
            { className: cls.label },
            t('qiniu.updated', { time: formatClock(state.updatedAt) }),
          ),
      createElement(
        'button',
        {
          type: 'button',
          className: cls.btn,
          disabled: state.refreshing,
          onClick: () => store.actions.refresh(),
        },
        state.refreshing ? t('qiniu.refreshing') : t('qiniu.refresh'),
      ),
    ),

    // 今天口径常驻延迟告警（设计文档 §8.1）
    state.day === 'today' && usage !== null
      ? createElement(
          'div',
          { className: `${cls.callout} ${cls.calloutWarn}` },
          createElement('strong', null, t('qiniu.warn.dataDelay')),
          usage.watermark === undefined || usage.watermark === ''
            ? null
            : createElement(
                'span',
                { className: cls.muted, style: { fontSize: '11.5px' } },
                `上游水位 ${formatWatermark(usage.watermark)}`,
              ),
        )
      : null,

    // 选了具体 Key、但这份数据没有 Key 归属：必须说清"下面是账号汇总"，
    // 而不是默默显示账号总量（看着像筛选失效）或显示空面板（看着像坏了）。
    state.key !== '' && usage?.unattributedKeys === true
      ? createElement(
          'div',
          { className: `${cls.callout} ${cls.calloutWarn}`, role: 'status' },
          createElement('strong', null, t('qiniu.warn.keyUnattributed', { key: state.key })),
        )
      : null,

    // 面板级传输错误
    showOnlyError
      ? createElement(
          'div',
          { className: `${cls.callout} ${cls.calloutError}` },
          createElement('strong', null, t('qiniu.error.usage')),
          createElement('span', null, state.error ?? ''),
          createElement(
            'button',
            {
              type: 'button',
              className: cls.btn,
              style: { alignSelf: 'flex-start', marginTop: '4px' },
              onClick: () => store.actions.refresh(),
            },
            t('qiniu.error.retry'),
          ),
        )
      : null,

    // 首屏骨架：形状贴近真实卡片（标题 + 若干行）
    isInitialLoading
      ? createElement(
          'div',
          { className: cls.card },
          createElement(
            'div',
            { className: cls.skeleton },
            createElement('div', { className: cls.skelLine, style: { width: '32%' } }),
            createElement('div', { className: cls.skelLine, style: { width: '92%' } }),
            createElement('div', { className: cls.skelLine, style: { width: '78%' } }),
            createElement('div', { className: cls.skelLine, style: { width: '60%' } }),
          ),
          createElement(
            'div',
            { className: cls.muted, style: { fontSize: '11.5px' } },
            t('qiniu.loading'),
          ),
        )
      : null,

    // 用量卡片
    !isInitialLoading && !showOnlyError
      ? createElement(
          'section',
          { className: cls.card },
          createElement(
            'div',
            { className: cls.cardHead },
            createElement('h4', { className: cls.cardTitle }, t('qiniu.usage.heading')),
            usage === null || usage.models.length === 0
              ? null
              : createElement(
                  'span',
                  { className: cls.cardNote },
                  t('qiniu.usage.summary', {
                    total: formatTokens(usage.totals.total),
                    models: usage.models.length,
                  }),
                ),
          ),
          renderUsageBlock(usage, state.key, t),
        )
      : null,

    // 资源包卡片（当月口径）
    !isInitialLoading && !showOnlyError
      ? createElement(
          'section',
          { className: cls.card },
          createElement(
            'div',
            { className: cls.cardHead },
            createElement('h4', { className: cls.cardTitle }, t('qiniu.respack.heading')),
            createElement('span', { className: cls.badge }, t('qiniu.respack.monthScope')),
          ),
          renderMonthBlock(respack, t),
        )
      : null,

    // 逐包明细：**独立卡片**。它是生命周期口径，与上方当月口径是两回事，
    // 放同一张卡里容易把两种口径读混，也不便于单独定位（设计文档 §3.3）。
    !isInitialLoading && !showOnlyError
      ? createElement(
          'section',
          { className: cls.card },
          createElement(
            'div',
            { className: cls.cardHead },
            createElement('h4', { className: cls.cardTitle }, t('qiniu.respack.packs')),
            createElement('span', { className: cls.badge }, t('qiniu.respack.packLifecycle')),
            respack === null || respack.packages.length === 0
              ? null
              : createElement(
                  'span',
                  { className: cls.cardNote },
                  t('qiniu.respack.packsCount', { count: respack.packages.length }),
                ),
          ),
          renderPacksBlock(store, respack, t),
        )
      : null,

    // 凭据卡片：键名只读 + 值输入框（两层语义，见 §10.2）
    !isInitialLoading && !showOnlyError
      ? createElement(
          'section',
          { className: cls.card },
          createElement(
            'div',
            { className: cls.cardHead },
            createElement('h4', { className: cls.cardTitle }, t('qiniu.credentials.heading')),
          ),
          createElement(CredentialsForm, {
            credentials: state.credentials,
            t,
            onSet: (ref: string, value: string) => store.actions.setCredential(ref, value),
            onUnset: (ref: string) => store.actions.unsetCredential(ref),
          }),
        )
      : null,

    // 告警：用量与资源包的告警合并放在面板级 —— 原先挂在资源包卡片里，
    // 导致"用量"的告警出现在资源包区域，归属不清。
    !isInitialLoading && !showOnlyError && warnings.length > 0
      ? createElement(
          'section',
          { className: cls.card },
          createElement(
            'div',
            { className: cls.cardHead },
            createElement('h4', { className: cls.cardTitle }, t('qiniu.warnings.heading')),
          ),
          createElement(
            'div',
            { className: cls.warnList },
            ...warnings.map((warning, index) =>
              createElement(
                'div',
                { key: `${index}-${warning}`, className: cls.muted, style: { fontSize: '11.5px' } },
                `· ${warning}`,
              ),
            ),
          ),
        )
      : null,

    // 分源错误：用量与资源包失败互不遮蔽
    ...(!showOnlyError && data !== null
      ? data.errors.map((error) => {
          const label = error.source === 'usage' ? t('qiniu.error.usage') : t('qiniu.error.respack')
          const hint = error.isForbidden
            ? t('qiniu.error.forbidden')
            : error.isAuthError
              ? t('qiniu.error.auth')
              : null
          return createElement(
            'div',
            { key: `${error.source}-${error.code ?? 'na'}`, className: `${cls.callout} ${cls.calloutError}` },
            createElement(
              'strong',
              null,
              label + (error.code === undefined ? '' : `（code=${error.code}）`),
            ),
            createElement('span', null, error.message),
            hint === null
              ? null
              : createElement('span', { className: cls.muted, style: { fontSize: '11.5px' } }, hint),
          )
        })
      : []),
  )
}

/** 用量块：空状态 / 模型表。 */
function renderUsageBlock(usage: UsageSnapshot | null, selectedKey: string, t: Translate): ReactNode {
  if (usage === null) {
    return createElement('div', { className: cls.empty }, t('qiniu.error.usage'))
  }

  if (usage.models.length === 0) {
    return createElement(
      'div',
      { className: cls.empty },
      selectedKey === '' ? t('qiniu.empty.noUsage') : t('qiniu.empty.noUsageKey'),
    )
  }

  return createElement(ModelUsageTable, { models: usage.models, grandTotal: usage.totals.total, t })
}

/** 当月口径块：空状态 / 利用率列表。 */
function renderMonthBlock(
  respack: OverviewRespack | null,
  t: Translate,
): ReactNode {
  if (respack === null) {
    return createElement('div', { className: cls.empty }, t('qiniu.error.respack'))
  }
  return createElement(RespackMonth, { snapshot: respack, t })
}

/** 逐包明细块：空状态 / 逐包列表。 */
function renderPacksBlock(
  store: UsageStoreView,
  respack: OverviewRespack | null,
  t: Translate,
): ReactNode {
  if (respack === null) {
    return createElement('div', { className: cls.empty }, t('qiniu.error.respack'))
  }
  return createElement(RespackPacks, {
    snapshot: respack,
    details: store.getSnapshot().details,
    onLoadDetail: (orderHash: string, poId: number) => store.actions.loadDetail(orderHash, poId),
    t,
  })
}
