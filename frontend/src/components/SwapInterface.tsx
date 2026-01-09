import { useState, useEffect, useMemo, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

interface BidWallInfo {
  tokenMint: string
  bidWallAddress: string
  name?: string
  navPerToken: number
  priceAfterFee: number
  totalNav: number
  activeSupply: number
  quoteAmount: number
  tokensBurned: number
  spotPrice: number | null
  isActive: boolean
}

// RPC URL - will be fetched from server
let rpcUrl = 'https://api.mainnet-beta.solana.com'

export function SwapInterface() {
  const { publicKey, signTransaction, connected } = useWallet()
  
  const [bidWalls, setBidWalls] = useState<BidWallInfo[]>([])
  const [selectedBidWall, setSelectedBidWall] = useState<BidWallInfo | null>(null)
  const [tokenAmount, setTokenAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [txStatus, setTxStatus] = useState<'idle' | 'signing' | 'confirming' | 'success' | 'error'>('idle')
  const [txSignature, setTxSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [userBalance, setUserBalance] = useState<number | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  useEffect(() => {
    fetchBidWalls()
    // Refresh every 30 seconds
    const interval = setInterval(fetchBidWalls, 30000)
    return () => clearInterval(interval)
  }, [])

  // Fetch user balance when wallet or selected bid wall changes
  useEffect(() => {
    if (connected && publicKey && selectedBidWall) {
      fetchUserBalance(selectedBidWall.tokenMint)
    } else {
      setUserBalance(null)
    }
  }, [connected, publicKey, selectedBidWall?.tokenMint])

  const fetchBidWalls = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/bid-walls')
      if (!response.ok) throw new Error('Failed to fetch bid walls')
      const data = await response.json()
      
      // Store RPC URL from server
      if (data.rpcUrl) {
        rpcUrl = data.rpcUrl
      }
      
      setBidWalls(data.bidWalls)
      if (data.bidWalls.length > 0 && !selectedBidWall) {
        setSelectedBidWall(data.bidWalls[0])
      } else if (selectedBidWall) {
        // Update the selected bid wall with fresh data
        const updated = data.bidWalls.find((b: BidWallInfo) => b.bidWallAddress === selectedBidWall.bidWallAddress)
        if (updated) setSelectedBidWall(updated)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bid walls')
    } finally {
      setLoading(false)
    }
  }

  const fetchUserBalance = async (tokenMint: string) => {
    if (!publicKey) return
    
    try {
      setBalanceLoading(true)
      const connection = new Connection(rpcUrl, 'confirmed')
      const mintPubkey = new PublicKey(tokenMint)
      const ata = await getAssociatedTokenAddress(mintPubkey, publicKey)
      
      try {
        const accountInfo = await connection.getTokenAccountBalance(ata)
        setUserBalance(accountInfo.value.uiAmount || 0)
      } catch {
        // Token account doesn't exist, balance is 0
        setUserBalance(0)
      }
    } catch (err) {
      console.error('Error fetching balance:', err)
      setUserBalance(null)
    } finally {
      setBalanceLoading(false)
    }
  }

  // Calculate USDC output based on token input
  const usdcOutput = useMemo(() => {
    if (!selectedBidWall || !tokenAmount || parseFloat(tokenAmount) <= 0) {
      return null
    }
    const tokens = parseFloat(tokenAmount)
    const grossUsdc = tokens * selectedBidWall.navPerToken
    const fee = grossUsdc * 0.01 // 1% fee
    const netUsdc = grossUsdc - fee
    return {
      gross: grossUsdc,
      fee: fee,
      net: netUsdc,
    }
  }, [tokenAmount, selectedBidWall])

  // Check if user has enough balance in the wall
  const exceedsWallBalance = useMemo(() => {
    if (!selectedBidWall || !usdcOutput) return false
    const wallBalanceUsdc = selectedBidWall.quoteAmount / 1_000_000
    return usdcOutput.gross > wallBalanceUsdc
  }, [selectedBidWall, usdcOutput])

  // Check if user has enough token balance
  const insufficientBalance = useMemo(() => {
    if (userBalance === null || !tokenAmount) return false
    return parseFloat(tokenAmount) > userBalance
  }, [userBalance, tokenAmount])

  const handleSwap = useCallback(async () => {
    if (!selectedBidWall || !tokenAmount || !publicKey || !signTransaction || !usdcOutput) return

    try {
      setTxStatus('signing')
      setError(null)

      // Request the sell transaction from the server
      const response = await fetch('/api/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidWallAddress: selectedBidWall.bidWallAddress,
          tokenAmount: parseFloat(tokenAmount),
          seller: publicKey.toBase58(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create sell transaction')
      }

      const { transaction: txBase64 } = await response.json()
      const txBuffer = Buffer.from(txBase64, 'base64')
      const transaction = VersionedTransaction.deserialize(txBuffer)
      
      const signedTx = await signTransaction(transaction)
      setTxStatus('confirming')

      // Send the signed transaction
      const executeResponse = await fetch('/api/execute-sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: Buffer.from(signedTx.serialize()).toString('base64'),
        }),
      })

      if (!executeResponse.ok) {
        const errorData = await executeResponse.json()
        throw new Error(errorData.error || 'Failed to execute transaction')
      }

      const { signature } = await executeResponse.json()
      setTxSignature(signature)
      setTxStatus('success')
      setTokenAmount('')

      // Refresh bid wall data and user balance
      setTimeout(() => {
        fetchBidWalls()
        if (selectedBidWall) {
          fetchUserBalance(selectedBidWall.tokenMint)
        }
      }, 2000)
    } catch (err) {
      setTxStatus('error')
      setError(err instanceof Error ? err.message : 'Swap failed')
    }
  }, [selectedBidWall, tokenAmount, publicKey, signTransaction, usdcOutput])

  const resetTxState = () => {
    setTxStatus('idle')
    setTxSignature(null)
    setError(null)
  }

  if (loading && bidWalls.length === 0) {
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
          Configure bid walls in your environment variables to enable selling.
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
                <h3 className="font-serif text-xl text-center mb-2">Sale Complete</h3>
                <p className="text-muted text-sm text-center mb-4">
                  Your tokens have been sold to the bid wall.
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
                <h3 className="font-serif text-xl text-center mb-2">Transaction Failed</h3>
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
          <span className="text-white">Sell to </span>
          <span className="italic text-coral">Bid Wall</span>
        </h1>
        <p className="text-muted">
          Sell your tokens directly to the MetaDAO bid wall at NAV price
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
            <div className="grid grid-cols-2 gap-6 mb-4">
              <div>
                <p className="label mb-1">Bid Wall Price</p>
                <p className="stat-value text-2xl">${(selectedBidWall.navPerToken ?? 0).toFixed(4)}</p>
                <p className="text-xs text-muted mt-1">per token (NAV)</p>
              </div>
              <div>
                <p className="label mb-1">Jupiter Price</p>
                {selectedBidWall.spotPrice != null && selectedBidWall.spotPrice > 0 ? (
                  <>
                    <p className="stat-value text-2xl">${selectedBidWall.spotPrice.toFixed(4)}</p>
                    <p className="text-xs text-muted mt-1">
                      {selectedBidWall.navPerToken > 0 ? (
                        selectedBidWall.spotPrice < selectedBidWall.navPerToken ? (
                          <span className="text-success">
                            {((1 - selectedBidWall.spotPrice / selectedBidWall.navPerToken) * 100).toFixed(1)}% below NAV
                          </span>
                        ) : (
                          <span className="text-coral">
                            {((selectedBidWall.spotPrice / selectedBidWall.navPerToken - 1) * 100).toFixed(1)}% above NAV
                          </span>
                        )
                      ) : (
                        <span className="text-muted">current market</span>
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="stat-value text-2xl text-muted">—</p>
                    <p className="text-xs text-coral mt-1 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Price unavailable
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="label mb-1">Wall Balance</p>
                <p className="stat-value text-lg">
                  ${((selectedBidWall.quoteAmount ?? 0) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs text-muted mt-1">USDC</p>
              </div>
              <div>
                <p className="label mb-1">Tokens Burned</p>
                <p className="stat-value text-lg">
                  {((selectedBidWall.tokensBurned ?? 0) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs text-muted mt-1">bought by wall</p>
              </div>
              <div>
                <p className="label mb-1">Active Supply</p>
                <p className="stat-value text-lg">
                  {(selectedBidWall.activeSupply ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}M
                </p>
                <p className="text-xs text-muted mt-1">of 10M</p>
              </div>
            </div>
            
            <div className="mt-4 pt-4 border-t border-meta-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Token Mint</span>
                <a 
                  href={`https://solscan.io/token/${selectedBidWall.tokenMint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-coral hover:text-coral-300 font-mono"
                >
                  {selectedBidWall.tokenMint.slice(0, 6)}...{selectedBidWall.tokenMint.slice(-6)}
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
            <p className="text-muted mb-4">Connect your wallet to sell tokens</p>
          </div>
        ) : !selectedBidWall?.isActive ? (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-coral/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <p className="text-muted mb-4">This bid wall is currently inactive</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Input Amount */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label">You Sell</label>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Balance:</span>
                  {balanceLoading ? (
                    <span className="text-muted">...</span>
                  ) : userBalance !== null ? (
                    <button
                      onClick={() => setTokenAmount(String(userBalance))}
                      className="text-coral hover:text-coral-300 font-medium"
                      title="Click to use max balance"
                    >
                      {userBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </button>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </div>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={tokenAmount}
                  onChange={(e) => setTokenAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.000001"
                  className="input-field pr-24 text-xl font-medium"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted font-medium">
                  {selectedBidWall?.name || 'TOKENS'}
                </span>
              </div>
              {userBalance !== null && parseFloat(tokenAmount) > userBalance && (
                <p className="text-coral text-sm mt-1">Insufficient balance</p>
              )}
            </div>

            {/* Arrow */}
            <div className="flex justify-center py-2">
              <div className="w-8 h-8 rounded-full bg-meta-border flex items-center justify-center">
                <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            </div>

            {/* Output Display */}
            <div className="bg-meta-bg rounded-lg p-4 border border-meta-border">
              <p className="label mb-2">You Receive</p>
              {usdcOutput ? (
                <div className="space-y-2">
                  <p className="text-2xl font-semibold text-success">
                    ${usdcOutput.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDC
                  </p>
                  <div className="text-sm text-muted space-y-1">
                    <div className="flex justify-between">
                      <span>Gross value</span>
                      <span>${usdcOutput.gross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                    </div>
                    <div className="flex justify-between text-coral/80">
                      <span>1% fee</span>
                      <span>-${usdcOutput.fee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                    </div>
                  </div>
                  {exceedsWallBalance && (
                    <p className="text-coral text-sm mt-2">
                      ⚠️ Amount exceeds wall balance
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xl text-muted-dark">Enter an amount</p>
              )}
            </div>

            {/* Swap Button */}
            <button
              onClick={handleSwap}
              disabled={!usdcOutput || exceedsWallBalance || insufficientBalance || txStatus === 'signing' || txStatus === 'confirming'}
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
                'Sell to Bid Wall'
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
            <p>Enter the amount of tokens you want to sell to the bid wall.</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-coral/10 text-coral flex items-center justify-center text-xs font-medium">2</span>
            <p>The bid wall pays you at the current NAV price, minus a 1% fee.</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-coral/10 text-coral flex items-center justify-center text-xs font-medium">3</span>
            <p>You receive USDC directly to your wallet.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
