/**
 * 设置作用域的最小结构契约。
 *
 * dsh 0.2.0 起官方客户端不再提供 `ctx.settingsScope` 服务，也不再从
 * `@deepseek-ai/dsh-client-ui-settings/client` 导出 `SettingsScope` /
 * `SettingsScopeSpec` 类型。当前提供 binder 的是 dsh-web-settings 家族插件
 * （服务名 `webUiSettings`）。
 *
 * 本插件用到「同步读快照 + 订阅变更」（必需）与「写回一个配置字段」（可选，用于
 * 设置页里的自动刷新间隔），因此这里按**用到的成员**做结构声明，把构建与那份已被
 * 删除的官方类型解耦：官方类型回不回来都不影响这里。
 *
 * @module dsh-qiniu-usage/client/settings-scope
 */

/** 设置快照；插件只关心解析后的配置值。 */
export interface SettingsScopeSnapshot<T> {
  /** 解析后的配置；尚未同步到或解析失败时为 `undefined`。 */
  value?: T
}

/** 一个设置命名空间的作用域句柄。 */
export interface SettingsScope<T> {
  /** 同步读取当前快照。 */
  getSnapshot(): SettingsScopeSnapshot<T>
  /**
   * 订阅变更。
   *
   * @param listener - 快照变化时调用。
   * @returns 退订函数。
   */
  subscribe(listener: () => void): () => void
  /**
   * 写回一个配置字段（可选）。
   *
   * 官方 `configForms` 与家族 binder 都提供它，但两者缺席时作用域就只有读能力 ——
   * 因此声明为可选，调用方必须处理"这个部署不接受写入"。
   *
   * @param field - 配置字段名。
   * @param value - 新值。
   * @returns 是否写入成功（被拒/只读时为 `false`）。
   */
  set?(field: string, value: unknown): Promise<boolean>
  /**
   * 清除一个配置字段，回到默认值（可选）。
   *
   * @param field - 配置字段名。
   * @returns 是否清除成功。
   */
  unset?(field: string): Promise<boolean>
}

/** `webUiSettings` binder：按命名空间换取一个作用域句柄。 */
export interface SettingsScopeBinder {
  /**
   * 绑定一个设置命名空间。
   *
   * @param spec - 命名空间。
   * @returns 该命名空间的作用域句柄。
   */
  bind<T>(spec: { namespace: string }): SettingsScope<T>
}
