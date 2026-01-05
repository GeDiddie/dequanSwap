export type ControlPlaneChallengeResponse = {
  challengeId: string
  message: string
  expiresAt: string
}

export type ControlPlaneVerifyResponse = {
  ok: boolean
  userId: string
  wallet: string
}

export type ControlPlaneTokenResponse = {
  token: string
  expiresAt: string
}

export type ControlPlaneEmailStartResponse = {
  ok: boolean
  challengeId: string
  expiresAt: string
  debugCode?: string
}

export type ControlPlaneEmailVerifyResponse = {
  ok: boolean
  email: string
  verifiedAt: string
}

export type ControlPlaneAccountMeResponse = {
  ok: boolean
  wallet: { userId: string; wallet: string; expiresAt: string } | null
  account: { email: string; verifiedAt: string; expiresAt: string } | null
}

export type ControlPlaneAccountTokenResponse = {
  ok: boolean
  token: string
  expiresAt: string
  email: string
}

function readStringField(obj: unknown, key: string): string {
  if (!obj || typeof obj !== 'object') throw new Error(`Invalid response: missing ${key}`)
  const v = (obj as Record<string, unknown>)[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Invalid response: ${key} must be a string`)
  return v
}

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Control Plane HTTP ${res.status}: ${txt.slice(0, 200)}`)
  }

  return (await res.json()) as T
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Control Plane HTTP ${res.status}: ${txt.slice(0, 200)}`)
  }

  return (await res.json()) as T
}

export async function requestWalletChallenge(baseUrl: string, wallet: string): Promise<ControlPlaneChallengeResponse> {
  const url = joinUrl(baseUrl, '/auth/wallet/challenge')
  const json = await postJson<unknown>(url, { wallet })
  return {
    challengeId: readStringField(json, 'challengeId'),
    message: readStringField(json, 'message'),
    expiresAt: readStringField(json, 'expiresAt'),
  }
}

export async function verifyWalletChallenge(
  baseUrl: string,
  params: { challengeId: string; wallet: string; signature: string },
): Promise<ControlPlaneVerifyResponse> {
  const url = joinUrl(baseUrl, '/auth/wallet/verify')
  const json = await postJson<unknown>(url, params)

  const okRaw = (json as Record<string, unknown> | null)?.ok
  if (okRaw !== true) throw new Error('Control Plane verify failed')

  return {
    ok: true,
    userId: readStringField(json, 'userId'),
    wallet: readStringField(json, 'wallet'),
  }
}

export async function mintTradingJwt(
  baseUrl: string,
  params: { userId: string; wallet: string },
): Promise<ControlPlaneTokenResponse> {
  const url = joinUrl(baseUrl, '/session/token')
  const json = await postJson<unknown>(url, params)
  return {
    token: readStringField(json, 'token'),
    expiresAt: readStringField(json, 'expiresAt'),
  }
}

export async function startEmailLogin(baseUrl: string, email: string): Promise<ControlPlaneEmailStartResponse> {
  const url = joinUrl(baseUrl, '/auth/email/start')
  const json = await postJson<unknown>(url, { email })
  const ok = (json as Record<string, unknown> | null)?.ok === true
  if (!ok) throw new Error('Control Plane email start failed')
  const resp: ControlPlaneEmailStartResponse = {
    ok: true,
    challengeId: readStringField(json, 'challengeId'),
    expiresAt: readStringField(json, 'expiresAt'),
    ...(typeof (json as Record<string, unknown>).debugCode === 'string' ? { debugCode: String((json as Record<string, unknown>).debugCode) } : {}),
  }
  return resp
}

export async function verifyEmailLogin(
  baseUrl: string,
  params: { challengeId: string; code: string },
): Promise<ControlPlaneEmailVerifyResponse> {
  const url = joinUrl(baseUrl, '/auth/email/verify')
  const json = await postJson<unknown>(url, params)
  const ok = (json as Record<string, unknown> | null)?.ok === true
  if (!ok) throw new Error('Control Plane email verify failed')
  return {
    ok: true,
    email: readStringField(json, 'email'),
    verifiedAt: readStringField(json, 'verifiedAt'),
  }
}

export async function logoutEmailAccount(baseUrl: string): Promise<{ ok: boolean }> {
  const url = joinUrl(baseUrl, '/auth/email/logout')
  const json = await postJson<unknown>(url, {})
  const ok = (json as Record<string, unknown> | null)?.ok === true
  if (!ok) throw new Error('Control Plane logout failed')
  return { ok: true }
}

export async function getAccountMe(baseUrl: string): Promise<ControlPlaneAccountMeResponse> {
  const url = joinUrl(baseUrl, '/account/me')
  const json = await getJson<unknown>(url)
  const ok = (json as Record<string, unknown> | null)?.ok === true
  if (!ok) throw new Error('Control Plane account/me failed')

  const walletRaw = (json as Record<string, unknown>).wallet
  const accountRaw = (json as Record<string, unknown>).account

  const wallet =
    walletRaw && typeof walletRaw === 'object'
      ? {
          userId: readStringField(walletRaw, 'userId'),
          wallet: readStringField(walletRaw, 'wallet'),
          expiresAt: readStringField(walletRaw, 'expiresAt'),
        }
      : null

  const account =
    accountRaw && typeof accountRaw === 'object'
      ? {
          email: readStringField(accountRaw, 'email'),
          verifiedAt: readStringField(accountRaw, 'verifiedAt'),
          expiresAt: readStringField(accountRaw, 'expiresAt'),
        }
      : null

  return { ok: true, wallet, account }
}

export async function linkWalletToEmail(baseUrl: string): Promise<{ ok: boolean; wallet: string; email: string }> {
  const url = joinUrl(baseUrl, '/account/link_wallet')
  const json = await postJson<unknown>(url, {})
  const ok = (json as Record<string, unknown> | null)?.ok === true
  if (!ok) throw new Error('Control Plane link_wallet failed')
  return {
    ok: true,
    wallet: readStringField(json, 'wallet'),
    email: readStringField(json, 'email'),
  }
}

export async function mintAccountToken(
  baseUrl: string,
  params: { wallet: string },
): Promise<ControlPlaneAccountTokenResponse> {
  const url = joinUrl(baseUrl, '/account/token')
  const json = await postJson<unknown>(url, params)
  const ok = (json as Record<string, unknown> | null)?.ok === true
  if (!ok) throw new Error('Control Plane account token mint failed')
  return {
    ok: true,
    token: readStringField(json, 'token'),
    expiresAt: readStringField(json, 'expiresAt'),
    email: readStringField(json, 'email'),
  }
}
