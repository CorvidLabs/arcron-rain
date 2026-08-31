---
spec: rain.spec.md
---

## Tasks

- [ ] Deploy this repository's own hub, and record its app id, commit, and program hashes. The TestNet hub inherited from `CorvidLabs/arcron` declares no update handler and predates the 2026-08-30 `ONE` entry lock, so that fix cannot be applied to it — a fix is a new app id, by construction. Until this lands there is no deployment `scripts/verify_build.py` can affirm against this tree, and no app id in this repository should be described as live.
- [ ] Register one Arcron upkeep on `draw()uint64` against the new hub, `SKIP_AHEAD` rather than `CATCH_UP`: a missed drop should be dropped, not replayed in a burst that spends one fee per backed-up interval.
- [ ] Cancel the upkeep still paying keepers to call `draw()` on the superseded hub, once the new one is serving.
- [ ] Re-create the Corvid rains on the new hub. Warn anyone else holding a rain on the old one first: there is no `leave`, so their ticket and rain box minimums stay behind whatever they do.
- [ ] Repoint or retire `scripts/rain_bot.py`. Since the hub replaced the single-draw contract it is a scan that changes nothing, and the state it prints is not state the hub keeps (see Gaps).
- [ ] Cover `opt_in_prize_asset` with unit tests. It is the one method with real money-safety assertions and no test at all (see Gaps).

## Gaps

- **`opt_in_prize_asset` is untested.** `tests/test_rain.py` opts the hub into a prize by patching holdings directly (`_opt_hub_into`), so the method itself never runs: its four asset-safety refusals (clawback, freeze, manager, default-frozen), the already-opted-in guard, and its `ASSET_OPT_IN_MBR` are unproven. Those refusals are what stop an issuer clawing a pot back out from under people who entered for it (REQ-rain-020).
- **Validation paths with no test:** the interval floor and ceiling and `Unknown mode` on `create_rain`; `No such rain` on the eight methods that assert it; `gm` on a non-`WAVE` rain and `resolve` / `abandon` on a non-`ONE` one; `resolve` after the seed window closed; and `Opt in to the prize asset first` in `_pay`.
- **The rekey, close-remainder and payer-binding assertions have no test.** No test builds a payment that rekeys, closes, or comes from an account other than the caller, so Invariant 12 is reviewed rather than proven.
- **Nothing derives the box size from the compiled struct.** `RAIN_BOX_MBR`'s `233`, the same expression in `js/src/rain.ts`, and the `95_700` literal in `js/test/rain-abi.test.ts` are three hand-written copies of one number. Add a field to `RainRec` and the contract under-charges for a box it can then fail to write, and the mock — which enforces no minimum balance — passes.
- **`scripts/rain_bot.py` reads state the hub does not keep.** `scan_once` logs `tickets` and `pot` out of global state; the hub keeps both per rain box, so the numbers are always zero. `should_resolve` and `should_abandon` are no longer called by anything, and they are pinned at `BEACON_WINDOW = 1_000` while the contract's `SEED_WINDOW` is 800: re-wired unchanged they would call `resolve` up to 200 rounds after the contract stops accepting one, and hold off `abandon` for 200 rounds after it would have worked. Their 14 tests pin the old boundary, so nothing goes red.
- **`draw`'s reference budget is reasoned about, not measured here.** `DRAW_SCAN` is 4 on the argument that Arcron spends 2 of 8 reference slots and a keeper discovers the rest by simulation. The instrument that measures that boundary (`resource_probe`, `sim_probe`) stayed in the keeper repository; if `DRAW_SCAN` ever rises, the measurement has to be borrowed back before the change ships.
- The mock AVM records inner transactions without executing them and enforces no minimum balances, so no test in `tests/` shows a payout actually moving or the app account actually affording its boxes. Covered by the LocalNet demos and the TestNet proofs listed in `testing.md`.

## Review Sign-offs

- **Product**: pending
- **QA**: pending
- **Design**: pending
- **Dev**: pending
