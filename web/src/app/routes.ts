/**
 * Three destinations: the rains, one rain, and opening one.
 *
 * Rain is the whole site now, so the list is the root rather than a section of
 * somebody else's console. That removes the trap the old `rain/new` before
 * `rain/:id` ordering existed to dodge — "new" and "r/5" no longer share a
 * prefix, so no declaration order can make opening a rain resolve as rain
 * zero.
 *
 * Ids are short on purpose: under `<base href="/rain/">` a rain reads as
 * `/rain/r/2`, not `/rain/rain/2`.
 */

import type { RouterConfigOptions, Routes } from '@angular/router';

/**
 * `?dev=1` and `?network=` are developer state that belongs to the visit
 * rather than to any one page, so every link carries them without having to
 * remember. A holder's URL has no query string at all: the hub id is a
 * constant, not a parameter, so there is nothing else to preserve.
 *
 * Declared here rather than inline in `app.config.ts` so it can be asserted
 * without booting Angular; `app.config.ts` passes exactly this object to
 * `withRouterConfig`.
 */
export const routerOptions: RouterConfigOptions = {
  defaultQueryParamsHandling: 'preserve',
};

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Rain',
    loadComponent: () => import('./pages/rain-page').then((module) => module.RainPage),
  },
  {
    path: 'new',
    title: 'Open a rain · Rain',
    loadComponent: () => import('./pages/rain-create-page').then((module) => module.RainCreatePage),
  },
  {
    path: 'r/:id',
    title: 'A rain · Rain',
    loadComponent: () => import('./pages/rain-detail-page').then((module) => module.RainDetailPage),
  },
  // A mistyped path is not a reason to show a blank page, and Angular carries
  // the query string through a redirect.
  { path: '**', redirectTo: '' },
];
