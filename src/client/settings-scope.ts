// 设置作用域的最小结构契约。dsh 0.2.0 起官方客户端不再提供 `ctx.settingsScope`，
// 也不再导出 `SettingsScope` / `SettingsScopeSpec` 类型；当前提供 binder 的是
// dsh-web-settings 家族插件（服务名 `webUiSettings`）。这里按**用到的成员**做结构
// 声明，把构建与那份已被删除的官方类型解耦。

export interface SettingsScopeSnapshot<T> {
    // 尚未同步或解析失败时为 `undefined`。
  value?: T
}

export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void

    // 官方 `configForms` 与家族 binder 都提供它，但两者缺席时作用域就只有读能力 ——
    // 因此可选，调用方必须处理"这个部署不接受写入"。
  set?(field: string, value: unknown): Promise<boolean>
  unset?(field: string): Promise<boolean>
}

// `webUiSettings` binder：按命名空间换取一个作用域句柄。
export interface SettingsScopeBinder {
  bind<T>(spec: { namespace: string }): SettingsScope<T>
}
