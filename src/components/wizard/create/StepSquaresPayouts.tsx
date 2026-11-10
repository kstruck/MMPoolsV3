import { useFormContext } from 'react-hook-form';
import { CheckboxField, NumberField, SelectField, TextField } from '../fields';
import { PERIODS, PERIOD_SHORT_LABEL, periodBase, squaresPot, type PayoutPool } from '@shared/squaresPayouts';
import { formatPrize } from '../../../utils/payouts';

/**
 * The squares wizard's payouts step (PLAN-SQUARES-REOPEN C2).
 *
 * Every NFL wizard has a payouts step; squares had none, so a new pool was
 * created at the server's even split and the commissioner had to find the
 * settings on the admin page afterwards — where the rule options also lived,
 * several of which did nothing reliable until PR-B.
 *
 * The example at the bottom is worked out by `@shared/squaresPayouts` — the
 * same function that records winners — so what the commissioner is shown here
 * is what a full grid will actually pay.
 */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const money = formatPrize;

export function StepSquaresPayouts() {
  const { watch } = useFormContext();
  const split = (watch('squaresPayouts') as Record<string, unknown> | undefined) ?? {};
  const charityOn = watch('charity.enabled') === true;
  const charityPct = num(watch('charity.percentage'));
  const rollover = watch('ruleVariations.quarterlyRollover') === true;
  const reverse = watch('ruleVariations.reverseWinners') === true;
  const cost = num(watch('costPerSquare'));

  const total = PERIODS.reduce((sum, p) => sum + num(split[p]), 0);
  const balanced = Math.abs(total - 100) < 1e-9;

  // A full grid, as the payout math sees it.
  const example: PayoutPool = {
    costPerSquare: cost,
    squares: Array.from({ length: 100 }, () => ({ owner: 'x' })),
    payouts: { q1: num(split.q1), half: num(split.half), q3: num(split.q3), final: num(split.final) },
    charity: { enabled: charityOn, percentage: charityPct },
  };
  const pot = squaresPot(example);

  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">Payouts</h3>
      <p className="mb-5 text-sm text-slate-400">How the pot is split between the four quarters, and what happens to a prize nobody wins.</p>

      <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
        <NumberField name="squaresPayouts.q1" label="1st quarter %" min={0} max={100} helpId="squaresPayouts" />
        <NumberField name="squaresPayouts.half" label="Halftime %" min={0} max={100} helpId="squaresPayouts" />
        <NumberField name="squaresPayouts.q3" label="3rd quarter %" min={0} max={100} helpId="squaresPayouts" />
        <NumberField name="squaresPayouts.final" label="Final %" min={0} max={100} helpId="squaresPayouts" />
      </div>
      <p role={balanced ? undefined : 'alert'} className={`mb-5 text-sm font-semibold ${balanced ? 'text-slate-300' : 'text-rose-400'}`}>
        Total: {total}%{balanced ? '' : ' — the four must add up to exactly 100%'}
      </p>

      <div className="mb-5 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
        <CheckboxField name="charity.enabled" label="Give part of the pot to a charity" helpId="charity" />
        {charityOn && (
          <div className="mt-3 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <NumberField name="charity.percentage" label="Share of the pot (%)" min={0} max={100} helpId="charity" />
            <TextField name="charity.name" label="Charity name" placeholder="Local food bank" helpId="charity" />
          </div>
        )}
      </div>

      <div className="mb-5 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
        <CheckboxField name="ruleVariations.reverseWinners" label="Reverse winners — the square with the digits swapped shares each prize" />
        <CheckboxField name="ruleVariations.quarterlyRollover" label="Roll an unsold prize into the next quarter" />
        {rollover && (
          <div className="mt-3">
            <SelectField name="ruleVariations.unclaimedFinalPrizeStrategy" label="If the final square is unsold" options={[
              { value: 'last_winner', label: 'Give it to the last player who won' },
              { value: 'random', label: 'Random draw among the squares that were sold' },
            ]} />
          </div>
        )}
      </div>

      {cost > 0 && balanced && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4" data-testid="squares-payout-example">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">If all 100 squares sell at {money(cost)}</p>
          <p className="text-sm text-slate-200">
            Pot {money(pot.gross)}
            {pot.charity > 0 && <> · charity {money(pot.charity)} · prizes {money(pot.net)}</>}
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-200 sm:grid-cols-4">
            {PERIODS.map((p) => {
              const prize = periodBase(example, p);
              return (
                <li key={p}>
                  <span className="text-slate-400">{PERIOD_SHORT_LABEL[p]}</span>{' '}
                  <span className="font-semibold">{money(prize)}</span>
                  {/* On its own line: four columns are too narrow for "$180 ($90 each)" to sit on one. */}
                  {reverse && prize > 0 && <span className="block text-xs text-slate-400">{money(prize / 2)} each</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
