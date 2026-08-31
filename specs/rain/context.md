---
spec: rain.spec.md
---

## Key Decisions

- **Pull, not push.** `draw` credits; holders `claim`. A scheduled call that paid people directly would fail the moment one recipient had closed their account or opted out of the prize asset, and that failure takes the whole group — every other rain in the hub included — down with it. Pull also means a drop costs one box write no matter how many people are owed.
- **An accumulator, not a payout list.** `SPLIT` moves one number (`cumulative`) and each ticket remembers where it came in. That is why a rain with ten holders and a rain with ten thousand cost the same to fire, and why a late arriver collects nothing that fell before them without anyone having to iterate.
- **`draw` returns rather than fails.** Nothing due, nothing funded, nothing entered: all return `0`. A keeper reads a failing call as a broken target and backs off, so a rain that is merely quiet must not look broken. This is the single constraint that shapes the whole method.
- **The interval lives in the rain, not only in the upkeep.** `draw` is permissionless — anyone may call it every round — so the keeper's cadence cannot be the thing protecting a pot. Each rain refuses to fire before its own `interval_rounds` have passed, and the upkeep is then only a promise that *somebody* will call.
- **One hub, many rains, one upkeep.** The alternative is an app and an upkeep per rain, which is one escrow per community to keep funded and one deployment per community to verify. The hub costs a cursor and a scan cap instead.
- **A block seed, not a beacon.** Rain called Algorand's randomness beacon until 2026-08-29; `op.Block.blk_seed` removed an inner call, a foreign app reference, and a second contract to trust. The trade is honest and bounded: a block proposer can influence a seed, so this is right for a drip and wrong for a jackpot. `smart_contracts/beacon_stub/` is kept, referenced by nothing, so the trip back is testable on LocalNet if a pot ever grows worth aiming at.
- **Commit first, reveal later.** `ONE` locks the prize and names a round eight ahead; the seed it will use does not exist yet at the moment the draw is committed. Freezing entry until the draw closes is the other half of that: once the committed round is mined its seed is public, and a batch of tickets bought against a known seed can be sized to catch the modulo.
- **`abandon` is permissionless on purpose.** A `ONE` rain with a locked prize never fires again. With no owner and no update path, an unresolved draw that only a privileged account could clear would be a rain frozen forever by someone else's outage.
- **No admin, no rake, no exit.** Past `bootstrap` the app creator has no more authority than a stranger; the hub keeps nothing but box minimum balance; and nothing reclaims a box. All three are deliberate, and all three are permanent for a given app id.

## Files to Read First

- `smart_contracts/rain/contract.py`: the hub. The `_fire_*` subroutines are the whole product; everything else is bookkeeping around them.
- `specs/rain/rain.spec.md`: the module contract, including the sixteen invariants.
- `tests/test_rain.py`: expected behaviour with rounds and block seeds under test control.
- `scripts/rain_demo.py` and `scripts/community_rain_demo.py`: the two shapes end to end on a real node — open ALGO, and gated ASA.
- `scripts/rain_one_draw.py`: why a live `ONE` draw with one ticket proves less than it looks like it does.
- `js/src/rain.ts`: the decoder and the box names a reader needs, and the one place the keeper's app id and upkeep id appear.

## Current Status

- Implemented and unit-tested: all three modes, both denominations, the collection gate at entry and at payout, the `ONE` commit-reveal with its entry lock, and `abandon`.
- The mock AVM records inner transactions without executing them and enforces no minimum balances, so the payout itself, the hub's solvency, and a real block seed are proven on a chain instead — LocalNet for the two demos, TestNet for the `ONE` and live proofs.
- **No deployment matches this tree.** The hub this repository inherits from `CorvidLabs/arcron` predates the 2026-08-30 `ONE` entry lock and cannot be updated, so it is superseded by definition rather than by choice. Deploying a fresh hub from this repository is the first task in `tasks.md`, and until it lands nothing here should be described as live.

## Notes

- **A rain that has run dry reads as due forever.** `_try_fire` deliberately leaves `last_rain_round` alone when it cannot pay, so the box says "due" indefinitely. Any reader — page, bot, or alert — has to combine the rain's own due-ness with evidence that something is actually coming to fire it, and say "waiting" rather than "due" when it cannot see that. Promising a drop is the one thing a client may not do.
- **A struct change is a new app id.** `RainRec` is 224 bytes; `RAIN_BOX_MBR` is derived from that plus the 9-byte box name, and existing boxes do not reshape themselves. This is the same rule the keeper's `Upkeep` struct lives under, for the same reason.
- **`draw` needs box references it cannot declare.** It opens up to four rain boxes and the registered call carries no foreign arrays, so the keeper resolves them off chain by simulation. `DRAW_SCAN` is set at 4 to leave headroom inside the eight-reference ceiling after Arcron's own two.
- **The gate is a snapshot, twice.** Holding is checked at `enter` and again at `claim`, and never in between. Someone can enter with a borrowed NFT and someone can be locked out of credit they earned; both are the honest consequence of a point-in-time check, and neither is a bug to fix in the contract.
- Rain depends on the Arcron keeper registry at runtime, as data, and never the other way round. A rain reads its own upkeep to know when a drop is expected; nothing in the keeper knows what a rain is.
