/**
 * What gets audited: which widths, which themes, which pages.
 *
 * Its own module because two things need it. `audit.ts` walks it to declare
 * the tests, and `report.ts` needs its size to know whether a run covered
 * everything: the stale-baseline check is only meaningful over a full run, and
 * firing it after `--grep` would make filtering unusable.
 */

import { type Page } from '@playwright/test';

import type { AlgodStubOptions } from './chain';

export interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/**
 * A phone, a tablet, a laptop and a large desktop. The two ends are the ones
 * that matter: 390 is where "isn't mobile responsive" is decided, and 1920 is
 * where "doesn't use the full screen" is.
 */
export const VIEWPORTS: readonly Viewport[] = [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];

/**
 * Both, always. The bug that started this suite was theme-dependent in one
 * direction and, once measured, turned out to be broken in the other too.
 * `?theme=` is the design system's own override, so this drives the page
 * exactly the way a QA screenshot link does.
 */
export const THEMES = ['light', 'dark'] as const;

export interface Scenario {
  readonly name: string;
  readonly path: string;
  /**
   * How the chain is stubbed for this one page.
   *
   * A state that never renders is a state the suite never audits, and the
   * empty hub is the state a fresh deployment is in — the only place the empty
   * copy and its "Open one" link exist at all.
   */
  readonly stub?: AlgodStubOptions;
  /** Anything that has to happen after the first read lands. */
  readonly settle?: (page: Page) => Promise<void>;
}

/**
 * Every destination, plus the one state that only exists inside one: a hub
 * with no rains on it, which is what a fresh deployment looks like and the
 * only place the empty state and its "Open one" link render.
 *
 * There is no `?app=` here and there must not be one. The hub id is a constant
 * in the client, so a path is the whole address of a page.
 */
export const SCENARIOS: readonly Scenario[] = [
  { name: 'rains', path: '/' },
  { name: 'rains-empty', path: '/', stub: { emptyRains: true } },
  // One of each mode, because they draw different rows and different pages:
  // 1 splits and is due, 2 is a wave with nobody checked in, 4 pays an ASA.
  { name: 'rain-split', path: '/r/1' },
  { name: 'rain-wave', path: '/r/2' },
  { name: 'rain-asa', path: '/r/4' },
  { name: 'rain-missing', path: '/r/99' },
  { name: 'open-a-rain', path: '/new' },
];

export const MATRIX_SIZE = VIEWPORTS.length * THEMES.length * SCENARIOS.length;
