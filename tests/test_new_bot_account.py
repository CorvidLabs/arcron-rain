"""The throwaway key generator, checked without printing a key.

Every assertion here is about shape, permissions and refusals. None of them
prints a mnemonic, and the files are written under pytest's tmp_path rather
than into the repository.
"""

import logging

from algosdk import account, mnemonic

from scripts.new_bot_account import main


def _phrase(path) -> str:
    line = [ln for ln in path.read_text().splitlines() if ln.startswith("RAIN_MNEMONIC=")][0]
    return line.split("=", 1)[1].strip().strip('"')


def test_the_mnemonic_written_rebuilds_the_address_printed(tmp_path, caplog) -> None:
    """A file that does not rebuild its own address fails at signing time.

    Which is on a machine that has nothing else, so it is checked here and
    again in the script before it writes.
    """
    caplog.set_level(logging.INFO)
    out = tmp_path / ".env.testnet.bot"
    assert main(["--out", str(out)]) == 0

    rebuilt = account.address_from_private_key(mnemonic.to_private_key(_phrase(out)))
    assert rebuilt in caplog.text, "the address printed is not the one the file signs as"


def test_the_file_is_not_world_readable(tmp_path) -> None:
    out = tmp_path / ".env.testnet.bot"
    main(["--out", str(out)])
    assert oct(out.stat().st_mode)[-3:] == "600"


def test_two_runs_do_not_produce_the_same_key(tmp_path) -> None:
    first, second = tmp_path / ".env.testnet.a", tmp_path / ".env.testnet.b"
    main(["--out", str(first)])
    main(["--out", str(second)])
    assert _phrase(first) != _phrase(second)


def test_it_refuses_to_overwrite_a_key_that_may_be_funded(tmp_path) -> None:
    out = tmp_path / ".env.testnet.bot"
    main(["--out", str(out)])
    before = _phrase(out)
    assert main(["--out", str(out)]) == 1
    assert _phrase(out) == before, "a refused run must not touch the file"


def test_force_replaces_it(tmp_path) -> None:
    out = tmp_path / ".env.testnet.bot"
    main(["--out", str(out)])
    before = _phrase(out)
    assert main(["--out", str(out), "--force"]) == 0
    assert _phrase(out) != before


def test_it_refuses_a_name_gitignore_does_not_cover(tmp_path) -> None:
    """`.gitignore` covers `.env.*`, and nothing else here is safe by default.

    A mnemonic under a tracked path is one `git add -A` from being public,
    and this repository is public.
    """
    out = tmp_path / "bot-key.txt"
    assert main(["--out", str(out)]) == 1
    assert not out.exists()


def test_the_mnemonic_is_not_printed_unless_asked(tmp_path, caplog) -> None:
    caplog.set_level(logging.INFO)
    out = tmp_path / ".env.testnet.bot"
    main(["--out", str(out)])
    assert _phrase(out) not in caplog.text

    shown = tmp_path / ".env.testnet.shown"
    main(["--out", str(shown), "--show"])
    assert _phrase(shown) in caplog.text
