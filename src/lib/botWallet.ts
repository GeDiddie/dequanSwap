import { Keypair } from '@solana/web3.js'

const STORAGE_KEY = 'dequanswap.botWalletSecretKey'

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function loadBotWalletKeypair(): Keypair | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const bytes = base64ToBytes(raw)
    return Keypair.fromSecretKey(bytes)
  } catch {
    return null
  }
}

export function saveBotWalletKeypair(keypair: Keypair) {
  localStorage.setItem(STORAGE_KEY, bytesToBase64(keypair.secretKey))
}

export function clearBotWalletKeypair() {
  localStorage.removeItem(STORAGE_KEY)
}

export function getBotWalletStorageKey(): string {
  return STORAGE_KEY
}
