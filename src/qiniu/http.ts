/**
 * 七牛上游 HTTP 客户端：超时、退避重试、双外壳解析。
 *
 * 设计文档 §8.4。两条上游的错误外壳不同，必须分别判定：
 *
 * - `api.qnaigc.com`（大模型用量）：`{ status: true|false, data?, error? }`
 * - `api.qiniu.com`（财务/资源包）：`{ code: 0|非0, message, data? }`
 *
 * 重试策略：`429` 与 `5xx` 最多重试 2 次（500ms、1.5s + 抖动）；
 * `400` / `401` **不重试** —— 重试改变不了参数错误或凭据无效。
 *
 * @module dsh-qiniu-usage/qiniu/http
 */

/** 上游错误；`code` 为上游的业务错误码（用量侧为字符串，财务侧为数字）。 */
export class QiniuUpstreamError extends Error {
  /** 上游业务错误码；传输层失败时为 `undefined`。 */
  readonly code: number | string | undefined
  /** HTTP 状态码；未拿到响应时为 `undefined`。 */
  readonly status: number | undefined
  /** 是否为鉴权失败（401，或财务侧的鉴权类错误码）。 */
  readonly isAuthError: boolean
  /** 是否为权限不足（403）—— 财务 API 常见：AK 缺账单权限。 */
  readonly isForbidden: boolean

  /**
   * @param message - 用户可读信息（已脱敏、已截断）。
   * @param options - 错误码、HTTP 状态与分类标记。
   */
  constructor(
    message: string,
    options: {
      code?: number | string
      status?: number
      isAuthError?: boolean
      isForbidden?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'QiniuUpstreamError'
    this.code = options.code
    this.status = options.status
    this.isAuthError = options.isAuthError === true
    this.isForbidden = options.isForbidden === true
  }
}

/** 一次上游请求的描述。 */
export interface UpstreamRequest {
  /** 完整目标 URL（query 已编码；签名的就是这里的 `search`）。 */
  url: URL
  /** HTTP 方法，默认 `GET`。 */
  method?: string
  /** 额外请求头（例如 `Authorization`）。 */
  headers?: Record<string, string>
  /** 请求体。本插件当前只发 GET，保留以便扩展。 */
  body?: string
  /** `Content-Type`；**只有真正会发送该头时才传**（GET 必须省略）。 */
  contentType?: string
  /** 超时毫秒数，默认 {@link DEFAULT_TIMEOUT_MS}。 */
  timeoutMs?: number
}

/** 单次请求超时。 */
export const DEFAULT_TIMEOUT_MS = 10_000

/** 重试次数上限（不含首次请求）。 */
export const MAX_RETRIES = 2

/** 重试基础延迟，毫秒；实际为 `base * 3^n + 抖动`。 */
const RETRY_BASE_MS = 500

/** 上游错误信息透传前的截断长度，避免把大段 HTML 错误页喷到界面上。 */
const MAX_ERROR_MESSAGE_LENGTH = 300

/** 上游返回的两个错误外壳。 */
export type UpstreamEnvelope = 'qnaigc' | 'qiniu'

/**
 * 截断并清理上游错误信息。
 *
 * 上游偶尔回一整页 HTML（网关错误页），直接透传既难看又可能在界面里渲染。
 *
 * @param raw - 原始信息。
 * @returns 去掉控制字符、折叠空白、截断到 {@link MAX_ERROR_MESSAGE_LENGTH} 的单行文本。
 */
export function sanitizeErrorMessage(raw: string): string {
  const collapsed = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (collapsed.length <= MAX_ERROR_MESSAGE_LENGTH) return collapsed
  return `${collapsed.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
}

/** 判断 HTTP 状态码是否值得重试。 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/** 计算第 `attempt` 次重试（从 0 计）的等待毫秒数。 */
function retryDelayMs(attempt: number): number {
  const base = RETRY_BASE_MS * 3 ** attempt
  const jitter = Math.random() * RETRY_BASE_MS
  return Math.round(base + jitter)
}

/** 睡眠指定毫秒。 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 把上游的错误外壳翻译成一个 {@link QiniuUpstreamError}。
 *
 * @param envelope - 该上游使用的错误外壳。
 * @param status - HTTP 状态码。
 * @param parsed - 已解析的响应体；无法解析时为 `undefined`。
 * @returns 归一后的错误。
 */
export function toUpstreamError(
  envelope: UpstreamEnvelope,
  status: number,
  parsed: unknown,
): QiniuUpstreamError {
  const isAuthError = status === 401
  const isForbidden = status === 403

  let code: number | string | undefined
  let message: string | undefined

  if (typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>
    if (envelope === 'qnaigc') {
      if (typeof record.error === 'string') message = record.error
    } else {
      if (typeof record.code === 'number') code = record.code
      else if (typeof record.code === 'string') code = record.code
      if (typeof record.message === 'string') message = record.message
    }
  }

  if (message === undefined || message === '') {
    message = `上游返回 HTTP ${status}`
  }

  return new QiniuUpstreamError(sanitizeErrorMessage(message), {
    ...(code === undefined ? {} : { code }),
    status,
    isAuthError,
    isForbidden,
  })
}

/**
 * 发起一次上游请求并解析响应外壳，含超时与退避重试。
 *
 * 成功时返回 `data` 字段的内容（已剥掉外壳）；失败时抛
 * {@link QiniuUpstreamError}。
 *
 * @param request - 请求描述。
 * @param envelope - 该上游使用的成功/失败外壳。
 * @param options - 可选的中止信号、`fetch` 实现与重试睡眠实现。
 *   两个替身都可注入，因此测试能覆盖重试路径而无需真的等待。
 * @returns 外壳内 `data` 字段的值。
 * @throws {QiniuUpstreamError} 鉴权失败、参数错误、业务错误码或重试耗尽。
 */
export async function fetchUpstreamData(
  request: UpstreamRequest,
  envelope: UpstreamEnvelope,
  options: {
    signal?: AbortSignal
    fetchImpl?: typeof fetch
    sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>
  } = {},
): Promise<unknown> {
  const method = request.method ?? 'GET'
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = options.fetchImpl ?? globalThis.fetch
  const doSleep = options.sleepImpl ?? sleep
  const signal = options.signal

  const headers: Record<string, string> = { ...request.headers }
  if (request.contentType !== undefined) headers['content-type'] = request.contentType

  let attempt = 0
  // 循环：首次 + 最多 MAX_RETRIES 次重试。
  for (;;) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combined = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])

    let response: Response
    try {
      response = await doFetch(request.url, {
        method,
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: combined,
      })
    } catch (error) {
      // 传输层失败（DNS/连接/超时/主动中止）。中止不重试，其余按可重试处理。
      if (signal?.aborted === true) {
        throw new QiniuUpstreamError('请求已取消', { status: undefined })
      }
      const reason = timeoutSignal.aborted
        ? `上游响应超时（${timeoutMs}ms）`
        : sanitizeErrorMessage(error instanceof Error ? error.message : String(error))
      if (attempt >= MAX_RETRIES) {
        throw new QiniuUpstreamError(`${reason}（已重试 ${attempt} 次）`, { status: undefined })
      }
      await doSleep(retryDelayMs(attempt), signal)
      attempt += 1
      continue
    }

    // 读文本再解析：上游在错误时可能回非 JSON（网关 HTML 页）。
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? undefined : JSON.parse(text)
    } catch {
      parsed = undefined
    }

    if (!response.ok) {
      if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
        await doSleep(retryDelayMs(attempt), signal)
        attempt += 1
        continue
      }
      throw toUpstreamError(envelope, response.status, parsed)
    }

    // HTTP 2xx：仍需检查业务外壳。
    if (typeof parsed !== 'object' || parsed === null) {
      throw new QiniuUpstreamError('上游返回了无法解析的响应体', { status: response.status })
    }
    const record = parsed as Record<string, unknown>

    if (envelope === 'qnaigc') {
      if (record.status === true) return record.data
      const message = typeof record.error === 'string' && record.error !== ''
        ? record.error
        : '上游返回 status=false 但未给出 error'
      throw new QiniuUpstreamError(sanitizeErrorMessage(message), { status: response.status })
    }

    if (record.code === 0) return record.data
    const code = typeof record.code === 'number' || typeof record.code === 'string'
      ? record.code
      : undefined
    const message = typeof record.message === 'string' && record.message !== ''
      ? record.message
      : `上游返回 code=${String(code)}`
    throw new QiniuUpstreamError(sanitizeErrorMessage(message), {
      ...(code === undefined ? {} : { code }),
      status: response.status,
    })
  }
}
