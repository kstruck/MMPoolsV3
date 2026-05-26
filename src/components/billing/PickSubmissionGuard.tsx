import React from 'react';
import { ShieldAlert } from 'lucide-react';
import type { BillingStatus } from '../../types';

interface PickSubmissionGuardProps {
  billingStatus?: BillingStatus;
  children: React.ReactNode;
}

/**
 * PickSubmissionGuard — disables pick submission UI when pool is billing-locked.
 *
 * - `locked` → wraps children with pointer-events:none, reduced opacity,
 *   and an inline warning bar explaining submissions are frozen.
 * - Any other status (or undefined) → renders children normally.
 */
export const PickSubmissionGuard: React.FC<PickSubmissionGuardProps> = ({
  billingStatus,
  children,
}) => {
  if (billingStatus !== 'locked') {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        position: 'relative',
        border: '1px solid rgba(239,68,68,0.35)',
        borderRadius: '16px',
        overflow: 'hidden',
      }}
    >
      {/* Inline warning bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 16px',
          background: 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(245,158,11,0.08) 100%)',
          borderBottom: '1px solid rgba(239,68,68,0.25)',
        }}
      >
        <ShieldAlert
          size={14}
          style={{ color: '#f87171', flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: '10px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#fca5a5',
          }}
        >
          Submissions are locked — awaiting commissioner payment
        </span>
      </div>

      {/* Disabled children */}
      <div
        style={{
          pointerEvents: 'none',
          opacity: 0.5,
          userSelect: 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
};
