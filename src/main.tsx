import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { clusterApiUrl } from '@solana/web3.js'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import App from './App.tsx'
import './index.css'
import '@solana/wallet-adapter-react-ui/styles.css'

export function Root() {
  const endpoint = import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
  const wsEndpoint = useMemo(() => {
    const envWs = import.meta.env.VITE_SOLANA_WS_URL
    if (envWs && String(envWs).trim().length > 0) return String(envWs).trim()

    // If we're using an HTTP JSON-RPC proxy, don't derive WS from it.
    // Proxies are JSON-RPC over HTTP only; Solana signature subscriptions need a real Solana WebSocket endpoint.
    if (String(endpoint).includes('/solana-rpc')) return 'wss://api.mainnet-beta.solana.com/'

    // Otherwise, derive ws(s):// from the HTTP endpoint.
    return String(endpoint)
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://')
  }, [endpoint])
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])

  return (
    <ConnectionProvider endpoint={endpoint} config={{ wsEndpoint }}>
      <WalletProvider wallets={wallets}>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
