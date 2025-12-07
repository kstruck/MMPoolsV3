import React from 'react';

export const Logo: React.FC<{ className?: string, textClassName?: string }> = ({ className = "w-10 h-10", textClassName = "text-xl" }) => (
  <div className="flex items-center gap-3 select-none group">
    <div className={`relative flex items-center justify-center bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl shadow-lg shadow-orange-500/20 transform transition-transform group-hover:scale-105 group-hover:rotate-3 ${className}`}>
      
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent"></div>
      
      {/* Abstract Sports Ball / Grid Icon */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white relative z-10 w-2/3 h-2/3">
        {/* Ball Circle */}
        <circle cx="12" cy="12" r="10" strokeWidth="2" className="opacity-90" />
        {/* Grid Lines (Melee feel) */}
        <path d="M2 12h20" className="opacity-80" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10" className="opacity-80" />
        <path d="M12 2a15.3 15.3 0 0 0-4 10 15.3 15.3 0 0 0 4 10" className="opacity-80" />
        <path d="M22 12c-2 0-7-2-9-9" className="opacity-60" />
        <path d="M2 12c2 0 7 2 9 9" className="opacity-60" />
      </svg>
      
      {/* Shine */}
      <div className="absolute top-1 right-1 w-2 h-2 bg-white/40 rounded-full blur-[1px]"></div>
    </div>
    
    <div className={`font-black tracking-tight text-white flex flex-col leading-none ${textClassName}`}>
      <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-200 uppercase text-[0.9em] tracking-tight whitespace-nowrap drop-shadow-sm">MarchMelee</span>
      <span className="text-slate-400 text-[0.7em] tracking-[0.2em] font-bold uppercase ml-0.5">Pools</span>
    </div>
  </div>
);