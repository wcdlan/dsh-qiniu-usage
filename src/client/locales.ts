/**
 * 客户端文案字典（zh / en）。
 *
 * `LocaleNamespaceMap` 是**声明合并**注册表：不在这里 merge 自己的命名空间，
 * `ctx.locale.register(NS, ...)` 与 `ctx.locale.bind(NS)` 都会因为
 * "string 不可赋给 keyof LocaleNamespaceMap" 而编译失败。
 *
 * @module dsh-qiniu-usage/client/locales
 */

import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'

/** locale 命名空间。 */
export const NS = 'dsh-qiniu-usage'

/** 中文文案。 */
export const zh = {
  'qiniu.title': '七牛云用量',
  'qiniu.subtitle': '查看指定 API Key 当天的各模型 Token 用量，以及账号资源包的利用情况',
  'qiniu.placeholder': '面板尚未接入数据源（M0 脚手架阶段）。',
  'qiniu.usage.heading': '今日各模型用量',
  'qiniu.respack.heading': '资源包利用情况（本月）',
  'qiniu.credentials.heading': '凭据',
  'qiniu.refresh': '刷新',
  'qiniu.loading': '加载中…',
  'qiniu.empty.noCredentials': '尚未配置七牛 AK/SK',
  'qiniu.empty.noUsage': '当日没有用量记录',
  'qiniu.empty.noRespack': '没有资源包',
  'qiniu.warn.dataDelay': '当天数据可能有延迟',
}

/** 英文文案。 */
export const en: LocaleDictOf<typeof NS> = {
  'qiniu.title': 'Qiniu Usage',
  'qiniu.subtitle': "Per-model token usage for a given API key today, plus the account's resource-pack utilisation",
  'qiniu.placeholder': 'The panel is not wired to a data source yet (M0 scaffold).',
  'qiniu.usage.heading': 'Model usage today',
  'qiniu.respack.heading': 'Resource packs (this month)',
  'qiniu.credentials.heading': 'Credentials',
  'qiniu.refresh': 'Refresh',
  'qiniu.loading': 'Loading…',
  'qiniu.empty.noCredentials': 'Qiniu AK/SK is not configured yet',
  'qiniu.empty.noUsage': 'No usage recorded for this day',
  'qiniu.empty.noRespack': 'No resource packs',
  'qiniu.warn.dataDelay': "Today's data may be delayed",
}

/**
 * 把本包的命名空间与文案键并集注册进 locale 类型表。
 *
 * `zh` 是键集合的权威来源，`en` 用 {@link LocaleDictOf} 约束以保证双语键集
 * 完全一致（少一个键就编译失败，而不是在界面上露出空文案）。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-qiniu-usage': keyof typeof zh
  }
}

/** 文案键并集。 */
export type LocaleKey = keyof typeof zh

