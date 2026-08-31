---
spec: rain.spec.md
---

## User Stories

- As an NFT project, I want to drip a token to my holders on a cadence without running a bot, a treasury multisig, or a snapshot script, so the giveaway keeps happening after I stop paying attention to it.
- As a holder, I want to take one ticket once and be in every future drop, and pull what I am owed whenever I feel like it, rather than having to be online at the moment a prize falls.
- As a Discord community, I want the drop to go to the people who actually showed up this interval, which is what "rain" means to everyone who has seen it in a chat room.
- As someone running a raffle, I want one random holder to win, decided by something nobody in the transaction chose.
- As Corvid Labs, I want to run our own rains on the same app any stranger uses, so the dogfood and the product are not two different things.

## Acceptance Criteria

### REQ-rain-001
The creator, and only the creator, SHALL fund the app account's own minimum balance once, through `bootstrap`, before any rain can be created. That 100,000 µALGO is held aside and never credited to a pot, so no rain's prize is ever the reason the hub can hold boxes.

### REQ-rain-002
Anyone SHALL be able to open a rain by paying its box minimum balance, choosing a label, a gate, a denomination, a drip, an interval between 10 and 1,000,000,000 rounds, and one of the three modes. Ids SHALL be sequential from 1 and SHALL never be reused.

### REQ-rain-003
A rain's mode, gate and denomination SHALL be fixed at creation. Only that rain's creator SHALL be able to change its drip and its interval, and SHALL be able to change nothing else.

### REQ-rain-004
An account SHALL hold at most one ticket per rain, and SHALL pay for the ticket box itself — plus, on a `ONE` rain, the index box that makes it drawable. A rain's ticket count SHALL only ever grow: there is no exit.

### REQ-rain-005
`draw` SHALL take no arguments, SHALL be callable by anyone, and SHALL NOT fail. An empty hub, a rain that is not yet due, a rain with no tickets, a drip too small to divide, and a pot that cannot cover the drop SHALL each return `0` rather than reject. A scheduled call that fails is an outage to the keeper watching it, and a quiet week must be uneventful.

### REQ-rain-006
`draw` SHALL open at most `DRAW_SCAN` (4) rain boxes per call, starting at a stored cursor, SHALL fire every due rain among them rather than only the first, and SHALL advance the cursor by `DRAW_SCAN` so that a hub larger than four rains is served round-robin across successive calls.

### REQ-rain-007
No rain SHALL fire before `last_rain_round + interval_rounds`. `draw` is permissionless and the keeper's cadence is only a suggestion, so the interval that protects the pot SHALL live in the rain itself.

### REQ-rain-008
`SPLIT` SHALL credit every ticket the same `share = drip // tickets` by advancing one accumulator, so the cost of a fire does not grow with the number of holders. `paid = share * tickets` SHALL leave the pot and the division remainder SHALL stay in it.

### REQ-rain-009
A `SPLIT` fire that cannot pay — no tickets, `share == 0`, or a pot below `paid` — SHALL change nothing at all, including `last_rain_round`. A rain that has run dry therefore reads as due forever, and every reader of the box SHALL be written knowing that "due" does not mean "a drop is coming".

### REQ-rain-010
A ticket taken after a `SPLIT` rain has already fired SHALL start at the current accumulator, so a late arriver collects the drops that fall after they entered and none of the ones before.

### REQ-rain-011
`WAVE` SHALL pay only the accounts that checked in during the interval, up to `wave_cap` of them, first come first served, at `share = drip // wave_count`. Shares from the previous drop that nobody has settled SHALL return to the pot at the next fire, so a drop aimed at people who never came back is not lost.

### REQ-rain-012
`ONE` SHALL decide its winner from a block seed that did not exist when the draw was locked: the fire SHALL take `drip` out of the pot, hold it in `prize_locked`, and commit to the seed of the round `COMMIT_DELAY` (8) rounds in the future.

### REQ-rain-013
While a `ONE` draw is open, `enter` SHALL be refused. `resolve` divides the committed seed by the live ticket count, and that seed becomes public the moment the committed round is mined; a batch of tickets bought afterwards could be sized to make the modulo land on one of them. The set the winner is drawn over SHALL be the set that existed before the seed did.

### REQ-rain-014
Anyone SHALL be able to `resolve` an open `ONE` draw once the committed round has passed and while its seed is still readable (`SEED_WINDOW`, 800 rounds), crediting the locked prize to the ticket at index `seed % tickets`.

### REQ-rain-015
Once the seed window has closed, anyone SHALL be able to `abandon` the draw, returning the locked prize to the pot. This is the only exit from a stalled draw: a `ONE` rain with `prize_locked > 0` never fires again, and the contract has no owner and no update path, so an unresolved draw with no permissionless way out would freeze that rain permanently.

### REQ-rain-016
Funds SHALL leave the hub only through `claim`, and only to the account claiming its own credit. Nothing SHALL push a payment during `draw`: a push to an account that has closed, or opted out of the prize asset, would fail the whole scheduled call and stall every other rain in the hub with it.

### REQ-rain-017
`claim` SHALL return `0` rather than fail when there is no rain, no ticket, or nothing owed, so a client may call it speculatively.

### REQ-rain-018
A gated rain SHALL admit only accounts holding a positive balance of an asset whose creator is `gate_creator`, checked at `enter`, at `gm`, and again at `claim` when there is something to pay. The gate SHALL match on the asset's creator rather than its id, so a whole collection qualifies without listing it.

### REQ-rain-019
The prize asset SHALL NOT be usable as a gate token, so a rain cannot be entered by holding the thing it pays out.

### REQ-rain-020
Each rain SHALL be denominated either in ALGO or in exactly one ASA, and SHALL refuse a deposit of the other kind. The hub SHALL only accept an ASA it is already opted into, and SHALL refuse to opt into any asset carrying a clawback, freeze, or manager address, or frozen by default — an issuer able to claw a pot back could empty a rain after people had entered it.

### REQ-rain-021
Every box the hub holds SHALL have been paid for at exactly its cost by the account that caused it to exist, and every payment or asset transfer the contract accepts SHALL be checked for `rekey_to` and `close_remainder_to` / `asset_close_to`. An MBR payment SHALL additionally come from the caller, so nobody's payment can be spent buying somebody else a box.

## Constraints

- **The gate is a point-in-time check, not custody.** Entry and payout each ask whether the sender holds a collection token at that moment. Between the two, nothing is enforced: an account may enter with a borrowed NFT, sell it, and keep a ticket it can never claim against — and may buy back in later and claim. Anyone designing a rain around scarcity should read the gate as "holds one now", not "held one all along".
- **There is no exit.** No `leave`, no `delete_rain`, no refund. Ticket, index, and rain box minimum balances stay with the hub forever. They are the price of the accounting, not a deposit.
- **The contract has no administrator and no update path.** Beyond `bootstrap`, the app creator has no more authority than a stranger, and the contract declares no update or delete handler, so a deployment cannot be patched. Fixing anything means a new app id and every rain re-created by hand.
- **A struct change is a new app id.** `RainRec` is 224 bytes and `RAIN_BOX_MBR` is derived from it; adding a field changes both, and existing boxes do not reshape themselves.
- **`share = drip // tickets` shrinks as a rain grows.** Tickets only accumulate, so a popular `SPLIT` rain eventually divides to zero and silently stops firing until its creator raises the drip. That is the same code path as "cannot pay" in REQ-rain-009, and it looks identical from outside.
- **The hub takes nothing.** There is no protocol fee, no rake, and no owner withdrawal. Every unit deposited leaves as somebody's claim or stays in the pot; the only value the app keeps is box minimum balance.
- **A payment argument is bound by position, not by name.** ARC-4 resolves a transaction argument to the transaction immediately preceding the call, so the same payment cannot be presented to two calls in one group. That is why no method records which payments it has already consumed.
- **An MBR payment above the minimum is a donation.** The contract asserts `>=` and credits nothing; overpaying `bootstrap`, `create_rain`, `enter`, or `opt_in_prize_asset` leaves the excess in the app account with no path back out.
- **`draw` depends on the keeper's off-chain resource resolution.** It opens up to four rain boxes, and a scheduled call declares no foreign arrays on chain; a keeper that does not discover box references by simulation cannot execute the upkeep.
- **`claim` pays through an inner transaction with a zero fee**, so the caller's group has to pool it. A claim submitted at the bare minimum fee fails before it reaches a block.

## Out of Scope

- **Jackpots.** A rain is a drip: `drip` is what falls, not the pot. The one-winner mode locks a drip too, not the balance.
- **Refunds, exits and ticket transfers.** Nothing reclaims a box, and a ticket is bound to the account that took it.
- **A stronger source of randomness than the block seed.** The beacon inner call was removed on 2026-08-29 — one fewer app to trust and one fewer reference to attach — on the grounds that a proposer manipulating a seed to win a drip is spending more than the drip. `smart_contracts/beacon_stub/` is kept, unreferenced, so that the return trip is testable on LocalNet if a pot ever grows worth aiming at.
- **Push payouts, per-holder writes at fire time, and any design where the number of holders is in the cost of a drop.**
- **Protocol fees, staking, and any authority to pause, seize, or redirect a pot.**

The off-chain half — `scripts/rain_bot.py`, the two demos, the TestNet proofs and
the TypeScript client under `js/` — is outside the contract's surface but ships
in this repository and is what exercises the paths the mock AVM cannot reach.
