/**
 * 凭据解析：AK/SK 与可选的单 Key Bearer token。
 *
 * 设计文档 §10.2。三个要点：
 *
 * 1. **每次上游调用都重新 `resolve`**，因此轮换密钥下一次请求即生效，无需重启。
 * 2. 缺 `credentials` 服务时降级为 `process.env[ref]` 直读，此时 `writable=false`。
 * 3. 回传浏览器的**只有** `{ configured, source?, writable }` 这种形状 ——
 *    上游 SDK 的 `describe()` 返回值本身就不含 value 槽位，这正是它可以安全跨线的
 *    原因。
 *
 * @module dsh-qiniu-usage/credentials
 */

import type { Context } from '@deepseek-ai/cordis'

/** 凭据引用名（POSIX 环境变量名）。 */
export type CredentialRefName = string

/** 安全的凭据状态视图：唯一允许回传浏览器的形状。 */
export interface CredentialStatus {
  /** 当前是否已配置（能解析出值）。 */
  configured: boolean
  /** 来源层，例如 `env` / `file` / `user-env`。 */
  source?: string
  /** 是否可写；环境变量等只读来源遮蔽时为 `false`。 */
  writable: boolean
}

/** 一份 AK/SK 组合的解析结果。 */
export interface ResolvedKeyPair {
  accessKey: string
  secretKey: string
  /** AccessKey 的来源层，便于 UI 说明。 */
  accessKeySource?: string
  secretKeySource?: string
}

/** AK/SK 缺任意一项时的错误；调用方据此给出"去配置"引导。 */
export class MissingCredentialsError extends Error {
  /** 缺失的引用名列表。 */
  readonly missingRefs: CredentialRefName[]
  /** 相关引用是否只读（只读时不该引导用户去 GUI 填）。 */
  readonly readOnly: boolean

  /**
   * @param missingRefs - 缺失的引用名。
   * @param readOnly - 是否因只读来源导致不可写。
   */
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

/**
 * 对宿主 `ctx.credentials` 的最小结构约束。
 *
 * 用结构类型而不是直接 import 服务类型，是为了让"缺 credentials 服务"的降级路径
 * 与测试替身都能自然地满足它。
 */
interface CredentialsLike {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

/**
 * 凭据服务的来源：既可以是服务实例本身，也可以是一个**每次使用时调用的解析器**。
 *
 * 解析器形态是必需的，不能省：cordis 的服务是**异步激活**的，而且插件树是
 * **并发应用**的（`Promise.allSettled`）。`ctx.get(name)` 默认 `strict = true`，
 * 其内部判定是
 *
 * ```js
 * if (strict && impl.fiber.state !== 2) return;   // 提供方 fiber 必须已激活
 * ```
 *
 * 于是在本插件 `apply` 期间读 `credentials` 会拿到 `undefined`（它的 fiber 还没激活）。
 * 若把这个 `undefined` 在构造时缓存下来，插件就会**永久**停留在环境变量只读模式 ——
 * GUI 表单永远置灰，用户无法在界面里填 AK/SK。
 */
type CredentialSource = CredentialsLike | (() => CredentialsLike | undefined)

/** 凭据访问器：把"有服务 / 无服务"两种来源统一在同一套方法后面。 */
export class CredentialAccess {
  readonly #source: CredentialSource | undefined
  readonly #env: Record<string, string | undefined>

  /**
   * @param source - 宿主凭据服务，或其惰性解析器；缺失时降级到环境变量。
   * @param env - 环境变量表，默认 `process.env`。
   */
  constructor(
    source?: CredentialSource,
    env: Record<string, string | undefined> = process.env,
  ) {
    this.#source = source
    this.#env = env
  }

  /**
   * 从上下文构造。**惰性解析**凭据服务：每次使用时才 `ctx.get('credentials')`，
   * 因此服务晚于本插件激活时也能被识别。
   *
   * @param ctx - 宿主上下文。
   * @returns 凭据访问器。
   */
  static fromContext(ctx: Context): CredentialAccess {
    return new CredentialAccess(() => ctx.get('credentials') as CredentialsLike | undefined)
  }

  /** 当前解析到的凭据服务；没有则 `undefined`（表示降级为环境变量直读）。 */
  #provider(): CredentialsLike | undefined {
    const source = this.#source
    if (source === undefined) return undefined
    return typeof source === 'function' ? source() : source
  }

  /**
   * 是否由 DSH 凭据库支撑（否则为环境变量直读）。
   *
   * 这是**实时判定**，不是构造时的快照。
   */
  get hasStore(): boolean {
    return this.#provider() !== undefined
  }

  /**
   * 解析一个引用为值。
   *
   * @param ref - 引用名。
   * @returns 值与来源；未配置时为 `undefined`。
   */
  async resolve(ref: CredentialRefName): Promise<{ value: string; source: string } | undefined> {
    const provider = this.#provider()
    if (provider !== undefined) {
      try {
        const resolved = await provider.resolve(ref)
        if (resolved !== undefined && resolved.value !== '') return resolved
      } catch {
        // 服务存在但解析失败（引用名不合法等）→ 继续尝试环境变量。
      }
    }
    const value = this.#env[ref]
    return value === undefined || value === '' ? undefined : { value, source: 'env' }
  }

  /**
   * 描述一个引用，**永不返回值**。
   *
   * @param ref - 引用名。
   * @returns 可安全回传浏览器的状态视图。
   */
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

  /**
   * 写入凭据。无凭据库时直接拒绝（环境变量无法由本进程持久化）。
   *
   * @param ref - 引用名。
   * @param value - 非空值。
   * @throws {Error} 无凭据库，或来源只读遮蔽（由上游服务抛出）。
   */
  async set(ref: CredentialRefName, value: string): Promise<void> {
    const provider = this.#provider()
    if (provider === undefined) {
      throw new Error('当前没有凭据库可用（插件降级为环境变量直读），无法从界面写入')
    }
    await provider.set(ref, value)
  }

  /**
   * 清除凭据。
   *
   * @param ref - 引用名。
   * @throws {Error} 无凭据库，或来源只读遮蔽。
   */
  async unset(ref: CredentialRefName): Promise<void> {
    const provider = this.#provider()
    if (provider === undefined) {
      throw new Error('当前没有凭据库可用（插件降级为环境变量直读），无法从界面清除')
    }
    await provider.unset(ref)
  }

  /**
   * 解析一组 AK/SK。
   *
   * @param accessKeyRef - AccessKey 的引用名。
   * @param secretKeyRef - SecretKey 的引用名。
   * @returns 解析到的键值对。
   * @throws {MissingCredentialsError} 任一引用未配置。
   */
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
      // 只读来源下的"缺失"无法通过 GUI 补 —— UI 应改提示去设置环境变量。
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
}

/**
 * 掩码化 AccessKey：只保留前 4 位（设计文档 §11.3）。
 *
 * @param accessKey - 原始 AccessKey。
 * @returns 掩码后的 AccessKey。
 */
export function maskAccessKey(accessKey: string): string {
  if (accessKey.length <= 4) return '*'.repeat(accessKey.length)
  return `${accessKey.slice(0, 4)}${'*'.repeat(Math.min(accessKey.length - 4, 12))}`
}
