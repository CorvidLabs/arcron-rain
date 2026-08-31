# Rain

The page a holder reads: every pot open on the Rain hub, what each one pays,
whether you are in it, and what it owes you.

Angular (standalone components, signals, zoneless) + Bun + algosdk, styled
entirely on the CorvidLabs design system, a private repository vendored here
under `public/brand/`.

Its address is **https://corvidlabs.xyz/rain/**, and `<base href="/rain/">` in
`src/index.html` and `baseHref` in `angular.json` both have to agree with it.

## Rain is the user surface, Arcron is the developer one

That is the decision the whole shape of this directory follows. A Rain reader
holds an NFT and wants to know two things: am I in, and what am I owed. They
must not see a selector, an upkeep id, escrow runway, a catch-up policy, a
reference grade, or the word *Arcron* anywhere in the page. All of that lives
in the keeper console, which is a different product for a different person.

It is pinned in three places, because a convention nothing enforces is a
convention that lasts a month:

- `routes.test.ts` — no route may name an upkeep or a registry.
- `pages/rain-page.test.ts`, `pages/rain-detail-page.test.ts` — the D3a tests
  read each component's **template literal** and refuse the vocabulary. Scoped
  to the template on purpose: the keeper *read* is code and must stay, so
  asserting over the whole file would either fail on `rain.upkeep()` or, once
  loosened to pass, stop checking anything.
- `e2e/rain.pw.ts::noKeeperSurface` — the same words, against the rendered
  text of a real browser. That is the one that catches it arriving from a
  component the page composes rather than owns.

### But Rain is not blind to the keeper

`rain.service.ts` reads exactly one box that is not the hub's: the upkeep on
the keeper app that calls `draw()`. That read is load-bearing, and deleting it
would be a bug rather than a simplification.

`_fire_split` deliberately leaves `last_rain_round` untouched when a rain
cannot pay. So a rain's own box can say "ready, and my cadence elapsed" for
ever while nothing is servicing it — and a page that says **Due** on every
visit for weeks has taught its reader that the word means nothing.

Due is a claim that something is coming. The schedule is the only evidence for
it. So:

```
RainService.standingOf(rain)   // the single copy of the rule
  rain's own standing is not 'due'  ->  that standing
  'due' and the schedule was read   ->  'due'
  'due' and it was not              ->  'waiting'
```

The tiles, the list row and a rain's own page all call it. It lives in the
service rather than in the three of them because a rule copied three times is a
rule that will disagree with itself. The failure it prevents is named in the
docstring, and `rain-detail-page.test.ts` binds to that one copy.

Spoken in Rain's words throughout: *next drop expected around round N*, *the
schedule cannot be read right now*. Never "upkeep 113", never "keeper".

## Running it

```bash
bun install                        # from the repo root; it is a workspace
bun run ng serve                   # http://localhost:4200
bun test                           # decoders, formatting, routes, the D3a rules

bunx playwright install chromium   # once per machine
bunx playwright test               # what the page actually renders
```

It opens on **TestNet**, which is the only chain a hub exists on. LocalNet is a
switch in the developer network picker and renders "Rain lives on TestNet",
which is the honest answer and a state the audit covers.

## Three destinations

| Route | What it is |
|---|---|
| `/` | Every rain on the hub. What it pays, who it falls on, when, and whether you are in. |
| `/new` | Open a rain. Opening one ends on `/r/:id` for the rain just opened. |
| `/r/:id` | One rain: enter, check in, deposit, collect. |

`routes.test.ts` asserts the count, because the count is the decision. The old
console had `rain/new` and `rain/:id`, where declaring them the wrong way round
read "new" as an id and opened rain zero; `new` and `r/:id` share no prefix and
cannot collide however they are ordered.

Because the page routes on the path rather than on a hash, a static host needs
`index.html` as its 404 page or a cold load of `/rain/r/2` will not resolve.

Focus moves to the routed region on every navigation but the first. A router
that does not move focus is a router that breaks screen readers.

## There is no `?app=`, and no quarantine

The keeper console needs one. Its app id is a query parameter, the ABI and box
layout are public, and a look-alike keeper shows the same registry and keeps
whatever is escrowed in it — so a link is the attack, and the console answers
it with a quarantine: a panel, dead money buttons, and an id that is never
remembered.

Rain has no such parameter. The hub id is `TESTNET_RAIN` in
`@corvidlabs/arcron-rain/rain`, a constant compiled into the bundle, and
`RainService.send` builds every transaction against it. There is no URL that
moves this page to another contract, so there is nothing to quarantine — and a
runtime check of our own constant against our own constant would be theatre.

What survives from that thinking is the part that still buys something: the hub
app id is a **link to a block explorer**, in the footer of every page and on
the list and detail pages. Checking it somewhere we do not control is the one
verification a reader can make that this page cannot fake. The residual risk —
a copy of this page at another address pointing at a hostile hub — is answered
by the canonical address above, not by anything the page can do at runtime.

`?network=` survives as a developer control and is read **only in dev mode**,
gated on `established` so that a single `?dev=1&network=localnet` link cannot
both turn dev mode on and point a stranger's page at `http://localhost:4001`.
See `core/dev-mode.ts`.

## How it talks to the chain

- **Reads** are permissionless: pots, tickets and cadences are box state, so
  the whole page works with no wallet connected.
- **Signing** goes through [`@txnlab/use-wallet`](https://github.com/TxnLab/use-wallet):
  Pera, Defly, Lute, Exodus and Kibisis, none of which needs any
  configuration. The generic WalletConnect entry is the only one that wants a
  project id, so it is offered only when `window.__ARCRON__.walletConnectProjectId`
  is set, the same pattern the other CorvidLabs front ends use.
- **On LocalNet**, KMD is offered as a wallet too, so a browser can sign with
  nothing installed. Keys never leave KMD.

## Layout

Everything framework-independent lives one directory up, in `js/`, and this
package consumes it as a workspace dependency. They must share one `algosdk`:
installed separately, both copies end up in the browser bundle, which cost
487 kB and blew the initial budget.

```
../js/src/
  rain.ts            the hub's boxes, modes, gates and standings
  rain-abi.ts        method signatures, checked against the ARC-56 artifact
  rain-txns.ts       enter / gm / deposit / claim / resolve / abandon / create
  vendor.ts          the handful of things copied from CorvidLabs/arcron:
                     ALGO and token formatting, the Signing pair, and the
                     upkeep-box decoder Rain reads the schedule with
src/app/
  routes.ts          the three destinations and the query-parameter policy
  pages/             one component per destination
src/app/core/
  chain.service.ts   which network, which node, what round; no app id at all
  networks.ts        LocalNet/TestNet endpoints, genesis ids, nominal round time
  rain.service.ts    the hub as signals, the holder-facing writes, and standingOf
  dev-mode.ts        whether ?network= is honoured, and why that is a boundary
  wallets.ts         the wallet catalogue (KMD on LocalNet, five public wallets)
  wallet.service.ts  connect/disconnect/sign, use-wallet's store as signals
  nft-media.ts       ARC-19 collection art, from asset params already read
  explorer.ts        block-explorer links, absent on LocalNet by design
  contrast.ts        the WCAG ratio arithmetic the render audit measures with
src/app/components/  network bar, signer bar, stat tiles, create form,
                     activity log, explorer link
e2e/
  page.pw.ts         the rendering audit: 7 page states x 4 viewports x 2 themes
  rain.pw.ts         the click-through, and D3a against the rendered page
  matrix.ts          which widths, which themes, which pages
  chain.ts           a hub that never moves, stubbed at the HTTP boundary
  collect.ts         what the browser is asked for: colours, boxes, line boxes
  audit.ts           measurements in, ranked findings out
  baseline.ts        what is already wrong, and what counts as worse
  baseline.json      each accepted finding, its measurement and why it stands
  report.ts          the consolidated report, and the stale-baseline check
scripts/
  dev.ts             poke rounds on LocalNet
  localnet-txns.ts   drive the transaction builders headlessly against LocalNet
  wallet-kmd-e2e.ts  drive a real transaction through use-wallet, headlessly
  serve-static.ts    serve a built bundle with the single-page fallback
  write-baseline.ts  re-record e2e/baseline.json from the last run
```

## Units and time

Amounts read in **ALGO**; an ASA pot reads in whole tokens scaled by that
asset's own decimals, and reads as *base units of X* until the asset lookup has
said how many that is — the hub is permissionless, so a 6-decimal pot printed
unscaled would overstate itself a millionfold and be a lure. Round counts are
also shown as human time, using the rate measured from the chain, or 2.695
s/round on TestNet before there is enough to measure.

LocalNet runs in dev mode, where a block is produced per transaction rather
than on a timer, so there is no rate to measure: schedules are labelled with
the nominal rate and the header says `nominal`.

## Accessibility

Checked with axe-core and must stay at zero violations:

```bash
cp node_modules/axe-core/axe.min.js public/    # gitignored
bun run ng serve
```

Then in the browser console: `await axe.run(document)`. Check it with rains on
screen and an account connected, not just the empty state.

axe-core is necessary and nowhere near sufficient. It reported zero violations
on a page whose disabled buttons were rendering at 1.02:1, because it does not
resolve a CSS custom property through a cascade and ask what colour a control
ended up. That is what the suite below is for.

## What the page actually renders

`bunx playwright test` (or `fledge run web-render`) builds the page, serves it,
and audits it in a real browser at 390, 768, 1280 and 1920, in both themes,
across every route plus the empty hub, a waiting rain, an ASA rain and a rain
that does not exist. Fifty-six page states, about fifteen seconds including the
build.

It needs nothing running. `e2e/chain.ts` answers algod at the HTTP boundary
with a fixed hub — one rain due, one wave with nobody checked in, one lottery
scheduled, one paying an ASA — and with the single keeper box the schedule is
read from, so the round number never moves and a TestNet outage cannot turn it
red. Everything above that boundary is the real code: algosdk, the poll in
`ChainService`, the ARC-4 box decoders.

The suite builds with `--base-href /` rather than the published `/rain/`,
because it serves the bundle at the root of its own port and a page asking that
server for `/rain/main-*.js` would get the SPA fallback HTML instead of
JavaScript — a blank page every check would then dutifully measure.

It asserts **properties**, not pixels. Diffing screenshots produces a suite
that fails on every legitimate change and teaches people to press "accept";
these are measurements with a name and a number attached:

| rule | what it measures |
| --- | --- |
| `overflow` | `scrollWidth` against `clientWidth`, plus every element reaching past the viewport outside a scroller |
| `contrast` | the WCAG ratio from `getComputedStyle`, for every interactive control **in every state including disabled**, walking up for the real painted background |
| `text-size` | every rendered text node below a 14px floor |
| `touch-target` | controls under 44x44 CSS px at phone widths (WCAG 2.5.5) |
| `clip` | content cut off by an ancestor that hides its overflow |
| `overlap` | two controls that both take clicks in the same place |
| `table-cell` | a `td` the table is not laying out as a cell |

The ratio arithmetic is `src/app/core/contrast.ts`, unit-tested under
`bun test`, so the browser suite and the unit tests share one implementation.

Screenshots and a ranked `findings.md` land in `e2e/__screenshots__/` on every
run, passing or failing, and are attached to failures. They are the part that
catches what no rule thought to look for.

**`e2e/baseline.json`** records what is wrong today and is not being fixed yet,
which is the type scale and the touch targets, each with its measurement and
the reason it stands. A new finding fails the run, a recorded one getting worse
fails the run, and a recorded one that stopped happening fails the run too,
because a licence nothing uses any more is a licence to regress. It lost
twenty-four entries when the keeper console's pages left this site — those were
licences for styles that no longer exist, not fixes. Regenerate with
`bun run scripts/write-baseline.ts`, and only after reading what changed.
