import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createAssociatedTokenAccountInstruction,
  createRevokeInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'

export type FastModeStatus = 'disarmed' | 'arming' | 'armed' | 'revoking'

export type FastModeSession = {
  keypair: Keypair
  wsolAta: PublicKey
  capLamports: bigint
  armedAtMs: number
  expiresAtMs: number
}

export function createFastModeSessionKeypair(): Keypair {
  return Keypair.generate()
}

export function deriveWsolAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    NATIVE_MINT,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
}

export async function buildArmFastModeTx(params: {
  connection: Connection
  owner: PublicKey
  delegate: PublicKey
  capLamports: bigint
  feeTopupLamports?: bigint
}): Promise<{ tx: Transaction; wsolAta: PublicKey }> {
  const { connection, owner, delegate, capLamports, feeTopupLamports } = params

  const wsolAta = deriveWsolAta(owner)
  const delegateWsolAta = deriveWsolAta(delegate)
  const ataInfo = await connection.getAccountInfo(wsolAta, 'confirmed')
  const delegateAtaInfo = await connection.getAccountInfo(delegateWsolAta, 'confirmed')

  const tx = new Transaction()
  tx.feePayer = owner

  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        owner,
        wsolAta,
        owner,
        NATIVE_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    )
  }

  // Pre-create the session key's WSOL ATA so Jupiter won't add a non-idempotent create-ATA
  // instruction later (which could conflict with any client-side idempotent creates).
  if (!delegateAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        owner,
        delegateWsolAta,
        delegate,
        NATIVE_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    )
  }

  const lamportsNumber = Number(capLamports)
  if (!Number.isFinite(lamportsNumber) || lamportsNumber <= 0) {
    throw new Error('Fast Mode cap is invalid')
  }

  tx.add(
    SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: wsolAta,
      lamports: lamportsNumber,
    }),
  )

  if (feeTopupLamports && feeTopupLamports > 0n) {
    const topupNumber = Number(feeTopupLamports)
    if (Number.isFinite(topupNumber) && topupNumber > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: delegate,
          lamports: topupNumber,
        }),
      )
    }
  }

  tx.add(createSyncNativeInstruction(wsolAta))

  tx.add(
    createApproveInstruction(
      wsolAta,
      delegate,
      owner,
      capLamports,
      [],
      TOKEN_PROGRAM_ID,
    ),
  )

  const { blockhash } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash

  return { tx, wsolAta }
}

export async function buildRevokeFastModeTx(params: {
  connection: Connection
  owner: PublicKey
}): Promise<{ tx: Transaction; wsolAta: PublicKey }> {
  const { connection, owner } = params
  const wsolAta = deriveWsolAta(owner)

  const tx = new Transaction()
  tx.feePayer = owner
  tx.add(createRevokeInstruction(wsolAta, owner, [], TOKEN_PROGRAM_ID))

  const { blockhash } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash

  return { tx, wsolAta }
}
