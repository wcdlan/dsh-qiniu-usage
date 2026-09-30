// 上游两种错误外壳：qnaigc `{status,data?,error?}` / qiniu `{code,message,data?}`；重试策略：429 与 5xx 最多 2 次（500ms、1.5s + 抖动），400/401 不重试（设计文档 §8.4）。

/** 上游错误；`code` 为上游业务错误码（用量侧字符串，财务侧数字）。 */
export class QiniuUpstreamError extends Error {
  readonly code: number | string | undefined
  readonly status: number | undefined
    /** 401，或业务错误码命中鉴权类。 */
  readonly isAuthError: boolean
    /** 403 —— 财务 API 常见：AK 缺账单权限。 */
  readonly isForbidden: boolean

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

export interface UpstreamRequest {
  /** 完整目标 URL（query 已编码；签名的就是这里的 `search`）。 */
  url: URL
  method?: string
  headers?: Record<string, string>
  body?: string
    /** 只有真正会发送该头时才传（GET 必须省略）。 */
  contentType?: string
  timeoutMs?: number
}

export const DEFAULT_TIMEOUT_MS = 10_000

/** 重试次数上限（不含首次请求）。 */
export const MAX_RETRIES = 2

// 重试基础延迟；实际为 `base * 3^n + 抖动`。
const RETRY_BASE_MS = 500

// 上游错误信息透传前的截断长度，避免把大段 HTML 错误页喷到界面上。
const MAX_ERROR_MESSAGE_LENGTH = 300

export type UpstreamEnvelope = 'qnaigc' | 'qiniu'

// **实测**：qnaigc 的鉴权失败是 HTTP 200 + `{status:false, error:"UNAUTHENTICATED"}` 而非 401；只看 HTTP 状态会把它误判成普通业务错误，故同时按错误码文本判定。
const AUTH_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'AUTHENTICATION_FAILED',
])

const FORBIDDEN_ERROR_CODES = new Set(['PERMISSION_DENIED', 'FORBIDDEN', 'ACCESS_DENIED'])

/** 去掉控制字符、折叠空白并截断：上游偶尔回整页 HTML 网关错误页。 */
export function sanitizeErrorMessage(raw: string): string {
  const collapsed = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (collapsed.length <= MAX_ERROR_MESSAGE_LENGTH) return collapsed
  return `${collapsed.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function retryDelayMs(attempt: number): number {
  const base = RETRY_BASE_MS * 3 ** attempt
  const jitter = Math.random() * RETRY_BASE_MS
  return Math.round(base + jitter)
}

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

/** 把上游的错误外壳翻译成一个 {@link QiniuUpstreamError}。 */
export function toUpstreamError(
  envelope: UpstreamEnvelope,
  status: number,
  parsed: unknown,
): QiniuUpstreamError {
  let code: number | string | undefined
  let message: string | undefined

  if (typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>
    if (envelope === 'qnaigc') {
      if (typeof record.error === 'string') message = record.error
      // qnaigc 的 `error` 字段同时充当错误码（实测为 `UNAUTHENTICATED`）。
      if (typeof record.code === 'number' || typeof record.code === 'string') code = record.code
      else if (typeof record.error === 'string' && record.error !== '') code = record.error
    } else {
      if (typeof record.code === 'number') code = record.code
      else if (typeof record.code === 'string') code = record.code
      if (typeof record.message === 'string') message = record.message
    }
  }

  if (message === undefined || message === '') {
    message = `上游返回 HTTP ${status}`
  }

    // 鉴权/权限：HTTP 状态与业务错误码任一命中即成立。
  const codeText = typeof code === 'string' ? code.toUpperCase() : ''
  const isAuthError = status === 401 || AUTH_ERROR_CODES.has(codeText)
  const isForbidden = status === 403 || FORBIDDEN_ERROR_CODES.has(codeText)

  return new QiniuUpstreamError(sanitizeErrorMessage(message), {
    ...(code === undefined ? {} : { code }),
    status,
    isAuthError,
    isForbidden,
  })
}

/** 发起请求并解析外壳，含超时与退避重试；成功返回 `data` 字段。`fetchImpl`/`sleepImpl` 可注入，测试能覆盖重试路径而无需真等。 */
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

      // 读文本再解析：上游错误时可能回非 JSON（网关 HTML 页）。
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

      // HTTP 2xx 仍需检查业务外壳；业务错误一律经 toUpstreamError 归一，不能就地 new —— 否则会绕过鉴权/权限判定（实测 qnaigc 鉴权失败即 200 + status:false）。
    if (typeof parsed !== 'object' || parsed === null) {
      throw new QiniuUpstreamError('上游返回了无法解析的响应体', { status: response.status })
    }
    const record = parsed as Record<string, unknown>

    if (envelope === 'qnaigc') {
      if (record.status === true) return record.data
      throw toUpstreamError(envelope, response.status, parsed)
    }

    if (record.code === 0) return record.data
    throw toUpstreamError(envelope, response.status, parsed)
  }
}
