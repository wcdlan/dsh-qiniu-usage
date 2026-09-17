/**
 * 七牛管理凭证（AK/SK）签名器。
 *
 * 文档：https://developer.qiniu.com/kodo/1201/access-token
 *
 * 三个易错点（本模块的全部存在意义就是不让它们出错）：
 *
 * 1. `Host` 头**不含端口**。`api.qiniu.com:443` 要与 `api.qiniu.com` 签。
 * 2. 签名用的 query 串必须与实际请求 URL 中的 query 串**逐字节一致**。
 *    所以 {@link signRequest} 从**已解析的 `URL` 对象**里取 `url.search`，
 *    签名与请求共用同一个字符串；不接受"另传一份 query"的调用方式。
 *    `+08:00` 必须编码为 `%2B08:00`（`URLSearchParams` 天然如此）。
 * 3. GET 请求**不设置 `Content-Type`**。带上它会让 signingStr 多出一行，
 *    签名与官方控制台/其他 SDK 不一致。
 *
 * @module dsh-qiniu-usage/qiniu/sign
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** 一个已归一化的请求描述，签名所需的最小信息集。 */
export interface QiniuSignRequest {
  /** HTTP 方法，大写（`GET` / `POST` / ...）。 */
  method: string
  /**
   * 已解析的目标 URL。其 `host`（不含端口）与 `search`（含前导 `?`，无则空串）
   * 就是签名使用的权威来源。
   */
  url: URL
  /**
   * query 串，**含前导 `?`**。必须与实际请求逐字节一致（易错点 2）。
   *
   * 省略时用 `url.search`。签名与请求共用同一个串这件事因此是 API 层面的结构
   * 保证，而不是靠调用方自觉。
   */
  queryString?: string
  /**
   * `Content-Type` 头。**只有实际会出现在请求里的头才可传入**：
   * GET 请求必须省略。传入 `application/octet-stream` 时 body 不参与签名。
   */
  contentType?: string
  /**
   * 额外的 `X-Qiniu-*` 头。键大小写不敏感，会归一为
   * `X-Qiniu-<大驼峰>` 形态后按 ASCII 升序参与签名。
   */
  xQiniuHeaders?: Record<string, string>
  /** 请求体。仅在设置了 `contentType` 且其不为 `application/octet-stream` 时参与签名。 */
  body?: Buffer | string
}

/** 签名产物：可直接使用的 `Authorization` 头值与签名串（后者仅供调试/测试）。 */
export interface QiniuSignature {
  /** `Authorization` 头的完整值：`Qiniu <AccessKey>:<EncodedSign>`。 */
  authorization: string
  /** Base64URL 编码后的签名（保留 `=` 填充）。 */
  encodedSign: string
  /**
   * 参与 HMAC 的原始字符串。**仅供测试与排障**——它不含 SK，
   * 但可能含 query 参数，不要整体写进日志。
   */
  signingStr: string
  /** 目标 URL 的签名用 query 串（含 `?`，无 query 时为空串）。 */
  query: string
}

/** Signing string 中 `Host:` 之后的换行 —— 无 body 时签名串以此收尾。 */
const EMPTY_LINE = '\n'

/**
 * 将任意 `X-Qiniu-*` 头键归一为签名要求的形态：
 * 小写化后把首字母与每个 `-` 后的字母大写，其余保持小写。
 *
 * 例：`x-qiniu-callback-url` → `X-Qiniu-Callback-Url`。
 *
 * @param key - 原始头名，大小写不敏感。
 * @returns 归一化后的头名；输入不以 `x-qiniu-` 开头时原样返回。
 */
export function canonicalizeQiniuHeaderKey(key: string): string {
  const lower = key.toLowerCase()
  if (!lower.startsWith('x-qiniu-')) return key
  return lower
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join('-')
}

/**
 * 计算管理凭证的签名串（尚未 HMAC）。
 *
 * 形态：
 *
 * ```text
 * METHOD + " " + path
 *   (+ "?" + query)                        // query 非空且不含 "?"
 *   + "\nHost: " + host                    // host 不含端口
 *   (+ "\nContent-Type: " + contentType)   // 仅当设置了该头
 *   (+ 按 key ASCII 排序的 X-Qiniu-* 头)
 *   + "\n\n"
 *   (+ body)                               // 仅当有 body 且 Content-Type != application/octet-stream
 * ```
 *
 * @param request - 请求描述。
 * @returns 参与 HMAC-SHA1 的原始字符串。
 */
export function buildSigningStr(request: QiniuSignRequest): string {
  const { method, url, contentType, xQiniuHeaders, body } = request

  // url.pathname 已含前导 '/'，且 URL 对象保证 pathname 非空。
  let signingStr = `${method.toUpperCase()} ${url.pathname}`

  // query 串逐字节共用（易错点 2）。url.search 自带前导 '?'，空 query 时为空串。
  // 允许显式传入，用于"先构造 query 串、再拼 URL"的调用路径。
  const query = request.queryString ?? url.search
  if (query.length > 0) {
    signingStr += query
  }

  // Host 取 url.hostname：`url.host` 带端口，`hostname` 不带 —— 易错点 1。
  // URL 的 hostname 对 IPv6 已含方括号，符合 Host 头形态。
  signingStr += `\nHost: ${url.hostname}`

  if (contentType !== undefined) {
    signingStr += `\nContent-Type: ${contentType}`
  }

  if (xQiniuHeaders !== undefined) {
    const entries = Object.entries(xQiniuHeaders)
      .map(([key, value]) => [canonicalizeQiniuHeaderKey(key), value] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    for (const [key, value] of entries) {
      signingStr += `\n${key}: ${value}`
    }
  }

  signingStr += `${EMPTY_LINE}${EMPTY_LINE}`

  // body 仅当"设置了 Content-Type 且其不为 application/octet-stream"时参与签名。
  // 没有 Content-Type 就没有 body 这一行 —— 否则签名会多出一段上游不认的内容。
  if (body !== undefined && contentType !== undefined && contentType !== 'application/octet-stream') {
    signingStr += typeof body === 'string' ? body : body.toString('utf8')
  }

  return signingStr
}

/**
 * 用 SecretKey 对 signing string 做 HMAC-SHA1，并 Base64URL 编码。
 *
 * **必须保留 `=` 填充**：Node 的 `Buffer#toString('base64url')` 会剥掉填充，
 * 而七牛的 encodedSign 带填充（文档固定向量以 `=` 结尾），两者签名值不同，
 * 直接用 `'base64url'` 会让所有请求 401。所以这里走 base64 再手工替换字符：
 * `+` → `-`，`/` → `_`，`=` 原样保留。
 *
 * @param signingStr - {@link buildSigningStr} 的产物。
 * @param secretKey - 七牛 SecretKey。
 * @returns Base64URL 编码且保留填充的签名。
 */
export function encodeSign(signingStr: string, secretKey: string): string {
  const digest = createHmac('sha1', secretKey).update(signingStr, 'utf8').digest()
  return digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * 生成完整的七牛 `Authorization` 头。
 *
 * @param accessKey - 七牛 AccessKey。
 * @param secretKey - 七牛 SecretKey。
 * @param signingStr - {@link buildSigningStr} 的产物。
 * @returns `Qiniu <AccessKey>:<EncodedSign>`。
 */
export function signWithKeys(accessKey: string, secretKey: string, signingStr: string): string {
  return `Qiniu ${accessKey}:${encodeSign(signingStr, secretKey)}`
}

/**
 * 一次性完成"构造签名串 → HMAC → Authorization 头"。
 *
 * @param accessKey - 七牛 AccessKey。
 * @param secretKey - 七牛 SecretKey。
 * @param request - 请求描述；其 `url` 的 query 串会被签名与请求共用。
 * @returns 签名产物。
 */
export function signRequest(
  accessKey: string,
  secretKey: string,
  request: QiniuSignRequest,
): QiniuSignature {
  const signingStr = buildSigningStr(request)
  const encodedSign = encodeSign(signingStr, secretKey)
  return {
    authorization: `Qiniu ${accessKey}:${encodedSign}`,
    encodedSign,
    signingStr,
    query: request.queryString ?? request.url.search,
  }
}

/**
 * 为一次七牛管理 API 调用生成 **已签名 URL 与请求头**。
 *
 * 这是服务层应当使用的入口：query 串在这里被构造一次，同时用于签名与最终 URL，
 * 因此"签名串与请求串逐字节一致"由结构保证，而不是靠调用方自觉。
 *
 * ```ts
 * const { url, headers } = signQiniuRequest(ak, sk, {
 *   method: 'GET',
 *   baseUrl: 'https://api.qiniu.com',
 *   path: '/billing-api/v1/respack/list',
 *   query: [['page', 1], ['page_size', 200]],
 * })
 * ```
 *
 * GET 调用**不会**带上 `Content-Type`（易错点 3）。
 *
 * @param accessKey - 七牛 AccessKey。
 * @param secretKey - 七牛 SecretKey。
 * @param request - 方法、基地址、路径与可选 query/头/body。
 * @returns 已签名 URL、`Authorization` 头与签名串（排障用）。
 */
export function signQiniuRequest(
  accessKey: string,
  secretKey: string,
  request: {
    method: string
    baseUrl: string
    path: string
    query?: Iterable<readonly [string, string | number | undefined]>
    contentType?: string
    xQiniuHeaders?: Record<string, string>
    body?: string
  },
): { url: URL; headers: Record<string, string>; signature: QiniuSignature } {
  const rawQuery = request.query === undefined ? '' : buildQueryString(request.query)
  const queryString = rawQuery === '' ? '' : `?${rawQuery}`
  const url = new URL(`${request.baseUrl.replace(/\/+$/, '')}${request.path}${queryString}`)

  const signature = signRequest(accessKey, secretKey, {
    method: request.method,
    url,
    queryString,
    ...(request.contentType === undefined ? {} : { contentType: request.contentType }),
    ...(request.xQiniuHeaders === undefined ? {} : { xQiniuHeaders: request.xQiniuHeaders }),
    ...(request.body === undefined ? {} : { body: request.body }),
  })

  const headers: Record<string, string> = { authorization: signature.authorization }
  if (request.contentType !== undefined) headers['content-type'] = request.contentType

  return { url, headers, signature }
}

/**
 * 以恒定时间比较两个签名，用于测试或回验上游签名。
 *
 * @param a - 待比较的签名（通常来自上游）。
 * @param b - 本地计算的签名。
 * @returns 二者是否相等；长度不同时直接返回 `false`。
 */
export function signaturesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * 用一组 `{ key, value }` 有序对构造 query 串，**逐字节**返回可直接拼进 URL 的形态。
 *
 * 需要签名与请求共用同一串时用它，而不是在别处手工拼 `&`/`?`：
 *
 * ```ts
 * const query = buildQueryString([['granularity', 'hour'], ['start', '2026-01-01T00:00:00+08:00']])
 * const url = new URL('/v3/stat/usage?' + query, 'https://api.qnaigc.com')
 * ```
 *
 * `URLSearchParams` 会把 `:` 编码为 `%3A`、`+` 编码为 `%2B`，
 * 这正是签名所需的逐字节形态。
 *
 * @param pairs - query 参数有序对；`undefined` 值会被跳过。
 * @returns 不含前导 `?` 的 query 串。
 */
export function buildQueryString(
  pairs: Iterable<readonly [string, string | number | undefined]>,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of pairs) {
    if (value === undefined) continue
    params.append(key, String(value))
  }
  return params.toString()
}
