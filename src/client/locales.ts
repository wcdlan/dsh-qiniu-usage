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
  'qiniu.respack.capacity': '当月可用',
  'qiniu.respack.used': '已用',
  'qiniu.respack.remain': '剩余',
  'qiniu.respack.packs': '逐包明细',
  'qiniu.respack.packLifecycle': '生命周期口径',
  'qiniu.respack.monthScope': '当月口径',
  'qiniu.respack.expires': '{days} 天后到期',
  'qiniu.respack.expired': '已过期',
  'qiniu.respack.expiresOn': '{date} 到期',
  'qiniu.respack.detail': '下钻',
  'qiniu.respack.detail.loading': '正在读取抵扣明细…',
  'qiniu.respack.detail.none': '没有抵扣明细',
  'qiniu.respack.detail.deductDate': '抵扣月份',
  'qiniu.respack.detail.deductAmount': '抵扣量',
  'qiniu.respack.detail.deductStatus': '出账状态',
  'qiniu.respack.scopeHint': '「已用」为资源包生命周期累计；当月口径见上方利用率。',

  // 凭据
  'qiniu.credentials.heading': '凭据',
    'qiniu.credentials.accessKey': 'AccessKey',
  'qiniu.credentials.secretKey': 'SecretKey',
  'qiniu.credentials.accessKeyPlaceholder': '粘贴 AccessKey 值',
  'qiniu.credentials.secretKeyPlaceholder': '粘贴 SecretKey 值（不会回显）',
  'qiniu.credentials.save': '保存',
  'qiniu.credentials.clear': '清除',
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

  // 设置页：只做配置
      'qiniu.settings.restHint': '时区、缓存 TTL、Key 名单等其余配置走 profile 的插件配置（cordis.patch.yml）。',
  'qiniu.settings.pollHeading': '自动刷新',
  'qiniu.settings.pollLabel': '刷新间隔（秒）',
  'qiniu.settings.pollHint': '0 = 关闭（只在手动点「刷新」时取数）。上游当天数据本身有小时级缓存，界面刷新不会额外打上游。',
  'qiniu.settings.pollUnavailable': '当前部署读不到设置服务（或该配置只读），只能用配置文件里的值。',
  'qiniu.settings.pollSave': '保存',
  'qiniu.settings.pollSaving': '保存中…',
  'qiniu.settings.pollSaved': '已保存',
  'qiniu.settings.pollFailed': '这个部署不接受写入（只读）',

  // Key 列表（来自 AK/SK 接口）
  'qiniu.keys.heading': 'Key 列表',
  'qiniu.keys.count': '{count} 个 Key',
  'qiniu.keys.empty': '还没有拿到 Key 名册：先确认上面的 AK/SK 可用。',
  'qiniu.keys.name': '名称',
  'qiniu.keys.masked': '掩码',
  'qiniu.keys.today': '当日',
  'qiniu.keys.usage.yes': '有用量',
  'qiniu.keys.usage.no': '无用量',
  'qiniu.keys.usage.unknown': '未归属',

  // 详情弹窗：用量 / 资源包两个栏目 + 筛选
  'qiniu.detail.tab.usage': '各模型用量',
  'qiniu.detail.tab.respack': '资源包利用',
  'qiniu.detail.tablist': '详情分栏',
  'qiniu.usage.day': '日期',
  'qiniu.usage.day.today': '今天',
  'qiniu.usage.day.yesterday': '昨天',
  'qiniu.usage.key': 'Key',
  'qiniu.usage.key.all': '全部 Key（汇总）',
  'qiniu.usage.key.unavailable': '名册还没到，暂时只能看账号汇总',
  'qiniu.usage.keySingleHint': '单 Key 口径只有上游完成归属后才有数据，所以查的是昨天。',
  'qiniu.usage.keyUnattributed': '上游还没把当天用量归属到「{key}」，下面是账号汇总。',

  // 侧栏速览卡片（左侧会话列表下方）
  'qiniu.card.today': '今日用量',
  'qiniu.card.yesterday': '昨日用量',
  'qiniu.card.expand': '展开用量速览',
  'qiniu.card.collapse': '收起用量速览',
  'qiniu.card.detail': '详情',
  'qiniu.card.more': '其余 {count} 个模型合计 {total}',
  'qiniu.card.failed': '取数失败，点「详情」重试',
  'qiniu.card.detailHint': '完整面板与凭据配置见「设置 → 七牛云用量」。',

  // 详情弹窗
  'qiniu.detail.title': '用量详情',
  'qiniu.detail.close': '关闭',
  'qiniu.detail.reload': '刷新',

  // 状态
  'qiniu.empty.noUsage': '当日没有用量记录',
  'qiniu.empty.noRespack': '账号下没有资源包',
  'qiniu.warn.dataDelay': '当天数据可能有延迟',
  'qiniu.error.usage': '用量查询失败',
  'qiniu.error.respack': '资源包查询失败',
  'qiniu.error.forbidden':
    '该 AK 没有账单权限：请在七牛控制台 IAM 授予财务权限，或仅查看用量',
  'qiniu.error.auth': 'AK/SK 无效或已过期',
} as const

/** 英文文案。 */
export const en: LocaleDictOf<typeof NS> = {
  'qiniu.title': 'Qiniu Usage',
  'qiniu.subtitle': "Per-model token usage for a given API key today, plus the account's resource-pack utilisation",

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
  'qiniu.respack.capacity': 'Available',
  'qiniu.respack.used': 'Used',
  'qiniu.respack.remain': 'Remaining',
  'qiniu.respack.packs': 'Per-pack detail',
  'qiniu.respack.packLifecycle': 'lifetime scope',
  'qiniu.respack.monthScope': 'month-to-date scope',
  'qiniu.respack.expires': 'expires in {days} days',
  'qiniu.respack.expired': 'expired',
  'qiniu.respack.expiresOn': 'expires {date}',
  'qiniu.respack.detail': 'Drill down',
  'qiniu.respack.detail.loading': 'Loading deduction detail…',
  'qiniu.respack.detail.none': 'No deduction records',
  'qiniu.respack.detail.deductDate': 'Deduction month',
  'qiniu.respack.detail.deductAmount': 'Amount',
  'qiniu.respack.detail.deductStatus': 'Posting status',
  'qiniu.respack.scopeHint': '"Used" is the pack lifetime total; the month-to-date view is the utilisation above.',

  'qiniu.credentials.heading': 'Credentials',
    'qiniu.credentials.accessKey': 'AccessKey',
  'qiniu.credentials.secretKey': 'SecretKey',
  'qiniu.credentials.accessKeyPlaceholder': 'Paste the AccessKey value',
  'qiniu.credentials.secretKeyPlaceholder': 'Paste the SecretKey value (never echoed back)',
  'qiniu.credentials.save': 'Save',
  'qiniu.credentials.clear': 'Clear',
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

  // Settings page: configuration only
      'qiniu.settings.restHint': 'Timezone, cache TTLs, key roster and the rest live in the profile plugin config (cordis.patch.yml).',
  'qiniu.settings.pollHeading': 'Auto refresh',
  'qiniu.settings.pollLabel': 'Refresh interval (seconds)',
  'qiniu.settings.pollHint': '0 = off (fetch only when Refresh is pressed). The upstream already caches today at an hourly cadence, so the UI cadence does not add upstream load.',
  'qiniu.settings.pollUnavailable': 'This deployment serves no writable settings scope, so the value comes from the config file.',
  'qiniu.settings.pollSave': 'Save',
  'qiniu.settings.pollSaving': 'Saving…',
  'qiniu.settings.pollSaved': 'Saved',
  'qiniu.settings.pollFailed': 'This deployment refuses the write (read-only)',

  // Key list (from the AK/SK interface)
  'qiniu.keys.heading': 'Keys',
  'qiniu.keys.count': '{count} keys',
  'qiniu.keys.empty': 'No key roster yet — confirm the AK/SK above works.',
  'qiniu.keys.name': 'Name',
  'qiniu.keys.masked': 'Masked',
  'qiniu.keys.today': 'Today',
  'qiniu.keys.usage.yes': 'has usage',
  'qiniu.keys.usage.no': 'no usage',
  'qiniu.keys.usage.unknown': 'unattributed',

  'qiniu.detail.tab.usage': 'Model usage',
  'qiniu.detail.tab.respack': 'Resource packs',
  'qiniu.detail.tablist': 'Detail sections',
  'qiniu.usage.day': 'Date',
  'qiniu.usage.day.today': 'Today',
  'qiniu.usage.day.yesterday': 'Yesterday',
  'qiniu.usage.key': 'Key',
  'qiniu.usage.key.all': 'All keys (combined)',
  'qiniu.usage.key.unavailable': 'No roster yet, so only the account total is available',
  'qiniu.usage.keySingleHint': 'Per-key figures only exist once upstream attributes usage, so this queries yesterday.',
  'qiniu.usage.keyUnattributed': "Upstream has not attributed today's usage to \"{key}\" yet; the figures below are account-wide.",

  'qiniu.card.today': "Today's usage",
  'qiniu.card.yesterday': "Yesterday's usage",
  'qiniu.card.expand': 'Expand the usage glance',
  'qiniu.card.collapse': 'Collapse the usage glance',
  'qiniu.card.detail': 'Details',
  'qiniu.card.more': '{count} more models, {total} combined',
  'qiniu.card.failed': 'Fetch failed — open Details to retry',
  'qiniu.card.detailHint': 'The full panel and credential setup live under Settings → Qiniu Usage.',

  'qiniu.detail.title': 'Usage detail',
  'qiniu.detail.close': 'Close',
  'qiniu.detail.reload': 'Refresh',

  'qiniu.empty.noUsage': 'No usage recorded for this day',
  'qiniu.empty.noRespack': 'This account has no resource packs',
  'qiniu.warn.dataDelay': "Today's data may be delayed",
  'qiniu.error.usage': 'Usage query failed',
  'qiniu.error.respack': 'Resource-pack query failed',
  'qiniu.error.forbidden':
    'This AK has no billing permission: grant financial access in the Qiniu console IAM, or view usage only',
  'qiniu.error.auth': 'The AK/SK is invalid or expired',
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
