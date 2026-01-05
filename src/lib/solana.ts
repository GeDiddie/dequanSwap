import {
  Connection,
  PublicKey,
  VersionedTransaction,
  Transaction,
  LAMPORTS_PER_SOL,
  Keypair,
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

  const readParsedInfo = (data: unknown): unknown => {
    if (!data || typeof data !== 'object') return undefined
    if (!('parsed' in data)) return undefined
    return (data as { parsed?: unknown }).parsed
  }

  const readTokenAmount = (parsed: unknown): { amount?: string; decimals?: number } | undefined => {
    if (!parsed || typeof parsed !== 'object') return undefined
    if (!('info' in parsed)) return undefined
    const info = (parsed as { info?: unknown }).info
    if (!info || typeof info !== 'object') return undefined
    if (!('tokenAmount' in info)) return undefined
    const tokenAmount = (info as { tokenAmount?: unknown }).tokenAmount
    if (!tokenAmount || typeof tokenAmount !== 'object') return undefined
    const amount = 'amount' in tokenAmount ? (tokenAmount as { amount?: unknown }).amount : undefined
    const dec = 'decimals' in tokenAmount ? (tokenAmount as { decimals?: unknown }).decimals : undefined
    return {
      amount: typeof amount === 'string' ? amount : undefined,
      decimals: typeof dec === 'number' ? dec : undefined,
    }
  }

  for (const { account } of res.value) {
    const parsed = readParsedInfo(account.data as unknown)
    const tokenAmount = readTokenAmount(parsed)
    if (!tokenAmount?.amount) continue

    total += BigInt(tokenAmount.amount)
    if (decimals === null && typeof tokenAmount.decimals === 'number') decimals = tokenAmount.decimals
  }

  if (decimals === null) {
    // Fallback: try reading mint account decimals
    const mintInfo = await connection.getParsedAccountInfo(mint, 'confirmed')
    const parsed = readParsedInfo(mintInfo.value?.data as unknown)
    let mintDecimals: number | undefined
    if (parsed && typeof parsed === 'object' && 'info' in parsed) {
      const info = (parsed as { info?: unknown }).info
      if (info && typeof info === 'object' && 'decimals' in info) {
        const d = (info as { decimals?: unknown }).decimals
        if (typeof d === 'number') mintDecimals = d
      }
    }
    decimals = mintDecimals ?? 0
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

export function signTxWithKeypair(tx: Transaction | VersionedTransaction, signer: Keypair) {
  if (tx instanceof VersionedTransaction) {
    tx.sign([signer])
    return tx
  }
  tx.partialSign(signer)
  return tx
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
