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
  'qiniu.subtitle': '指定 API Key 当天的各模型 Token 用量，以及账号资源包的利用情况',

  // 工具条
  'qiniu.account': '账号',
  'qiniu.account.all': '全部 Key（汇总）',
  'qiniu.key': 'Key',
  'qiniu.key.unavailable': '上游暂未返回 Key 名册，暂时只能看账号汇总',
  'qiniu.day': '日期',
  'qiniu.day.today': '今天',
  'qiniu.day.yesterday': '昨天',
  'qiniu.refresh': '刷新',
  'qiniu.refreshing': '刷新中…',
  'qiniu.updated': '更新于 {time}',
  'qiniu.loading': '正在加载用量数据…',

  // 用量表
  'qiniu.usage.heading': '各模型用量',
  'qiniu.usage.model': '模型',
  'qiniu.usage.input': '输入',
  'qiniu.usage.output': '输出',
  'qiniu.usage.total': '合计',
  'qiniu.usage.cachedInput': '缓存读',
  'qiniu.usage.cachedWrite': '缓存写',
  'qiniu.usage.other': '其他',
  'qiniu.usage.summary': '合计 {total} tokens · {models} 个模型',
  'qiniu.usage.more': '其余 {count} 个模型合计 {total}',
  'qiniu.usage.expand': '展开全部 {count} 个模型',
  'qiniu.usage.collapse': '收起',
  'qiniu.usage.unitHint': '单位以响应返回为准；原始值见悬停提示。',

  // 资源包
  'qiniu.respack.heading': '资源包利用情况（本月）',
  'qiniu.respack.item': '计费项',
  'qiniu.respack.zone': '区域',
  'qiniu.respack.capacity': '当月可用',
  'qiniu.respack.used': '已用',
  'qiniu.respack.remain': '剩余',
  'qiniu.respack.packs': '逐包明细',
  'qiniu.respack.packLifecycle': '生命周期口径',
  'qiniu.respack.monthScope': '当月口径',
  'qiniu.respack.expires': '{days} 天后到期',
  'qiniu.respack.expired': '已过期',
  'qiniu.respack.expiresOn': '{date} 到期',
  'qiniu.respack.status.1': '未使用',
  'qiniu.respack.status.2': '使用中',
  'qiniu.respack.status.3': '已用完',
  'qiniu.respack.status.4': '已过期',
  'qiniu.respack.carryOver.0': '按月可结转',
  'qiniu.respack.carryOver.1': '按月不可结转',
  'qiniu.respack.carryOver.2': '一次性',
  'qiniu.respack.detail': '下钻',
  'qiniu.respack.detail.loading': '正在读取抵扣明细…',
  'qiniu.respack.detail.none': '没有抵扣明细',
  'qiniu.respack.detail.deductDate': '抵扣月份',
  'qiniu.respack.detail.deductAmount': '抵扣量',
  'qiniu.respack.detail.deductStatus': '出账状态',
  'qiniu.respack.detail.combo': '融合资源包',
  'qiniu.respack.scopeHint': '「已用」为资源包生命周期累计；当月口径见上方利用率。',

  // 凭据
  'qiniu.credentials.heading': '凭据',
  'qiniu.credentials.hint': '输入框里填的是凭据的值；等宽灰字是该值存放的环境变量名。',
  'qiniu.credentials.accessKey': 'AccessKey',
  'qiniu.credentials.secretKey': 'SecretKey',
  'qiniu.credentials.accessKeyPlaceholder': '粘贴 AccessKey 值',
  'qiniu.credentials.secretKeyPlaceholder': '粘贴 SecretKey 值（不会回显）',
  'qiniu.credentials.save': '保存',
  'qiniu.credentials.clear': '清除',
  'qiniu.credentials.configured': '已配置',
  'qiniu.credentials.notConfigured': '未配置',
  'qiniu.credentials.sourceEnv': '来源：环境变量 {ref}',
  'qiniu.credentials.sourceStore': '已保存 · 来源：凭据库',
  'qiniu.credentials.writable': '可写',
  'qiniu.credentials.readOnly': '只读',
  'qiniu.credentials.noStore': '无凭据库',
  'qiniu.credentials.noStoreHint':
    '宿主侧没有可用的凭据库，插件降级为环境变量直读；请在环境变量里设置下方两个名字，界面无法写入。',
  'qiniu.credentials.unavailable': '暂时读不到凭据状态。',

  'qiniu.respack.packsCount': '{count} 个资源包',

  // 对话页悬浮按钮
  'qiniu.fab.button': '用量',
  'qiniu.fab.open': '查看七牛云用量',
  'qiniu.fab.close': '关闭',
  'qiniu.fab.reload': '刷新',
  'qiniu.fab.hint': '完整面板与凭据配置见「设置 → 七牛云用量」。',

  // 状态
  'qiniu.empty.noUsage': '当日没有用量记录',
  'qiniu.empty.noRespack': '账号下没有资源包',
  'qiniu.empty.noUsageKey': '所选 Key 当日没有用量（零用量的 Key 上游不会返回）',
  'qiniu.warn.dataDelay': '当天数据可能有延迟',
  'qiniu.warn.keyUnattributed':
    '上游尚未把当天用量归属到「{key}」，下方是账号汇总；单 Key 明细要等归属完成后（通常次日）才有',
  'qiniu.warn.seeBelow': '存在告警，详见下方说明。',
  'qiniu.error.usage': '用量查询失败',
  'qiniu.error.respack': '资源包查询失败',
  'qiniu.error.forbidden':
    '该 AK 没有账单权限：请在七牛控制台 IAM 授予财务权限，或仅查看用量',
  'qiniu.error.auth': 'AK/SK 无效或已过期',
  'qiniu.error.pluginDisabled': '宿主侧插件未启用（找不到用量接口）',
  'qiniu.error.retry': '重试',
  'qiniu.warnings.heading': '告警',
} as const

/** 英文文案。 */
export const en: LocaleDictOf<typeof NS> = {
  'qiniu.title': 'Qiniu Usage',
  'qiniu.subtitle': "Per-model token usage for a given API key today, plus the account's resource-pack utilisation",

  'qiniu.account': 'Account',
  'qiniu.account.all': 'All keys (combined)',
  'qiniu.key': 'Key',
  'qiniu.key.unavailable': 'Upstream returned no key roster yet, so only the account total is available',
  'qiniu.day': 'Date',
  'qiniu.day.today': 'Today',
  'qiniu.day.yesterday': 'Yesterday',
  'qiniu.refresh': 'Refresh',
  'qiniu.refreshing': 'Refreshing…',
  'qiniu.updated': 'Updated {time}',
  'qiniu.loading': 'Loading usage data…',

  'qiniu.usage.heading': 'Model usage',
  'qiniu.usage.model': 'Model',
  'qiniu.usage.input': 'Input',
  'qiniu.usage.output': 'Output',
  'qiniu.usage.total': 'Total',
  'qiniu.usage.cachedInput': 'Cache read',
  'qiniu.usage.cachedWrite': 'Cache write',
  'qiniu.usage.other': 'Other',
  'qiniu.usage.summary': '{total} tokens total · {models} models',
  'qiniu.usage.more': '{count} more models, {total} combined',
  'qiniu.usage.expand': 'Show all {count} models',
  'qiniu.usage.collapse': 'Collapse',
  'qiniu.usage.unitHint': 'Units follow the upstream response; hover for raw values.',

  'qiniu.respack.heading': 'Resource packs (this month)',
  'qiniu.respack.item': 'Billing item',
  'qiniu.respack.zone': 'Zone',
  'qiniu.respack.capacity': 'Available',
  'qiniu.respack.used': 'Used',
  'qiniu.respack.remain': 'Remaining',
  'qiniu.respack.packs': 'Per-pack detail',
  'qiniu.respack.packLifecycle': 'lifetime scope',
  'qiniu.respack.monthScope': 'month-to-date scope',
  'qiniu.respack.expires': 'expires in {days} days',
  'qiniu.respack.expired': 'expired',
  'qiniu.respack.expiresOn': 'expires {date}',
  'qiniu.respack.status.1': 'Unused',
  'qiniu.respack.status.2': 'In use',
  'qiniu.respack.status.3': 'Exhausted',
  'qiniu.respack.status.4': 'Expired',
  'qiniu.respack.carryOver.0': 'Monthly, carries over',
  'qiniu.respack.carryOver.1': 'Monthly, no carry-over',
  'qiniu.respack.carryOver.2': 'One-off',
  'qiniu.respack.detail': 'Drill down',
  'qiniu.respack.detail.loading': 'Loading deduction detail…',
  'qiniu.respack.detail.none': 'No deduction records',
  'qiniu.respack.detail.deductDate': 'Deduction month',
  'qiniu.respack.detail.deductAmount': 'Amount',
  'qiniu.respack.detail.deductStatus': 'Posting status',
  'qiniu.respack.detail.combo': 'Combined pack',
  'qiniu.respack.scopeHint': '"Used" is the pack lifetime total; the month-to-date view is the utilisation above.',

  'qiniu.credentials.heading': 'Credentials',
  'qiniu.credentials.hint': 'The input takes the credential value; the monospace name is the environment variable it is stored under.',
  'qiniu.credentials.accessKey': 'AccessKey',
  'qiniu.credentials.secretKey': 'SecretKey',
  'qiniu.credentials.accessKeyPlaceholder': 'Paste the AccessKey value',
  'qiniu.credentials.secretKeyPlaceholder': 'Paste the SecretKey value (never echoed back)',
  'qiniu.credentials.save': 'Save',
  'qiniu.credentials.clear': 'Clear',
  'qiniu.credentials.configured': 'Configured',
  'qiniu.credentials.notConfigured': 'Not configured',
  'qiniu.credentials.sourceEnv': 'Source: environment variable {ref}',
  'qiniu.credentials.sourceStore': 'Saved · source: credential store',
  'qiniu.credentials.writable': 'Writable',
  'qiniu.credentials.readOnly': 'Read-only',
  'qiniu.credentials.noStore': 'No credential store',
  'qiniu.credentials.noStoreHint':
    'The host has no credential store available, so the plugin falls back to reading environment variables. Set the two names below in the environment; the UI cannot write them.',
  'qiniu.credentials.unavailable': 'Credential status is unavailable right now.',

  'qiniu.respack.packsCount': '{count} packs',

  'qiniu.fab.button': 'Usage',
  'qiniu.fab.open': 'Show Qiniu usage',
  'qiniu.fab.close': 'Close',
  'qiniu.fab.reload': 'Refresh',
  'qiniu.fab.hint': 'The full panel and credential setup live under Settings → Qiniu Usage.',

  'qiniu.empty.noUsage': 'No usage recorded for this day',
  'qiniu.empty.noRespack': 'This account has no resource packs',
  'qiniu.empty.noUsageKey': 'The selected key had no usage this day (upstream omits zero-usage keys)',
  'qiniu.warn.dataDelay': "Today's data may be delayed",
  'qiniu.warn.keyUnattributed':
    'Upstream has not attributed today\'s usage to "{key}" yet; the figures below are account-wide. Per-key detail appears once attribution lands (usually the next day)',
  'qiniu.warn.seeBelow': 'There are warnings; see the notes below.',
  'qiniu.error.usage': 'Usage query failed',
  'qiniu.error.respack': 'Resource-pack query failed',
  'qiniu.error.forbidden':
    'This AK has no billing permission: grant financial access in the Qiniu console IAM, or view usage only',
  'qiniu.error.auth': 'The AK/SK is invalid or expired',
  'qiniu.error.pluginDisabled': 'The host half is not enabled (usage endpoint not found)',
  'qiniu.error.retry': 'Retry',
  'qiniu.warnings.heading': 'Warnings',
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
