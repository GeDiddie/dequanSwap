export type WsClientOptions = {
  url: string
  apiKey?: string
  authToken?: string
  wallet?: string
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
  timeoutMs?: number
}

export type TradingWsStats = {
  messageCount: number
  lastMessageAt: number
  lastMessageType?: string
}

type AnyJson = Record<string, unknown>

export class TradingWsError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'TradingWsError'
    this.code = code
  }
}

export class TradingWs {
  private ws: WebSocket | null = null
  private readonly url: string
  private readonly apiKey?: string
  private readonly authToken?: string
  private readonly wallet?: string
  private readonly signMessage?: (message: Uint8Array) => Promise<Uint8Array>
  private readonly timeoutMs: number
  private authed = false
  private readonly authFingerprint: string

  private helloCache: AnyJson | null = null

  private readonly messageListeners = new Set<(msg: AnyJson) => void>()

  private stats: TradingWsStats = { messageCount: 0, lastMessageAt: 0, lastMessageType: undefined }
  private statsListener: ((event: MessageEvent) => void) | null = null

  constructor(opts: WsClientOptions) {
    this.url = opts.url
    this.apiKey = opts.apiKey
    this.authToken = opts.authToken
    this.wallet = opts.wallet
    this.signMessage = opts.signMessage
    this.timeoutMs = opts.timeoutMs ?? 20_000

    // Used by callers to detect when a reconnect is required.
    this.authFingerprint = [this.apiKey || '', this.authToken || '', this.wallet || ''].join('|')
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get isAuthed() {
    return this.authed
  }

  get authKey() {
    return this.authFingerprint
  }

  getStats(): TradingWsStats {
    return { ...this.stats }
  }

  getHello(): AnyJson | null {
    return this.helloCache
  }

  onMessage(listener: (msg: AnyJson) => void): () => void {
    this.messageListeners.add(listener)
    return () => {
      this.messageListeners.delete(listener)
    }
  }

  async connect(): Promise<void> {
    if (this.isOpen) return

    this.authed = false
    this.helloCache = null

    this.ws = new WebSocket(this.url)

    // Attach a lightweight listener for Debug Portal metrics.
    // This does not affect request/response behavior (it only samples metadata).
    this.stats = { messageCount: 0, lastMessageAt: 0, lastMessageType: undefined }
    this.statsListener = (event: MessageEvent) => {
      this.stats.messageCount += 1
      this.stats.lastMessageAt = Date.now()
      try {
        const parsed = JSON.parse(String(event.data)) as AnyJson
        const t = (parsed as { type?: unknown }).type
        this.stats.lastMessageType = typeof t === 'string' ? t : undefined

        // Cache the server hello so auth can safely consume it even if it arrives
        // before the auth-specific listener is attached.
        if (this.stats.lastMessageType === 'hello') {
          this.helloCache = parsed
        }

        if (this.messageListeners.size > 0) {
          for (const fn of this.messageListeners) {
            try {
              fn(parsed)
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
    }
    this.ws.addEventListener('message', this.statsListener)

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not created'))

      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error('WebSocket connection error'))
      }

      const cleanup = () => {
        this.ws?.removeEventListener('open', onOpen)
        this.ws?.removeEventListener('error', onError)
      }

      this.ws.addEventListener('open', onOpen)
      this.ws.addEventListener('error', onError)
    })

      // Always read server hello first so we know what auth is required.
      const hello = this.helloCache
        ? this.helloCache
        : await this.waitFor(
            (m): m is AnyJson => m.type === 'hello',
            this.timeoutMs,
          )

      const authObj =
        typeof (hello as AnyJson)?.data === 'object' && (hello as AnyJson).data
          ? (((hello as AnyJson).data as AnyJson).auth as AnyJson)
          : null
      const walletSigObj = authObj && typeof authObj.walletSig === 'object' && authObj.walletSig ? (authObj.walletSig as AnyJson) : null

      const walletSigRequired = Boolean(walletSigObj && (walletSigObj as { required?: unknown }).required === true)
      const challenge =
        walletSigObj && typeof (walletSigObj as { challenge?: unknown }).challenge === 'string'
          ? String((walletSigObj as { challenge: string }).challenge)
          : ''

      // Prefer wallet-signature auth when available (avoids JWT expiry/caching issues).
      if (this.wallet && this.signMessage && challenge.trim().length > 0) {
        const encoder = new TextEncoder()
        const signatureBytes = await this.signMessage(encoder.encode(challenge))
        const signatureBase64 = TradingWs.bytesToBase64(signatureBytes)

        const auth = await this.request(
          {
            type: 'auth',
            wallet: this.wallet,
            signatureBase64,
          },
          (m): m is AnyJson => m.type === 'auth_result',
          this.timeoutMs,
        )

        if (!auth || typeof auth !== 'object' || !('success' in auth) || (auth as { success?: unknown }).success !== true) {
          const msg =
            typeof (auth as { message?: unknown }).message === 'string'
              ? (auth as { message: string }).message
              : 'Trading API auth failed'
          throw new TradingWsError(msg, 'auth_failed')
        }

        this.authed = true
        return
      }

      // If the server requires wallet-signature auth, never attempt JWT/legacy.
      if (walletSigRequired) {
        throw new TradingWsError('Signature needed in wallet', 'wallet_sig_required')
      }

    if (this.apiKey || this.authToken) {
      const auth = await this.request(
        {
          type: 'auth',
          ...(this.apiKey ? { apiKey: this.apiKey } : {}),
          ...(this.authToken ? { token: this.authToken } : {}),
        },
        (m): m is AnyJson => m.type === 'auth_result',
        this.timeoutMs,
      )

      if (!auth || typeof auth !== 'object' || !('success' in auth) || (auth as { success?: unknown }).success !== true) {
        const msg =
          typeof (auth as { message?: unknown }).message === 'string'
            ? (auth as { message: string }).message
            : 'Trading API auth failed'
        throw new TradingWsError(msg, 'auth_failed')
      }

      this.authed = true
    }
  }

  close() {
    if (this.ws && this.statsListener) {
      this.ws.removeEventListener('message', this.statsListener)
    }
    this.ws?.close()
    this.ws = null
    this.authed = false
    this.statsListener = null
  }

  send(message: AnyJson) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }
    this.ws.send(JSON.stringify(message))
  }

  async request<T extends AnyJson>(
    message: AnyJson,
    predicate: (msg: AnyJson) => msg is T,
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }

    const responsePromise = new Promise<T>((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not connected'))

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('WebSocket request timed out'))
      }, timeoutMs)

      const onMessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(String(event.data)) as AnyJson
          if (predicate(parsed)) {
            cleanup()
            resolve(parsed)
          } else if (parsed.type === 'error') {
            // Surface API errors even if not exactly the awaited response type.
            cleanup()
            const code = typeof parsed.code === 'string' ? parsed.code : undefined
            const message = String(parsed.message || 'Trading API error')
            reject(new TradingWsError(message, code))
          }
        } catch {
          // ignore
        }
      }

      const onClose = () => {
        cleanup()
        reject(new Error('WebSocket not connected'))
      }

      const onError = () => {
        cleanup()
        reject(new Error('WebSocket connection error'))
      }

      const cleanup = () => {
        clearTimeout(timeout)
        this.ws?.removeEventListener('message', onMessage)
        this.ws?.removeEventListener('close', onClose)
        this.ws?.removeEventListener('error', onError)
      }

      this.ws.addEventListener('message', onMessage)
      this.ws.addEventListener('close', onClose)
      this.ws.addEventListener('error', onError)
    })

    this.send(message)
    return responsePromise
  }

  private async waitFor<T extends AnyJson>(
    predicate: (msg: AnyJson) => msg is T,
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }

    const responsePromise = new Promise<T>((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not connected'))

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('WebSocket request timed out'))
      }, timeoutMs)

      const onMessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(String(event.data)) as AnyJson
          if (predicate(parsed)) {
            cleanup()
            resolve(parsed)
          } else if (parsed.type === 'error') {
            cleanup()
            const code = typeof parsed.code === 'string' ? parsed.code : undefined
            const message = String(parsed.message || 'Trading API error')
            reject(new TradingWsError(message, code))
          }
        } catch {
          // ignore
        }
      }

      const onClose = () => {
        cleanup()
        reject(new Error('WebSocket not connected'))
      }

      const onError = () => {
        cleanup()
        reject(new Error('WebSocket connection error'))
      }

      const cleanup = () => {
        clearTimeout(timeout)
        this.ws?.removeEventListener('message', onMessage)
        this.ws?.removeEventListener('close', onClose)
        this.ws?.removeEventListener('error', onError)
      }

      this.ws.addEventListener('message', onMessage)
      this.ws.addEventListener('close', onClose)
      this.ws.addEventListener('error', onError)
    })

    return responsePromise
  }

  private static bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }
}
