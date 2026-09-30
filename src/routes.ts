// 个人账号数据只允许本机浏览器读：所有路由先过 loopback 校验并置 no-store；见 DESIGN.md §7。

import type {IncomingMessage, ServerResponse} from 'node:http'
import type {WebRoute} from '@deepseek-ai/dsh-host-webserver'
import {isLoopbackRequest} from './host/loopback.ts'
import {readJsonBody, writeJson} from './host/http.ts'
import type {DaySelector, KeySelector, QiniuUsageService} from './service.ts'
import {toSourceError} from './service.ts'

export const API_PREFIX = '/api/dsh-qiniu-usage'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 校验并归一 `day`；只放行 today/yesterday/合法日期，其余一律回落 today，绝不把未校验串带进上游。 */
export function parseDayParam(raw: string | null | undefined): DaySelector {
  if (typeof raw !== 'string' || raw === '') return 'today'
  if (raw === 'today' || raw === 'yesterday') return raw
  if (ISO_DATE.test(raw)) {
      // 再确认是真实日期，例如拒绝 2026-13-45。
    const parsed = new Date(`${raw}T00:00:00Z`)
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw) return raw
  }
  return 'today'
}

/** 归一并截断 `key`（≤128）；它只用于本地筛选、不进上游 query，仍限字符避免回显异常。 */
export function parseKeyParam(raw: string | null | undefined): KeySelector {
  if (typeof raw !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128)
}

// 用固定假 base 构造 URL，只取 path/query，不依赖 `Host`。
function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://localhost')
}

function guard(
  req: IncomingMessage,
  res: ServerResponse,
  allowed: string[],
): boolean {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' }, { 'cache-control': 'no-store' })
    return false
  }
  if (req.method !== undefined && !allowed.includes(req.method)) {
    writeJson(
      res,
      405,
      { ok: false, error: 'method not allowed' },
      { 'cache-control': 'no-store' },
    )
    return false
  }
  return true
}

function ok(res: ServerResponse, body: unknown): void {
  writeJson(res, 200, body, { 'cache-control': 'no-store' })
}

/** `GET /overview?day=&key=` —— 面板主接口。 */
export function makeOverviewRoute(service: QiniuUsageService): WebRoute {
  return {
    kind: 'exact',
    path: `${API_PREFIX}/overview`,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guard(req, res, ['GET'])) return
      const url = requestUrl(req)
      const day = parseDayParam(url.searchParams.get('day'))
      const key = parseKeyParam(url.searchParams.get('key'))
      const payload = await service.overview(day, key)
      ok(res, payload)
    },
  }
}

/** `POST /refresh`；body 可选，字段与 `/overview` 的 query 相同。 */
export function makeRefreshRoute(service: QiniuUsageService): WebRoute {
  return {
    kind: 'exact',
    path: `${API_PREFIX}/refresh`,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guard(req, res, ['POST'])) return

        // query 优先，其次读 body。
      const url = requestUrl(req)
      let dayRaw = url.searchParams.get('day')
      let keyRaw = url.searchParams.get('key')

      const body = await readJsonBody(req, { objectOnly: true })
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>
        if (typeof record.day === 'string') dayRaw = record.day
        if (typeof record.key === 'string') keyRaw = record.key
      }

      const payload = await service.refresh(parseDayParam(dayRaw), parseKeyParam(keyRaw))
      ok(res, payload)
    },
  }
}

/** `GET /keys?day=` —— Key 选择器候选集。 */
export function makeKeysRoute(service: QiniuUsageService): WebRoute {
  return {
    kind: 'exact',
    path: `${API_PREFIX}/keys`,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guard(req, res, ['GET'])) return
      const url = requestUrl(req)
      const payload = await service.keys(parseDayParam(url.searchParams.get('day')))
      ok(res, payload)
    },
  }
}

/** `order_hash` 形态：hex/md5 类标识，限长度与字符集。 */
const ORDER_HASH = /^[A-Za-z0-9_-]{1,64}$/

/** `GET /respack/detail`；参数须来自 `respack/list`，形态不合直接 400 不带上游，避免任意文本拼进签名 query。 */
export function makeRespackDetailRoute(service: QiniuUsageService): WebRoute {
  return {
    kind: 'exact',
    path: `${API_PREFIX}/respack/detail`,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guard(req, res, ['GET'])) return
      const url = requestUrl(req)

      const orderHash = (url.searchParams.get('order_hash') ?? '').trim()
      const poIdRaw = (url.searchParams.get('po_id') ?? '').trim()
      const poId = Number(poIdRaw)

      if (!ORDER_HASH.test(orderHash) || poIdRaw === '' || !Number.isSafeInteger(poId) || poId < 0) {
        writeJson(
          res,
          400,
          { ok: false, error: 'invalid order_hash or po_id' },
          { 'cache-control': 'no-store' },
        )
        return
      }

      try {
        const detail = await service.respackDetail(orderHash, poId)
        ok(res, { ok: true, detail })
      } catch (error) {
          // 下钻失败只影响本面板，不抛给上层；错误形状与 /overview 的 errors 一致。
        ok(res, { ok: false, detail: null, error: toSourceError(error, 'respack') })
      }
    },
  }
}

/** `/credentials`；`WebRoute` 无 method 字段故一路径只注册一条路由（重复会抛 duplicate exact route），方法分派写在 handler 内；`ref` 由 service 白名单校验，不能写任意路径。 */
export function makeCredentialsRoute(service: QiniuUsageService): WebRoute {
  return {
    kind: 'exact',
    path: `${API_PREFIX}/credentials`,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guard(req, res, ['GET', 'POST'])) return

      if (req.method === 'GET') {
        try {
          ok(res, { ok: true, credentials: await service.describeCredentials() })
        } catch (error) {
          ok(res, { ok: false, error: toSourceError(error, 'usage') })
        }
        return
      }

      const contentType = req.headers['content-type'] ?? ''
      if (!contentType.includes('application/json')) {
        writeJson(
          res,
          415,
          { ok: false, error: 'content-type must be application/json' },
          { 'cache-control': 'no-store' },
        )
        return
      }

      const body = await readJsonBody(req, { objectOnly: true })
      if (body === null) {
        writeJson(res, 400, { ok: false, error: 'invalid JSON body' }, { 'cache-control': 'no-store' })
        return
      }

      const record = body as Record<string, unknown>
      const ref = typeof record.ref === 'string' ? record.ref : ''
      const action = record.action
      if (ref === '' || (action !== 'set' && action !== 'unset')) {
        writeJson(
          res,
          400,
          { ok: false, error: "expected { ref, action: 'set'|'unset' }" },
          { 'cache-control': 'no-store' },
        )
        return
      }

      try {
        if (action === 'set') {
          const value = typeof record.value === 'string' ? record.value : ''
          await service.setCredential(ref, value)
        } else {
          await service.unsetCredential(ref)
        }
          // 写成功后回传新的 describe 结果供 UI 更新。
        ok(res, { ok: true, credentials: await service.describeCredentials() })
      } catch (error) {
          // 只读遮蔽、ref 不在白名单、空值均为可预期失败，回传可读信息。
        ok(res, {
          ok: false,
          error: toSourceError(error, 'usage'),
          credentials: await service.describeCredentials().catch(() => null),
        })
      }
    },
  }
}

/** 本插件当前注册的全部路由。 */
export function makeRoutes(service: QiniuUsageService): WebRoute[] {
  return [
    makeOverviewRoute(service),
    makeRefreshRoute(service),
    makeKeysRoute(service),
    makeRespackDetailRoute(service),
    makeCredentialsRoute(service),
  ]
}
