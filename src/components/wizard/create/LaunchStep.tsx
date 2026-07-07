import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import type { PoolType } from '@shared/poolTypes';
import {
  ADDON_KEYS,
  type AddonKey,
  type AddonSelection,
  type PoolQuote,
  creditSatisfiesPool,
  isPassLive,
} from '@shared/schemas';
import { dbService } from '../../../services/dbService';
import { CheckboxField, Field, NumberField } from '../fields';

// ---------------------------------------------------------------------------
// LaunchStep — the final wizard step (PLAN-BUYFLOW-OVERHAUL Phase 2 #5).
//
// The wizard stays pure UI (ADR-0001): this step NEVER computes price or decides
// free vs trial. It (1) shows the SERVER quote from getPoolQuote, and (2) runs
// the launch state machine, whose single rule is server-owned:
//
//   creation ALWAYS happens first, in one of two server-validated modes:
//     - free  : estimatedPlayers <= freePlayerThreshold AND quote total is $0
//     - trial : everything else (server stamps billing.status:"trial")
//   payment/redeem is an ACTION on the already-created (trial) pool:
//     - Start Trial   : create, stop.
//     - Activate now  : create (trial), then Stripe checkout for that pool.
//     - Redeem        : create (trial), then redeemPoolCredit for that pool.
//   Cancel/abandon just leaves the pool as a trial — no cleanup (server handles).
//
// This component drives creation via the `createPool` callback the flow passes
// (it returns the new poolId WITHOUT navigating), then branches. `onCreated` is
// the flow's post-launch navigation for the trial/redeem/free paths; the
// Activate-now path redirects to Stripe instead.
// ---------------------------------------------------------------------------

const ADDON_LABELS: Record<AddonKey, string> = {
  aiCommissioner: 'AI Commissioner',
  smsNotifications: 'SMS notifications',
  whatIfSimulator: 'What-If simulator',
  customBranding: 'Custom branding',
};

// A redeemable entitlement resolved from the user's bundles that satisfies this
// pool's type + size constraint. `kind` distinguishes the redeem call shape.
interface RedeemableEntitlement {
  bundleId: string;
  kind: 'CREDIT_BUNDLE' | 'UNLIMITED_PASS';
  label: string;
}

export interface LaunchStepProps {
  uid: string;
  poolType: PoolType;
  /** RHF path of the entry fee (for the summary line); optional. */
  feeField?: string;
  /** Creates the pool (free/trial per server) and RESOLVES the new poolId. Must NOT navigate. */
  createPool: (values: Record<string, unknown>) => Promise<string>;
  /** Post-launch navigation for the trial / redeem / free paths (not Activate-now). */
  onCreated: (poolId: string) => void;
}

type Busy = null | 'free' | 'trial' | 'activate' | 'redeem';

export function LaunchStep(props: LaunchStepProps) {
  const { uid, poolType, feeField, createPool, onCreated } = props;
  const { watch, getValues, trigger } = useFormContext();

  const name = String(watch('name') ?? '');
  const fee = feeField ? Number(watch(feeField) ?? 0) : undefined;
  const tosAccepted = Boolean(watch('_tosAccepted'));

  // Launch inputs the server prices. estimatedPlayers + addons also live in the
  // create payload (build*Payload spreads readLaunchFields), so the same numbers
  // the quote reflects are what computeLaunchMode reads server-side.
  const estimatedPlayers = Number(watch('estimatedPlayers') ?? 0) || 0;
  const addonsWatch = watch('addons') as Partial<AddonSelection> | undefined;
  const addons: AddonSelection = useMemo(
    () => ({
      aiCommissioner: !!addonsWatch?.aiCommissioner,
      smsNotifications: !!addonsWatch?.smsNotifications,
      whatIfSimulator: !!addonsWatch?.whatIfSimulator,
      customBranding: !!addonsWatch?.customBranding,
    }),
    [addonsWatch?.aiCommissioner, addonsWatch?.smsNotifications, addonsWatch?.whatIfSimulator, addonsWatch?.customBranding],
  );

  const [couponInput, setCouponInput] = useState('');
  const [quote, setQuote] = useState<PoolQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // After a successful create whose follow-on (checkout/redeem) failed, keep the
  // poolId so the user can still continue to the (trial) pool — no orphan state.
  const [createdPoolId, setCreatedPoolId] = useState<string | null>(null);

  const [redeemables, setRedeemables] = useState<RedeemableEntitlement[]>([]);

  // --- Server quote (debounced; the client renders it verbatim) --------------
  const addonsKey = JSON.stringify(addons);
  useEffect(() => {
    let cancelled = false;
    const trimmed = couponInput.trim();
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const q = await dbService.getPoolQuote({
          poolType,
          estimatedPlayers,
          addons,
          couponCode: trimmed ? trimmed.toUpperCase() : undefined,
        });
        if (!cancelled) setQuote(q);
      } catch {
        if (!cancelled) {
          setQuote(null);
          setQuoteError('Could not load pricing right now. You can still start a free trial below.');
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // addonsKey captures the four booleans; estimatedPlayers/coupon re-quote too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolType, estimatedPlayers, addonsKey, couponInput]);

  // --- Redeemable entitlements (only if the user owns a matching one) --------
  useEffect(() => {
    if (!uid) return;
    const unsub = dbService.subscribeToMyBundles(
      uid,
      (bundles) => {
        const now = Date.now();
        const matches: RedeemableEntitlement[] = [];
        for (const raw of bundles) {
          const b = raw as Record<string, any>;
          const snapshot = (b.productSnapshot ?? {}) as { poolType?: string; maxPlayersPerPool?: number; name?: string };
          const constraints = {
            poolType: snapshot.poolType as any,
            maxPlayersPerPool: snapshot.maxPlayersPerPool,
          };
          // Same size test the server enforces: pool player count within the
          // entitlement's ceiling, and pool type matches (or 'ALL').
          if (!creditSatisfiesPool(constraints, poolType, estimatedPlayers || undefined)) continue;

          if (b.productKind === 'UNLIMITED_PASS') {
            if (isPassLive({ productKind: 'UNLIMITED_PASS', status: b.status, termEndsAt: b.termEndsAt }, now)) {
              matches.push({
                bundleId: String(b.id),
                kind: 'UNLIMITED_PASS',
                label: snapshot.name ? `Unlimited Pass — ${snapshot.name}` : 'Unlimited Pass',
              });
            }
          } else if (b.productKind === 'CREDIT_BUNDLE') {
            const total = Number(b.creditsTotal ?? 0);
            const used = Number(b.creditsUsed ?? 0);
            if (b.status === 'active' && used < total) {
              matches.push({
                bundleId: String(b.id),
                kind: 'CREDIT_BUNDLE',
                label: snapshot.name
                  ? `Pool Credit — ${snapshot.name} (${total - used} left)`
                  : `Pool Credit (${total - used} left)`,
              });
            }
          }
        }
        setRedeemables(matches);
      },
      // Bundles rules may be pending (Wave 5) → permission-denied. Degrade: just
      // hide the redeem option rather than blocking the whole launch step.
      () => setRedeemables([]),
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, poolType, estimatedPlayers]);

  const freeEligible = quote?.freeTierEligible === true;

  // --- Shared create guard ---------------------------------------------------
  // Validates the full form and gates on Terms before creating. Returns the new
  // poolId, or null when validation/creation failed (error already surfaced).
  const runCreate = useCallback(async (): Promise<string | null> => {
    setActionError(null);
    if (!tosAccepted) {
      setActionError('Please accept the Terms of Service to launch.');
      return null;
    }
    const valid = await trigger();
    if (!valid) {
      setActionError('Some fields need attention on an earlier step. Please review and fix them.');
      return null;
    }
    // Re-use an already-created pool if a prior action created it but its
    // follow-on failed — never create a second pool for the same launch.
    if (createdPoolId) return createdPoolId;
    const { _tosAccepted, ...clean } = getValues() as Record<string, unknown>;
    void _tosAccepted;
    const poolId = await createPool(clean);
    setCreatedPoolId(poolId);
    return poolId;
  }, [tosAccepted, trigger, getValues, createPool, createdPoolId]);

  const startTrialOrFree = useCallback(async (mode: 'free' | 'trial') => {
    setBusy(mode);
    try {
      const poolId = await runCreate();
      if (poolId) onCreated(poolId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong launching your pool.');
    } finally {
      setBusy(null);
    }
  }, [runCreate, onCreated]);

  const activateNow = useCallback(async () => {
    setBusy('activate');
    try {
      const poolId = await runCreate();
      if (!poolId) return;
      const trimmed = couponInput.trim();
      const { sessionUrl } = await dbService.createCheckoutSession({
        poolId,
        poolName: name || 'Your pool',
        poolType,
        estimatedPlayers,
        addons,
        couponCode: trimmed ? trimmed.toUpperCase() : undefined,
      });
      // Leaves the app for Stripe. If the user cancels/abandons there, the pool
      // simply stays a trial (server side) — nothing to undo here.
      window.location.href = sessionUrl;
    } catch (e) {
      setActionError(
        e instanceof Error
          ? `Your pool was created as a trial, but checkout could not start: ${e.message}`
          : 'Your pool was created as a trial, but checkout could not start.',
      );
    } finally {
      setBusy(null);
    }
  }, [runCreate, couponInput, name, poolType, estimatedPlayers, addons]);

  const redeem = useCallback(async (ent: RedeemableEntitlement) => {
    setBusy('redeem');
    try {
      const poolId = await runCreate();
      if (!poolId) return;
      await dbService.redeemPoolCredit({ poolId, bundleId: ent.bundleId });
      onCreated(poolId);
    } catch (e) {
      setActionError(
        e instanceof Error
          ? `Your pool was created as a trial, but the entitlement could not be redeemed: ${e.message}`
          : 'Your pool was created as a trial, but the entitlement could not be redeemed.',
      );
    } finally {
      setBusy(null);
    }
  }, [runCreate, onCreated]);

  const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, '')}`;

  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Review &amp; launch</h3>
      <p className="mb-5 text-sm text-slate-400">
        Tell us how big you expect this pool to get — pricing is calculated on our server, never guessed here.
      </p>

      {/* Player estimate — the server reads this to pick free vs trial. */}
      <NumberField
        name="estimatedPlayers"
        label="Expected number of players"
        min={0}
        placeholder="e.g. 10"
        hint="An estimate is fine. Small pools launch on the free plan; larger ones start a free trial."
      />

      {/* Premium add-ons — priced server-side; any paid add-on starts a trial. */}
      <p className="mb-2 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Premium add-ons (optional)</p>
      <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
        {ADDON_KEYS.filter((key) => {
          // SMS notifications disabled for now (product decision 2026-07-07).
          if (key === 'smsNotifications') return false;
          // What-If Simulator is a Bracket-only add-on (matches the pricing page + checkout).
          if (key === 'whatIfSimulator') return poolType.toUpperCase() === 'BRACKET';
          return true;
        }).map((key) => (
          <CheckboxField key={key} name={`addons.${key}`} label={ADDON_LABELS[key]} />
        ))}
      </div>

      {/* Coupon — feeds the quote for display AND the checkout call. */}
      <Field label="Coupon code (optional)" htmlFor="launch-coupon" hint="Applied to the quote below and at checkout.">
        <input
          id="launch-coupon"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white uppercase outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="SAVE10"
          value={couponInput}
          onChange={(e) => setCouponInput(e.target.value)}
        />
      </Field>

      {/* Itemized SERVER quote (verbatim — no client math). */}
      <div className="mb-5 rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-sm">
        {quoteLoading && <p className="text-slate-400">Fetching your quote…</p>}
        {!quoteLoading && quoteError && <p className="text-amber-300">{quoteError}</p>}
        {!quoteLoading && !quoteError && quote && (
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-slate-400">Base ({quote.pricingKey})</dt>
              <dd className="text-white">{money(quote.basePrice)}</dd>
            </div>
            {quote.addonLines.map((line) => (
              <div key={line.key} className="flex justify-between">
                <dt className="text-slate-400">{line.label}</dt>
                <dd className="text-white">{money(line.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-slate-800 pt-2">
              <dt className="text-slate-400">Subtotal</dt>
              <dd className="text-white">{money(quote.subtotal)}</dd>
            </div>
            {quote.couponState && (
              <div className="flex justify-between">
                <dt className={quote.couponState.valid ? 'text-emerald-400' : 'text-rose-400'}>
                  {quote.couponState.valid
                    ? `Coupon ${quote.couponState.code}${quote.couponState.discountLabel ? ` — ${quote.couponState.discountLabel}` : ''}`
                    : `Coupon ${quote.couponState.code} — ${quote.couponState.reason || 'invalid'}`}
                </dt>
                <dd className="text-emerald-400">{quote.discount > 0 ? `− ${money(quote.discount)}` : ''}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-800 pt-2 text-base font-bold">
              <dt className="text-white">Total today</dt>
              <dd className="text-white">{money(quote.total)}</dd>
            </div>
            {fee !== undefined && fee > 0 && (
              <p className="pt-1 text-xs text-slate-500">
                Entry fee ({money(fee)}/player) is collected peer-to-peer and is not part of this total.
              </p>
            )}
            <p className="pt-1 text-xs font-semibold">
              {freeEligible ? (
                <span className="text-emerald-400">This pool qualifies for the free plan — launch at no charge.</span>
              ) : (
                <span className="text-indigo-300">Launches on a {quote.trialDays}-day free trial. No card required to start.</span>
              )}
            </p>
          </dl>
        )}
      </div>

      {/* Terms gate (this step owns it; the shell suppresses its own submit). */}
      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
        <CheckboxField
          name="_tosAccepted"
          label="I agree to the Terms of Service and confirm entry fees are collected peer-to-peer."
        />
      </div>

      {actionError && (
        <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
          {actionError}
          {createdPoolId && (
            <button
              type="button"
              onClick={() => onCreated(createdPoolId)}
              className="ml-2 font-semibold underline hover:text-rose-200"
            >
              Continue to your pool
            </button>
          )}
        </div>
      )}

      {/* --- Launch state machine actions -------------------------------------
          Creation always happens first (free/trial per server); payment/redeem
          is an action on the created pool. */}
      <div className="flex flex-col gap-3">
        {/* Primary: free launch when eligible, otherwise start the trial. */}
        {freeEligible ? (
          <button
            type="button"
            onClick={() => startTrialOrFree('free')}
            disabled={busy !== null || !tosAccepted}
            className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'free' ? 'Launching…' : 'Launch free pool'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => startTrialOrFree('trial')}
            disabled={busy !== null || !tosAccepted}
            className="rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'trial' ? 'Launching…' : `Start ${quote?.trialDays ?? 14}-day trial`}
          </button>
        )}

        {/* Activate now — create as trial, then Stripe checkout. Shown when there
            is a real amount to charge (a $0 total is either free or covered). */}
        {quote && quote.total > 0 && (
          <button
            type="button"
            onClick={activateNow}
            disabled={busy !== null || !tosAccepted}
            className="rounded-md border border-indigo-500/60 bg-indigo-500/10 px-6 py-2.5 text-sm font-bold text-indigo-100 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'activate' ? 'Starting checkout…' : `Activate now — ${money(quote.total)}`}
          </button>
        )}

        {/* Redeem — only when the user owns a matching Pool Credit / Unlimited Pass. */}
        {redeemables.length > 0 && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Use an entitlement you already own
            </p>
            <div className="flex flex-col gap-2">
              {redeemables.map((ent) => (
                <button
                  key={ent.bundleId}
                  type="button"
                  onClick={() => redeem(ent)}
                  disabled={busy !== null || !tosAccepted}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'redeem' ? 'Redeeming…' : `Redeem ${ent.label}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
