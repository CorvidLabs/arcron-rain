"""The bot's `allocation` mirror, checked against the contract that owns it.

`scripts/rain_bot.allocation` reimplements `Rain.allocation_of` from two box
reads, because a scan that simulates once per rain is a scan nobody runs
often. A reimplementation is a thing that goes stale, so it is not trusted
here: every case runs the real contract and compares the two.

Red after a contract change means the mirror is wrong, not the test.
"""

from collections.abc import Iterator

import pytest
from algopy import Asset, arc4
from algopy import op as algopy_op
from algopy_testing import AlgopyTestContext, algopy_testing_context

from scripts.rain_bot import allocation
from smart_contracts.rain.contract import ONE, SPLIT, TICKET_PREFIX, WAVE, Rain
from tests.test_rain import DRIP, INTERVAL, _advance, _bootstrap, _create, _deposit, _enter


@pytest.fixture()
def context() -> Iterator[AlgopyTestContext]:
    with algopy_testing_context() as ctx:
        yield ctx


def _hub(context: AlgopyTestContext) -> Rain:
    hub = Rain()
    _bootstrap(context, hub)
    return hub


def _ticket(context: AlgopyTestContext, hub: Rain, rain_id, who) -> dict | None:
    key = TICKET_PREFIX + algopy_op.itob(rain_id) + who.bytes
    raw = context.ledger.get_box(hub, key)
    if not raw:
        return None
    return {
        "credit": int.from_bytes(raw[0:8], "big"),
        "wave_id": int.from_bytes(raw[8:16], "big"),
        "settled_id": int.from_bytes(raw[16:24], "big"),
    }


def _check(context: AlgopyTestContext, hub: Rain, rain_id, who) -> int:
    """Assert the mirror agrees with the contract; return what both say."""
    rec = hub.rain_of(rain_id)
    rain = {
        "mode": int(rec.mode.native),
        "cumulative": int(rec.cumulative.native),
        "last_share": int(rec.last_share.native),
        "last_wave_id": int(rec.last_wave_id.native),
    }
    ticket = _ticket(context, hub, rain_id, who)
    expected = int(hub.allocation_of(rain_id, arc4.Address(who)))
    assert allocation(rain, ticket) == expected, (
        f"mirror {allocation(rain, ticket)} != contract {expected}; "
        f"mode {rain['mode']}, rain {rain}, ticket {ticket}"
    )
    return expected


def test_an_account_with_no_ticket_is_owed_nothing(context: AlgopyTestContext) -> None:
    hub = _hub(context)
    rain_id = _create(context, hub)
    assert _check(context, hub, rain_id, context.any.account()) == 0


def test_split_before_and_after_a_drop(context: AlgopyTestContext) -> None:
    hub = _hub(context)
    rain_id = _create(context, hub)
    holder = context.any.account()
    _enter(context, hub, rain_id, sender=holder)
    assert _check(context, hub, rain_id, holder) == 0

    _deposit(context, hub, rain_id, 1_000_000)
    _advance(context, INTERVAL)
    assert hub.draw() == 1
    assert _check(context, hub, rain_id, holder) == DRIP


def test_split_latecomer_cannot_pull_the_past(context: AlgopyTestContext) -> None:
    hub = _hub(context)
    rain_id = _create(context, hub)
    first = context.any.account()
    _enter(context, hub, rain_id, sender=first)
    _deposit(context, hub, rain_id, 1_000_000)
    _advance(context, INTERVAL)
    hub.draw()

    late = context.any.account()
    _enter(context, hub, rain_id, sender=late)
    assert _check(context, hub, rain_id, late) == 0
    assert _check(context, hub, rain_id, first) == DRIP


def test_wave_pays_the_seats_it_filled(context: AlgopyTestContext) -> None:
    hub = _hub(context)
    rain_id = _create(context, hub, mode=WAVE, wave_cap=2)
    a, b = context.any.account(), context.any.account()
    _enter(context, hub, rain_id, sender=a, mode=WAVE)
    _enter(context, hub, rain_id, sender=b, mode=WAVE)
    _deposit(context, hub, rain_id, 1_000_000)
    _advance(context, INTERVAL)
    assert hub.draw() == 1

    assert _check(context, hub, rain_id, a) == DRIP // 2
    assert _check(context, hub, rain_id, b) == DRIP // 2


def test_wave_holder_without_a_seat_this_drop(context: AlgopyTestContext) -> None:
    hub = _hub(context)
    rain_id = _create(context, hub, mode=WAVE, wave_cap=1)
    a, c = context.any.account(), context.any.account()
    _enter(context, hub, rain_id, sender=a, mode=WAVE)
    _enter(context, hub, rain_id, sender=c, mode=WAVE)
    _deposit(context, hub, rain_id, 1_000_000)
    _advance(context, INTERVAL)
    hub.draw()

    assert _check(context, hub, rain_id, a) == DRIP
    assert _check(context, hub, rain_id, c) == 0


def test_wave_after_the_holder_has_claimed(context: AlgopyTestContext) -> None:
    """Settled means owed nothing, which is the branch the mirror gets wrong
    if it forgets `settled_id`."""
    hub = _hub(context)
    rain_id = _create(context, hub, mode=WAVE, wave_cap=1)
    a = context.any.account()
    _enter(context, hub, rain_id, sender=a, mode=WAVE)
    _deposit(context, hub, rain_id, 1_000_000)
    _advance(context, INTERVAL)
    hub.draw()
    assert _check(context, hub, rain_id, a) == DRIP

    with context.txn.create_group(active_txn_overrides={"sender": a}):
        hub.claim(rain_id, Asset(0))
    assert _check(context, hub, rain_id, a) == 0


def test_one_mode_is_credit_only(context: AlgopyTestContext) -> None:
    hub = _hub(context)
    rain_id = _create(context, hub, mode=ONE)
    holder = context.any.account()
    _enter(context, hub, rain_id, sender=holder, mode=ONE)
    assert _check(context, hub, rain_id, holder) == 0
