/**
 * 签名器固定向量与边界测试。
 *
 * 主向量取自七牛官方文档：
 * https://developer.qiniu.com/kodo/1201/access-token
 *
 * @module dsh-qiniu-usage/test/sign
 */

import { strict as assert } from 'node:assert'
import { createHmac } from 'node:crypto'
import { describe, it } from 'vitest'
import {
  buildQueryString,
  buildSigningStr,
  canonicalizeQiniuHeaderKey,
  encodeSign,
  signaturesEqual,
  signRequest,
} from '../src/qiniu/sign.ts'

const ACCESS_KEY = 'MY_ACCESS_KEY'
const SECRET_KEY = 'MY_SECRET_KEY'

const OFFICIAL_PATH =
  '/move/bmV3ZG9jczpmaW5kX21hbi50eHQ=/bmV3ZG9jczpmaW5kLm1hbi50eHQ='
const OFFICIAL_HOST = 'rs.qiniu.com'
const OFFICIAL_SIGNING_STR =
  `POST ${OFFICIAL_PATH}\nHost: ${OFFICIAL_HOST}\n\n`
const OFFICIAL_ENCODED_SIGN = '1uLvuZM6l6oCzZFqkJ6oI4oFMVQ='

describe('签名器 · 官方固定向量', () => {
  it('signingStr 与文档逐字节一致', () => {
    const url = new URL(OFFICIAL_PATH, `https://${OFFICIAL_HOST}`)
    const signingStr = buildSigningStr({ method: 'POST', url })
    assert.equal(signingStr, OFFICIAL_SIGNING_STR)
  })

  it('encodedSign 等于文档期望值（含 = 填充）', () => {
    const encodedSign = encodeSign(OFFICIAL_SIGNING_STR, SECRET_KEY)
    assert.equal(encodedSign, OFFICIAL_ENCODED_SIGN)
  })

  it('Authorization 头形态为 Qiniu <AK>:<sign>', () => {
    const url = new URL(OFFICIAL_PATH, `https://${OFFICIAL_HOST}`)
    const { authorization, encodedSign, signingStr } = signRequest(
      ACCESS_KEY,
      SECRET_KEY,
      { method: 'POST', url },
    )
    assert.equal(encodedSign, OFFICIAL_ENCODED_SIGN)
    assert.equal(signingStr, OFFICIAL_SIGNING_STR)
    assert.equal(authorization, `Qiniu ${ACCESS_KEY}:${OFFICIAL_ENCODED_SIGN}`)
  })

  it('Base64URL 保留 =，且不出现 + 与 /', () => {
    const encoded = encodeSign(OFFICIAL_SIGNING_STR, SECRET_KEY)
    assert.ok(encoded.endsWith('='), '应保留 = 填充')
    assert.ok(!encoded.includes('+'), '不应出现 +（应为 -）')
    assert.ok(!encoded.includes('/'), '不应出现 /（应为 _）')
  })

  it('回归：Node 的 base64url 会剥掉 =，不能直接使用', () => {
    // 这是本项目踩过的真实坑：Buffer#toString('base64url') 无填充，
    // 与七牛要求的带填充 encodedSign 不同值，直接用会让所有请求 401。
    const digest = createHmac('sha1', SECRET_KEY).update(OFFICIAL_SIGNING_STR, 'utf8').digest()
    const nodeBase64Url = digest.toString('base64url')
    const ours = encodeSign(OFFICIAL_SIGNING_STR, SECRET_KEY)

    assert.equal(nodeBase64Url, OFFICIAL_ENCODED_SIGN.replace(/=$/, ''), '前置断言：Node 确实无填充')
    assert.notEqual(nodeBase64Url, OFFICIAL_ENCODED_SIGN)
    assert.equal(ours, OFFICIAL_ENCODED_SIGN)
  })
})

describe('签名器 · 易错点 1：Host 不含端口', () => {
  it('非默认端口：url.host 带端口，但签名只用 hostname', () => {
    const url = new URL('https://api.qiniu.com:8443/billing-api/v1/respack/list')
    assert.equal(url.host, 'api.qiniu.com:8443', '前置断言：URL.host 确实带端口')
    assert.equal(url.hostname, 'api.qiniu.com')

    const signingStr = buildSigningStr({ method: 'GET', url })
    assert.equal(
      signingStr,
      'GET /billing-api/v1/respack/list\nHost: api.qiniu.com\n\n',
    )
    assert.ok(!signingStr.includes('8443'), '签名串不得出现端口')
  })

  it('显式默认端口 :443 会被 URL 归一掉，签名不受影响', () => {
    const url = new URL('https://api.qiniu.com:443/billing-api/v1/respack/list')
    assert.equal(url.host, 'api.qiniu.com', '前置断言：默认端口被 URL 归一')
    assert.equal(
      buildSigningStr({ method: 'GET', url }),
      'GET /billing-api/v1/respack/list\nHost: api.qiniu.com\n\n',
    )
  })

  it('http 默认端口 :80 同样被剥离', () => {
    const url = new URL('http://127.0.0.1:9000/v3/stat/usage')
    const signingStr = buildSigningStr({ method: 'GET', url })
    assert.equal(signingStr, 'GET /v3/stat/usage\nHost: 127.0.0.1\n\n')
  })
})

describe('签名器 · 易错点 2：query 逐字节一致', () => {
  it('+08:00 编码为 %2B08:00，且签名串与 URL 共用同一串', () => {
    const query = buildQueryString([
      ['granularity', 'hour'],
      ['start', '2026-01-01T00:00:00+08:00'],
      ['end', '2026-01-01T12:00:00+08:00'],
    ])
    const url = new URL(`https://api.qnaigc.com/v3/stat/usage?${query}`)

    const { signingStr, query: signedQuery } = signRequest(ACCESS_KEY, SECRET_KEY, {
      method: 'GET',
      url,
    })

    assert.ok(query.includes('%2B08%3A00'), 'URLSearchParams 应把 + 编码为 %2B')
    assert.equal(signedQuery, url.search, '签名 query 必须与 URL.search 同源')

    const [requestLine] = signingStr.split('\n')
    assert.equal(requestLine, `GET /v3/stat/usage${url.search}`)
  })

  it('无 query 时不追加 ?', () => {
    const url = new URL('https://api.qiniu.com/billing-api/v1/respack/list')
    assert.equal(url.search, '')
    const signingStr = buildSigningStr({ method: 'GET', url })
    assert.ok(!signingStr.includes('?'))
  })

  it('buildQueryString 跳过 undefined 并保持插入顺序', () => {
    const query = buildQueryString([
      ['status', 2],
      ['page', 1],
      ['page_size', 200],
      ['ignored', undefined],
    ])
    assert.equal(query, 'status=2&page=1&page_size=200')
  })
})

describe('签名器 · 易错点 3：GET 不带 Content-Type', () => {
  it('未设置 Content-Type 时签名串以空行收尾', () => {
    const url = new URL('https://api.qiniu.com/billing-api/v1/respack/list')
    const signingStr = buildSigningStr({ method: 'GET', url })
    assert.ok(signingStr.endsWith('\n\n'), '应以 \\n\\n 收尾')
    assert.ok(!signingStr.includes('Content-Type'))
  })

  it('设置 Content-Type 时多出一行，且位置在 Host 之后', () => {
    const url = new URL('https://api.qiniu.com/v3/stat/usage')
    const signingStr = buildSigningStr({
      method: 'POST',
      url,
      contentType: 'application/json',
    })
    assert.equal(
      signingStr,
      'POST /v3/stat/usage\nHost: api.qiniu.com\nContent-Type: application/json\n\n',
    )
  })

  it('同一请求带与不带 Content-Type 必须得到不同签名', () => {
    const url = new URL('https://api.qiniu.com/v3/stat/usage')
    const withCt = signRequest(ACCESS_KEY, SECRET_KEY, {
      method: 'POST',
      url,
      contentType: 'application/json',
    })
    const withoutCt = signRequest(ACCESS_KEY, SECRET_KEY, { method: 'POST', url })
    assert.notEqual(withCt.encodedSign, withoutCt.encodedSign)
  })
})

describe('签名器 · body 参与规则', () => {
  it('普通 Content-Type 下 body 参与签名', () => {
    const url = new URL('https://api.qiniu.com/v3/stat/usage')
    const body = '{"a":1}'
    const signingStr = buildSigningStr({
      method: 'POST',
      url,
      contentType: 'application/json',
      body,
    })
    assert.equal(
      signingStr,
      'POST /v3/stat/usage\nHost: api.qiniu.com\nContent-Type: application/json\n\n{"a":1}',
    )
  })

  it('application/octet-stream 下 body 不参与签名', () => {
    const url = new URL('https://api.qiniu.com/v3/stat/usage')
    const signingStr = buildSigningStr({
      method: 'POST',
      url,
      contentType: 'application/octet-stream',
      body: 'RAW-BYTES',
    })
    assert.ok(!signingStr.includes('RAW-BYTES'))
  })

  it('无 Content-Type 时即使给了 body 也不参与签名', () => {
    const url = new URL('https://api.qiniu.com/v3/stat/usage')
    const signingStr = buildSigningStr({ method: 'POST', url, body: 'IGNORED' })
    assert.ok(!signingStr.includes('IGNORED'))
  })

  it('Buffer body 与等价字符串签名一致', () => {
    const url = new URL('https://api.qiniu.com/v3/stat/usage')
    const base = { method: 'POST', url, contentType: 'application/json' } as const
    const asString = encodeSign(buildSigningStr({ ...base, body: 'hello' }), SECRET_KEY)
    const asBuffer = encodeSign(
      buildSigningStr({ ...base, body: Buffer.from('hello', 'utf8') }),
      SECRET_KEY,
    )
    assert.equal(asString, asBuffer)
  })
})

describe('签名器 · X-Qiniu-* 头', () => {
  it('键归一为 X-Qiniu-<大驼峰>', () => {
    assert.equal(canonicalizeQiniuHeaderKey('x-qiniu-callback-url'), 'X-Qiniu-Callback-Url')
    assert.equal(canonicalizeQiniuHeaderKey('X-QINIU-MIME-TYPE'), 'X-Qiniu-Mime-Type')
    assert.equal(canonicalizeQiniuHeaderKey('Content-Type'), 'Content-Type')
  })

  it('按归一后 key 的 ASCII 升序排列，与传入顺序无关', () => {
    const url = new URL('https://api.qiniu.com/v3/stat/usage')
    const ordered = buildSigningStr({
      method: 'POST',
      url,
      xQiniuHeaders: { 'x-qiniu-alias': 'b', 'x-qiniu-aaa': 'a' },
    })
    const reversed = buildSigningStr({
      method: 'POST',
      url,
      xQiniuHeaders: { 'X-Qiniu-Aaa': 'a', 'X-Qiniu-Alias': 'b' },
    })
    assert.equal(ordered, reversed)
    assert.equal(
      ordered,
      'POST /v3/stat/usage\nHost: api.qiniu.com\nX-Qiniu-Aaa: a\nX-Qiniu-Alias: b\n\n',
    )
  })
})

describe('签名器 · 杂项', () => {
  it('method 大小写不敏感，统一大写', () => {
    const url = new URL('https://api.qiniu.com/v3/stat/usage')
    assert.equal(
      buildSigningStr({ method: 'get', url }),
      buildSigningStr({ method: 'GET', url }),
    )
  })

  it('signaturesEqual 对相同与不同签名给出正确结论', () => {
    assert.ok(signaturesEqual('abc', 'abc'))
    assert.ok(!signaturesEqual('abc', 'abd'))
    assert.ok(!signaturesEqual('abc', 'abcd'), '长度不同应直接 false')
  })

  it('不同 SK 产生不同签名（SK 确实参与 HMAC）', () => {
    const url = new URL(OFFICIAL_PATH, `https://${OFFICIAL_HOST}`)
    const a = signRequest(ACCESS_KEY, SECRET_KEY, { method: 'POST', url })
    const b = signRequest(ACCESS_KEY, 'OTHER_SECRET', { method: 'POST', url })
    assert.notEqual(a.encodedSign, b.encodedSign)
  })
})
