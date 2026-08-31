# arcron-rain

[![CI](https://github.com/CorvidLabs/arcron-rain/actions/workflows/ci.yml/badge.svg)](https://github.com/CorvidLabs/arcron-rain/actions/workflows/ci.yml)

**Rain** is a pot that pays out on a schedule, on Algorand. You fill it once,
say how much should leave it each interval and who is allowed in, and it keeps
dripping without anybody tending it. By
[CorvidLabs](https://github.com/CorvidLabs), built with Algorand Python (Puya)
and AlgoKit.

This is Discord rain, on chain. People show up, and a drop goes to the people
who showed up. It is not a jackpot of the whole pot: the pot survives the
payout, so the same rain can fall every day for as long as somebody keeps
filling it.

One app is a **hub** holding many rains. Each rain is a box, and opening one is
permissionless: any NFT collection as the gate, ALGO or any ASA as the prize,
any drip, any interval, and one of three ways it falls. CorvidLabs uses the
same hub as everybody else.

> [!WARNING]
> **Unaudited, and TestNet only.** No third party has reviewed this contract,
> and the hub has no update path at all — there is no `update` or `delete`
> handler, so a deployed hub is immutable by construction. That is a real
> guarantee and a real hazard in the same sentence: nobody can change the rules
> under your pot, and nobody can fix a bug in it either. The only remedy for a
> bad hub is a new hub that everyone re-enters.
>
> Do not put anything on it you would mind losing.

## Three ways a rain falls

Picked once, when the rain is created, and never changed.

| Mode | Enter | Who is paid each fire |
|---|---|---|
| **SPLIT** (0) | once | everyone holding a ticket, an equal share of `drip` |
| **ONE** (1) | once | one random ticket, drawn from a later round's block seed |
| **WAVE** (2) | check in each interval with `gm` | up to `wave_cap` of the people who checked in, first come |

SPLIT is fill-and-forget: a billion of a token in the pot, ten thousand a day
out of it, nothing to run. WAVE is the Discord shape: talk during the interval,
be there when it falls. ONE is a draw, and it takes two calls rather than one —
see [The randomness is not free](#the-randomness-is-not-free).

## Who calls it, and why you never have to care

A smart contract cannot wake itself. There is no on-chain timer on Algorand, or
anywhere else; every "this happened at midnight" is a transaction somebody
sent. So a rain needs somebody to poke it.

That somebody is [**Arcron**](https://github.com/CorvidLabs/arcron), a
permissionless keeper network. Somebody registers one *upkeep* against this
hub's `draw()` method with a cadence and a fee escrowed in ALGO, and after that
any account at all may execute it and collect the fee. Keepers compete for the
money; nobody is in charge; the hub does not know or care which account called
it.

**A person using a rain never touches any of this.** They `enter`, and later
they `claim`. The schedule is somebody else's job, and it is paid for out of
the upkeep's escrow rather than out of the pot. If you are here to run a rain
for your holders, you need to register exactly one upkeep, once, and then never
think about keepers again.

The dependency runs one way and must stay that way: **Rain depends on Arcron;
Arcron must never depend on Rain.** A keeper network with a favourite
application is not permissionless.

## Money is pulled, never pushed

`draw` is the call Arcron makes. It takes no arguments, walks a few rain boxes,
credits the ones that are due, and returns — including when there is nothing to
do. It moves no money and makes no inner call.

That is not tidiness. A scheduled call reaches only what the keeper's own
transaction made available to it, and a payment to an account that has closed
would fail the whole execution — stalling the schedule for every other rain in
the hub, because one recipient left. So `draw` does accounting only, and the
party who wants the money is the party who asks for it:

```
bootstrap()            creator funds the app's own floor, once
create_rain()          anyone opens a rain: gate, prize, drip, interval, mode
enter()                one ticket per account per rain
gm()                   WAVE check-in, first wave_cap this interval
deposit()              anyone tops the pot up (deposit_asset for an ASA)
draw()                 ZERO ARGS. The Arcron hook. Fires due rains, moves nothing.
resolve()              ONE mode: read the committed round's seed, credit a winner
abandon()              ONE mode: the seed window closed; return the locked prize
claim()                pull what you are owed
```

Each rain also enforces its own `interval_rounds`, so an extra `draw` from a
stranger is a no-op rather than a way to drain a pot. Arcron fires the hook;
the rain decides whether anything falls.

### The randomness is not free

A ONE draw cannot pick a winner in the same call that opens it: a transaction
cannot see a random number that did not exist when it was sent. So `draw` locks
the prize and names a round eight ahead, and a later `resolve` reads that
round's block seed and credits whoever it lands on.

Two consequences worth knowing before you choose ONE:

- Somebody has to send that `resolve`. `scripts/rain_bot.py` is a bot that does
  it for the rains we run, and `fledge run rain-bot` starts it.
- A block seed stays readable for only about a thousand rounds, and the hub
  gives itself 800 of them. Past that the draw can never be resolved, and
  `abandon` returns the locked prize to the pot instead. **Nothing else can
  unstick it**: a ONE rain with an unresolved draw fires nothing further until
  one of the two is called.

## What it costs

Algorand charges for storage as a minimum balance the app must keep, and the
hub collects it from whoever causes the box to exist. Every figure is exact.

None of it comes back to the person who paid it. There is no `leave` and no way
to close a rain, so a ticket's minimum stays with the hub for good. That is the
price of a permissionless `create_rain`: it is also what stops a stranger
opening ten thousand empty rains for the hub to pay for.

| | µALGO | Paid by |
|---|---|---|
| The hub's own floor | 100,000 | the creator, once, at `bootstrap` |
| One rain | 95,700 | whoever opens it |
| One ticket | 28,500 | whoever enters |
| A ONE rain's ticket index | 22,100 | whoever enters, in addition |
| Holding one ASA as a prize | 100,000 | whoever calls `opt_in_prize_asset`, permanently |

## Cadence

| Cadence | Interval, in rounds |
|---|---|
| hourly | 1,286 |
| daily | 30,857 |
| weekly | 216,000 |
| monthly | 925,714 |

Those are the nominal 2.8-second round. TestNet measures 2.695, so a "daily"
rain really fires every 23.1 hours — about an hour early, every day, compounding.
Rounds are what the contract counts; wall-clock is an estimate, and this one is
generous.

Register the hub's `draw()uint64` upkeep at least as often as the shortest rain
you care about. One upkeep serves every rain in the hub.

## Status

Nothing of this repository's own is deployed yet.

| Deployment | App id | Status |
|---|---|---|
| TestNet hub | _not deployed yet_ | `fledge run deploy-testnet` creates it |

An earlier hub ran on TestNet under the [arcron](https://github.com/CorvidLabs/arcron)
repository. It is not adopted here and should not be used: it is immutable and
missing a security fix, which is precisely the situation an immutable contract
cannot recover from. This tree deploys a fresh one.

Until that happens nothing defaults to a canonical hub, deliberately — every
command takes its app id explicitly and `scripts/rain_bot.py` refuses to start
without one. When the hub exists, its id belongs in three places and nowhere
else: the table above, `TESTNET_RAIN` in `js/src/rain.ts`, and `RAIN_APP_ID`
in the bot's environment.

## Getting started

Python 3.13 (`>=3.12,<3.14` — **never 3.14**, coincurve publishes no wheels for
it), [Poetry](https://python-poetry.org), [AlgoKit](https://github.com/algorandfoundation/algokit-cli),
[Bun](https://bun.sh) and [fledge](https://github.com/CorvidLabs/fledge).

```bash
poetry install
fledge lanes run ci              # build, unit tests, spec check, TypeScript. No chain.
```

```bash
algokit localnet start
fledge lanes run local           # the above, plus both demos against a real chain
```

Anything that touches TestNet needs `.env.testnet`: copy
`.env.testnet.template`, fill in a throwaway `DEPLOYER_MNEMONIC`, and set
`RAIN_APP_ID` once a hub exists. The template is committed; `.env.testnet` is
gitignored and must stay that way. LocalNet needs none of it — its accounts
come from KMD.

The two demos are the part that proves anything about money. The unit tests run
against `algorand-python-testing` mocks, which record inner transactions rather
than executing them and do not enforce minimum balances — so a claim that ALGO
actually arrived somewhere is a claim only a chain can settle:

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
| `fledge run deploy-localnet` | a bare hub on LocalNet |
| `fledge run deploy-testnet` | the hub, bootstrapped, with its rains and its Arcron upkeep |
| `fledge run rain-bot` | resolve, abandon and claim — the half a keeper cannot do |
| `fledge run rain-one-draw` | prove a ONE draw picks a stranger, on TestNet, with real ALGO |

`rain-one-draw` is in no lane on purpose. It spends real money and waits on
real rounds, and it exists because a ONE draw had been fired many times without
ever having *chosen*: the mocked test plants a seed, and the first live proof
entered with a single account, where `seed % 1` is zero for every seed there
has ever been.

## Checking what a deployment is running

A hub cannot be updated, so "the code you can read is the code that is running"
is its entire trust story — and an immutable contract is only worth as much as
that claim can be checked by somebody who does not trust us:

```bash
poetry run python -m scripts.verify_build --network testnet --app-id <hub>
```

It compares compiled bytecode, not source text. Comments and formatting do not
survive assembly, and two sources that assemble to the same bytes are the same
program by the only definition the chain has.

## Layout

| Path | What it is |
|---|---|
| `smart_contracts/rain/` | the hub |
| `smart_contracts/beacon_stub/` | a randomness stub, so LocalNet tests need no beacon |
| `specs/rain/` | the spec `specsync check --strict` holds the contract to |
| `scripts/` | the bot, the demos, the deployers, the build verifier |
| `js/` | `@corvidlabs/arcron-rain`: box decoding and transaction builders |
| `tests/` | unit tests, against mocks |

## Spec-driven development

Managed with [spec-sync](https://github.com/CorvidLabs/spec-sync) (strict) and
[fledge](https://github.com/CorvidLabs/fledge) lanes. Every contract has a spec
under `specs/` covering its public API, invariants, error cases and testing, and
`specsync check --strict` runs in the `ci` lane: a contract whose surface
changed without its spec changing fails the build rather than rotting quietly.

## Licence

[Apache-2.0](LICENSE) for the code, which carries an express patent grant —
worth having for contract code other people are asked to put money into.

CorvidLabs' name, logo mark and mascot are trademarks, and Apache-2.0 §6
grants no rights in them; [NOTICE](NOTICE) says so plainly rather than leaving
it to be inferred. Fork this freely, and run it under your own marks.
