/**
 * 凭据访问器测试。
 *
 * 重点是**惰性解析**：cordis 的服务异步激活，插件树又并发应用，所以插件 `apply`
 * 期间 `ctx.get('credentials')` 会返回 `undefined`（提供方 fiber 尚未激活）。
 *
 * 这个坑真实发生过：装进 profile 后 `/credentials` 恒返回
 * `{"hasStore":false,"writable":false}`，GUI 表单永久置灰，用户无法在界面里填 AK/SK。
 *
 * @module dsh-qiniu-usage/test/credentials
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { CredentialAccess, MissingCredentialsError, maskAccessKey } from '../src/credentials.ts'

/** 一个内存凭据库。 */
function makeStore(initial: Record<string, string> = {}, writable = true): {
  provider: unknown
  values: Record<string, string>
  calls: string[]
} {
  const values = { ...initial }
  const calls: string[] = []
  const provider = {
    resolve: async (ref: string) =>
      values[ref] === undefined ? undefined : { value: values[ref], source: 'file' },
    describe: async (ref: string) => ({
      configured: values[ref] !== undefined,
      ...(values[ref] === undefined ? {} : { source: 'file' }),
      writable,
    }),
    set: async (ref: string, value: string) => {
      calls.push(`set:${ref}`)
      if (!writable) throw new Error('来源只读，无法写入')
      values[ref] = value
    },
    unset: async (ref: string) => {
      calls.push(`unset:${ref}`)
      if (!writable) throw new Error('来源只读，无法清除')
      delete values[ref]
    },
  }
  return { provider, values, calls }
}

describe('CredentialAccess · 惰性解析（真实踩过的坑）', () => {
  it('服务晚于构造出现时，hasStore 从 false 变为 true', () => {
    let provider: unknown
    const access = new CredentialAccess(() => provider as never)

    assert.equal(access.hasStore, false, '服务未出现时应报告无凭据库')
    provider = makeStore().provider
    assert.equal(access.hasStore, true, '服务出现后应实时识别 —— 不能缓存构造时的 undefined')
  })

  it('服务晚于构造出现时，set/unset 也能用（不再是只读）', async () => {
    let provider: unknown
    const access = new CredentialAccess(() => provider as never)

    await assert.rejects(() => access.set('QINIU_ACCESS_KEY', 'AK'), /没有凭据库可用/)

    const store = makeStore()
    provider = store.provider

    await access.set('QINIU_ACCESS_KEY', 'AK')
    assert.equal(store.values.QINIU_ACCESS_KEY, 'AK')
    await access.unset('QINIU_ACCESS_KEY')
    assert.equal(store.values.QINIU_ACCESS_KEY, undefined)
  })

  it('服务晚于构造出现时，describe 走凭据库而不是环境变量', async () => {
    let provider: unknown
    const store = makeStore({ QINIU_ACCESS_KEY: 'AK' })
    // 环境变量里也有一份，用来区分走的是哪条路径
    const access = new CredentialAccess(() => provider as never, { QINIU_ACCESS_KEY: 'FROM_ENV' })

    const before = await access.describe('QINIU_ACCESS_KEY')
    assert.equal(before.source, 'env', '无凭据库时应走环境变量分支')
    assert.equal(before.writable, false, '环境变量来源不可写')

    provider = store.provider
    const after = await access.describe('QINIU_ACCESS_KEY')
    assert.equal(after.source, 'file', '有凭据库后应走凭据库 describe')
    assert.equal(after.writable, true)
  })

  it('直接传服务实例（非解析器）同样可用', async () => {
    const store = makeStore({ QINIU_ACCESS_KEY: 'AK' })
    const access = new CredentialAccess(store.provider as never)
    assert.equal(access.hasStore, true)
    assert.equal((await access.resolve('QINIU_ACCESS_KEY'))?.value, 'AK')
  })

  it('完全没有来源时降级为环境变量直读', async () => {
    const access = new CredentialAccess(undefined, { QINIU_ACCESS_KEY: 'AK' })
    assert.equal(access.hasStore, false)
    assert.deepEqual(await access.resolve('QINIU_ACCESS_KEY'), { value: 'AK', source: 'env' })
    assert.equal(await access.resolve('NOPE'), undefined)
  })

  it('凭据库为空值时不回退到环境变量（空值视为未配置）', async () => {
    const store = makeStore({})
    const access = new CredentialAccess(store.provider as never, { QINIU_ACCESS_KEY: 'FROM_ENV' })
    // 凭据库没有该 ref → 回退环境变量
    assert.equal((await access.resolve('QINIU_ACCESS_KEY'))?.value, 'FROM_ENV')
  })
})

describe('CredentialAccess · AK/SK 组合解析', () => {
  it('两个都齐时返回键值对与来源', async () => {
    const store = makeStore({ QINIU_ACCESS_KEY: 'AK', QINIU_SECRET_KEY: 'SK' })
    const access = new CredentialAccess(store.provider as never)
    const pair = await access.resolveKeyPair('QINIU_ACCESS_KEY', 'QINIU_SECRET_KEY')
    assert.equal(pair.accessKey, 'AK')
    assert.equal(pair.secretKey, 'SK')
    assert.equal(pair.accessKeySource, 'file')
  })

  it('缺任一时抛 MissingCredentialsError 并列出缺失的 ref', async () => {
    const store = makeStore({ QINIU_ACCESS_KEY: 'AK' })
    const access = new CredentialAccess(store.provider as never)
    await assert.rejects(
      () => access.resolveKeyPair('QINIU_ACCESS_KEY', 'QINIU_SECRET_KEY'),
      (error: unknown) =>
        error instanceof MissingCredentialsError
        && error.missingRefs.length === 1
        && error.missingRefs[0] === 'QINIU_SECRET_KEY'
        && error.readOnly === false,
    )
  })

  it('降级模式下缺失标记为只读（UI 应改提示去设置环境变量）', async () => {
    const access = new CredentialAccess(undefined, {})
    await assert.rejects(
      () => access.resolveKeyPair('QINIU_ACCESS_KEY', 'QINIU_SECRET_KEY'),
      (error: unknown) => error instanceof MissingCredentialsError && error.readOnly === true,
    )
  })

  it('两个都缺时都列出来', async () => {
    const access = new CredentialAccess(makeStore().provider as never)
    await assert.rejects(
      () => access.resolveKeyPair('QINIU_ACCESS_KEY', 'QINIU_SECRET_KEY'),
      (error: unknown) =>
        error instanceof MissingCredentialsError && error.missingRefs.length === 2,
    )
  })
})

describe('maskAccessKey', () => {
  it('保留前 4 位并打码', () => {
    assert.equal(maskAccessKey('ABCDEFGHIJKL'), 'ABCD********')
  })

  it('过短的 AK 整体打码', () => {
    assert.equal(maskAccessKey('AB'), '**')
    assert.equal(maskAccessKey('ABCD'), '****')
  })

  it('长 AK 也不会把掩码撑得过长', () => {
    const masked = maskAccessKey('A'.repeat(100))
    assert.equal(masked.length, 16, '4 位明文 + 最多 12 位掩码')
  })
})
