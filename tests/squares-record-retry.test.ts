import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { retryWhile, isScoresNotSavedYet, SCORES_NOT_SAVED_YET } from '../src/utils/retryWhile';

/**
 * "RECORD WINNERS", PRESSED STRAIGHT AFTER TYPING A SCORE.
 *
 * A typed score is saved by one request and recorded by another. If the second
 * overtakes the first, the server refuses — rightly: it would otherwise record
 * the winner for the score that was there BEFORE the edit. But the page handed
 * that refusal to the commissioner as a red error ("…press Record winners
 * again") in the most ordinary flow there is: type the score, press the button.
 *
 * Found by the end-to-end test written for the reopen, which pressed the button
 * as soon as it could and was refused two runs in three (review log, round W2).
 *
 * The page now waits a moment and asks again, with the SAME scores. That can
 * only succeed once what is stored is what the page shows, so the server's
 * guard is exactly as strict as before.
 */

const notSavedYet = () => Object.assign(new Error('The scores are still being saved. Wait a moment, check the scores shown, and press Record winners again.'), { code: 'functions/failed-precondition' });
const paused = () => Object.assign(new Error('Winner recording is paused by the site administrator. Scores are still being kept; nothing is lost. Try again later.'), { code: 'functions/failed-precondition' });
const noSleep = () => Promise.resolve();

describe('retryWhile', () => {
  it('returns at once when the first attempt works — no waiting', async () => {
    const sleep = vi.fn(noSleep);
    const attempt = vi.fn(async () => 'done');
    await expect(retryWhile(attempt, () => true, { tries: 5, delayMs: 700, sleep })).resolves.toBe('done');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits out a retriable failure and returns what the later attempt gives', async () => {
    const sleep = vi.fn(noSleep);
    const attempt = vi.fn()
      .mockRejectedValueOnce(notSavedYet())
      .mockRejectedValueOnce(notSavedYet())
      .mockResolvedValueOnce({ changed: 1 });
    await expect(retryWhile(attempt, isScoresNotSavedYet, { tries: 5, delayMs: 700, sleep })).resolves.toEqual({ changed: 1 });
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(700);
  });

  it('a failure that is NOT retriable is thrown at once — a pause is not something to wait out', async () => {
    const sleep = vi.fn(noSleep);
    const attempt = vi.fn().mockRejectedValue(paused());
    await expect(retryWhile(attempt, isScoresNotSavedYet, { tries: 5, delayMs: 700, sleep })).rejects.toThrow(/paused by the site administrator/);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the stated number of tries and throws the LAST failure — the commissioner is told in the end', async () => {
    const sleep = vi.fn(noSleep);
    const attempt = vi.fn().mockRejectedValue(notSavedYet());
    await expect(retryWhile(attempt, isScoresNotSavedYet, { tries: 4, delayMs: 700, sleep })).rejects.toThrow(/still being saved/);
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);   // not after the last one
  });

  it('a retriable failure followed by a different one throws the different one, at once', async () => {
    const sleep = vi.fn(noSleep);
    const attempt = vi.fn().mockRejectedValueOnce(notSavedYet()).mockRejectedValueOnce(paused());
    await expect(retryWhile(attempt, isScoresNotSavedYet, { tries: 5, delayMs: 700, sleep })).rejects.toThrow(/paused/);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('never retries without limit, whatever it is told — a nonsense count means ONE try', async () => {
    for (const tries of [0, -3, 0.4, Number.NaN, Number.POSITIVE_INFINITY]) {
      // Fails for a long time, then would succeed: an unbounded loop gets there.
      let calls = 0;
      const attempt = vi.fn(async () => { calls += 1; if (calls < 50) throw notSavedYet(); return 'eventually'; });
      await expect(retryWhile(attempt, isScoresNotSavedYet, { tries, delayMs: 1, sleep: noSleep }), String(tries)).rejects.toThrow(/still being saved/);
      expect(attempt, String(tries)).toHaveBeenCalledTimes(1);
    }
  });

  it('always makes at least one attempt, whatever it is told', async () => {
    for (const tries of [0, -3, 0.4, Number.NaN]) {
      const attempt = vi.fn(async () => 'done');
      await expect(retryWhile(attempt, () => true, { tries, delayMs: 1, sleep: noSleep })).resolves.toBe('done');
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });
});

describe('isScoresNotSavedYet', () => {
  it('recognises that refusal, however it is cased', () => {
    expect(isScoresNotSavedYet(notSavedYet())).toBe(true);
    expect(isScoresNotSavedYet({ message: 'THE SCORES ARE STILL BEING SAVED.' })).toBe(true);
  });

  it('and nothing else', () => {
    for (const e of [paused(), new Error('Pool not found.'), new Error(''), {}, null, undefined, 'The scores are still being saved', { message: 42 }]) {
      expect(isScoresNotSavedYet(e)).toBe(false);
    }
  });
});

describe('the two ends agree on the words', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('the server still says what the page waits on', () => {
    const server = read('functions/src/squaresAdmin.ts');
    const said = server.match(/'(The scores are still being saved[^']*)'/);
    expect(said).not.toBeNull();
    expect(SCORES_NOT_SAVED_YET.test(said![1])).toBe(true);
  });

  it('the manage page waits on that refusal and no other, a few times, with the scores it shows', () => {
    const panel = read('src/components/AdminPanel.tsx');
    expect(panel).toMatch(
      /retryWhile\(\s*\(\) => dbService\.recomputeSquaresWinners\(gameState\.id, \{[\s\S]*?\}\),\s*isScoresNotSavedYet,\s*\{ tries: \d+, delayMs: \d+ \},\s*\)/,
    );
    // One call site for recording by hand, and it is the one that sends the scores.
    expect(panel.match(/dbService\.recomputeSquaresWinners\(gameState\.id, \{/g)).toHaveLength(1);
  });
});
