/**
 * Three destinations: the rains, opening one, and one rain.
 *
 * Bound to the array the application boots with, so a route added for a
 * keeper-facing surface fails here rather than shipping. Rain is the user
 * surface; anything about upkeeps, selectors or escrow belongs to a different
 * site.
 */

import { describe, expect, test } from 'bun:test';

import { routerOptions, routes } from './routes';

describe('the site has three destinations', () => {
    test('exactly the rains, opening a rain, and one rain', () => {
        expect(routes.filter((route) => route.path !== '**').map((route) => route.path)).toEqual([
            '',
            'new',
            'r/:id',
        ]);
    });

    test('opening a rain shares no prefix with a rain id, so order cannot break it', () => {
        // The old console had `rain/new` and `rain/:id`, where declaring them
        // the wrong way round read "new" as an id and opened rain zero. With
        // the list at the root these are `new` and `r/:id`, which cannot
        // collide however they are ordered.
        const paths = routes.map((route) => route.path);
        expect(paths).toContain('new');
        expect(paths).toContain('r/:id');
        expect(paths.filter((path) => path?.startsWith('r/'))).toEqual(['r/:id']);
    });

    test('every one of them loads a component', () => {
        for (const route of routes) {
            if (route.path === '**') continue;
            expect(typeof route.loadComponent).toBe('function');
        }
    });

    test('the root matches only the empty path, so `/new` is not swallowed', () => {
        expect(routes.find((route) => route.path === '')?.pathMatch).toBe('full');
    });

    test('an unknown path falls back to the rains rather than a blank page', () => {
        const wildcard = routes.at(-1);
        expect(wildcard?.path).toBe('**');
        expect(wildcard?.redirectTo).toBe('');
    });

    test('each destination sets a title, so a tab and a back button are readable', () => {
        for (const route of routes) {
            if (route.path === '**') continue;
            expect(typeof route.title).toBe('string');
        }
    });

    test('no route names an upkeep, a registry or a register form', () => {
        // D3a: Rain is the holder's surface. A keeper page reachable from here
        // is the failure, not a missing feature.
        for (const route of routes) {
            expect(route.path ?? '').not.toMatch(/upkeep|registr|^u\//);
            expect(String(route.title ?? '')).not.toMatch(/[Uu]pkeep|[Aa]rcron|[Rr]egistry/);
        }
    });
});

describe('developer state survives navigation', () => {
    test('the router preserves the query string by default, so no link has to remember', () => {
        // `?dev=1` and `?network=` are the only parameters this site reads, and
        // both describe the visit rather than the page. Without this, following
        // any link inside the site silently drops back to the published
        // deployment mid-session.
        //
        // Asserted against the object `app.config.ts` hands to
        // `withRouterConfig`. Booting the router itself would need the JIT
        // compiler, which this test runner does not carry.
        expect(routerOptions.defaultQueryParamsHandling).toBe('preserve');
    });
});
