// 管理凭证签名文档：https://developer.qiniu.com/kodo/1201/access-token；三个易错点：`Host` 不含端口、query 串须与实际请求逐字节一致（`+08:00` → `%2B08:00`）、GET 不设 `Content-Type`。

import {createHmac, timingSafeEqual} from 'node:crypto'

/** 签名所需的最小请求描述。 */
export interface QiniuSignRequest {
  method: string
    /** `host` 不含端口、`search` 含前导 `?`，二者是签名使用的权威来源。 */
  url: URL
    /** 含前导 `?`；省略时用 `url.search`，使签名与请求共用同一串成为结构保证。 */
  queryString?: string
    /** 只有实际会出现在请求里的头才可传：GET 必须省略，`application/octet-stream` 时 body 不参与签名。 */
  contentType?: string
    /** 键大小写不敏感，归一为 `X-Qiniu-<大驼峰>` 后按 ASCII 升序参与签名。 */
  xQiniuHeaders?: Record<string, string>
    /** 仅在设置了 `contentType` 且其不为 `application/octet-stream` 时参与签名。 */
  body?: Buffer | string
}

/** 签名产物；`signingStr` 仅供测试与排障。 */
export interface QiniuSignature {
    /** `Authorization` 头完整值：`Qiniu <AccessKey>:<EncodedSign>`。 */
  authorization: string
    /** Base64URL 后的签名；**保留 `=` 填充**。 */
  encodedSign: string
    /** 参与 HMAC 的原始串：不含 SK，但可能含 query 参数，不要整体写进日志。 */
  signingStr: string
    /** 签名用的 query 串（含前导 `?`，无 query 时为空串）。 */
  query: string
}

// Signing string 中 `Host:` 之后的换行 —— 无 body 时签名串以此收尾。
const EMPTY_LINE = '\n'

/** 把 `x-qiniu-*` 头键归一到 `X-Qiniu-<大驼峰>`；非该前缀原样返回。 */
export function canonicalizeQiniuHeaderKey(key: string): string {
  const lower = key.toLowerCase()
  if (!lower.startsWith('x-qiniu-')) return key
  return lower
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join('-')
}

/** 计算参与 HMAC-SHA1 的签名串（尚未 HMAC）。 */
export function buildSigningStr(request: QiniuSignRequest): string {
  const { method, url, contentType, xQiniuHeaders, body } = request

    // url.pathname 自带前导 '/'。
  let signingStr = `${method.toUpperCase()} ${url.pathname}`

    // url.search 自带前导 '?'；显式传入用于"先拼 query 再拼 URL"的路径（易错点 2）。
  const query = request.queryString ?? url.search
  if (query.length > 0) {
    signingStr += query
  }

    // 用 hostname 而非 host：后者带端口（易错点 1）；IPv6 的方括号已包含在内。
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

    // 无 Content-Type 就没有 body 行，否则签名会多出上游不认的内容。
  if (body !== undefined && contentType !== undefined && contentType !== 'application/octet-stream') {
    signingStr += typeof body === 'string' ? body : body.toString('utf8')
  }

  return signingStr
}

/** 用 SK 对签名串做 HMAC-SHA1 后走 base64 手工替换 `+`→`-`、`/`→`_`：Node 的 `base64url` 会剥掉 `=` 填充，而七牛带填充，两者签名值不同，直接用会让所有请求 401。 */
export function encodeSign(signingStr: string, secretKey: string): string {
  const digest = createHmac('sha1', secretKey).update(signingStr, 'utf8').digest()
  return digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

export function signWithKeys(accessKey: string, secretKey: string, signingStr: string): string {
  return `Qiniu ${accessKey}:${encodeSign(signingStr, secretKey)}`
}

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

/** 服务层入口：query 在这里构造一次、同时用于签名与最终 URL，逐字节一致由结构保证；GET 不带 `Content-Type`（易错点 3）。 */
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

/** 恒定时间比较两个签名，用于测试或回验上游签名。 */
export function signaturesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** 有序对 → 不含前导 `?` 的 query 串；`URLSearchParams` 把 `:` 编成 `%3A`、`+` 编成 `%2B`，正是签名所需的逐字节形态。 */
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
