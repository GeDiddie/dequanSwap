export type WsClientOptions = {
  url: string
  apiKey?: string
  authToken?: string
  timeoutMs?: number
}

type AnyJson = Record<string, unknown>

export class TradingWs {
  private ws: WebSocket | null = null
  private readonly url: string
  private readonly apiKey?: string
  private readonly authToken?: string
  private readonly timeoutMs: number

  constructor(opts: WsClientOptions) {
    this.url = opts.url
    this.apiKey = opts.apiKey
    this.authToken = opts.authToken
    this.timeoutMs = opts.timeoutMs ?? 20_000
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  async connect(): Promise<void> {
    if (this.isOpen) return

    this.ws = new WebSocket(this.url)

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

    if (this.apiKey || this.authToken) {
      this.send({
        type: 'auth',
        ...(this.apiKey ? { apiKey: this.apiKey } : {}),
        ...(this.authToken ? { token: this.authToken } : {}),
      })
    }
  }

  close() {
    this.ws?.close()
    this.ws = null
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
            reject(new Error(String(parsed.message || 'Trading API error')))
          }
        } catch {
          // ignore
        }
      }

      const cleanup = () => {
        clearTimeout(timeout)
        this.ws?.removeEventListener('message', onMessage)
      }

      this.ws.addEventListener('message', onMessage)
    })

    this.send(message)
    return responsePromise
  }
}
