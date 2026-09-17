/**
 * 宿主路由：loopback-fenced 的 JSON 接口。
 *
 * 设计文档 §7。三条硬要求：
 *
 * 1. 每个路由都先过 `isLoopbackRequest` —— 个人账号数据，只允许本机浏览器读。
 * 2. 响应一律 `cache-control: no-store`。
 * 3. **入参白名单校验**：`day` 只接受 `today` / `yesterday` / `YYYY-MM-DD`；
 *    `key` 只是本地筛选用的标签，但同样不让它把任意文本带进上游请求链路。
 *
 * @module dsh-qiniu-usage/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackRequest } from './host/loopback.ts'
import { readJsonBody, writeJson } from './host/http.ts'
import type { DaySelector, KeySelector, QiniuUsageService } from './service.ts'
import { toSourceError } from './service.ts'

/** 本插件所有路由的前缀。 */
export const API_PREFIX = '/api/dsh-qiniu-usage'

/** 合法日期分隔形态：`YYYY-MM-DD`。 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 校验并归一 `day` 参数。
 *
 * 只放行三个形态：`today`、`yesterday`、合法日期。其余（含路径穿越、超长串、
 * 上游 query 注入尝试）一律回落到 `today` —— 绝不把未经校验的字符串带进上游请求。
 *
 * @param raw - 原始参数值，可能为 `null`（未提供）。
 * @returns 归一后的日期口径。
 */
export function parseDayParam(raw: string | null | undefined): DaySelector {
  if (typeof raw !== 'string' || raw === '') return 'today'
  if (raw === 'today' || raw === 'yesterday') return raw
  if (ISO_DATE.test(raw)) {
    // 再确认一次"看起来是真的日期"，例如拒绝 2026-13-45。
    const parsed = new Date(`${raw}T00:00:00Z`)
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw) return raw
  }
  return 'today'
}

/**
 * 归一并截断 `key` 参数。
 *
 * 该值只用于本地筛选（比对上游返回的 `name` / 掩码 / `api_key`），不会拼进上游
 * query。仍做长度与字符约束，避免它经错误信息或界面回显时出现异常内容。
 *
 * @param raw - 原始参数值。
 * @returns 归一后的 Key 选择器；空串表示账号级汇总。
 */
export function parseKeyParam(raw: string | null | undefined): KeySelector {
  if (typeof raw !== 'string') return ''
  // 去掉控制字符与首尾空白；长度上限 128 足够容纳名称与掩码。
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128)
}

/** 从请求 URL 里只取 query 段，避免依赖 `Host` 之外的信息。 */
function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://localhost')
}

/** 统一的 fence + 方法校验前置；返回 `true` 表示可以继续处理。 */
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

/** 统一的 200 JSON 响应。 */
function ok(res: ServerResponse, body: unknown): void {
  writeJson(res, 200, body, { 'cache-control': 'no-store' })
}

/**
 * `GET /overview?day=&key=` —— 面板主接口。
 *
 * @param service - 用量服务。
 * @returns 路由定义。
 */
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

/**
 * `POST /refresh` —— 失效缓存后重取。
 *
 * body 可选，字段与 `/overview` 的 query 相同。
 *
 * @param service - 用量服务。
 * @returns 路由定义。
 */
export function makeRefreshRoute(service: QiniuUsageService): WebRoute {
  return {
    kind: 'exact',
    path: `${API_PREFIX}/refresh`,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guard(req, res, ['POST'])) return

      // body 是可选增强：query 里给了就用 query，否则读 body。
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

/**
 * `GET /keys?day=` —— Key 选择器候选集。
 *
 * @param service - 用量服务。
 * @returns 路由定义。
 */
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

/** `order_hash` 形态：十六进制/md5 类标识，限制长度与字符集。 */
const ORDER_HASH = /^[A-Za-z0-9_-]{1,64}$/

/**
 * `GET /respack/detail?order_hash=&po_id=` —— 单包下钻。
 *
 * 两个参数都必须来自 `respack/list` 的返回，因此这里只做形态校验；任何不合形态的
 * 值直接 400，不带上游 —— 避免把任意文本拼进签名请求的 query。
 *
 * @param service - 用量服务。
 * @returns 路由定义。
 */
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
        // 下钻失败只影响这一个面板，不抛给上层；错误形状与 /overview 的 errors 一致。
        ok(res, { ok: false, detail: null, error: toSourceError(error, 'respack') })
      }
    },
  }
}

/**
 * `/credentials` —— 凭据状态读取与写入。
 *
 * ⚠ **一个路径只能注册一条路由。** `WebRoute` 没有 method 字段，
 * `webServer.register()` 按 `(kind, path)` 唯一，重复注册会在启动期抛
 * `duplicate exact route`。方法分派必须写在 handler 内部 —— 与 `dsh-usage`
 * 的 refresh 路由同款做法。
 *
 * - `GET`  → 只回 `describe` 形状（`configured` / `source` / `writable`），永不返回值。
 * - `POST` → body `{ ref, action: 'set', value }` 或 `{ ref, action: 'unset' }`。
 *   `ref` 由 service 做白名单校验，因此这个接口**不能写任意路径**。
 *
 * @param service - 用量服务。
 * @returns 路由定义。
 */
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

      // POST：写入或清除。
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
        // 写成功后回传新的 describe 结果，UI 据此更新状态。
        ok(res, { ok: true, credentials: await service.describeCredentials() })
      } catch (error) {
        // 只读遮蔽、引用不在白名单、空值 —— 都是可预期失败，回传可读信息。
        ok(res, {
          ok: false,
          error: toSourceError(error, 'usage'),
          credentials: await service.describeCredentials().catch(() => null),
        })
      }
    },
  }
}

/**
 * 本插件当前注册的全部路由。
 *
 * @param service - 用量服务。
 * @returns 路由数组。
 */
export function makeRoutes(service: QiniuUsageService): WebRoute[] {
  return [
    makeOverviewRoute(service),
    makeRefreshRoute(service),
    makeKeysRoute(service),
    makeRespackDetailRoute(service),
    makeCredentialsRoute(service),
  ]
}
