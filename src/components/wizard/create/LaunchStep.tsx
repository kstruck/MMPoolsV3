import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import type { PoolType } from '@shared/poolTypes';
import {
  type AddonKey,
  type AddonSelection,
  type PoolQuote,
  creditSatisfiesPool,
  isPassLive,
} from '@shared/schemas';
import { dbService } from '../../../services/dbService';
import { logger } from '../../../utils/logger';
import type { User } from '../../../types';
import { profileUpdatesFrom } from './profilePrefill';
import { launchButtonsState, type LaunchQuoteState } from './launchButtonsState';
import { CheckboxField, Field, NumberField } from '../fields';
import { SELLABLE_ADDON_KEYS, stripFreeAddons } from '../../../config/freeAddons';
import { estimateIsSet, feeWithoutPaymentPathWarning } from './launchReadiness';
import { FREE_PLAN_PARTICIPANT_CAP, FREE_PLAN_WARNING_AT, FREE_PLAN_FULL_MESSAGE } from '@shared/freePlanCap';

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
  /**
   * The signed-in commissioner, used ONLY to remember their contact and payout
   * handles after a successful create (`profileUpdatesFrom`). Optional so the
   * seven wizards can adopt it independently; omitting it just skips the
   * write-back.
   */
  user?: User | null;
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
  const { uid, user, poolType, feeField, createPool, onCreated } = props;
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
  // Bumped by the "Try again" control so the quote effect re-runs on the SAME
  // inputs. Without it a failed quote is a dead end until the user edits a field.
  const [quoteReloadKey, setQuoteReloadKey] = useState(0);
  // Which INPUTS the quote/error on screen belongs to. `quoteLoading` alone is
  // not enough: for the 300ms the fetch is debouncing it is still false, so a
  // superseded quote would read as current and the Activate button would offer
  // a price the server no longer agrees with (codex round 2 [P1]). Same stamp
  // BillingInvoiceCard uses (`setQuoteFor(key)`), for the same reason.
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);

  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // After a successful create whose follow-on (checkout/redeem) failed, keep the
  // poolId so the user can still continue to the (trial) pool — no orphan state.
  const [createdPoolId, setCreatedPoolId] = useState<string | null>(null);

  const [redeemables, setRedeemables] = useState<RedeemableEntitlement[]>([]);

  // --- Server quote (debounced; the client renders it verbatim) --------------
  const addonsKey = JSON.stringify(addons);
  // Identity of the priced inputs. A quote is only "current" while this matches
  // the key it resolved under — see `resolvedKey`.
  const quoteInputsKey = JSON.stringify([poolType, estimatedPlayers, addonsKey, couponInput.trim().toUpperCase()]);
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
          // Branding is included with every pool (T4/D1) — never quoted, so the
          // price is right regardless of the billing_config save.
          addons: stripFreeAddons(addons),
          couponCode: trimmed ? trimmed.toUpperCase() : undefined,
        });
        if (!cancelled) {
          setQuote(q);
          setResolvedKey(quoteInputsKey);
        }
      } catch {
        if (!cancelled) {
          setQuote(null);
          setQuoteError('Could not load pricing right now. You can still start a free trial below.');
          // Stamped on failure too, so the error belongs to THESE inputs and a
          // later edit reads as pending rather than as a standing failure.
          setResolvedKey(quoteInputsKey);
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
  }, [poolType, estimatedPlayers, addonsKey, couponInput, quoteReloadKey]);

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

  // Which launch actions to render. The rule lives in `launchButtonsState` so a
  // coupon-zeroed total keeps the Activate path (T2) and so it can be tested.
  const quoteState: LaunchQuoteState =
    resolvedKey !== quoteInputsKey || quoteLoading
      ? 'pending'
      : quoteError
        ? 'unavailable'
        : quote
          ? 'ready'
          : 'pending';
  const buttons = launchButtonsState({ quoteState, quote });

  // G7 — the estimate must be answered. It defaulted to 0 and was never
  // required, so an untouched field silently routed a 40-person pool onto the
  // free plan and the wall was found by the 11th member, mid-season.
  const estimateSet = estimateIsSet(estimatedPlayers);

  // G14 — a fee with nowhere to send it. Warns, never blocks: collecting cash
  // in person is a legitimate answer.
  const feeWarning = feeWithoutPaymentPathWarning({
    fee,
    handles: watch('paymentHandles') as Record<string, unknown> | undefined,
    instructions: watch('paymentInstructions'),
  });
  const freeEligible = buttons.primary === 'free';

  /**
   * Show the free plan's participant ceiling, or null when it does not apply.
   *
   * ⚠️ THE NUMBER IS `FREE_PLAN_PARTICIPANT_CAP`, NOT `quote.freePlayerThreshold`
   * (codex r1). Those are two different numbers that both happen to be 10 today:
   * the quote's threshold is a PRICING input (free vs trial, admin-configurable),
   * while the cap is what `nflPools` / `bracketEntries` / `playoffPools` /
   * `propBets` actually enforce on every join. Quoting the pricing number here
   * would have promised a 25-player free pool the moment an admin raised the
   * config, while the join gate still turned away the 11th.
   *
   * The quote is still what decides WHETHER to show it — `freeTierEligible` is
   * the server's own answer to "is this pool launching free". Null while that is
   * loading or stale, because a wrong claim here is worse than none: a
   * commissioner plans their invite list around it.
   */
  const freeCapNotice = useMemo(() => {
    if (resolvedKey !== quoteInputsKey || quoteLoading || !quote) return null;
    if (!quote.freeTierEligible) return null;
    // ⚠️ `freeTierEligible` is not the launch mode (codex r2). It is true whenever
    // the TOTAL is $0, and a 100%-off coupon makes that true with a paid add-on
    // selected — but `computeLaunchMode` forces 'trial' for ANY paid add-on, and
    // a trial pool is not subject to the free-plan join gate at all. `addonLines`
    // is the priced-add-on list the coupon discounts but does not empty, so it
    // mirrors the server's `payloadHasPaidAddon` exactly.
    if (quote.addonLines.length > 0) return null;
    // ⚠️ SQUARES DOES NOT ENFORCE THIS CAP (codex r5). `reserveSquare` checks
    // billing access but never the free-plan participant count, unlike the four
    // gates above — SQUARES-BACKLOG.md S3. Promising "player 11 cannot join" on
    // a pool where they can is the exact class of false claim this notice was
    // added to remove. Creation for the type is closed today, so this cannot
    // render; it is here so reopening creation cannot quietly reintroduce the
    // lie. Delete it when S3 is fixed, not before.
    if (String(poolType).toUpperCase() === 'SQUARES') return null;
    return FREE_PLAN_PARTICIPANT_CAP;
  }, [quote, resolvedKey, quoteInputsKey, quoteLoading, poolType]);

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
    // The coupon lives in this component's state, not the form, so it has to be
    // merged in here or it never reaches the create payload at all — which is
    // exactly why `billing.couponCode` was a field nothing wrote (T3).
    const couponForLaunch = couponInput.trim().toUpperCase();
    const poolId = await createPool(couponForLaunch ? { ...clean, couponCode: couponForLaunch } : clean);
    setCreatedPoolId(poolId);

    // Remember this commissioner's contact + payout handles so their NEXT pool
    // starts pre-filled. Blanks only — see profilePrefill's docblock.
    //
    // ⚠️ Deliberately swallowed. The pool EXISTS at this point; a failed profile
    // write is a lost convenience, not a lost pool, and letting it throw here
    // would surface as "Something went wrong launching your pool" and send the
    // commissioner back to create a SECOND one. Silence read as success is this
    // repo's most repeated defect, so the failure is logged rather than dropped.
    const profileUpdates = profileUpdatesFrom(user, clean);
    if (profileUpdates) {
      try {
        // ⚠️ CHECK THE RETURN VALUE, do not rely on the catch alone.
        // `dbService.updateUser` → `BaseRepository.update`, which CATCHES every
        // Firestore failure and resolves `false` (BaseRepository.ts:84-90). So a
        // permission-denied, an offline write or a missing user doc never throws
        // and would sail straight past a try/catch as a success. The catch is
        // kept for anything that throws before the repository is reached.
        // `profileUpdates` uses Firestore DOT PATHS (`paymentHandles.cashapp`)
        // rather than a nested object, so the write merges instead of replacing
        // the handle map. That is why it is not shaped like `Partial<User>`.
        const saved = await dbService.updateUser(uid, profileUpdates);
        if (!saved) {
          logger.warn(
            '[LaunchStep] profile save returned false — contact/payment details were NOT remembered',
            { uid, fields: Object.keys(profileUpdates) },
          );
        }
      } catch (e) {
        logger.warn('[LaunchStep] could not save contact/payment details to the profile', e);
      }
    }

    return poolId;
  }, [tosAccepted, trigger, getValues, createPool, createdPoolId, user, uid, couponInput]);

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
        addons: stripFreeAddons(addons),
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
        min={1}
        placeholder="e.g. 10"
      />
      {/* G7 — say what the number is FOR, at the moment it is asked.
          The limit used to be described without being NAMED, because the figure
          is configurable and already hardcoded at the four sites that ENFORCE
          it. Kevin, 2026-08-30: *"Make sure this is clear on the wizard to the
          user so they fully understand and explain how they will know when the
          11th player tries to join and what they will see, and how they can fix
          it."* Resolved by SERVING the number from the quote
          (`freePlayerThreshold`, same precedent as `trialDays`) rather than
          hardcoding a fifth copy — so the number on screen is the number the
          server will enforce, not a copy of it. Falls back to the old
          unnumbered sentence when the quote has not loaded. */}
      <p className="-mt-3 mb-4 text-xs text-slate-400">
        Small pools launch free; above that limit, hosting is priced by size. This is the number we price —
        estimate high rather than low, because growing past it later means upgrading.
      </p>
      {!estimateSet && (
        <p className="-mt-2 mb-4 text-xs font-semibold text-amber-300">
          Enter how many players you expect before launching.
        </p>
      )}
      {/* THE WALL, SPELLED OUT — what happens, who hits it, what they see, and
          how the commissioner clears it. Shown whenever the pool would launch
          free, which is exactly when the ceiling applies. */}
      {freeCapNotice !== null && (
        <div className="-mt-2 mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
          <p className="font-semibold">
            A free pool holds {freeCapNotice} players. Player {freeCapNotice + 1} cannot join.
          </p>
          <p className="mt-1">
            They are turned away with: <em>&ldquo;{FREE_PLAN_FULL_MESSAGE}&rdquo;</em>{' '}
            Nothing is lost — they can join the moment you make room.
          </p>
          <p className="mt-1">
            We email you when your pool reaches {FREE_PLAN_WARNING_AT} players and again at {freeCapNotice},
            so the wall should never be a surprise. To raise it, open your pool and use the
            <strong> Upgrade</strong> button on the participants banner — it takes you straight to the
            pricing page for that pool. Or set the number above to your real headcount now and launch on
            the right plan from the start, which is the cheaper move.
          </p>
        </div>
      )}

      {/* Premium add-ons — priced server-side; any paid add-on starts a trial. */}
      <p className="mb-2 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Premium add-ons (optional)</p>
      <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
        {SELLABLE_ADDON_KEYS.filter((key) => {
          // SMS notifications disabled for now (product decision 2026-07-07).
          if (key === 'smsNotifications') return false;
          // What-If Simulator is a Bracket-only add-on (matches the pricing page + checkout).
          if (key === 'whatIfSimulator') return poolType.toUpperCase() === 'BRACKET';
          return true;
        }).map((key) => (
          <CheckboxField key={key} name={`addons.${key}`} label={ADDON_LABELS[key]} helpId="launch.addons" />
        ))}
      </div>

      {/* Coupon — feeds the quote for display AND the checkout call. */}
      <Field label="Coupon code (optional)" htmlFor="launch-coupon" helpId="launch.coupon">
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
        {!quoteLoading && quoteError && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-amber-300">{quoteError}</p>
            {/* An enabled control, not a disabled button promising an action —
                same split BillingInvoiceCard uses for its quote retry. */}
            <button
              type="button"
              onClick={() => setQuoteReloadKey((k) => k + 1)}
              className="rounded-md border border-amber-400/60 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-400/10"
            >
              Try again
            </button>
          </div>
        )}
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
                <span className="text-indigo-300">
                  {/* T7 — the trial line said what it COST and nothing about what
                      it does. Three facts a commissioner needs before they
                      commit a pool of real people to it, and all three were
                      missing: what is switched on, what happens when it ends,
                      and whether anything charges them. */}
                  Launches on a {quote.trialDays}-day free trial with everything you selected above switched on.
                  No card required — nothing is charged automatically, ever.
                  {' '}When the trial ends you get a short grace period to pay; after that the pool locks
                  (members keep their picks and standings, and it all comes back the moment you activate).
                </span>
              )}
            </p>
          </dl>
        )}
      </div>

      {/* Terms gate (this step owns it; the shell suppresses its own submit). */}
      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
        <CheckboxField
          name="_tosAccepted"
          label={
            <span>
              I agree to the{' '}
              {/* Opens in a new tab so reading the terms does not destroy a
                  wizard that holds six steps of unsaved form state.
                  stopPropagation because this anchor sits INSIDE the <label>:
                  without it, clicking through to read the terms would also
                  tick the box the reader has not yet agreed to. */}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-semibold text-indigo-400 underline underline-offset-2 hover:text-indigo-300"
              >
                Terms of Service
              </a>{' '}
              and confirm entry fees are collected peer-to-peer.
            </span>
          }
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

      {feeWarning && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {feeWarning}
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
            disabled={busy !== null || !tosAccepted || !estimateSet}
            className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'free' ? 'Launching…' : 'Launch free pool'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => startTrialOrFree('trial')}
            disabled={busy !== null || !tosAccepted || !estimateSet}
            className="rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'trial' ? 'Launching…' : `Start ${quote?.trialDays ?? 14}-day trial`}
          </button>
        )}

        {/* Activate now — create as trial, then checkout. A full-discount coupon
            drives the total to $0 and STILL activates: the server's FREE PATH
            handles it without a Stripe redirect (T2). */}
        {buttons.showActivate && (
          <button
            type="button"
            onClick={activateNow}
            disabled={busy !== null || !tosAccepted || !estimateSet || buttons.activateDisabled}
            className="rounded-md border border-indigo-500/60 bg-indigo-500/10 px-6 py-2.5 text-sm font-bold text-indigo-100 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'activate'
              ? 'Starting checkout…'
              : buttons.activateDisabled
                ? 'Updating pricing…'
              : buttons.activateIsCouponZero
                ? 'Activate now — $0 (coupon applied)'
                : `Activate now — ${money(buttons.activateAmount)}`}
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
                  disabled={busy !== null || !tosAccepted || !estimateSet}
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
