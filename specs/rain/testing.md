---
spec: rain.spec.md
---

## Automated Testing

| Test File | Type | What It Covers |
|-----------|------|----------------|
| `tests/test_rain.py` | unit (`algorand-python-testing`), 41 tests | `bootstrap` once and creator-only, and its MBR floor; `create_rain` before bootstrap, zero drip, sequential ids, a `WAVE` without a cap and a `SPLIT` with one; a ticket paying its own box and one ticket per account; deposits accumulating and a zero deposit refused; `draw` as a no-op with no tickets, an empty pot, a pot short of one share each, and before the interval; `SPLIT` crediting `drip // tickets` and leaving the remainder; a late arriver collecting nothing that fell before them; `claim` paying and clearing, and returning 0 with no ticket; the gate admitting any asset from the collection, refusing another creator's asset and a zero balance, still applying at `claim`, and refusing the prize asset as a ticket; ALGO and ASA rains each refusing the other's deposit; `set_rain` creator-only; `WAVE` paying the accounts that checked in, returning an unsettled share to the pot at the next fire, and `gm` banking the last drop; `ONE` locking the drip, committing to `Global.round + COMMIT_DELAY`, refusing `resolve` early, and crediting the ticket the planted seed selects; `abandon` refused inside the window and returning the lock after it; entry refused while a draw is open and reopened by either `resolve` or `abandon`; two rains firing in one `draw`; an empty hub returning 0 |
| `tests/test_rain_one_draw.py` | unit, 7 tests | `check_allocations`, the assertion the live `ONE` proof makes about who won. Pins **delta** semantics rather than absolutes: an account holding an unclaimed prize from an earlier draw must not read as this draw's winner (it did once, live), a loser gaining anything is refused, and a winner credited zero — including a winner outside the watched set — fails loudly rather than passing quietly |
| `tests/test_rain_bot.py` | unit, 14 tests | The bot's local state file (`_read_pending` / `_write_pending`) round-tripping, clearing at zero, and surviving a missing or corrupt file — the record that stops a crash between `claim` and `deposit` from stranding a prize; `read_allocation` against a fake algod that 404s the way a real one does for a missing box. Also `should_resolve` / `should_abandon`, which the hub no longer calls — see Gaps in `tasks.md` |
| `js/test/rain-abi.test.ts` | unit (`bun test`) | Every signature in `RAIN_METHOD_SIGNATURES` against the compiled `Rain.arc56.json`, in both directions, so neither side can gain or lose a method without a red test; that every method also has a transaction builder behind it, or a written reason it is never sent from a UI; and the TypeScript decoders — `decodeRainRec`, `decodeHubState`, `allocationOf`, box naming both ways, label encoding, prize formatting by the asset's own decimals, and the gate and waiting-state predicates a page renders from |

Fixtures in `tests/test_rain.py`: `context` (fresh mock context), `hub` (a
bootstrapped `Rain` at round 1,000), `split` (that hub plus one SPLIT rain),
`collection` (a creator and two assets it minted). Rounds move with
`context.ledger.patch_global_fields(round=…)`; `ONE` seeds are planted with
`context.ledger.set_block(index=…, seed=…)`.

**What the mocks cannot show.** Inner transactions are recorded, not executed,
and minimum balances are not enforced. So the mock proves the *accounting* of
`claim` and never the payment; it proves `opt_in_prize_asset` asserts what it
asserts and never that the hub ends up holding the asset; and it cannot tell
you whether the app account can actually afford the boxes it is charging for.
It also plants block seeds, so nothing in `tests/` says a real seed is readable
when `resolve` reaches for it. Every one of those belongs on a chain.

| Script | Type | What it proves that the mocks cannot |
|--------|------|--------------------------------------|
| `scripts/rain_demo.py` | e2e (LocalNet) | The whole SPLIT shape on a real node: hub, rain, three real accounts entering, a deposit, an Arcron upkeep registered on `draw()uint64`, a keeper firing it, and a claim that moves ALGO |
| `scripts/community_rain_demo.py` | e2e (LocalNet) | The gated ASA shape: the hub opted into a prize asset, a rain gated to an NFT minter, a holder admitted and an impostor refused on chain, and a token payout |
| `scripts/rain_one_draw.py` | e2e (TestNet) | That a `ONE` draw *chooses*. Every other test of the winner either plants the seed or has a single ticket, and `seed % 1` is 0 for every seed there has ever been: this enters from several accounts and resolves until an index other than zero comes up, recomputing the expected index from `algod.block_info` so a contract agreeing only with itself fails |
| `scripts/rain_testnet_live_proof.py` | e2e (TestNet) | A live hub paying both denominations end to end — fund, enter with a real NFT, draw, resolve, claim — across ALGO and ASA rains |
| `scripts/verify_build.py` | verification | That a deployed app is running the programs this tree compiles to. On a hub with no update path this is the entire trust story, and it is the check to run after any deployment |

## Manual Testing

- [ ] `poetry run pytest tests/ -q`
- [ ] `specsync check --strict`
- [ ] `cd js && bun test`
- [ ] `poetry run python -m scripts.rain_demo --network localnet` (needs `algokit localnet start`)
- [ ] `poetry run python -m scripts.community_rain_demo --network localnet`
- [ ] `poetry run python -m scripts.rain_one_draw --network testnet --players 3` (costs real TestNet ALGO; each ticket's box minimum stays in the hub, there is no `leave`)
- [ ] `poetry run python -m scripts.rain_testnet_live_proof --network testnet`
- [ ] `poetry run python -m scripts.verify_build --network testnet --app-id <hub>` after every deployment

## Edge Cases & Boundary Conditions

| Scenario | Expected Behavior |
|----------|-------------------|
| A hub with fewer rains than `DRAW_SCAN` | The same rain is opened more than once in one `draw`. The second visit reads the `last_rain_round` the first just wrote and skips, so two rains return 2, not 4 |
| `draw` in exactly the due round | Fires; the guard is `Global.round < last_rain_round + interval_rounds` |
| Two `draw` calls in the same round | The second finds nothing due and returns 0 |
| A pot that cannot cover one share each | Returns 0 and writes nothing — `last_rain_round` included — so the rain reads as due forever. Not a bug; a client that says "due" here is |
| `drip` below the ticket count on a SPLIT rain | `share == 0`; the same silent no-op, until the creator raises the drip with `set_rain` |
| A WAVE fire with nobody checked in | Unclaimed shares from the last drop return to the pot, nothing is paid, and `last_rain_round` does not advance |
| A WAVE `enter` once the cap is full | A ticket is issued but no seat this drop; that account checks in with `gm` for a later one |
| `gm` from an account with no ticket, or twice in one interval | Returns 0 and changes nothing |
| `resolve` in the committed round itself | "Too early" — a round's seed is not readable until the round is past |
| `resolve` at `commit_round + SEED_WINDOW` | Allowed. One round later: "Window closed; abandon" |
| `abandon` at `commit_round + SEED_WINDOW` | "Window still open". One round later: allowed, and permissionless |
| A `ONE` draw nobody resolves | That rain never fires again until someone calls `abandon`. There is no other exit |
| A `ONE` rain with exactly one ticket | `seed % 1` is 0 every time; only the index box at offset 0 is ever read. A real chain proves nothing about the modulo until `scripts/rain_one_draw.py` runs |
| `enter` while a `ONE` draw is open | "Draw open; enter after resolve or abandon", and the ticket count is unchanged |
| `claim` with nothing owed on a gated rain, by an account that has since sold the token | Returns 0. The gate is only checked when there is something to pay |
| `claim` of an ASA by an account not opted in | Fails "Opt in to the prize asset first"; the whole call reverts, so the credit survives for a later claim |
| `claim` submitted at the bare minimum fee | Fails: the payout is an inner transaction with a zero fee, and the group has to pool it |
| An MBR payment above the minimum | Accepted, and the excess is credited to nothing and refunded by nothing |
| A rain created against an ASA the hub is not opted into | "Hub is not opted into the prize asset" |
| An asset with a clawback, freeze, or manager address, or frozen by default | `opt_in_prize_asset` refuses it, so no pot can be seized out from under the people who entered for it |
| A second `bootstrap`, or one from a stranger | "Already bootstrapped" / "Only the creator can bootstrap" |
