"""Put a pot behind the WAVE rain the deploy script opened and never seeded.

`rain_testnet_deploy` creates both rains and calls `deposit` for the SPLIT one
only, so the WAVE rain has been due since the hub went up and has declined
every `draw` for want of money: `_fire_wave` returns 0 while `pot < paid`.
Sixty-three scheduled calls, no draw, and nothing looked wrong because a rain
with an empty pot is a no-op by design rather than a failure.

This seeds it once, for the hub that is already live. The deploy script is
fixed alongside so a fresh hub does not need this.

Read-only until `--send`:

    poetry run python -m scripts.seed_wave_pot --network testnet --app-id N
    poetry run python -m scripts.seed_wave_pot --network testnet --app-id N --send
"""

import argparse
import base64
import logging

from scripts import network as net

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

RAIN_PREFIX = b"r"
LABEL_BYTES = 32
ADDRESS_BYTES = 32


def read_rain(algod, app_id: int, rain_id: int) -> dict:
    """Decode one rain box. Field order follows RainRec in the contract."""
    name = RAIN_PREFIX + rain_id.to_bytes(8, "big")
    raw = base64.b64decode(algod.application_box_by_name(app_id, name)["value"])
    offset = ADDRESS_BYTES * 2 + LABEL_BYTES
    fields = (
        "prize_asset", "drip", "interval_rounds", "last_rain_round", "pot",
        "tickets", "draw_id", "cumulative", "mode", "wave_cap", "wave_count",
        "last_share", "last_wave_id", "wave_unclaimed", "commit_round",
        "prize_locked",
    )
    out = {"label": raw[64:96].rstrip(b"\x00").decode(errors="replace")}
    for field in fields:
        out[field] = int.from_bytes(raw[offset:offset + 8], "big")
        offset += 8
    return out


SPLIT, ONE, WAVE = 0, 1, 2


def shortfall(rain: dict) -> tuple[int, str]:
    """What the pot needs before this rain will pay, and why if it cannot.

    Mirrors the contract per mode rather than assuming one. The first version
    of this ran WAVE's arithmetic over every rain, so asked about a SPLIT rain
    with no ticket holders it answered "nobody has said gm this wave", which
    is true of a field SPLIT does not use and says nothing about why that rain
    will not fire.
    """
    mode = rain["mode"]
    if mode == WAVE:
        if rain["wave_count"] == 0:
            return 0, "nobody has checked in for this wave, so no pot makes it fire"
        share = rain["drip"] // rain["wave_count"]
        if share == 0:
            return 0, "the drip is smaller than the number of seats, so each share rounds to zero"
        available = rain["pot"] + rain["last_share"] * rain["wave_unclaimed"]
        return max(0, share * rain["wave_count"] - available), ""
    if mode == SPLIT:
        if rain["tickets"] == 0:
            return 0, "nobody holds a ticket, so no pot makes it fire"
        share = rain["drip"] // rain["tickets"]
        if share == 0:
            return 0, "the drip is smaller than the ticket count, so each share rounds to zero"
        return max(0, share * rain["tickets"] - rain["pot"]), ""
    if rain["prize_locked"] > 0:
        return 0, "a draw is already open; it needs resolve or abandon, not money"
    if rain["tickets"] == 0:
        return 0, "nobody holds a ticket, so no pot makes it fire"
    return max(0, rain["drip"] - rain["pot"]), ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    net.add_network_argument(parser)
    parser.add_argument("--app-id", type=int, required=True, help="the rain hub")
    parser.add_argument("--rain-id", type=int, default=2, help="which rain to seed")
    parser.add_argument("--waves", type=int, default=4, help="how many waves to fund")
    parser.add_argument("--send", action="store_true", help="sign and send; otherwise print the plan")
    args = parser.parse_args(argv)

    algorand = net.connect(args.network)
    algod = algorand.client.algod if hasattr(algorand, "client") else algorand
    rain = read_rain(algod, args.app_id, args.rain_id)

    logger.info(f"rain {args.rain_id} '{rain['label']}' on app {args.app_id}")
    logger.info(f"  mode {rain['mode']}  pot {rain['pot']}  drip {rain['drip']}")
    logger.info(f"  wave_count {rain['wave_count']}  wave_unclaimed {rain['wave_unclaimed']}")
    logger.info(f"  draw_id {rain['draw_id']}  last_rain_round {rain['last_rain_round']}")

    need, blocked = shortfall(rain)
    if blocked:
        logger.info(f"Will not fire: {blocked}. Money is not what it is short of.")
        return 0

    amount = max(need, rain["drip"] * args.waves)
    if need == 0:
        logger.info("The pot already covers a wave; this only extends it.")
    logger.info(f"  short by {need} µALGO; would deposit {amount} for about {args.waves} wave(s)")

    if not args.send:
        logger.info("Nothing signed. Re-run with --send to deposit.")
        return 0

    import algokit_utils
    from smart_contracts.artifacts.rain.rain_client import DepositArgs, RainClient

    # Built from the client `net.connect` returned, not from `deploy_config`'s
    # own. That one constructs its AlgorandClient directly, so it never gets
    # the 403 retry `network.connect` installs, and the first attempt at this
    # deposit died on a bare `HTTP Error 403` from a public node.
    deployer = algorand.account.from_environment("DEPLOYER")
    rain_client = algorand.client.get_typed_app_client_by_id(
        RainClient, app_id=args.app_id, default_sender=deployer.address
    )
    app_address = rain_client.app_address
    before = algod.account_info(app_address)["amount"]
    logger.info(f"  depositing {amount} as {deployer.address[:14]}... to {app_address[:14]}...")

    rain_client.send.deposit(
        args=DepositArgs(
            payment=algorand.create_transaction.payment(
                algokit_utils.PaymentParams(
                    sender=deployer.address,
                    receiver=app_address,
                    amount=algokit_utils.AlgoAmount(micro_algo=amount),
                )
            ),
            rain_id=args.rain_id,
        )
    )
    after = algod.account_info(app_address)["amount"]
    seeded = read_rain(algod, args.app_id, args.rain_id)
    logger.info(f"  pot {rain['pot']} -> {seeded['pot']}")
    logger.info(f"  hub account {before} -> {after}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
