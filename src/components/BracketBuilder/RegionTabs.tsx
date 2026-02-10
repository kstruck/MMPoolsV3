import React from 'react';
import { CheckCircle2, Lock, Circle } from 'lucide-react';
import type { BracketRegion } from '../../types';

interface RegionTabsProps {
    activeRegion: BracketRegion | 'FF';
    onRegionChange: (region: BracketRegion | 'FF') => void;
    completionStatus: Record<BracketRegion | 'FF', { count: number; total: number; complete: boolean }>;
}

export const RegionTabs: React.FC<RegionTabsProps> = ({ activeRegion, onRegionChange, completionStatus }) => {
    const regions: { id: BracketRegion | 'FF'; label: string }[] = [
        { id: 'East', label: 'East' },
        { id: 'West', label: 'West' },
        { id: 'South', label: 'South' },
        { id: 'Midwest', label: 'Midwest' },
        { id: 'FF', label: 'Final Four' },
    ];

    const isFinalFourLocked = !regions
        .filter(r => r.id !== 'FF')
        .every(r => completionStatus[r.id as BracketRegion]?.complete);

    return (
        <div className="flex overflow-x-auto pb-2 mb-4 gap-2 no-scrollbar">
            {regions.map((region) => {
                const stats = completionStatus[region.id];
                const isActive = activeRegion === region.id;
                const isLocked = region.id === 'FF' && isFinalFourLocked;

                return (
                    <button
                        key={region.id}
                        onClick={() => !isLocked && onRegionChange(region.id)}
                        disabled={isLocked}
                        className={`
              flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap transition-all
              ${isActive
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }
              ${isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
                    >
                        {isLocked ? (
                            <Lock className="w-4 h-4" />
                        ) : stats?.complete ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                            <Circle className={`w-4 h-4 ${isActive ? 'text-indigo-200' : 'text-slate-600'}`} />
                        )}

                        <span className="font-medium">{region.label}</span>

                        {!isLocked && stats && (
                            <span className={`text-xs ml-1 ${isActive ? 'text-indigo-200' : 'text-slate-500'}`}>
                                {stats.count}/{stats.total}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};
