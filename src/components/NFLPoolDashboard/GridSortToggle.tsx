import React from 'react';
import type { GridSort } from '../../utils/picksGridSort';

/**
 * The two-way sort control for the Current Picks grids (item 12). Pure UI —
 * the order itself is `sortGridRows`, unit-tested.
 */
export const GridSortToggle: React.FC<{ value: GridSort; onChange: (v: GridSort) => void; scoreLabel: string }> = ({ value, onChange, scoreLabel }) => {
  const btn = (v: GridSort, label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={value === v}
      className={`px-2.5 py-1 font-display font-bold uppercase text-[11px] tracking-[0.08em] transition-colors ${
        value === v ? 'bg-brandred-600 text-white' : 'bg-page text-muted hover:text-[color:var(--text)]'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex rounded-full border border-line overflow-hidden" role="group" aria-label="Sort players">
      {btn('name', 'A–Z')}
      {btn('score', scoreLabel)}
    </div>
  );
};
