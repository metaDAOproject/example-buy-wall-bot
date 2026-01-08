import { useMemo } from 'react'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import '@solana/wallet-adapter-react-ui/styles.css'

import { SwapInterface } from './components/SwapInterface'
import { Header } from './components/Header'
import { Background } from './components/Background'

function App() {
  // Get RPC URL from API or use default
  const endpoint = useMemo(() => {
    return 'https://api.mainnet-beta.solana.com'
  }, [])

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="min-h-screen relative">
            <Background />
            <div className="relative z-10">
              <Header />
              <main className="container mx-auto px-4 py-8 max-w-2xl">
                <SwapInterface />
              </main>
            </div>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

export default App
