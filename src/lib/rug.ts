export type RugCheckToken = {
  isRugged?: boolean | null
  liquidityStatus?: 'active' | 'removed' | 'unknown' | null
  error?: string | null
}

export function isJupiterNoRouteErrorMessage(raw: string) {
  if (!raw) return false
  return raw.includes('COULD_NOT_FIND_ANY_ROUTE') || raw.includes('Could not find any route')
}

export function isTokenRugged(token: RugCheckToken) {
  if (!token) return false
  if (token.isRugged === true) return true
  if (token.liquidityStatus === 'removed') return true
  if (token.error && isJupiterNoRouteErrorMessage(token.error)) return true
  return false
}
