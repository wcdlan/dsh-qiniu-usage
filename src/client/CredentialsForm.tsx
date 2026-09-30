// 凭据表单：键名只读（CredentialRef 是 POSIX 环境变量名），值才是输入框；提交后立即清空输入框。
import {createElement, type ReactNode, useState} from 'react'
import {cls} from './styles.ts'

/** 与宿主 `CredentialStatus` 同形（不跨包 import 宿主类型）。 */
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

type Translate = (key: string, params?: Record<string, unknown>) => string

export interface CredentialsFormProps {
  credentials: CredentialsView | null
  t: Translate
  onSet: (ref: string, value: string) => Promise<void>
  onUnset: (ref: string) => Promise<void>
}

function CredentialRow(props: {
  title: string
  hint: string
  status: CredentialStatusView | null
  t: Translate
    // 草稿由 CredentialsForm 统一持有。
  value: string
  onValueChange: (next: string) => void
  onSet: (value: string) => Promise<void>
  onUnset: () => Promise<void>
    // SK 用密码框。
  secret?: boolean
}): ReactNode {
  const { title, hint, status, t, value, onValueChange, onSet, onUnset, secret } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (value === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSet(value)
        // 提交后立即清空，明文不在界面里停留。
      onValueChange('')
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
        onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
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

export function CredentialsForm({ credentials, t, onSet, onUnset }: CredentialsFormProps): ReactNode {
  const [drafts, setDrafts] = useState({ accessKey: '', secretKey: '' })

  const editDraft = (field: 'accessKey' | 'secretKey', next: string): void => {
    setDrafts((current) => ({ ...current, [field]: next }))
  }

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
      value: drafts.accessKey,
      onValueChange: (next: string) => editDraft('accessKey', next),
      onSet: (value: string) => onSet(credentials.accessKey.ref, value),
      onUnset: () => onUnset(credentials.accessKey.ref),
    }),
    createElement(CredentialRow, {
      title: t('qiniu.credentials.secretKey'),
      hint: t('qiniu.credentials.secretKeyPlaceholder'),
      status: credentials.secretKey,
      t,
      secret: true,
      value: drafts.secretKey,
      onValueChange: (next: string) => editDraft('secretKey', next),
      onSet: (value: string) => onSet(credentials.secretKey.ref, value),
      onUnset: () => onUnset(credentials.secretKey.ref),
    }),
  )
}
