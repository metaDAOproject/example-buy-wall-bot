export function Background() {
  return (
    <div className="fixed inset-0 pointer-events-none">
      {/* MetaDAO diagonal stripe pattern */}
      <div className="absolute inset-0 meta-pattern" />
      
      {/* Subtle gradient overlays */}
      <div 
        className="absolute inset-0 opacity-40"
        style={{
          background: 'radial-gradient(ellipse at 0% 0%, rgba(248, 113, 113, 0.08) 0%, transparent 50%)',
        }}
      />
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          background: 'radial-gradient(ellipse at 100% 100%, rgba(248, 113, 113, 0.05) 0%, transparent 50%)',
        }}
      />
    </div>
  )
}
