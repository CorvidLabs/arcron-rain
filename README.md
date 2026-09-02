# arcron-rain

[![CI](https://github.com/CorvidLabs/arcron-rain/actions/workflows/ci.yml/badge.svg)](https://github.com/CorvidLabs/arcron-rain/actions/workflows/ci.yml)

**Rain** is a pot that pays out on a schedule, on Algorand. You fill it once,
say how much should leave it each interval and who is allowed in, and it keeps
dripping without anybody tending it. By
[CorvidLabs](https://github.com/CorvidLabs), built with Algorand Python (Puya)
and AlgoKit.

This is Discord rain, on chain. People show up, and a drop goes to the people
who showed up. It is not a jackpot of the whole pot: `drip` is what falls, the
pot survives the payout, and the same rain can fall every day for as long as
somebody keeps filling it.

One app is a **hub** holding many rains. Each rain is a box, and opening one is
permissionless: any NFT collection as the gate, ALGO or any ASA as the prize,
any drip, any interval, and one of three ways it falls. CorvidLabs uses the
same hub as everybody else, with no more authority on it than a stranger.

> [!WARNING]
> **Unaudited, TestNet only, and immutable.** No third party has reviewed this
> contract. The hub declares no update and no delete handler — every method is
> `NoOp`-only, which you can check for yourself in
> `smart_contracts/artifacts/rain/Rain.arc56.json` — so a deployed hub cannot
> be patched by anyone, including us. That is a real guarantee and a real
> hazard in the same sentence: nobody can change the rules under your pot, and
> nobody can fix a bug in it either. The only remedy for a bad hub is a new hub
> that everyone re-enters by hand.
>
> Put nothing on it you would mind losing.

## The live hub

| | |
|---|---|
| TestNet hub | **770746178** |
| Page | <https://corvidlabs.xyz/rain/> |
| Woken by | a keeper network, hourly — see [Who calls it](#who-calls-it-and-why-you-never-have-to-care). Concretely, Arcron upkeep **113** on keeper app 769891898 |
| Deployed from | commit `81aaefb`, 2026-08-30 22:35 −0600. The app was created two minutes earlier, at round 66,837,443. `smart_contracts/rain/contract.py` has not changed since, which is why `verify_build` still matches from HEAD — but HEAD is not the deploy commit, and `verify_build` prints HEAD |
| Approval program | 4,971 bytes, combined sha256 `ecebeca3f32cb0ebc913ff40b04650453618d1214079027fecb4c78f361d6db3` |

Because the hub can never be updated, "the code you can read is the code that
is running" is the only trust story it has — and that claim is worth nothing
unless somebody who does not trust us can check it. So check it:

```bash
poetry run python -m scripts.verify_build --network testnet --contract rain --app-id 770746178
```

It rebuilds from this working tree, fetches what algod reports for that app id,
and compares the compiled bytecode — not the source text, which comments and
formatting do not survive. On 2026-08-31 it printed
`✔ The deployed app is this source, byte for byte.` **Run it rather than
believe this README.** Read the answer narrowly: it proves the deployed
programs are the ones this tree compiles to, and nothing about who created the
app or whether this tree is the tag you think it is.

### Nothing has fallen from it yet

Read from the chain at round 66,860,306 on 2026-08-31, the hub holds two
rains — a daily SPLIT one for everyone in, and a GM (WAVE) one for whoever
checks in — both gated to the Corvid TestNet collection, and **zero tickets
between them**. Only one of the two is even funded: the daily rain's pot is
100,000 µALGO against a 50,000 drip, and the GM rain's pot is **0**, so
`_fire_wave` would return on `pot < paid` even with a full wave. The app
account holds 391,400 µALGO against a 291,400 minimum for its floor and two
rain boxes, and the 100,000 µALGO of that which is free is exactly that one
pot: nothing else has ever been deposited. No drop has been credited, no
`claim` has run, no ONE draw has been resolved.

Upkeep 113's counter said 16 executions at that round, and it rises every hour,
so treat any number here as a floor. Every one of those calls correctly did
nothing: a rain with no tickets is a rain with nobody to pay.

**The upkeep escrow is nearly out.** At that round upkeep 113 held 16,000 µALGO
against a 4,000 µALGO fee — four more hourly firings, about four hours. When it
empties, no keeper is paid, nothing fires the hub, and any rain on it goes
quiet until somebody tops the upkeep up. If you open a rain here, check that
first.

That is the honest state: the contract is deployed, verified and scheduled, and
nobody has used it. Everything below about how a drop behaves in practice rests
on LocalNet demos and on the previous hub, not on this one.

## Three ways a rain falls

Picked once, when the rain is created, and never changed afterwards. The page
calls them by what they do; the contract calls them by number.

| Mode | On the page | You do this | Each drop goes to |
|---|---|---|---|
| SPLIT (0) | **Everyone** | take a ticket once | everybody holding a ticket, in equal shares |
| ONE (1) | **One person** | take a ticket once | one ticket, picked by a block seed nobody chose |
| WAVE (2) | **Who shows up** | take a ticket, then check in each interval | the first `wave_cap` people who checked in |

SPLIT is fill-and-forget. Put a billion of a token in the pot, drip ten
thousand a day, and stop thinking about it — the cost of a drop does not grow
with the number of holders, because it moves one accumulator rather than
writing to every ticket. Enter late and you collect the drops that fall after
you, and none of the ones before.

WAVE is the Discord shape: being in the room during the interval is what earns
the drop. You still take a ticket once; `gm` is the check-in on top of it, and
only the first `wave_cap` people each interval are in. Shares nobody came back
for return to the pot at the next drop.

ONE is a draw, and it is the only mode that takes two calls instead of one. See
[The randomness is not free](#the-randomness-is-not-free).

Whatever the mode, a drop is **credited**, not sent. You pull it with `claim`
whenever you like, which is why nobody has to be online at the moment a rain
falls.

## Who calls it, and why you never have to care

A smart contract cannot wake itself. There is no on-chain timer on Algorand, or
anywhere else; every "this happened at midnight" is a transaction somebody
sent. So a rain needs somebody to poke it.

That somebody is [**Arcron**](https://github.com/CorvidLabs/arcron), a
permissionless keeper network. One upkeep is registered against this hub's
`draw()` method with a cadence and a fee escrowed in ALGO, and after that any
account at all may execute it and collect the fee. Keepers compete for the
money; nobody is in charge; the hub does not know or care which account called
it.

**A person using a rain never touches any of this.** They enter, and later they
claim. The schedule is somebody else's job, and it is paid for out of the
upkeep's escrow rather than out of the pot. If you open a rain on the live hub,
upkeep 113 already fires it — **but check that it still has escrow**, because
when the escrow runs out no keeper is paid and nothing fires the hub at all.
It was down to about four hours of runway on 2026-08-31. If you deploy a hub of
your own, you register exactly one upkeep, once, and keeping it funded is
yours.

A ONE rain needs a second call that no keeper makes; see
[The randomness is not free](#the-randomness-is-not-free).

The dependency runs one way and must stay that way: **Rain depends on Arcron;
Arcron must never depend on Rain.** A keeper network with a favourite
application is not permissionless.

## Money is pulled, never pushed

`draw` is the call Arcron makes. It takes no arguments, walks a few rain boxes,
credits the ones that are due, and returns — including when there is nothing to
do. It moves no money and makes no inner call.

That is not tidiness. A scheduled call reaches only what the keeper's own
transaction made available to it, and a payment to an account that had closed
or opted out of the prize asset would fail the whole execution — stalling the
schedule for every other rain in the hub, because one recipient left. So `draw`
does accounting only, and the party who wants the money is the party who asks
for it.

```
bootstrap()            creator funds the app's own floor, once
opt_in_prize_asset()   anyone lets the hub hold one ASA, so rains can pay in it
create_rain()          anyone opens a rain: gate, prize, drip, interval, mode
set_rain()             that rain's creator retunes its drip and interval
enter()                one ticket per account per rain
gm()                   WAVE check-in, first wave_cap this interval
deposit()              anyone tops the pot up (deposit_asset for an ASA)
draw()                 ZERO ARGS. The Arcron hook. Fires due rains, moves nothing.
resolve()              ONE: read the committed round's seed, credit a winner
abandon()              ONE: the seed window closed; return the locked prize
claim()                pull what you are owed
```

Each rain also enforces its own `interval_rounds`, so an extra `draw` from a
stranger is a no-op rather than a way to drain a pot. Arcron fires the hook;
the rain decides whether anything falls.

The hub takes nothing. There is no protocol fee, no rake, and no owner
withdrawal. Past `bootstrap`, the app's creator has no more authority than
anyone else.

### The randomness is not free

A ONE draw cannot pick a winner in the same call that opens it: a transaction
cannot see a random number that did not exist when it was sent. So `draw` locks
the drip and names a round eight ahead, and a later `resolve` reads that
round's block seed and credits whoever it lands on.

Three consequences worth knowing before you choose ONE:

- Somebody has to send that `resolve`, and **today nobody does, including us**.
  `scripts/rain_bot.py` is a scan that sends nothing: its `scan_once` reads
  global state, logs one `idle` line and returns. Its `should_resolve` and
  `should_abandon` are dead code nothing calls, and it is written against the
  superseded single-rain contract — it looks for globals the hub does not keep,
  builds ticket box names the hub does not use, and carries a 1,000-round
  beacon window against the contract's `SEED_WINDOW = 800`. Repointing or
  retiring it is an open task in `specs/rain/tasks.md`. Until then, on any
  rain — ours or yours — that somebody is you, by hand or by a script you
  write.
- A block seed stays readable for only about a thousand rounds, and the hub
  gives itself 800. Past that the draw can never be resolved, and `abandon`
  returns the locked drip to the pot instead. **Nothing else can unstick it**:
  a ONE rain with an open draw fires nothing further until one of the two runs.
- Entry is refused while a draw is open. Once the committed round is mined its
  seed is public, and a batch of tickets bought against a known seed could be
  sized to catch the modulo, so the set the winner is drawn from freezes at the
  moment of the fire — eight rounds before the seed exists.

A block proposer can influence a seed. That trade is deliberate and bounded: it
is the right source of randomness for a drip and the wrong one for a jackpot.
`smart_contracts/beacon_stub/` is kept, referenced by nothing, so the trip back
to a randomness beacon stays testable if a pot ever grows worth aiming at.

## What is wrong with it

None of this is theoretical, and none of it is fixable on a deployed hub.

**The gate gives no Sybil resistance, and it is not staking.** A gated rain
asks whether the sender holds a token from the collection at `enter`, again at
`claim` when there is something to pay, and — on a WAVE rain only — at every
`gm` check-in. Every one of those is a point-in-time balance read: nothing is
locked, nothing is at risk, and re-checking a snapshot more often does not make
it a stake. One NFT can therefore walk through the gate from as many wallets as
you care to fund, passing it back between them if a WAVE rain asks again. Per
extra identity: 0.0285 ALGO of ticket box minimum that never comes back (0.0506
on a ONE rain), plus 0.1 ALGO of account minimum and 0.1 of asset minimum for
the opt-in to hold the gate NFT — both of which you recover when you close the
wallet — plus fees. So about **0.23 ALGO tied up and about 0.03 actually
spent**, per identity. Design a rain around "one share per holder" and you have
designed it around something the contract does not enforce. The same snapshot
cuts the other way: someone can enter with a borrowed NFT, sell it, and hold
credit they can never claim.

**A popular SPLIT rain divides to zero and stops, silently.** `share = drip //
tickets` is integer division, and tickets only ever accumulate — there is no
`leave`. Once the ticket count passes the drip, every share rounds to zero, the
contract declines the drop, and it declines it *without touching*
`last_rain_round`, so the rain reads as due for ever while paying nothing. The
only cure is the creator raising the drip with `set_rain`, and `set_rain` has
no builder in `js/` and no button on the page: today it can only be sent from a
script. A rain whose creator has walked away is dead, and it will go on
advertising itself as due.

**There is no way to delete a rain, and `draw` only scans four.** `DRAW_SCAN`
is 4, so a hub of N rains gives each one a visit every ⌈N/4⌉ calls of the
upkeep. Nothing removes a rain box — not its creator, not us — so every
abandoned, empty or joke rain anybody ever opens permanently lengthens the gap
between visits for everybody else. Nothing rate-limits `create_rain` beyond its
95,700 µALGO box minimum.

**`opt_in_prize_asset` has no unit test at all.** `tests/test_rain.py` opts the
hub into a prize by patching holdings directly, so the method never runs there.
It is the one method carrying real money-safety assertions — it refuses an
asset with a clawback, freeze or manager address, or one frozen by default,
which is what stops an issuer clawing a pot back out from under the people who
entered for it — and not one of those four refusals is exercised by anything.
Only the happy path has ever run: once on the previous hub, and in
`fledge run smoke-community-rain` on LocalNet.

**`abandon` has never run on this hub.** It gained a transaction builder in
`js/` and a button on the page on 2026-08-31, having spent the contract's whole
life before that with no way to send it — so a stalled ONE rain was stalled for
good. It has executed exactly once on chain, on the previous hub, at round
66,801,521. On hub 770746178 it is untried outside the unit tests, and the unit
tests run against a mock.

**The unit tests cannot see money move.** `algorand-python-testing` records
inner transactions rather than executing them, and enforces no minimum
balances. So no test in `tests/` shows ALGO or an ASA actually arriving
anywhere, or the app account actually affording its boxes. Those claims are
settled by `fledge run smoke-rain` and `fledge run smoke-community-rain` on
LocalNet, and by `fledge run rain-one-draw` on TestNet, and nowhere else.

`specs/rain/tasks.md` keeps the fuller list of untested paths, including the
rekey and close-remainder assertions, which are reviewed rather than proven.
Read its prose with the date in mind: `specs/rain/context.md`, `tasks.md` and
`.env.testnet.template` were all written before hub 770746178 existed and still
say no deployment matches this tree and no app id here should be described as
live. That is stale, not a second opinion — the hub above is real and
`verify_build` affirms it — and `specsync check --strict` passes 2/2 because it
checks the API surface, not the prose. Fixing those three files is itself an
open task.

## The hub before this one

An earlier hub, **770130162**, ran on TestNet under the
[arcron](https://github.com/CorvidLabs/arcron) repository. It is superseded and
**must not be used.**

It predates the fix that refuses `enter` while a ONE draw is open. Its
committed seed becomes public the moment that round is mined, and it accepts
tickets afterwards — so a ONE draw on it can be aimed by anybody willing to buy
enough tickets once the answer is visible. The difference between the two hubs
is eight bytes of approval program, 4,963 against 4,971, and those eight bytes
are the assert. It is immutable, so it cannot be repaired; a fix is a new app
id, by construction. That is arcron issue #232.

It is still live and still holds money. At round 66,860,306 its app account
held **3.1628 ALGO**, of which 0.9728 is minimum balance it can never release:
0.1 for the account, 0.7728 for its 16 boxes (5 rain, 8 ticket, 3 ONE-draw
index), and 0.1 for the one ASA it opted into as a prize. The pots are
0.8 + 0.95 + 0.2 + 0 + 0 ALGO, plus 0.05 locked in an unresolved draw:
**2.0 ALGO across five rains**, not 3.16. That draw is rain 3, locked at round
66,831,686 and committed to the seed of 66,831,694 — a round that passed tens
of thousands of rounds ago with nobody resolving it. Its seed window (800
rounds) has long since closed, so only `abandon` can free it, and nobody has
called it. Anyone holding a ticket there should know there is no `leave` — the
ticket and rain box minimums stay with that hub whatever they do.

**And the other half of the project is still paying to keep it running.**
Nothing in *this* repository defaults to it, names it as a deployment, or
points a script at it — but Arcron upkeep **91**, registered by the same
deployer account that created both hubs, still fires `draw()` on it hourly and
still pays a keeper 4,000 µALGO to do so. It has run 43 times and holds about
29 days of escrow. Rain 1 on that hub credited a drop as recently as round
66,859,560, so it is not a dormant app — it is a running one.
Cancelling 91 is the remedy and it has not been done; that is arcron issue
[#232](https://github.com/CorvidLabs/arcron/issues/232). "Superseded" here
means nobody should use it, not that it has been switched off.

## What it costs

Algorand charges for storage as a minimum balance the app must keep, and the
hub collects it from whoever causes the box to exist. Every figure is exact and
derived in `smart_contracts/rain/contract.py`.

None of it comes back. There is no `leave` and no way to close a rain, so a
ticket's minimum stays with the hub for good. That is the price of a
permissionless `create_rain`: it is also the only thing stopping a stranger
opening ten thousand empty rains for the hub to pay for.

| | µALGO | Paid by |
|---|---|---|
| The hub's own floor | 100,000 | the creator, once, at `bootstrap` |
| One rain | 95,700 | whoever opens it |
| One ticket | 28,500 | whoever enters |
| A ONE rain's ticket index | 22,100 | whoever enters, in addition |
| Holding one ASA as a prize | 100,000 | whoever calls `opt_in_prize_asset`, permanently |

An MBR payment above the minimum is a donation: the contract asserts `>=`,
credits nothing, and there is no path back out.

`claim` pays through an inner transaction with a zero fee, so the caller's
group has to pool it. A claim submitted at the bare minimum fee fails before it
reaches a block.

## Cadence

| Cadence | Interval, in rounds |
|---|---|
| hourly | 1,286 |
| daily | 30,857 |
| weekly | 216,000 |
| monthly | 925,714 |

Those are the nominal 2.8-second round. TestNet measured 2.695 on 2026-08-28,
so a "daily" rain really fires every 23.1 hours — about an hour early, every
day, compounding. Rounds are what the contract counts; wall-clock is an
estimate, and this one is generous. An interval must be between 10 and
1,000,000,000 rounds.

Register the `draw()uint64` upkeep at least as often as the shortest rain you
care about. One upkeep serves every rain in the hub; upkeep 113 runs hourly.

## Getting started

Python 3.13 (`>=3.12,<3.14` — **never 3.14**, coincurve publishes no wheels for
it), [Poetry](https://python-poetry.org), [AlgoKit](https://github.com/algorandfoundation/algokit-cli),
[Bun](https://bun.sh) and [fledge](https://github.com/CorvidLabs/fledge).

```bash
poetry install
fledge lanes run ci     # build, unit tests, spec check, TypeScript, the page. No chain.
```

```bash
algokit localnet start
fledge lanes run local  # the above, plus the rendered-page audit and both demos
```

On 2026-08-31 that is 62 pytest tests, 74 TypeScript client tests, 93 page unit
tests, 73 rendered-page checks, and 2 specs held to `specsync check --strict`.

Anything that touches TestNet needs `.env.testnet`: copy
`.env.testnet.template`, fill in a throwaway `DEPLOYER_MNEMONIC`, and set
`RAIN_APP_ID=770746178`. The template is committed; `.env.testnet` is
gitignored and must stay that way. Never put a mnemonic you care about in it.
LocalNet needs none of this — its accounts come from KMD. (The template still
carries a comment saying no hub of this repository's own is deployed and leaves
`RAIN_APP_ID` commented out. That comment predates 770746178 and has not been
updated.)

The two LocalNet demos are the part that proves anything about money, for the
reason given above: the unit tests run against mocks that record inner
transactions rather than executing them.

```bash
fledge run smoke-rain            # a SPLIT rain in ALGO, end to end
fledge run smoke-community-rain  # gated to an NFT collection, paying an ASA
```

### The tasks

| Task | What it does |
|---|---|
| `fledge run build` | compile the contract and regenerate the typed client |
| `fledge run test` | the unit tests |
| `fledge run spec` | `specsync check --strict` — fails on drift between spec and code |
| `fledge run verify` | print the hash of the contract this tree builds |
| `fledge run web-render` | what the page actually renders, in a browser, in both themes |
| `fledge run deploy-localnet` | a bare hub on LocalNet |
| `fledge run deploy-testnet` | a new hub, bootstrapped, with its rains and its Arcron upkeep |
| `fledge run rain-bot` | **does nothing today.** It was written for the single-rain contract the hub replaced; `scan_once` logs one line and sends no transaction. Kept so an existing cron unit does not start failing. See `specs/rain/tasks.md` |
| `fledge run rain-one-draw` | prove a ONE draw picks a stranger, on TestNet, with real ALGO |

`rain-one-draw` is in no lane on purpose. It spends real money and waits on
real rounds, and it exists because a ONE draw had been fired many times without
ever having *chosen*: the mocked test plants a seed, and the first live proof
entered with a single account, where `seed % 1` is zero for every seed there
has ever been.

## Layout

| Path | What it is |
|---|---|
| `smart_contracts/rain/` | the hub |
| `smart_contracts/beacon_stub/` | a randomness stub, referenced by nothing, kept so the trip back is testable |
| `specs/rain/` | the spec `specsync check --strict` holds the contract to |
| `scripts/` | the bot, the demos, the deployers, the build verifier |
| `js/` | `@corvidlabs/arcron-rain`: box decoding and transaction builders. Unpublished; see [`js/README.md`](js/README.md) |
| `web/` | the page at corvidlabs.xyz/rain. See [`web/README.md`](web/README.md) |
| `tests/` | unit tests, against mocks |

## Spec-driven development

Managed with [spec-sync](https://github.com/CorvidLabs/spec-sync) `v6.0.0-rc.12`
(strict) and
[fledge](https://github.com/CorvidLabs/fledge) lanes. Every contract has a spec
under `specs/` covering its public API, invariants, error cases and testing,
and `specsync check --strict` runs in the `ci` lane: a contract whose surface
changed without its spec changing fails the build rather than rotting quietly.
`specs/rain/tasks.md` is where the known gaps are written down.

## Licence

[Apache-2.0](LICENSE) for the code, which carries an express patent grant —
worth having for contract code other people are asked to put money into.

CorvidLabs' name, logo mark and mascot are trademarks, and Apache-2.0 §6
grants no rights in them; [NOTICE](NOTICE) says so plainly rather than leaving
it to be inferred. Fork this freely, and run it under your own marks.
