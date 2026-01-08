import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'

interface BidWallInfo {
  tokenMint: string
  bidWallAddress: string
  name?: string
  navPerToken: number
  priceAfterFee: number
  totalNav: number
  activeSupply: number
  quoteAmount: number
  isActive: boolean
  spotPrice: number
}

interface SwapQuote {
  inputAmount: string
  outputAmount: string
  estimatedUsdcReceived: string
  priceImpact: string
  route: string
}

export function SwapInterface() {
  const { publicKey, signTransaction, connected } = useWallet()
  
  const [bidWalls, setBidWalls] = useState<BidWallInfo[]>([])
  const [selectedBidWall, setSelectedBidWall] = useState<BidWallInfo | null>(null)
  const [usdcAmount, setUsdcAmount] = useState('')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [txStatus, setTxStatus] = useState<'idle' | 'signing' | 'confirming' | 'success' | 'error'>('idle')
  const [txSignature, setTxSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchBidWalls()
  }, [])

  useEffect(() => {
    if (selectedBidWall && usdcAmount && parseFloat(usdcAmount) > 0 && connected && publicKey) {
      const debounce = setTimeout(() => {
        fetchQuote()
      }, 500)
      return () => clearTimeout(debounce)
    } else {
      setQuote(null)
    }
  }, [usdcAmount, selectedBidWall, connected, publicKey])

  const fetchBidWalls = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/bid-walls')
      if (!response.ok) throw new Error('Failed to fetch bid walls')
      const data = await response.json()
      setBidWalls(data.bidWalls)
      if (data.bidWalls.length > 0) {
        setSelectedBidWall(data.bidWalls[0])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bid walls')
    } finally {
      setLoading(false)
    }
  }

  const fetchQuote = async () => {
    if (!selectedBidWall || !usdcAmount || !publicKey) return
    
    try {
      setQuoteLoading(true)
      const response = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidWallAddress: selectedBidWall.bidWallAddress,
          usdcAmount: parseFloat(usdcAmount) * 1_000_000,
          taker: publicKey.toBase58(),
        }),
      })
      if (!response.ok) throw new Error('Failed to get quote')
      const data = await response.json()
      setQuote(data)
      setError(null)
    } catch {
      setQuote(null)
    } finally {
      setQuoteLoading(false)
    }
  }

  const handleSwap = useCallback(async () => {
    if (!selectedBidWall || !usdcAmount || !publicKey || !signTransaction) return

    try {
      setTxStatus('signing')
      setError(null)

      const response = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidWallAddress: selectedBidWall.bidWallAddress,
          usdcAmount: parseFloat(usdcAmount) * 1_000_000,
          taker: publicKey.toBase58(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create swap transaction')
      }

      const { transaction: txBase64, requestId } = await response.json()
      const txBuffer = Buffer.from(txBase64, 'base64')
      const transaction = VersionedTransaction.deserialize(txBuffer)
      
      const signedTx = await signTransaction(transaction)
      setTxStatus('confirming')

      const executeResponse = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: Buffer.from(signedTx.serialize()).toString('base64'),
          requestId,
        }),
      })

      if (!executeResponse.ok) {
        const errorData = await executeResponse.json()
        throw new Error(errorData.error || 'Failed to execute swap')
      }

      const { signature } = await executeResponse.json()
      setTxSignature(signature)
      setTxStatus('success')
      setUsdcAmount('')
      setQuote(null)

      setTimeout(fetchBidWalls, 2000)
    } catch (err) {
      setTxStatus('error')
      setError(err instanceof Error ? err.message : 'Swap failed')
    }
  }, [selectedBidWall, usdcAmount, publicKey, signTransaction])

  const resetTxState = () => {
    setTxStatus('idle')
    setTxSignature(null)
    setError(null)
  }

  if (loading) {
    return (
      <div className="meta-card p-8 text-center">
        <div className="animate-spin w-6 h-6 border-2 border-coral border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-muted">Loading bid walls...</p>
      </div>
    )
  }

  if (bidWalls.length === 0) {
    return (
      <div className="meta-card p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-meta-border/50 flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="font-serif text-xl mb-2">No Bid Walls Configured</h3>
        <p className="text-muted text-sm">
          Configure bid walls in your environment variables to enable swapping.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Success/Error Modal */}
      {(txStatus === 'success' || txStatus === 'error') && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="meta-card p-6 max-w-md w-full animate-slide-up">
            {txStatus === 'success' ? (
              <>
                <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="font-serif text-xl text-center mb-2">Swap Successful</h3>
                <p className="text-muted text-sm text-center mb-4">
                  Your tokens have been swapped into the bid wall.
                </p>
                {txSignature && (
                  <a
                    href={`https://solscan.io/tx/${txSignature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-coral text-sm hover:text-coral-300 mb-4"
                  >
                    View on Solscan →
                  </a>
                )}
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-coral/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h3 className="font-serif text-xl text-center mb-2">Swap Failed</h3>
                <p className="text-muted text-sm text-center mb-4">
                  {error || 'An unknown error occurred'}
                </p>
              </>
            )}
            <button onClick={resetTxState} className="btn-primary">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Page Title */}
      <div className="text-center mb-8">
        <h1 className="font-serif text-3xl md:text-4xl mb-2">
          <span className="text-white">Sell into </span>
          <span className="italic text-coral">bid wall</span>
        </h1>
        <p className="text-muted">
          Buy tokens on Jupiter and sell into the bid wall at NAV price
        </p>
      </div>

      {/* Bid Wall Selector */}
      {bidWalls.length > 1 && (
        <div className="meta-card p-4">
          <label className="label mb-2 block">Select Bid Wall</label>
          <select
            value={selectedBidWall?.bidWallAddress || ''}
            onChange={(e) => {
              const bw = bidWalls.find(b => b.bidWallAddress === e.target.value)
              setSelectedBidWall(bw || null)
              setQuote(null)
            }}
            className="input-field"
          >
            {bidWalls.map((bw) => (
              <option key={bw.bidWallAddress} value={bw.bidWallAddress}>
                {bw.name || bw.tokenMint.slice(0, 8) + '...'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Bid Wall Info Card */}
      {selectedBidWall && (
        <div className="meta-card overflow-hidden">
          <div className="p-5 border-b border-meta-border">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-xl">
                {selectedBidWall.name || 'Bid Wall'}
              </h2>
              <span className={`status-badge ${selectedBidWall.isActive ? 'status-active' : 'status-inactive'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${selectedBidWall.isActive ? 'bg-success' : 'bg-coral'}`} />
                {selectedBidWall.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          
          <div className="p-5">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="label mb-1">NAV Price</p>
                <p className="stat-value">${selectedBidWall.navPerToken.toFixed(4)}</p>
              </div>
              <div>
                <p className="label mb-1">After 1% Fee</p>
                <p className="stat-value text-coral">${selectedBidWall.priceAfterFee.toFixed(4)}</p>
              </div>
              <div>
                <p className="label mb-1">Spot Price</p>
                <p className="stat-value">${selectedBidWall.spotPrice.toFixed(4)}</p>
              </div>
              <div>
                <p className="label mb-1">Wall Balance</p>
                <p className="stat-value">
                  ${(selectedBidWall.quoteAmount / 1_000_000).toLocaleString()}
                </p>
              </div>
            </div>
            
            {/* Progress bar showing wall capacity */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-muted mb-1">
                <span>Token Mint</span>
                <a 
                  href={`https://solscan.io/token/${selectedBidWall.tokenMint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-coral hover:text-coral-300"
                >
                  {selectedBidWall.tokenMint.slice(0, 4)}...{selectedBidWall.tokenMint.slice(-4)}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Swap Card */}
      <div className="meta-card p-5">
        {!connected ? (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-meta-border/50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <p className="text-muted mb-4">Connect your wallet to swap</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Input Amount */}
            <div>
              <label className="label mb-2 block">You Pay</label>
              <div className="relative">
                <input
                  type="number"
                  value={usdcAmount}
                  onChange={(e) => setUsdcAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="input-field pr-20 text-xl font-medium"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted font-medium">
                  USDC
                </span>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center py-2">
              <div className="w-8 h-8 rounded-full bg-meta-border flex items-center justify-center">
                <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            </div>

            {/* Quote Display */}
            <div className="bg-meta-bg rounded-lg p-4 border border-meta-border">
              <p className="label mb-2">You Receive (from Bid Wall)</p>
              {quoteLoading ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin w-4 h-4 border-2 border-coral border-t-transparent rounded-full" />
                  <span className="text-muted">Fetching quote...</span>
                </div>
              ) : quote ? (
                <div>
                  <p className="text-2xl font-semibold text-success">
                    ~${(parseFloat(quote.estimatedUsdcReceived) / 1_000_000).toFixed(2)} USDC
                  </p>
                  <p className="text-sm text-muted mt-1">
                    via {(parseFloat(quote.outputAmount) / 1_000_000).toFixed(2)} tokens • {quote.priceImpact}% impact
                  </p>
                </div>
              ) : (
                <p className="text-xl text-muted-dark">Enter an amount</p>
              )}
            </div>

            {/* Swap Button */}
            <button
              onClick={handleSwap}
              disabled={!quote || txStatus === 'signing' || txStatus === 'confirming'}
              className="btn-primary"
            >
              {txStatus === 'signing' ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="animate-spin w-5 h-5 border-2 border-meta-bg border-t-transparent rounded-full" />
                  Signing...
                </span>
              ) : txStatus === 'confirming' ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="animate-spin w-5 h-5 border-2 border-meta-bg border-t-transparent rounded-full" />
                  Confirming...
                </span>
              ) : (
                'Swap into Bid Wall'
              )}
            </button>

            {error && txStatus === 'idle' && (
              <p className="text-coral text-sm text-center">{error}</p>
            )}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="meta-card p-5">
        <h3 className="font-serif text-lg mb-4">How it works</h3>
        <div className="space-y-4 text-sm text-muted">
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-coral/10 text-coral flex items-center justify-center text-xs font-medium">1</span>
            <p>You provide USDC which is used to buy tokens on Jupiter at the current spot price.</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-coral/10 text-coral flex items-center justify-center text-xs font-medium">2</span>
            <p>The purchased tokens are immediately sold into the MetaDAO bid wall at NAV price.</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-coral/10 text-coral flex items-center justify-center text-xs font-medium">3</span>
            <p>You receive USDC back (minus the 1% bid wall fee). If spot &lt; NAV, you profit!</p>
          </div>
        </div>
      </div>
    </div>
  )
}
