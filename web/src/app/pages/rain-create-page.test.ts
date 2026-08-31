/**
 * Opening a rain is its own page, and it leaves for the rain it opened.
 *
 * Pinned under the list it ended on itself: the form succeeded and left you
 * looking at an empty form.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const PAGE = readFileSync(join(import.meta.dirname, 'rain-create-page.ts'), 'utf8');
const FORM = readFileSync(join(import.meta.dirname, '../components/rain-create-form.ts'), 'utf8');

describe('open a rain', () => {
  test('Back to rains is the list of rains', () => {
    expect(PAGE).toContain('Back to rains');
    expect(PAGE).toMatch(/routerLink="\/"[\s\S]{0,40}Back to rains/);
    expect(PAGE).not.toContain('routerLink="/register"');
  });

  test('succeeding leaves for the rain, not back to an empty form', () => {
    expect(PAGE).toContain("navigate(['/r', String(id)])");
  });

  test('the form is a rain, not an upkeep', () => {
    expect(FORM).toContain('Who it falls on');
    expect(FORM).toContain('Open this rain');
    for (const source of [PAGE, FORM]) {
      expect(source).not.toContain('Register an upkeep');
      expect(source).not.toContain('Arcron');
      expect(source).not.toContain('upkeep');
    }
  });
});
