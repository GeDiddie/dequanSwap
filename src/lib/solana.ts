import {
  Connection,
  PublicKey,
  VersionedTransaction,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'

export const SOL_MINT = 'So11111111111111111111111111111111111111112'

export function toLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * LAMPORTS_PER_SOL))
}

export function formatSol(lamports: number | bigint, decimals = 4) {
  const value = Number(lamports) / LAMPORTS_PER_SOL
  return value.toFixed(decimals)
}

export async function getSolBalanceLamports(connection: Connection, owner: PublicKey) {
  return connection.getBalance(owner, 'confirmed')
}

export async function getTokenBalanceBaseUnits(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<{ amount: bigint; decimals: number } | null> {
  const res = await connection.getParsedTokenAccountsByOwner(
    owner,
    { mint },
    'confirmed',
  )

  let total = 0n
  let decimals: number | null = null

  for (const { account } of res.value) {
    const info = (account.data as any).parsed?.info
    const tokenAmount = info?.tokenAmount
    if (!tokenAmount?.amount) continue

    total += BigInt(tokenAmount.amount)
    if (decimals === null && typeof tokenAmount.decimals === 'number') {
      decimals = tokenAmount.decimals
    }
  }

  if (decimals === null) {
    // Fallback: try reading mint account decimals
    const mintInfo = await connection.getParsedAccountInfo(mint, 'confirmed')
    const parsed = (mintInfo.value?.data as any)?.parsed
    const mintDecimals = parsed?.info?.decimals
    decimals = typeof mintDecimals === 'number' ? mintDecimals : 0
  }

  return { amount: total, decimals }
}

export function deserializeTx(base64: string): Transaction | VersionedTransaction {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  try {
    return VersionedTransaction.deserialize(bytes)
  } catch {
    return Transaction.from(bytes)
  }
}

export function toBaseUnits(amountUi: number, decimals: number): bigint {
  const scale = 10 ** decimals
  return BigInt(Math.floor(amountUi * scale))
}

export function baseUnitsToUi(amount: bigint, decimals: number): number {
  const denom = 10 ** decimals
  return Number(amount) / denom
}

export { TOKEN_PROGRAM_ID }
