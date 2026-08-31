/**
 * The Open-a-rain CTA must stay a real route.
 *
 * `href="#create"` resolves against `<base href="/rain/">` as `/rain/#create`,
 * which is the list itself — the button appears to do nothing. A fragment kept
 * people on the list with the form pinned under the table, where opening a
 * rain ended on an empty form rather than on the rain. `/new` is a page. Lock
 * the markup here, and the click in `e2e/rain.pw.ts`.
 *
 * The other half of this file is D3a: Rain is the holder's surface, so no
 * keeper vocabulary may reappear on the front door.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const SOURCE = readFileSync(join(import.meta.dirname, 'rain-page.ts'), 'utf8');

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

describe('Open a rain', () => {
  test('is a rain route, not a hash-only href or a fragment on the list', () => {
    expect(SOURCE).not.toContain('href="#create"');
    expect(SOURCE).not.toContain('fragment="create"');
    expect(SOURCE).toContain('routerLink="/new"');
  });

  test('does not point at the list it is on, which would look like a dead button', () => {
    expect(SOURCE).not.toMatch(/Open a rain[\s\S]{0,120}routerLink="\/"/);
    expect(SOURCE).not.toContain('routerLink="/register"');
  });

  test('the empty-state Open one uses the same rain route', () => {
    expect(SOURCE).toMatch(/Open one[\s\S]{0,80}to start a drip/);
    const empty = SOURCE.slice(SOURCE.indexOf('No rains on this hub yet'));
    expect(empty).toContain('routerLink="/new"');
    expect(empty.slice(0, 400)).not.toContain('href="#create"');
    expect(empty.slice(0, 400)).not.toContain('fragment="create"');
  });

  test('the list does not carry the create form', () => {
    expect(SOURCE).not.toContain('Who it falls on');
    expect(SOURCE).not.toContain('Open this rain');
  });

  test('D3a: the front door shows no keeper machinery', () => {
    // A holder holds an NFT and wants to know whether they are in and what
    // they are owed. Upkeep ids, selectors, escrow runway, catch-up policy and
    // the name of the network that fires the draws are somebody else's product
    // surface.
    for (const word of ['upkeep', 'Upkeep', 'Arcron', 'escrow', 'catch-up', 'registry', 'Registry']) {
      expect(TEMPLATE).not.toContain(word);
    }
    expect(TEMPLATE).not.toMatch(/routerLink="\/u\//);
  });

  test('but the hub app id is still linked, because it is checkable off-site', () => {
    // The one verification a reader can make that this page cannot fake. It is
    // not keeper machinery; it is the identity of the contract holding the pot.
    expect(SOURCE).toContain('kind="app"');
    expect(SOURCE).toContain('deployment.appId');
  });

  test('the whole row is one rain link, not the id and the name separately', () => {
    expect(SOURCE).toContain('class="row-link"');
    expect(SOURCE).toContain("['/r', row.id]");
    expect(SOURCE).not.toContain('(click)="open(row.id, $event)"');
    expect(SOURCE).not.toContain('<a [routerLink]="[\'/r\', row.id]">{{ row.id }}</a>');
    expect(SOURCE).toContain('class="identity"');
    expect(SOURCE).toContain('row.gate');
  });

  test('the state chip lives on Next, not jammed against the id', () => {
    expect(SOURCE).not.toContain('class="id-cell"');
    const next = SOURCE.slice(SOURCE.indexOf('data-label="Next"'));
    expect(next).toContain('chip');
    const identity = SOURCE.slice(SOURCE.indexOf('class="identity"'), SOURCE.indexOf('data-label="Pays"'));
    expect(identity).not.toContain('class="chip"');
  });

  test('an ASA rain shows the asset id on the row', () => {
    expect(SOURCE).toContain('row.prizeId');
    expect(SOURCE).toContain('row.gateId');
    expect(SOURCE).toContain('opt in');
  });

  test('the collection picture is an NFT image, not the mascot', () => {
    expect(SOURCE).toContain('class="thumb"');
    expect(SOURCE).not.toContain('mascot');
    expect(SOURCE).not.toContain('brand/');
  });
});
