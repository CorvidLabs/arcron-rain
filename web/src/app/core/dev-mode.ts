/**
 * Whether this page is being driven by someone developing it.
 *
 * Rain has two audiences with opposite needs. A holder arriving at the
 * published address wants one hub, the real one, with nothing to configure and
 * nothing to get wrong. Somebody working on the page wants to point it at
 * LocalNet and see what a chain with no hub on it renders as.
 *
 * Serving both from the same controls is what created the only attack the
 * keeper console this page was forked from ever had: a link carrying a chain
 * or an app id pointed a stranger somewhere the page could not vouch for. Not
 * honouring the parameter at all removes it, so `?network=` is read only in
 * dev mode. (Rain has no `?app=` at all: the hub id is a constant in the
 * client, so there is no parameter for a link to poison.)
 *
 * Enabling and redirecting are deliberately separated. `?dev=1` is a public
 * query parameter, so a single link of the form `?dev=1&network=localnet`
 * would otherwise turn dev mode on and re-arm `?network=` in the same
 * navigation, pointing a stranger at `http://localhost:4001` — and the flag
 * persists, so a later and much more innocent-looking link stays honoured on
 * that browser. `established` reports whether dev mode was on *before* this
 * navigation, which is what `?network=` requires. A developer who already has
 * it on is unaffected; the single-link attack needs both halves at once and no
 * longer gets them.
 */

/** Query parameter that turns on the developer controls: `?dev=1`. */
export const DEV_PARAM = 'dev';

/**
 * Where the flag is kept once set, so it survives navigation.
 *
 * Namespaced to rain rather than to arcron because localStorage is per origin,
 * and this page and the keeper console are meant to be served from the same
 * host under different paths. Sharing a key would let turning dev mode on in
 * one turn it on in the other.
 */
export const DEV_STORAGE_KEY = 'rain.dev';

/** The subset of `Storage` this module needs, so a test can supply its own. */
export type DevStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Whether developer controls are on.
 *
 * `?dev=1` turns it on and is remembered; `?dev=0` turns it off and forgets.
 * Anything else falls back to what was remembered.
 *
 * Reading and writing storage is wrapped because a browser with site data
 * blocked throws on access rather than returning null, and a page that cannot
 * open in a private window is worse than one without dev mode.
 */
export interface DevModeState {
    /** Whether developer controls are on at all. */
    readonly enabled: boolean;
    /**
     * Whether dev mode was already on before this navigation.
     *
     * `?network=` requires this rather than `enabled`, so that a single link
     * cannot both turn dev mode on and move the page to another chain.
     */
    readonly established: boolean;
}

export function devModeFrom(search: string, storage: DevStorage | null): DevModeState {
    const requested = new URLSearchParams(search).get(DEV_PARAM);

    let remembered = false;
    try {
        remembered = storage?.getItem(DEV_STORAGE_KEY) === '1';
    } catch {
        // A browser blocking site data throws rather than returning null. Not
        // remembering is survivable; not opening is not.
    }

    if (requested === '1' || requested === 'true') {
        try {
            storage?.setItem(DEV_STORAGE_KEY, '1');
        } catch {
            // As above.
        }
        // `established` stays false when this navigation is what turned it on,
        // which is exactly the case `?dev=1&network=localnet` relies on.
        return { enabled: true, established: remembered };
    }

    if (requested === '0' || requested === 'false') {
        try {
            storage?.removeItem(DEV_STORAGE_KEY);
        } catch {
            // As above.
        }
        return { enabled: false, established: false };
    }

    return { enabled: remembered, established: remembered };
}
