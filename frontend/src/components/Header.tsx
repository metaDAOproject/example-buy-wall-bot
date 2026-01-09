import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

export function Header() {
  return (
    <header className="border-b border-meta-border">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* MetaDAO Logo */}
          <img 
            src="/metadao-logo.svg" 
            alt="MetaDAO" 
            className="w-9 h-9"
          />
          <div>
            <h1 className="font-serif text-lg font-medium text-white tracking-tight">
              MetaDAO Bid Wall Swap
            </h1>
          </div>
        </div>
        
        <WalletMultiButton />
      </div>
    </header>
  )
}
