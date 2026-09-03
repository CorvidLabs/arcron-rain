"""The second automated participant in a `rain` draw: it resolves, it claims,
it puts the prize back in.

`rain` is deliberately pull, not push (see `smart_contracts/rain/contract.py`):
`draw` only locks a prize and fixes a future beacon round, because that is all
a bare Arcron upkeep can do. Somebody still has to supply the beacon
(`resolve`) and the winner still has to pull their own prize (`claim`). On a
draw with only one real participant, "somebody" and "the winner" are the same
account, so this bot holds that account, watches one `rain` hub, and does
three things, in order, for **every rain on it**, every time it runs:

  1. If a ONE draw is open and its beacon round has passed, call `resolve`.
  2. If a ONE draw's beacon window has closed unresolved, call `abandon`, so
     the prize returns to the pot instead of sitting locked forever.
  3. If this account is owed anything (`allocation`), `claim` it, then
     `deposit` the exact amount straight back into the pot it came from.
     `claim` and `deposit` are two transactions, not one atomic group, so
     what was claimed is recorded to a small local state file first, with
     the rain it came out of, and cleared only once the deposit confirms;
     a crash between the two then redeposits on the next run instead of
     stranding a won prize in this account's own wallet forever.

Step 3 is what "circulates" means here, concretely. The pot after a full
cycle is the pot before it. **What does not circulate is transaction fees**,
which are real ALGO leaving the system every cycle, forever. That is the cost
of running the dogfood, not a bug, and nothing about this design amortises it.

**This module described all of that while doing none of it.** For a while
`scan_once` read global state, logged one line and returned False, under a
comment saying drip rain has no resolve and holders claim for themselves,
while this docstring went on promising three jobs. So a cron reported success
for work nobody was doing, and rain 1 on the live hub accrued 100,000
microAlgos that nothing ever pulled. The helpers had also been written for
the single-rain contract that predates the hub: `read_state` looked for
`draw_open` and `commit_round` in global state, which now live per rain in
boxes, and the allocation read used a box key with no rain id in it.

An ASA prize is **named and skipped** rather than claimed: putting it back
needs `deposit_asset` and a different transaction shape, and a claim with no
matching redeposit is how a prize leaves a pot for good.

This bot never opens a draw itself; that is Arcron's job. It only reacts to
what a `draw` already did, which is why every action here is a no-op check
before it is a transaction: run it as often as you like, including from a
cron job that overlaps with itself, and a quiet round costs nothing.

Picks its network with --network (or ARCRON_NETWORK), loading .env.localnet
or .env.testnet. Signs as the account from RAIN_MNEMONIC if set, else
DEPLOYER_MNEMONIC; resolving costs a small fee, and only a won prize is ever
paid out, straight back to this same account. On LocalNet both come from
KMD, so no mnemonic is needed.

Run:  poetry run python -m scripts.rain_bot --once [--network N] [--app-id N]
"""

import argparse
import base64
import json
import logging
import os
import time
from pathlib import Path

import algokit_utils
from algosdk import encoding
from algosdk.error import AlgodHTTPError

from scripts import network as net
from scripts.arcron import Emitter, Shutdown
from smart_contracts.artifacts.rain.rain_client import (
    AbandonArgs,
    ClaimArgs,
    DepositArgs,
    RainClient,
    ResolveArgs,
)
from smart_contracts.rain.contract import ONE, SEED_WINDOW, TICKET_PREFIX

# Drip rain has no beacon window. Kept so existing unit tests of the old
# jackpot bot's predicates can stay until that bot is deleted.
BEACON_WINDOW = 1_000
ALLOCATION_PREFIX = TICKET_PREFIX

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Extra fee, on top of the standard 1,000 µALGO outer fee, pooled for the one
# inner transaction `resolve` and `claim` each submit (a beacon call and a
# payment respectively). Matches scripts/rain_demo.py, proved sufficient
# there and against the real beacon (see arcron's `docs/releases.md`).
EXTRA_FEE_MICROALGO = 1_000
# What this account must hold before it refuses to start, rather than
# looking alive while unable to broadcast: the base account MBR plus one
# full cycle (resolve + claim + deposit, ~2,000 µALGO of fees each).
ACCOUNT_MBR_MICROALGO = 100_000
CYCLE_COST_MICROALGO = 3 * 2_000
HARD_MINIMUM_MICROALGO = ACCOUNT_MBR_MICROALGO + CYCLE_COST_MICROALGO
# Default warning floor: about 30 days of cycles at the registered two-hour
# cadence (roughly 360 cycles), below RAIN_ACCOUNT_FUNDING_MICROALGO in
# scripts/rain_testnet_deploy.py so a freshly funded account does not warn
# on its very first run.
LOW_BALANCE_MICROALGO = ACCOUNT_MBR_MICROALGO + 360 * CYCLE_COST_MICROALGO
# Between polls in loop mode. The registered cadence is hours; nothing here
# is time-critical enough to justify a block-by-block loop the way the
# Arcron keeper runs one, and busy-polling an idle draw is exactly the "loop
# hot" this bot must not do.
POLL_SECONDS_DEFAULT = 300

emit = Emitter()


SPLIT, ONE, WAVE = 0, 1, 2
RAIN_PREFIX = b"r"
# 32 bytes of creator, 32 of gate creator, 32 of label, then uint64s.
RAIN_HEAD = 96
RAIN_FIELDS = (
    "prize_asset", "drip", "interval_rounds", "last_rain_round", "pot", "tickets",
    "draw_id", "cumulative", "mode", "wave_cap", "wave_count", "last_share",
    "last_wave_id", "wave_unclaimed", "commit_round", "prize_locked",
)


def read_rain(algod, app_id: int, rain_id: int) -> dict | None:
    """One rain's box, decoded. A free algod read. None when there is no such rain."""
    name = RAIN_PREFIX + rain_id.to_bytes(8, "big")
    try:
        raw = algod.application_box_by_name(app_id, name)["value"]
    except AlgodHTTPError as exc:
        if "box not found" in str(exc).lower():
            return None
        raise
    if isinstance(raw, str):
        raw = base64.b64decode(raw)
    out: dict = {}
    offset = RAIN_HEAD
    for field in RAIN_FIELDS:
        out[field] = int.from_bytes(raw[offset:offset + 8], "big")
        offset += 8
    return out


def read_ticket(algod, app_id: int, rain_id: int, address: str) -> dict | None:
    """This account's ticket on one rain, or None if it holds none."""
    name = TICKET_PREFIX + rain_id.to_bytes(8, "big") + encoding.decode_address(address)
    try:
        raw = algod.application_box_by_name(app_id, name)["value"]
    except AlgodHTTPError as exc:
        if "box not found" in str(exc).lower():
            return None
        raise
    if isinstance(raw, str):
        raw = base64.b64decode(raw)
    return {
        "credit": int.from_bytes(raw[0:8], "big"),
        "wave_id": int.from_bytes(raw[8:16], "big"),
        "settled_id": int.from_bytes(raw[16:24], "big"),
    }


def allocation(rain: dict | None, ticket: dict | None) -> int:
    """What this account can claim on one rain, from two box reads.

    A mirror of the contract's `allocation_of`, kept because a scan that has
    to simulate once per rain is a scan nobody runs often. Mirrors go stale,
    so `tests/test_rain_bot.py` runs this against the real contract over a
    matrix of states rather than trusting the reading.
    """
    if rain is None or ticket is None:
        return 0
    if rain["mode"] == SPLIT:
        return max(0, rain["cumulative"] - ticket["credit"])
    owed = ticket["credit"]
    if rain["mode"] == WAVE:
        if ticket["wave_id"] == rain["last_wave_id"] and ticket["settled_id"] != rain["last_wave_id"]:
            owed += rain["last_share"]
    return owed


def read_state(algod, app_id: int) -> dict:
    """This rain app's global state, decoded. A free algod read, no signing."""
    entries = algod.application_info(app_id)["params"].get("global-state", [])
    state: dict[str, int | str] = {}
    for entry in entries:
        key = base64.b64decode(entry["key"]).decode()
        value = entry["value"]
        state[key] = value.get("uint", 0) if value.get("type") == 2 else value.get("bytes", "")
    return state


def read_allocation(algod, app_id: int, address: str) -> int:
    """What `address` can claim right now. Zero if it has no allocation box.

    A free algod read: the same box `claim` deletes, read directly rather
    than through a simulated ABI call, so checking costs nothing and can be
    done every time this runs.
    """
    name = ALLOCATION_PREFIX + encoding.decode_address(address)
    try:
        raw = algod.application_box_by_name(app_id, name)["value"]
    except AlgodHTTPError as exc:
        if "box not found" in str(exc).lower():
            return 0
        raise
    if isinstance(raw, str):
        raw = base64.b64decode(raw)
    return int.from_bytes(raw, "big")


def default_pending_path(network: str, app_id: int) -> Path:
    """Where a claimed-but-not-yet-redeposited amount is remembered.

    Mirrors the state path convention of arcron's `scripts/keeper_backoff.py`: per network,
    per app, outside the repo so it is never committed. Exists for exactly
    one gap: `claim` and `deposit` are two separate transactions, not one
    atomic group, so a crash between them (a rate-limited node did this on
    a real run, see arcron's `docs/releases.md`) would otherwise strand a won prize
    in this account's own wallet. The next run's `allocation_of` reads zero,
    because the claim already happened, so nothing would tell it to
    redeposit money it no longer sees as owed to it, without this record.

    Like the backoff state, this is a stopgap that assumes a persistent
    filesystem between runs. A fresh container on every invocation (a
    scheduled CI job, as opposed to a long-lived host) loses it exactly the
    way arcron's `.github/workflows/keeper-bot.yml` already documents for backoff
    state; the fix is the same one recommended there, a long-running
    process with a real disk.
    """
    base = os.environ.get("XDG_STATE_HOME")
    root = Path(base) if base else Path.home() / ".local" / "state"
    return root / "arcron" / f"rain-bot-pending-{network}-{app_id}.json"


def _read_pending(path: Path | None) -> tuple[int, int]:
    """A claimed-but-not-redeposited amount, and the rain it came out of.

    The rain id is not optional bookkeeping. A hub holds several pots, and a
    redeposit aimed at the wrong one takes money from one rain and gives it
    to another, which no later run can tell apart from a donation.
    """
    if path is None or not path.exists():
        return 0, 0
    try:
        saved = json.loads(path.read_text())
        return int(saved.get("pending_deposit", 0)), int(saved.get("rain_id", 0))
    except Exception:
        return 0, 0


def _write_pending(path: Path | None, amount: int, rain_id: int = 0) -> None:
    if path is None:
        return
    if amount <= 0:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"pending_deposit": amount, "rain_id": rain_id}))


def _payment(client: "RainClient", sender: str, amount: int):
    """A payment to the hub, for the deposit that follows a claim."""
    return client.algorand.create_transaction.payment(
        algokit_utils.PaymentParams(
            sender=sender,
            receiver=client.app_address,
            amount=algokit_utils.AlgoAmount(micro_algo=amount),
        )
    )


def should_resolve(state: dict, current_round: int, window: int = BEACON_WINDOW) -> bool:
    """A draw is open, its beacon round has passed, and the window has not."""
    if int(state.get("draw_open", 0)) != 1:
        return False
    commit_round = int(state["commit_round"])
    return current_round > commit_round and current_round <= commit_round + window


def should_abandon(state: dict, current_round: int, window: int = BEACON_WINDOW) -> bool:
    """A draw is open and the beacon can no longer answer for it.

    Defensive: at the registered two-hour cadence the beacon window (about
    1,000 rounds held short of the real ~1,512-round retention; see
    `smart_contracts/rain/contract.py`) closes roughly 46 minutes after a
    draw opens, well inside any reasonable polling interval. This exists so
    a bot that misses that window anyway (an outage, a stopped cron) heals
    itself on the next run instead of leaving the pot locked forever.
    """
    if int(state.get("draw_open", 0)) != 1:
        return False
    commit_round = int(state["commit_round"])
    return current_round > commit_round + window


def resolve_app_id(parser: argparse.ArgumentParser, app_id: int | None) -> int:
    if app_id is not None:
        return app_id
    from_env = os.environ.get("RAIN_APP_ID")
    if from_env:
        return int(from_env)
    parser.error("--app-id (or RAIN_APP_ID) is required: no rain app is canonical yet")


def guard_balance(algod, address: str, warn_below: int) -> int:
    balance = algod.account_info(address)["amount"]
    if balance < HARD_MINIMUM_MICROALGO:
        raise SystemExit(
            f"rain bot account {address} holds {balance} µALGO, below the "
            f"{HARD_MINIMUM_MICROALGO} µALGO needed to keep its account and pay for "
            f"one resolve/claim/deposit cycle ({CYCLE_COST_MICROALGO} µALGO). Fund it "
            f"before starting."
        )
    if balance < warn_below:
        cycles = (balance - ACCOUNT_MBR_MICROALGO) // CYCLE_COST_MICROALGO
        emit(
            "low_balance",
            f"rain bot balance {balance} µALGO is low: about {cycles} cycle(s) of "
            f"headroom. The prize it wins comes straight back out as a deposit; "
            f"only this account's own transaction fees ever draw it down.",
            level=logging.WARNING,
            balance=balance,
            cycles_remaining=cycles,
        )
    return balance


def rains_on(algod, app_id: int) -> list[int]:
    """Every rain id the hub has opened. `next_rain_id` is the count."""
    state = read_state(algod, app_id)
    return list(range(1, int(state.get("next_rain_id", 0)) + 1))


def scan_once(
    algod,
    client: "RainClient",
    app_id: int,
    address: str,
    pending_path: Path | None = None,
) -> bool:
    """One pass over every rain on the hub. Returns whether anything was sent.

    Every branch starts by asking whether there is anything to do, so a quiet
    run signs nothing and costs nothing beyond the free box reads. Safe to
    call as often as you like, including back to back.

    This was a heartbeat for a while: it read global state, logged one line
    and returned False, under a comment saying drip rain has no resolve and
    holders claim for themselves. The module docstring above went on
    describing all three jobs, so the cron reported success for work nobody
    was doing, and rain 1 on the live hub accrued 100,000 microAlgos that
    nothing ever pulled.
    """
    current = algod.status()["last-round"]
    acted = False

    # A prize claimed but not yet redeposited, from a run that died between
    # the two. Cleared only once the deposit confirms.
    pending, pending_rain = _read_pending(pending_path)
    if pending > 0 and pending_rain > 0:
        emit("redeposit",
             f"Round {current}: redepositing {pending} into rain {pending_rain}, "
             "left by a run that died between claim and deposit",
             round=current, app_id=app_id, rain_id=pending_rain, amount=pending)
        client.send.deposit(
            args=DepositArgs(payment=_payment(client, address, pending), rain_id=pending_rain)
        )
        _write_pending(pending_path, 0)
        acted = True

    for rain_id in rains_on(algod, app_id):
        rain = read_rain(algod, app_id, rain_id)
        if rain is None:
            continue

        # 1 and 2. A ONE draw is locked until somebody supplies the beacon.
        # Nothing else in this repository calls either, so a rain whose bot
        # is not running stays locked for the seed window and then forever.
        if rain["mode"] == ONE and rain["prize_locked"] > 0:
            commit = rain["commit_round"]
            if commit < current <= commit + SEED_WINDOW:
                emit("resolve", f"Round {current}: resolving rain {rain_id}",
                     round=current, app_id=app_id, rain_id=rain_id)
                client.send.resolve(args=ResolveArgs(rain_id=rain_id))
                acted = True
            elif current > commit + SEED_WINDOW:
                emit("abandon", f"Round {current}: rain {rain_id} seed window closed; abandoning",
                     round=current, app_id=app_id, rain_id=rain_id)
                client.send.abandon(args=AbandonArgs(rain_id=rain_id))
                acted = True
            rain = read_rain(algod, app_id, rain_id) or rain

        # 3. Pull what this account is owed and put it straight back in.
        owed = allocation(rain, read_ticket(algod, app_id, rain_id, address))
        if owed <= 0:
            continue
        if rain["prize_asset"] != 0:
            # An ASA prize is claimed to this account and redeposited with
            # deposit_asset, a different transaction shape. Named rather than
            # attempted, because a claim with no matching redeposit is how a
            # prize leaves the pot for good.
            emit("skipped", f"Round {current}: rain {rain_id} owes {owed} of asset "
                 f"{rain['prize_asset']}, which this bot cannot redeposit",
                 level=logging.WARNING, round=current, app_id=app_id, rain_id=rain_id, amount=owed)
            continue

        emit("claim", f"Round {current}: claiming {owed} from rain {rain_id}",
             round=current, app_id=app_id, rain_id=rain_id, amount=owed)
        claimed = int(client.send.claim(args=ClaimArgs(rain_id=rain_id, gate_asset=0)).abi_return or 0)
        acted = True
        if claimed <= 0:
            continue
        # Recorded before the deposit, not after: these are two transactions,
        # not one group, and a crash between them would otherwise strand the
        # prize in this account's own wallet with the next run's allocation
        # reading zero.
        _write_pending(pending_path, claimed, rain_id)
        client.send.deposit(
            args=DepositArgs(payment=_payment(client, address, claimed), rain_id=rain_id)
        )
        _write_pending(pending_path, 0)
        emit("redeposited", f"Round {current}: put {claimed} back into rain {rain_id}",
             round=current, app_id=app_id, rain_id=rain_id, amount=claimed)

    if not acted:
        emit("idle", f"Round {current}: nothing to resolve, abandon or claim",
             round=current, app_id=app_id)
    return acted


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="run a single scan, then exit")
    net.add_network_argument(parser)
    parser.add_argument(
        "--app-id", type=int, default=None, help="rain app id (default: RAIN_APP_ID)"
    )
    parser.add_argument(
        "--poll-seconds",
        type=int,
        default=int(os.environ.get("RAIN_POLL_SECONDS", POLL_SECONDS_DEFAULT)),
        help="seconds between scans in loop mode (default: %(default)s)",
    )
    parser.add_argument(
        "--min-balance",
        type=int,
        default=int(os.environ.get("RAIN_MIN_BALANCE", LOW_BALANCE_MICROALGO)),
        help="warn below this signer balance in µALGO (default: %(default)s)",
    )
    parser.add_argument(
        "--log-format",
        choices=("text", "json"),
        default=os.environ.get("ARCRON_LOG_FORMAT", "text"),
        help="one JSON object per line for log shipping (default: %(default)s)",
    )
    parser.add_argument(
        "--state-file",
        type=Path,
        default=None,
        help="where to persist a claimed-not-yet-deposited amount (default: under XDG_STATE_HOME)",
    )
    parser.add_argument(
        "--no-state",
        action="store_true",
        help="keep pending-deposit tracking in memory only; nothing is written to disk",
    )
    args = parser.parse_args(argv)

    global emit
    as_json = args.log_format == "json"
    if as_json:
        for handler in logging.getLogger().handlers:
            handler.setFormatter(logging.Formatter("%(message)s"))
    emit = Emitter(as_json=as_json)
    shutdown = Shutdown()
    shutdown.install()

    algorand = net.connect(args.network)
    app_id = resolve_app_id(parser, args.app_id)
    algod = algorand.client.algod

    try:
        bot = algorand.account.from_environment("RAIN")
    except Exception:
        bot = algorand.account.from_environment("DEPLOYER")

    balance = guard_balance(algod, bot.address, args.min_balance)
    client = RainClient(
        algorand=algorand,
        app_id=app_id,
        default_sender=bot.address,
        default_signer=bot.signer,
    )
    pending_path = (
        None if args.no_state else (args.state_file or default_pending_path(args.network, app_id))
    )
    emit(
        "started",
        f"rain bot {bot.address} watching app {app_id}",
        account=bot.address,
        app_id=app_id,
        network=args.network,
        balance=balance,
        pending_state=str(pending_path) if pending_path else "memory",
    )

    if args.once:
        scan_once(algod, client, app_id, bot.address, pending_path)
        return

    while True:
        if shutdown.requested:
            emit("stopped", "Shutting down cleanly")
            return
        try:
            scan_once(algod, client, app_id, bot.address, pending_path)
            guard_balance(algod, bot.address, args.min_balance)
        except KeyboardInterrupt:
            emit("stopped", "Interrupted; exiting")
            return
        except Exception as exc:
            emit(
                "scan_failed",
                f"{exc}; retrying in {args.poll_seconds}s",
                level=logging.WARNING,
                reason=str(exc)[:400],
            )
        for _ in range(args.poll_seconds):
            if shutdown.requested:
                break
            time.sleep(1)


if __name__ == "__main__":
    main()
