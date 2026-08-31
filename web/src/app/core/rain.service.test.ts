/**
 * What the activity log says you just did.
 *
 * Both of these are bugs a real person hit within minutes of the page going
 * up. They entered two rains, and the log printed the same sentence twice
 * with nothing naming which rain — so two correct transactions looked like
 * one action charged twice. And the sentence itself, "You stay in every drop
 * after this", is only true in two of the three modes.
 */

import { describe, expect, test } from 'bun:test';

import { ONE, SPLIT, WAVE } from '@corvidlabs/arcron-rain/rain';
import { enteredMessage, nameOf } from './rain.service';

const named = (mode: bigint) => ({ id: 2n, label: 'Corvid GM', mode });
const unnamed = (mode: bigint) => ({ id: 7n, label: '', mode });

describe('nameOf', () => {
  test('prefers the label', () => {
    expect(nameOf(named(SPLIT))).toBe('Corvid GM');
  });

  test('falls back to the number, because a rain need not be labelled', () => {
    expect(nameOf(unnamed(SPLIT))).toBe('rain #7');
  });
});

describe('enteredMessage', () => {
  test('names the rain, so two entries are not one sentence twice', () => {
    expect(enteredMessage(named(SPLIT))).toContain('Corvid GM');
    expect(enteredMessage(unnamed(SPLIT))).toContain('rain #7');
  });

  test('SPLIT: the ticket is standing, and says so', () => {
    expect(enteredMessage(named(SPLIT))).toContain('every drop from now on');
  });

  test('ONE: the same, because a ONE ticket also persists', () => {
    expect(enteredMessage(named(ONE))).toContain('every drop from now on');
  });

  test('WAVE: does NOT promise every drop', () => {
    // `_fire_wave` pays `wave_count`, which `gm` increments and every fire
    // resets to zero. A holder who enters a WAVE rain and then waits is in no
    // drop at all, so the SPLIT wording is money the page cannot deliver.
    const message = enteredMessage(named(WAVE));
    expect(message).not.toContain('every drop from now on');
    expect(message).toContain('I am here');
  });

  test('the three modes do not all say the same thing', () => {
    const split = enteredMessage(named(SPLIT));
    const wave = enteredMessage(named(WAVE));
    expect(split).not.toBe(wave);
  });
});
