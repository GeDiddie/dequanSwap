export const PRICE_PROXY_SCALE = 1_000_000_000_000n // 1e12

export function bigintFromString(v: string): bigint {
  try {
    return BigInt(v)
  } catch {
    return 0n
  }
}

export function computePriceProxyScaled(amountInLamports: bigint, amountOutBaseUnits: bigint): bigint {
  if (amountOutBaseUnits <= 0n) throw new Error('Invalid quote amountOut')
  return (amountInLamports * PRICE_PROXY_SCALE) / amountOutBaseUnits
}
