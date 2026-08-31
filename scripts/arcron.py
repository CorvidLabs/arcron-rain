"""Everything Rain borrows from the Arcron keeper network, copied not imported.

Rain is a *target*: it does nothing on a schedule by itself, and every script
here that proves a draw fires end to end needs a keeper registry to register
an upkeep on and a keeper bot to execute it. In the arcron repository those
came from `scripts/keeper_e2e.py`, `scripts/keeper_bot.py` and
`smart_contracts/keeper/`, all of which stayed behind in the split.

This is a copy because there is nothing to depend on. The arcron repository
sets `package-mode = false` in its `pyproject.toml`: its Python is a set of
scripts run out of a checkout, not a distribution with a name and a version,
so `poetry add arcron` has nothing to resolve. Vendoring is the honest form
of that fact rather than a shortcut around it — a git dependency would pull
the whole keeper contract, its tests and its deployment tooling into a
repository whose subject is a lottery.

**What would make this file unnecessary:** arcron publishing its Python as a
real package (the TypeScript half already is, as `@corvidlabs/arcron`). On
that day this module becomes a handful of re-exports and then nothing.

**What is kept in step by hand until then.** Two of these are not merely
copied code but *mirrors of on-chain behaviour*, and a keeper that disagrees
with the contract is worse than no keeper at all:

  * `CATCH_UP`/`SKIP_AHEAD` and `BOX_MBR_FIXED` are the keeper contract's own
    constants (`smart_contracts/keeper/contract.py` over there).
  * `_decode_upkeep` and `effective_fee` reimplement, respectively, the box
    layout the contract writes and the fee escalation it charges.

`HEAD_BYTES` is the guard on the first of those: the contract always writes
130 as the tail offset, so a box from a keeper this decoder does not
understand is refused rather than read as zeros. The second has no such
guard, and a stale copy would only overpay or underbid.

The one thing here that is not a faithful copy is `deploy_keeper`, which is
deliberately narrower than the original: see its docstring.
"""

import base64
import contextlib
import hashlib
import json
import logging
import signal
from dataclasses import dataclass, replace
from types import FrameType

import algokit_utils
from algosdk import abi, encoding

from scripts import network as net

# Re-exported so nothing else in this repository has to reach into
# `smart_contracts.artifacts.keeper` directly. That directory is generated
# code committed from the other repository, and routing every use of it
# through this one module is what makes the vendored surface countable.
from smart_contracts.artifacts.keeper.keeper_client import (
    CancelArgs,
    ExecuteArgs,
    KeeperClient,
    KeeperFactory,
    RegisterArgs,
)

logger = logging.getLogger(__name__)

__all__ = [
    "BOX_MBR_FIXED",
    "CATCH_UP",
    "CancelArgs",
    "Emitter",
    "ExecuteArgs",
    "KeeperClient",
    "KeeperFactory",
    "RegisterArgs",
    "SKIP_AHEAD",
    "Shutdown",
    "Upkeep",
    "_assert",
    "_box_mbr",
    "_quiet",
    "_read_upkeep",
    "_selector",
    "deploy_keeper",
    "effective_fee",
    "emit",
    "run_keeper_once",
    "scan_upkeeps",
    "select_due",
]


# MARK: - Contract constants (mirrors smart_contracts/keeper/contract.py)

# Catch-up policy. Zero is the keeper's default behaviour, so an upkeep that
# says nothing means what upkeeps have always meant.
CATCH_UP = 0
SKIP_AHEAD = 1
# Box minimum balance, less the argument list: 2,500 µALGO per box plus 400
# per byte of name and value. The name is 9 bytes (b"u" + itob(id)) and the
# Upkeep head is 130. Unlike a `byte[]`, a `byte[][]` carries its own length
# prefix inside the encoding, so the whole tail is `call_args.bytes`. A box
# therefore costs BOX_MBR_FIXED + 400 * len(encoded call_args) µALGO.
BOX_MBR_FIXED = 2_500 + 400 * 139
# The ARC-4 head of an Upkeep, in bytes. Also the value the contract writes as
# the offset to the argument list, which makes it a version fingerprint.
HEAD_BYTES = 130

# Covers the two inner transactions (app call + keeper payment); the outer
# fee is the standard 1,000 µALGO.
EXTRA_FEE_MICROALGO = 2_000
# The bonus transfer, when an upkeep pays one and this keeper can receive it.
# Overpaying is harmless: an unused fee is simply not charged.
BONUS_FEE_MICROALGO = 1_000
# A ceiling on the outer fee, so a node reporting an inflated per-byte fee is
# refused rather than signed for. Ten times the minimum leaves room for
# genuine congestion pricing and still refuses a number that could only be
# wrong.
MAX_OUTER_FEE_MICROALGO = 10_000


# MARK: - Logging and shutdown (from scripts/keeper_bot.py)


class Emitter:
    """Human lines by default; one JSON object per line for log shipping.

    A keeper's logs have to answer "did upkeep N fire, and when?" months
    later, so every event carries the round and the upkeep it concerns.
    """

    def __init__(self, as_json: bool = False) -> None:
        self.as_json = as_json

    def __call__(self, event: str, message: str, level: int = logging.INFO, **fields) -> None:
        if self.as_json:
            logger.log(level, json.dumps({"event": event, **fields}, default=str))
        else:
            logger.log(level, message)


emit = Emitter()


class Shutdown:
    """SIGTERM means finish what you are doing, then stop.

    A redeploy must not abandon a half-signed execution, so the flag is
    checked between upkeeps rather than interrupting one.
    """

    def __init__(self) -> None:
        self.requested = False

    def install(self) -> None:
        for received in (signal.SIGTERM, signal.SIGINT):
            signal.signal(received, self._request)

    def _request(self, signum: int, frame: FrameType | None) -> None:
        if self.requested:  # a second signal means "now"
            raise KeyboardInterrupt
        self.requested = True
        emit(
            "shutdown_requested",
            f"Signal {signum} received; finishing the current scan then exiting",
            signal=signum,
        )


# MARK: - Reading the registry (from scripts/keeper_bot.py)


@dataclass
class Upkeep:
    upkeep_id: int
    # The account that registered it, and the only one that can cancel it.
    creator: str
    target_app: int
    interval_rounds: int
    next_execution_round: int
    fee_per_execution: int
    balance: int
    times_executed: int
    policy: int
    fee_cap: int
    last_serviced_round: int
    fee_asset: int
    asset_fee: int
    asset_balance: int


def _as_bytes(value: object) -> bytes:
    # algosdk returns box names/values as bytes or base64 str depending on
    # version; accept both.
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    return base64.b64decode(value)  # type: ignore[arg-type]


def _decode_upkeep(upkeep_id: int, raw: bytes) -> Upkeep:
    """Decode a box value of the keeper contract's Upkeep ARC-4 struct.

    ABI head/tail layout: a 32-byte creator, then the static fields inline,
    with the dynamic argument list in the tail (the offset at bytes [40:42]
    points to it; nothing here needs it, since the contract stores and sends
    it itself). The head is 130 bytes.

    Rejects anything that is not this struct rather than decoding it. A box
    from an older keeper is shorter, and reading past its end silently yields
    zeros and garbage, so a fee would be computed from numbers that were never
    in the box. The tail offset is the cheapest possible fingerprint: the
    contract always writes 130 there.
    """
    if len(raw) < HEAD_BYTES + 2:
        raise ValueError(
            f"upkeep {upkeep_id}: box is {len(raw)} bytes, too short to be an Upkeep"
        )
    tail_offset = int.from_bytes(raw[40:42], "big")
    if tail_offset != HEAD_BYTES:
        raise ValueError(
            f"upkeep {upkeep_id}: tail offset is {tail_offset}, not {HEAD_BYTES}; "
            f"this box was written by a different version of the keeper contract"
        )
    return Upkeep(
        upkeep_id=upkeep_id,
        creator=encoding.encode_address(raw[0:32]),
        target_app=int.from_bytes(raw[32:40], "big"),
        interval_rounds=int.from_bytes(raw[42:50], "big"),
        next_execution_round=int.from_bytes(raw[50:58], "big"),
        fee_per_execution=int.from_bytes(raw[58:66], "big"),
        balance=int.from_bytes(raw[66:74], "big"),
        times_executed=int.from_bytes(raw[74:82], "big"),
        policy=int.from_bytes(raw[82:90], "big"),
        fee_cap=int.from_bytes(raw[90:98], "big"),
        last_serviced_round=int.from_bytes(raw[98:106], "big"),
        fee_asset=int.from_bytes(raw[106:114], "big"),
        asset_fee=int.from_bytes(raw[114:122], "big"),
        asset_balance=int.from_bytes(raw[122:130], "big"),
    )


def scan_upkeeps(algod, app_id: int) -> list[Upkeep]:
    upkeeps: list[Upkeep] = []
    token: str | None = None
    while True:  # paginate the box list
        kwargs = {"next": token} if token else {}
        page = algod.application_boxes(app_id, **kwargs)
        for box in page["boxes"]:
            name = _as_bytes(box["name"])
            if name[:1] != b"u":
                continue
            raw = _as_bytes(algod.application_box_by_name(app_id, name)["value"])
            upkeeps.append(_decode_upkeep(int.from_bytes(name[1:9], "big"), raw))
        token = page.get("next-token") or None
        if not token:
            return upkeeps


def effective_fee(upkeep: Upkeep, current_round: int) -> int:
    """What `execute` would pay for this upkeep right now.

    The twin of the escalation arithmetic in the keeper contract's `execute`.
    The fee rises linearly from the base to the cap over one missed interval
    and then holds, and lateness is measured from the last service rather than
    from the schedule, so a keeper draining a backlog is paid the ceiling once,
    not once per replay. A zero cap means the fee never moves, and an upkeep
    never bids more than it holds: an escrow below the escalated fee drops back
    to the base fee rather than freezing the upkeep at a price it can never
    pay. A replay of a backlog never escalates at all:
    `next_execution_round <= last_serviced_round` means the upkeep was already
    behind when it last ran.
    """
    base, cap = upkeep.fee_per_execution, upkeep.fee_cap
    if cap <= base or upkeep.next_execution_round <= upkeep.last_serviced_round:
        return base
    interval = max(upkeep.interval_rounds, 1)
    lateness = max(current_round - upkeep.last_serviced_round, 0)
    excess = min(max(lateness - interval, 0), interval)
    fee = base + (cap - base) * excess // interval
    return base if upkeep.balance < fee else fee


def select_due(upkeeps: list[Upkeep], current_round: int) -> list[Upkeep]:
    """The work a keeper should take, in the order it should take it.

    Ordered by what each upkeep pays *now* rather than by registry order:
    escalation exists to change which work a keeper reaches for, and registry
    order would mean a neglected upkeep stays neglected however far its fee has
    risen.
    """
    return sorted(
        (
            upkeep
            for upkeep in upkeeps
            if current_round >= upkeep.next_execution_round
            and upkeep.balance >= effective_fee(upkeep, current_round)
        ),
        key=lambda upkeep: (-effective_fee(upkeep, current_round), upkeep.upkeep_id),
    )


# MARK: - Executing an upkeep (from scripts/keeper_bot.py)


def _merge_unnamed_resources(*accessed: dict | None) -> dict:
    """The union of every unnamed resource algod reported, across as many
    `unnamed-resources-accessed` objects as are passed in.

    A target's own resource needs can be attributed to the whole group or to
    the call's single transaction depending on how algod resolves them, so both
    are read (`_resolve_execute_references` passes both) and merged into one
    set of references to attach.
    """
    accounts: list[str] = []
    apps: list[int] = []
    assets: list[int] = []
    boxes: list[tuple[int, bytes]] = []
    extra_box_refs = 0

    def account(address: str) -> None:
        if address not in accounts:
            accounts.append(address)

    def app(app_id: int) -> None:
        if app_id not in apps:
            apps.append(app_id)

    def asset(asset_id: int) -> None:
        if asset_id not in assets:
            assets.append(asset_id)

    def box(app_id: int, name: bytes) -> None:
        if (app_id, name) not in boxes:
            boxes.append((app_id, name))

    for source in accessed:
        if not source:
            continue
        for address in source.get("accounts") or []:
            account(address)
        for app_id in source.get("apps") or []:
            app(int(app_id))
        for asset_id in source.get("assets") or []:
            asset(int(asset_id))
        for entry in source.get("boxes") or []:
            box(int(entry["app"]), base64.b64decode(entry["name"]))
        for holding in source.get("asset-holdings") or []:
            account(holding["account"])
            asset(int(holding["asset"]))
        for local in source.get("app-locals") or []:
            account(local["account"])
            app(int(local["app"]))
        extra_box_refs = max(extra_box_refs, source.get("extra-box-refs") or 0)

    return {
        "accounts": accounts,
        "apps": apps,
        "assets": assets,
        "boxes": boxes,
        "extra_box_refs": extra_box_refs,
    }


def _resolve_execute_references(
    client: KeeperClient, upkeep: Upkeep, extra_fee: int
) -> algokit_utils.CommonAppCallParams:
    """What `execute(upkeep_id)` needs to reach its target, named directly.

    algokit-utils' own resource populator would discover this for us, but its
    default spreader caps at four direct account references per transaction and
    refuses a fifth with "No more transactions below reference limit", even
    though the AVM allows up to six references for a target once the two the
    keeper itself always spends are set aside (the upkeep's own box and the
    target app). Both of those are already known, so only what the target
    itself reaches for has to be discovered by simulating first, and everything
    is then attached by hand rather than left for that populator, which the
    real send is told not to run at all.

    A `rain` draw is exactly the case this exists for: `draw()` writes the rain
    box and the winner's allocation box, and neither is nameable from the
    upkeep alone.
    """
    box_ref = algokit_utils.BoxReference(
        app_id=0, name=b"u" + upkeep.upkeep_id.to_bytes(8, "big")
    )
    base_params = algokit_utils.CommonAppCallParams(
        box_references=[box_ref],
        app_references=[upkeep.target_app],
        extra_fee=algokit_utils.AlgoAmount(micro_algo=extra_fee),
        # A ceiling on what this will sign, rather than trusting the node's
        # suggested per-byte fee.
        max_fee=algokit_utils.AlgoAmount(micro_algo=MAX_OUTER_FEE_MICROALGO + extra_fee),
    )
    simulated = (
        client.new_group()
        .execute(args=ExecuteArgs(upkeep_id=upkeep.upkeep_id), params=base_params)
        .simulate(allow_unnamed_resources=True)
    )
    group_response = simulated.simulate_response["txn-groups"][0]
    accessed = _merge_unnamed_resources(
        group_response.get("unnamed-resources-accessed"),
        *(
            result.get("unnamed-resources-accessed")
            for result in group_response.get("txn-results", [])
        ),
    )
    extra_boxes = [
        algokit_utils.BoxReference(app_id=box_app, name=box_name)
        for box_app, box_name in accessed["boxes"]
    ] + [
        algokit_utils.BoxReference(app_id=0, name=b"")
        for _ in range(accessed["extra_box_refs"])
    ]
    return replace(
        base_params,
        account_references=accessed["accounts"] or None,
        app_references=[upkeep.target_app, *accessed["apps"]],
        asset_references=accessed["assets"] or None,
        box_references=[box_ref, *extra_boxes],
    )


def run_keeper_once(network: str, app_id: int) -> int:
    """Execute every due upkeep on `app_id`, once. Returns how many fired.

    Stands in for `poetry run python -m scripts.keeper_bot --once` over in the
    arcron repository, which is what the rain demos used to shell into. It is
    the executing core of that bot and nothing else: no backoff state, no
    sweeping, no balance guard, no JSON log format, because none of those are
    about whether a draw fires and all of them are an operator's concern rather
    than a demo's.

    It also lets a failed execution raise instead of recording it and moving
    on, which is the one behaviour deliberately opposite to the real bot's. A
    keeper servicing strangers' upkeeps must survive one broken target; a demo
    that swallows the failure only fails three lines later on an assertion
    about a pot that never moved, and says nothing about why.

    Signs as KEEPER, which on LocalNet is a KMD wallet created and funded on
    demand, so no mnemonic is needed.
    """
    algorand = net.connect(network)
    algod = algorand.client.algod
    keeper = algorand.account.from_environment("KEEPER")
    client = KeeperClient(
        algorand=algorand,
        app_id=app_id,
        default_sender=keeper.address,
        default_signer=keeper.signer,
    )

    current = algod.status()["last-round"]
    due = select_due(scan_upkeeps(algod, app_id), current)
    emit(
        "scan",
        f"Round {current}: {len(due)} due on app {app_id}",
        round=current,
        app_id=app_id,
        due=len(due),
    )
    # An upkeep offering an ASA bonus sends a third inner transaction, and only
    # a keeper opted in to that asset can receive it. Asking the same question
    # the contract asks keeps the fee off executions that could never pay one.
    opted_in = {
        holding["asset-id"]
        for holding in algod.account_info(keeper.address).get("assets", [])
    }
    for upkeep in due:
        extra_fee = EXTRA_FEE_MICROALGO
        if (
            upkeep.fee_asset > 0
            and upkeep.asset_balance >= upkeep.asset_fee
            and upkeep.fee_asset in opted_in
        ):
            extra_fee += BONUS_FEE_MICROALGO
        response = client.send.execute(
            args=ExecuteArgs(upkeep_id=upkeep.upkeep_id),
            params=_resolve_execute_references(client, upkeep, extra_fee),
            # Every reference the call needs is already named directly above,
            # so the populator has nothing left to add and its four-account cap
            # is sidestepped rather than collided with.
            send_params=algokit_utils.SendParams(populate_app_call_resources=False),
        )
        emit(
            "executed",
            f"Executed upkeep {upkeep.upkeep_id} (target app {upkeep.target_app}); "
            f"next due round {response.abi_return}",
            round=current,
            upkeep_id=upkeep.upkeep_id,
            target_app=upkeep.target_app,
            next_due_round=response.abi_return,
            tx_id=response.tx_id,
        )
    return len(due)


# MARK: - Test helpers (from scripts/keeper_e2e.py)


def _selector(signature: str) -> bytes:
    return hashlib.new("sha512_256", signature.encode()).digest()[:4]


def _encode_args(call_args: list[bytes]) -> bytes:
    """The ARC-4 `byte[][]` an upkeep stores."""
    return abi.ABIType.from_string("byte[][]").encode([list(a) for a in call_args])


def _box_mbr(call_args: list[bytes] | bytes) -> int:
    """What one upkeep box costs, per the keeper contract's own constant."""
    if isinstance(call_args, (bytes, bytearray)):
        call_args = [bytes(call_args)]
    return BOX_MBR_FIXED + 400 * len(_encode_args(call_args))


def _read_upkeep(algorand, app_id: int, upkeep_id: int):
    """Read one upkeep box, decoded with the keeper's own decoder."""
    name = b"u" + upkeep_id.to_bytes(8, "big")
    raw = _as_bytes(algorand.client.algod.application_box_by_name(app_id, name)["value"])
    return _decode_upkeep(upkeep_id, raw), raw


@contextlib.contextmanager
def _quiet():
    """Mute algokit's own logging of a rejection we are deliberately causing."""
    previous = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    try:
        yield
    finally:
        logging.disable(previous)


def _assert(label: str, actual, expected) -> None:
    assert actual == expected, f"{label}: expected {expected}, got {actual}"
    logger.info(f"  ✔ {label} = {actual}")


# MARK: - Deploying a keeper


def deploy_keeper() -> KeeperClient:
    """Create a throwaway keeper registry on LocalNet. Returns its client.

    Deliberately narrower than the `deploy` it was copied from. Over in the
    arcron repository that function creates the real thing, and it guards
    MainNet because a keeper's creator can never be changed afterwards. Here
    the keeper is a **test fixture**: something for a demo to register an
    upkeep on so a `draw` can be proved to fire. Rain does not own the keeper
    network, does not operate one, and must never be the path by which one
    comes into existence on a chain anybody else is using — so this refuses
    every network but LocalNet, TestNet included.

    It compiles nothing. `KeeperFactory` carries the keeper's approval and
    clear programs inside the generated client that was copied with it, which
    is why the keeper's Algorand Python source did not have to come along.
    """
    algorand = algokit_utils.AlgorandClient.from_environment()
    genesis = algorand.client.algod.suggested_params().gen
    if genesis not in net.genesis_ids(net.LOCALNET):
        raise RuntimeError(
            f"Refusing to create a keeper on {genesis!r}. In this repository the "
            f"keeper is a test fixture for the rain demos, never a deployment: "
            f"arcron-rain vendors a copy of the keeper's compiled programs and "
            f"has no business putting them on a shared chain. Register against a "
            f"keeper that already exists instead (see scripts/rain_testnet_deploy.py), "
            f"or run this on LocalNet."
        )
    deployer = algorand.account.from_environment("DEPLOYER")

    factory = algorand.client.get_typed_app_factory(
        KeeperFactory, default_sender=deployer.address
    )
    app_client, result = factory.deploy(
        on_update=algokit_utils.OnUpdate.AppendApp,
        on_schema_break=algokit_utils.OnSchemaBreak.AppendApp,
    )
    logger.info(
        f"Keeper app {app_client.app_id} deployed "
        f"(operation: {result.operation_performed})"
    )

    # The app account escrows ALGO and holds box MBR, so it must meet the base
    # account MBR (0.1 ALGO). Fund it once, idempotently.
    APP_BASE_MBR = 100_000
    app_balance = algorand.client.algod.account_info(app_client.app_address)["amount"]
    if app_balance < APP_BASE_MBR:
        algorand.send.payment(
            algokit_utils.PaymentParams(
                amount=algokit_utils.AlgoAmount(micro_algo=APP_BASE_MBR),
                sender=deployer.address,
                receiver=app_client.app_address,
            )
        )
        logger.info(f"Funded app account with {APP_BASE_MBR} µALGO base MBR")

    client: KeeperClient = app_client
    return client
