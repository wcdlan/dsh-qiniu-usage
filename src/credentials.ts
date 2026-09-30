// 每次上游调用都重新 resolve（轮换密钥下次请求即生效）；缺 credentials 服务时降级为 process.env 直读且 writable=false。见 DESIGN.md §10.2。

import type {Context} from '@deepseek-ai/cordis'

export type CredentialRefName = string

/** 安全的凭据状态视图：唯一允许回传浏览器的形状（上游 SDK 的 describe() 本身不含 value 槽位）。 */
export interface CredentialStatus {
  configured: boolean
  /** 来源层，例如 `env` / `file` / `user-env`。 */
  source?: string
  /** 是否可写；环境变量等只读来源遮蔽时为 `false`。 */
  writable: boolean
}

export interface ResolvedKeyPair {
  accessKey: string
  secretKey: string
  accessKeySource?: string
  secretKeySource?: string
}

/** AK/SK 缺任意一项时的错误；调用方据此给出"去配置"引导。 */
export class MissingCredentialsError extends Error {
  readonly missingRefs: CredentialRefName[]
  /** 相关引用是否只读（只读时不该引导用户去 GUI 填）。 */
  readonly readOnly: boolean

  constructor(missingRefs: CredentialRefName[], readOnly = false) {
    super(
      readOnly
        ? `凭据 ${missingRefs.join(' / ')} 未配置，且当前来源为只读（环境变量）`
        : `尚未配置七牛凭据：${missingRefs.join(' / ')}`,
    )
    this.name = 'MissingCredentialsError'
    this.missingRefs = missingRefs
    this.readOnly = readOnly
  }
}

/** 对宿主 `ctx.credentials` 的最小结构约束；用结构类型以便"缺服务"降级路径与测试替身都能满足。 */
interface CredentialsLike {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

/** 凭据来源可为服务实例或惰性解析器；cordis 服务异步激活、插件树并发应用，构造时缓存 `undefined` 会永久停在只读模式，故必须每次解析。 */
type CredentialSource = CredentialsLike | (() => CredentialsLike | undefined)

export class CredentialAccess {
  readonly #source: CredentialSource | undefined
  readonly #env: Record<string, string | undefined>

  constructor(
    source?: CredentialSource,
    env: Record<string, string | undefined> = process.env,
  ) {
    this.#source = source
    this.#env = env
  }

    /** 是否由 DSH 凭据库支撑；**实时判定**，不是构造时的快照。 */
  get hasStore(): boolean {
    return this.#provider() !== undefined
  }

    /** 从上下文构造；惰性解析凭据服务（每次使用时才 `ctx.get`），服务晚于本插件激活时也能识别。 */
  static fromContext(ctx: Context): CredentialAccess {
    return new CredentialAccess(() => ctx.get('credentials') as CredentialsLike | undefined)
  }

    /** 解析一个引用为值。 */
  async resolve(ref: CredentialRefName): Promise<{ value: string; source: string } | undefined> {
    const provider = this.#provider()
    if (provider !== undefined) {
      try {
        const resolved = await provider.resolve(ref)
        if (resolved !== undefined && resolved.value !== '') return resolved
      } catch {
          // 服务在但解析失败（如引用名非法）→ 继续尝试环境变量。
      }
    }
    const value = this.#env[ref]
    return value === undefined || value === '' ? undefined : { value, source: 'env' }
  }

    /** 描述一个引用；**永不返回值**。 */
  async describe(ref: CredentialRefName): Promise<CredentialStatus> {
    const provider = this.#provider()
    if (provider !== undefined) {
      try {
        const info = await provider.describe(ref)
        return {
          configured: info.configured,
          ...(info.source === undefined ? {} : { source: info.source }),
          writable: info.writable,
        }
      } catch {
        // 落到环境变量判定。
      }
    }
    const value = this.#env[ref]
    const configured = value !== undefined && value !== ''
    return {
      configured,
      ...(configured ? { source: 'env' } : {}),
      // 环境变量来源不可通过 GUI 写。
      writable: false,
    }
  }

    /** 写入凭据；无凭据库时直接拒绝（环境变量无法由本进程持久化）。 */
  async set(ref: CredentialRefName, value: string): Promise<void> {
    const provider = this.#provider()
    if (provider === undefined) {
      throw new Error('当前没有凭据库可用（插件降级为环境变量直读），无法从界面写入')
    }
    await provider.set(ref, value)
  }

    /** 清除凭据；无凭据库时直接拒绝。 */
  async unset(ref: CredentialRefName): Promise<void> {
    const provider = this.#provider()
    if (provider === undefined) {
      throw new Error('当前没有凭据库可用（插件降级为环境变量直读），无法从界面清除')
    }
    await provider.unset(ref)
  }

    /** 解析一组 AK/SK；任一引用未配置时抛 {@link MissingCredentialsError}。 */
  async resolveKeyPair(
    accessKeyRef: CredentialRefName,
    secretKeyRef: CredentialRefName,
  ): Promise<ResolvedKeyPair> {
    const [accessKey, secretKey] = await Promise.all([
      this.resolve(accessKeyRef),
      this.resolve(secretKeyRef),
    ])
    const missing: CredentialRefName[] = []
    if (accessKey === undefined) missing.push(accessKeyRef)
    if (secretKey === undefined) missing.push(secretKeyRef)
    if (accessKey === undefined || secretKey === undefined) {
        // 只读来源下的缺失无法经 GUI 补，UI 应改提示去设置环境变量。
      const readOnly = this.#provider() === undefined
      throw new MissingCredentialsError(missing, readOnly)
    }
    return {
      accessKey: accessKey.value,
      secretKey: secretKey.value,
      accessKeySource: accessKey.source,
      secretKeySource: secretKey.source,
    }
  }

    // 当前解析到的凭据服务；没有则 `undefined`（降级为环境变量直读）。
  #provider(): CredentialsLike | undefined {
    const source = this.#source
    if (source === undefined) return undefined
    return typeof source === 'function' ? source() : source
  }
}

/** 掩码化 AccessKey，只保留前 4 位（DESIGN.md §11.3）。 */
export function maskAccessKey(accessKey: string): string {
  if (accessKey.length <= 4) return '*'.repeat(accessKey.length)
  return `${accessKey.slice(0, 4)}${'*'.repeat(Math.min(accessKey.length - 4, 12))}`
}
