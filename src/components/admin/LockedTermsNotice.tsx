import React from 'react';
import { Lock } from 'lucide-react';

/**
 * Says why a squares setting cannot be changed any more (PLAN-SQUARES-SERVER-FIELDS).
 *
 * Once the grid is locked, players have bought on the terms shown, so the price,
 * the number sets, the prize split and the rules are fixed, and firestore.rules
 * refuses a change to them. The fields are shown read-only with this line above
 * them, rather than letting an edit fail on save.
 */
export const LockedTermsNotice: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div
    role="note"
    data-testid="locked-terms-notice"
    className="mb-4 flex items-start gap-2 rounded-xl border border-navy-600/20 bg-navy-600/10 p-3.5 text-xs text-muted"
  >
    <Lock size={16} className="mt-0.5 shrink-0 text-navy-600 dark:text-navy-500" />
    <span>
      {children ?? 'The grid is locked, so the prize terms are fixed: players bought their squares on them. To change them, reopen the grid first — that discards the drawn numbers.'}
    </span>
  </div>
);
