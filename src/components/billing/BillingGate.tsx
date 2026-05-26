import React, { useMemo } from 'react';
import { Lock, AlertTriangle, CreditCard, Clock, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PoolBilling, BillingStatus } from '../../types';

interface BillingGateProps {
  pool: { billing?: PoolBilling; [key: string]: any };
  isCommissioner: boolean;
  children: React.ReactNode;
}

/** Computes human-readable "X days" remaining from a timestamp */
const getDaysRemaining = (endsAt?: number): number => {
  if (!endsAt) return 0;
  const diff = endsAt - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
};

/**
 * BillingGate — wraps pool content and renders billing-status-aware UI:
 *
 * - `free` / `active` → children only, no banner
 * - `trial` → children + subtle gradient countdown banner
 * - `grace_period` → children + prominent pulsing amber warning
 * - `locked` → blurred children behind a glassmorphism lockout overlay
 * - undefined billing → treated as 'free'
 */
export const BillingGate: React.FC<BillingGateProps> = ({
  pool,
  isCommissioner,
  children,
}) => {
  const billing = pool.billing;
  const status: BillingStatus = billing?.status ?? 'free';

  const trialDaysLeft = useMemo(
    () => getDaysRemaining(billing?.trialEndsAt),
    [billing?.trialEndsAt]
  );

  const graceDaysLeft = useMemo(
    () => getDaysRemaining(billing?.gracePeriodEndsAt),
    [billing?.gracePeriodEndsAt]
  );

  // ─── UNDEFINED BILLING OR ACTIVE — render children with zero overhead ───
  if (!billing || status === 'active') {
    return <>{children}</>;
  }

  // ─── FREE PLAN PARTICIPANT LIMIT BANNER ───────────────────
  if (status === 'free') {
    let count = 0;
    const poolType = (pool.type || '').toUpperCase();
    if (poolType === 'NFL_PLAYOFFS' || poolType === 'PLAYOFF') {
      count = Object.keys(pool.entries || {}).length;
    } else if (
      poolType === 'NFL_PICKEM' || 
      poolType === 'NFL_SURVIVOR' || 
      poolType === 'NFL_MARGIN' || 
      poolType === 'SEASON' || 
      pool.participantIds
    ) {
      count = (pool.participantIds || []).length;
    } else {
      count = pool.entryCount || 0;
    }

    const isLocked = count >= 10;
    const isApproaching = count >= 8 && count < 10;

    let bannerBg = 'linear-gradient(135deg, rgba(30,41,59,0.4) 0%, rgba(15,23,42,0.5) 100%)';
    let bannerBorder = '1px solid rgba(51,65,85,0.3)';
    let badgeBg = 'rgba(51,65,85,0.15)';
    let badgeBorder = '1px solid rgba(51,65,85,0.25)';
    let textColor = '#cbd5e1';
    let titleColor = '#94a3b8';
    let titleText = `Participants: ${count}/10 (Free Plan)`;
    let descText = 'Upgrade to Premium to allow more than 10 participants.';

    if (isLocked) {
      bannerBg = 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(220,38,38,0.15) 100%)';
      bannerBorder = '1px solid rgba(239,68,68,0.4)';
      badgeBg = 'rgba(239,68,68,0.18)';
      badgeBorder = '1px solid rgba(239,68,68,0.35)';
      textColor = '#fca5a5';
      titleColor = '#f87171';
      titleText = 'Participant entries locked! (10/10 reached)';
      descText = 'Upgrade to Premium now to unlock the pool and allow new entries to join.';
    } else if (isApproaching) {
      bannerBg = 'linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(217,119,6,0.14) 100%)';
      bannerBorder = '1px solid rgba(245,158,11,0.4)';
      badgeBg = 'rgba(245,158,11,0.18)';
      badgeBorder = '1px solid rgba(245,158,11,0.35)';
      textColor = '#fde68a';
      titleColor = '#fbbf24';
      titleText = `Participants: ${count}/10 (Free Plan Limit Approaching)`;
      descText = 'Upgrade to Premium to avoid locking entries once the 10-player limit is hit.';
    }

    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          style={{
            background: bannerBg,
            border: bannerBorder,
            borderRadius: '16px',
            padding: '14px 20px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap' as const,
            boxShadow: isLocked ? '0 4px 20px rgba(239,68,68,0.12)' : isApproaching ? '0 4px 20px rgba(245,158,11,0.12)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                padding: '8px',
                background: badgeBg,
                border: badgeBorder,
                borderRadius: '12px',
                color: isLocked ? '#f87171' : isApproaching ? '#fbbf24' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isLocked ? <Lock size={18} /> : <AlertTriangle size={18} />}
            </div>
            <div>
              <p
                style={{
                  fontSize: '12px',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: titleColor,
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                {titleText}
              </p>
              <p
                style={{
                  fontSize: '10px',
                  color: textColor,
                  margin: '2px 0 0',
                  fontWeight: 700,
                }}
              >
                {descText}
              </p>
            </div>
          </div>

          {isCommissioner && (
            <a
              href="/pricing"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 20px',
                background: isLocked 
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)' 
                  : isApproaching 
                    ? 'linear-gradient(135deg, #f59e0b, #d97706)' 
                    : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: isApproaching && !isLocked ? '#0f172a' : '#fff',
                borderRadius: '12px',
                fontSize: '10px',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                textDecoration: 'none',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: isLocked 
                  ? '0 4px 14px rgba(239,68,68,0.25)' 
                  : isApproaching 
                    ? '0 4px 14px rgba(245,158,11,0.25)' 
                    : '0 4px 14px rgba(99,102,241,0.25)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1.04)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1)';
              }}
            >
              <CreditCard size={12} />
              Upgrade to Premium
            </a>
          )}
        </motion.div>

        {children}
      </>
    );
  }

  // ─── TRIAL BANNER ─────────────────────────────────────────
  if (status === 'trial') {
    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          style={{
            background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(139,92,246,0.12) 100%)',
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: '16px',
            padding: '14px 20px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap' as const,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                padding: '8px',
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: '12px',
                color: '#818cf8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Clock size={18} />
            </div>
            <div>
              <p
                style={{
                  fontSize: '12px',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#c7d2fe',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                Trial ends in {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}
              </p>
              <p
                style={{
                  fontSize: '10px',
                  color: '#94a3b8',
                  margin: '2px 0 0',
                  fontWeight: 700,
                }}
              >
                Upgrade to keep full access after your trial period.
              </p>
            </div>
          </div>

          {isCommissioner && (
            <a
              href="/pricing"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff',
                borderRadius: '12px',
                fontSize: '10px',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                textDecoration: 'none',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: '0 4px 14px rgba(99,102,241,0.25)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1.04)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1)';
              }}
            >
              <ExternalLink size={12} />
              Upgrade Now
            </a>
          )}
        </motion.div>

        {children}
      </>
    );
  }

  // ─── GRACE PERIOD WARNING ──────────────────────────────────
  if (status === 'grace_period') {
    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(239,68,68,0.08) 100%)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: '16px',
            padding: '16px 20px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap' as const,
            boxShadow: '0 4px 20px rgba(245,158,11,0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
              style={{
                padding: '10px',
                background: 'rgba(245,158,11,0.15)',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: '14px',
                color: '#fbbf24',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangle size={20} />
            </motion.div>
            <div>
              <p
                style={{
                  fontSize: '13px',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#fde68a',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                Payment Required — Pool locks in {graceDaysLeft} day
                {graceDaysLeft !== 1 ? 's' : ''}
              </p>
              <p
                style={{
                  fontSize: '10px',
                  color: '#94a3b8',
                  margin: '3px 0 0',
                  fontWeight: 700,
                }}
              >
                {isCommissioner
                  ? 'Complete payment to avoid losing access for your entire pool.'
                  : 'The pool commissioner needs to complete payment to maintain access.'}
              </p>
            </div>
          </div>

          {isCommissioner && (
            <a
              href="/pricing"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '12px 24px',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#0f172a',
                borderRadius: '14px',
                fontSize: '10px',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                textDecoration: 'none',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: '0 4px 16px rgba(245,158,11,0.3)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1.04)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1)';
              }}
            >
              <CreditCard size={12} />
              Pay Now
            </a>
          )}
        </motion.div>

        {children}
      </>
    );
  }

  // ─── LOCKED — FULL LOCKOUT OVERLAY ─────────────────────────
  return (
    <div style={{ position: 'relative', minHeight: '400px' }}>
      {/* Blurred children backdrop */}
      <div
        style={{
          filter: 'blur(8px)',
          pointerEvents: 'none',
          userSelect: 'none',
          opacity: 0.45,
        }}
        aria-hidden="true"
      >
        {children}
      </div>

      {/* Glassmorphism lockout overlay */}
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            background: 'rgba(2,6,23,0.6)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            style={{
              background: 'rgba(15,23,42,0.85)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(51,65,85,0.5)',
              borderRadius: '24px',
              padding: '40px 36px',
              maxWidth: '420px',
              width: '90%',
              textAlign: 'center',
              boxShadow:
                '0 25px 50px rgba(0,0,0,0.5), inset 0 0 30px rgba(99,102,241,0.03)',
            }}
          >
            {/* Lock icon badge */}
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '20px',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                color: '#f87171',
              }}
            >
              <Lock size={28} />
            </div>

            {/* Title */}
            <h2
              style={{
                fontSize: '20px',
                fontWeight: 900,
                color: '#ffffff',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                margin: '0 0 10px',
              }}
            >
              Pool Locked
            </h2>

            {/* Message */}
            <p
              style={{
                fontSize: '13px',
                color: '#94a3b8',
                lineHeight: 1.6,
                margin: '0 0 28px',
                fontWeight: 600,
              }}
            >
              {isCommissioner
                ? 'Your pool has been locked. Please complete payment to restore access.'
                : 'This pool is awaiting payment from the commissioner.'}
            </p>

            {/* CTA */}
            {isCommissioner ? (
              <a
                href="/pricing"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '14px 32px',
                  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  color: '#ffffff',
                  borderRadius: '16px',
                  fontSize: '11px',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  textDecoration: 'none',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  boxShadow: '0 8px 24px rgba(239,68,68,0.3)',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1.03)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1)';
                }}
              >
                <CreditCard size={14} />
                Pay Now
              </a>
            ) : (
              <div
                style={{
                  padding: '14px 20px',
                  background: 'rgba(30,41,59,0.6)',
                  border: '1px solid rgba(51,65,85,0.4)',
                  borderRadius: '14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                Please contact your pool commissioner
              </div>
            )}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
