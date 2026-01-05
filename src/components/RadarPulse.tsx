import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface RadarPulseProps {
  isNewTokenFound: boolean
  isCriticalSignal?: boolean
}

export const RadarPulse: React.FC<RadarPulseProps> = ({ isNewTokenFound, isCriticalSignal = false }) => {
  const [pulses, setPulses] = useState<number[]>([])

  // Trigger a new radar ring whenever a token is found
  useEffect(() => {
    if (isNewTokenFound) {
      const id = Date.now()
      setPulses((prev) => [...prev, id])
      setTimeout(() => {
        setPulses((prev) => prev.filter((p) => p !== id))
      }, 2000) // Pulse duration
    }
  }, [isNewTokenFound])

  const pulseColor = isCriticalSignal ? 'border-red-400/50 shadow-[0_0_20px_rgba(239,68,68,0.4)]' : 'border-emerald-400/50 shadow-[0_0_20px_rgba(52,211,153,0.3)]'
  const hubColor = isCriticalSignal ? 'bg-red-400 shadow-[0_0_10px_#ef4444]' : 'bg-emerald-400 shadow-[0_0_10px_#10b981]'

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
      {/* 1. CONSTANT AMBIENT SWEEP */}
      <div className="absolute w-[500px] h-[500px] border border-emerald-500/5 rounded-full animate-ping opacity-20" 
           style={{ animationDuration: '3s' }} />
      
      {/* 2. DYNAMIC SIGNAL RINGS */}
      <AnimatePresence>
        {pulses.map((id) => (
          <motion.div
            key={id}
            initial={{ scale: 0, opacity: 0.8 }}
            animate={{ scale: 4, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            className={`absolute w-20 h-20 border-2 rounded-full ${pulseColor}`}
          />
        ))}
      </AnimatePresence>

      {/* 3. CENTER HUB (The Engine Status) */}
      <div className={`relative z-10 w-2 h-2 rounded-full ${hubColor}`} />
    </div>
  )
}
