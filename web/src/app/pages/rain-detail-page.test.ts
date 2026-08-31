/**
 * A rain's own page must return to the list of rains, and must not leak the
 * keeper surface that fires it (D3a).
 *
 * The underlying read of the keeper's schedule stays — it is the only thing
 * that can tell "this rain is due" from "this rain is due and something is
 * coming" — but it is spoken in Rain's words and never named.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { ONE, SPLIT, rainStanding, scheduleServes, waitingReason } from '@corvidlabs/arcron-rain/rain';
import { decodeUpkeep } from '@corvidlabs/arcron-rain/vendor';

const SOURCE = readFileSync(join(import.meta.dirname, 'rain-detail-page.ts'), 'utf8');
const SERVICE = readFileSync(join(import.meta.dirname, '../core/rain.service.ts'), 'utf8');

/**
 * What the reader actually sees: the component's template literal.
 *
 * Scoped to the template on purpose. The keeper read is code and must stay —
 * asserting over the whole file would either fail on `rain.upkeep()` or, if
 * loosened to pass, stop checking anything. The rule is not "never mention the
 * keeper", it is "never show it".
 */
function template(source: string): string {
  const open = source.indexOf('`', source.indexOf('template:'));
  return source.slice(open + 1, source.indexOf('`', open + 1));
}

const TEMPLATE = template(SOURCE);

/**
 * A keeper upkeep box, written by offset rather than built from the decoder's
 * constants: a fixture generated from the table it is checked against would
 * cancel out a wrong offset and prove nothing. 130-byte ARC-4 head, then an
 * empty `byte[][]` tail.
 */
function upkeepBox(fields: { targetApp?: bigint; feePerExecution?: bigint; balance?: bigint }): Uint8Array {
  const raw = new Uint8Array(132);
  const view = new DataView(raw.buffer);
  view.setBigUint64(32, fields.targetApp ?? 770_746_178n);
  view.setUint16(40, 130);
  view.setBigUint64(42, 1_286n);
  view.setBigUint64(50, 55_400_000n);
  view.setBigUint64(58, fields.feePerExecution ?? 10_000n);
  view.setBigUint64(66, fields.balance ?? 604_000n);
  return raw;
}

describe('a rain detail', () => {
  test('Back to rains is the list of rains', () => {
    expect(SOURCE).toContain('Back to rains');
    expect(SOURCE).toMatch(/routerLink="\/"[\s\S]{0,40}Back to rains/);
    expect(SOURCE).not.toContain('routerLink="/register"');
  });

  test('a rain that is not here sends people to the list', () => {
    expect(SOURCE).toContain('See what is open');
    expect(SOURCE).toContain('No rain {{ id() }} on this hub.');
  });

  test('D3a: the keeper is read but never named', () => {
    // The read: `cadenceHint` consults the schedule to name the round the next
    // drop is expected around.
    expect(SOURCE).toContain('rain.upkeep()');
    expect(SOURCE).toContain('roundsUntilDue');
    // The words: none of it reaches the reader.
    for (const word of ['Arcron', 'upkeep', 'Upkeep', 'draw()uint64', 'escrow', 'catch-up', 'keeper', 'Keeper']) {
      expect(TEMPLATE).not.toContain(word);
    }
    expect(TEMPLATE).not.toMatch(/routerLink="\/u\//);
  });

  test('an unreadable schedule reads as waiting, never as due', () => {
    // `_fire_split` leaves `last_rain_round` untouched when a rain cannot pay,
    // so a rain's own due-ness is satisfied for ever by a rain nothing is
    // servicing. Due is a promise; without the schedule there is no evidence
    // for it.
    //
    // Asserted against `RainService.standingOf`, which is the single copy of
    // the rule. The tiles, the list row and this page all call it — bound here
    // rather than in three places so the invariant cannot be half-reverted.
    expect(SERVICE).toContain('standingOf(rain: RainRec): RainStanding');
    expect(SERVICE).toMatch(/if \(own !== 'due'\) return own;/);
    expect(SERVICE).toMatch(/this\.upkeep\(\) === null \? 'waiting' : 'due'/);
    // And this page names it rather than recomputing it.
    expect(SOURCE).toContain('this.rain.standingOf(state)');
    expect(SOURCE).not.toContain('rainStanding(');
    expect(SOURCE).toContain('next drop expected around round');
  });

  test('a starved schedule is not a schedule, and the read fails closed', () => {
    // The keeper asserts `balance >= fee_per_execution` on every execution, and
    // there is no status flag in the struct — a starved upkeep is byte-for-byte
    // an ordinary one. So the page named an expected round for a schedule that
    // reverts on every call. Caught in `readUpkeep` rather than at the render,
    // because "escrow" is not a word a Rain reader may be shown (D3a).
    const hub = { appId: 770_746_178 };
    const starved = decodeUpkeep(113n, upkeepBox({ balance: 9_999n }));
    expect(starved.balance).toBe(9_999n);
    expect(scheduleServes(starved, hub)).toBe(false);

    // Exactly its own fee is still a schedule: the keeper's assert is `>=`.
    expect(scheduleServes(decodeUpkeep(113n, upkeepBox({ balance: 10_000n })), hub)).toBe(true);
    // And one aimed at another app, which decodes just as cleanly.
    expect(scheduleServes(decodeUpkeep(113n, upkeepBox({ targetApp: 1n })), hub)).toBe(false);

    // Null is what `readUpkeep` hands back, and `standingOf` already turns null
    // into "waiting"; this is the wiring that connects the two.
    expect(SERVICE).toContain('scheduleServes(upkeep, deployment) ? upkeep : null');
  });

  test('a ONE rain waiting on a person may not promise a round', () => {
    // `_fire_one` returns on a locked prize before it writes `last_rain_round`,
    // so this rain is past its cadence for ever. The page renders the
    // Resolve/Abandon row and the Schedule panel together; before this, it held
    // both facts and published the wrong one.
    const locked = {
      mode: ONE,
      tickets: 5n,
      waveCount: 0n,
      pot: 1_000_000n,
      drip: 50_000n,
      lastShare: 0n,
      waveUnclaimed: 0n,
      prizeLocked: 50_000n,
      lastRainRound: 100n,
      intervalRounds: 10n,
    };
    expect(rainStanding(locked, 1_000n)).toBe('waiting');
    expect(waitingReason(locked)).toBe('the last drop is still being resolved');
    // Unlocked, the same rain is due — the lock is the whole difference.
    expect(rainStanding({ ...locked, prizeLocked: 0n }, 1_000n)).toBe('due');
    // The page reaches the sentence through `waitingHint`, not a fourth rule.
    expect(SOURCE).toContain('this.rain.waitingHint(state)');
    expect(SERVICE).toContain('const reason = waitingReason(rain);');
  });

  test('a drop too small to divide is waiting, not due for ever', () => {
    // `_fire_split` and `_fire_wave` compute `drip // count` and return when it
    // is zero, again without writing `last_rain_round`. Realistic for a
    // 0-decimal ASA prize, and tickets only grow, so it is permanent.
    const tiny = {
      mode: SPLIT,
      tickets: 5n,
      waveCount: 0n,
      pot: 1_000n,
      drip: 3n,
      lastShare: 0n,
      waveUnclaimed: 0n,
      prizeLocked: 0n,
      lastRainRound: 100n,
      intervalRounds: 10n,
    };
    expect(rainStanding(tiny, 1_000n)).toBe('waiting');
    expect(waitingReason(tiny)).toBe('each drop is too small to split between everyone in');
  });

  test('WAVE and SPLIT facts both live here', () => {
    expect(SOURCE).toContain('This drop');
    expect(SOURCE).toContain('Enter this rain');
    expect(SOURCE).toContain('I am here');
    expect(SOURCE).toContain('What anyone can do here');
  });

  test('the prize ASA id is on the page so people can opt in', () => {
    expect(SOURCE).toContain('<h3>Prize</h3>');
    expect(SOURCE).toContain('kind="asset"');
    expect(SOURCE).toContain('state.prizeAsset.toString()');
    expect(SOURCE).toContain('Opt in to');
    expect(SOURCE).toContain('Connect to opt in to ASA');
    expect(SOURCE).toContain('ticket box');
  });

  test('a gated rain names the collection token, not the mascot', () => {
    expect(SOURCE).toContain('Who can enter');
    expect(SOURCE).toContain('gateAssetId');
    expect(SOURCE).not.toContain('mascot');
  });
});
