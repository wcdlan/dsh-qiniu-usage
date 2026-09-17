/**
 * 凭据表单。
 *
 * 设计文档 §9.3 与 §10.2 的**两层语义**必须体现出来：
 *
 * - **键名**（`QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY`，来自 config）→ 只读展示，
 *   用等宽"代码块"样式明确它是名字而不是值。`CredentialRef` 是 POSIX 环境变量名。
 * - **值**（AK/SK 明文）→ 才是输入框。
 *
 * 提交后**立即清空输入框**，只回显 `configured / source / writable`。
 *
 * @module dsh-qiniu-usage/client/CredentialsForm
 */

import { createElement, useState, type ReactNode } from 'react'
import { cls } from './styles.ts'

/** 单个引用的状态（与宿主 `CredentialStatus` 同形，这里不跨包 import 宿主类型）。 */
export interface CredentialStatusView {
  ref: string
  configured: boolean
  source?: string
  writable: boolean
}

/** `/credentials` 的 describe 载荷。 */
export interface CredentialsView {
  accessKey: CredentialStatusView
  secretKey: CredentialStatusView
  apiKeys: { label: string; ref: string; status: CredentialStatusView }[]
  hasStore: boolean
}

/** 翻译函数签名。 */
type Translate = (key: string, params?: Record<string, unknown>) => string

/** 组件属性。 */
export interface CredentialsFormProps {
  credentials: CredentialsView | null
  t: Translate
  /** 写入一个引用。 */
  onSet: (ref: string, value: string) => Promise<void>
  /** 清除一个引用。 */
  onUnset: (ref: string) => Promise<void>
}

/** 一行凭据：只读键名 + 值输入框 + 保存/清除 + 状态。 */
function CredentialRow(props: {
  title: string
  hint: string
  status: CredentialStatusView | null
  t: Translate
  onSet: (value: string) => Promise<void>
  onUnset: () => Promise<void>
  /** 是否用密码框（SK 用）。 */
  secret?: boolean
}): ReactNode {
  const { title, hint, status, t, onSet, onUnset, secret } = props
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (value === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSet(value)
      // 提交后立即清空 —— 明文不在界面里停留。
      setValue('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onUnset()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const writable = status?.writable === true
  const sourceLabel = status?.configured === true
    ? status.source === 'env'
      ? t('qiniu.credentials.sourceEnv', { ref: status.ref })
      : t('qiniu.credentials.sourceStore')
    : t('qiniu.credentials.notConfigured')

  return createElement(
    'div',
    { className: cls.credRow },
    // 第一层：只读键名（等宽代码块 = 名字，不是值）
    createElement(
      'div',
      { className: cls.credHead },
      createElement('span', { className: cls.credName }, title),
      createElement('code', { className: cls.token }, status?.ref ?? '—'),
      createElement(
        'span',
        { className: `${cls.badge} ${cls.badgeSoft}` },
        writable ? t('qiniu.credentials.writable') : t('qiniu.credentials.readOnly'),
      ),
      createElement('span', { className: cls.credStatus }, sourceLabel),
    ),
    // 第二层：值输入框
    createElement(
      'div',
      { className: cls.credInputRow },
      createElement('input', {
        className: cls.input,
        type: secret === true ? 'password' : 'text',
        value,
        placeholder: hint,
        autoComplete: 'off',
        spellCheck: false,
        disabled: status?.writable === false || busy,
        'aria-label': `${title} 值`,
        onChange: (event: { target: { value: string } }) => setValue(event.target.value),
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Enter') void save()
        },
      }),
      createElement(
        'button',
        {
          type: 'button',
          className: cls.btn,
          disabled: busy || status?.writable === false || value === '',
          onClick: () => void save(),
        },
        t('qiniu.credentials.save'),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: cls.btn,
          disabled: busy || status?.writable === false,
          onClick: () => void clear(),
        },
        t('qiniu.credentials.clear'),
      ),
    ),
    error === null
      ? null
      : createElement(
          'div',
          {
            className: `${cls.callout} ${cls.calloutError}`,
            style: { padding: '7px 9px', fontSize: '11.5px' },
          },
          error,
        ),
  )
}

/**
 * 凭据表单。
 *
 * @param props - 凭据状态、翻译函数与读写回调。
 * @returns 表单元素；无凭据库时整块置灰并说明原因。
 */
export function CredentialsForm({ credentials, t, onSet, onUnset }: CredentialsFormProps): ReactNode {
  if (credentials === null) {
    return createElement('div', { className: cls.empty }, t('qiniu.credentials.unavailable'))
  }

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    credentials.hasStore
      ? null
      : createElement(
          'div',
          { className: `${cls.callout} ${cls.calloutWarn}` },
          createElement('strong', null, t('qiniu.credentials.noStore')),
          createElement('span', { style: { fontSize: '11.5px' } }, t('qiniu.credentials.noStoreHint')),
        ),

    createElement(CredentialRow, {
      title: t('qiniu.credentials.accessKey'),
      hint: t('qiniu.credentials.accessKeyPlaceholder'),
      status: credentials.accessKey,
      t,
      onSet: (value: string) => onSet(credentials.accessKey.ref, value),
      onUnset: () => onUnset(credentials.accessKey.ref),
    }),
    createElement(CredentialRow, {
      title: t('qiniu.credentials.secretKey'),
      hint: t('qiniu.credentials.secretKeyPlaceholder'),
      status: credentials.secretKey,
      t,
      secret: true,
      onSet: (value: string) => onSet(credentials.secretKey.ref, value),
      onUnset: () => onUnset(credentials.secretKey.ref),
    }),
    createElement(
      'div',
      { className: cls.muted, style: { fontSize: '11px' } },
      t('qiniu.credentials.hint'),
    ),
  )
}
