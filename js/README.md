# @corvidlabs/arcron-rain

Reading the Rain hub's boxes and building the transactions a holder sends it.
No UI framework, no backend, no indexer. Everything here comes from box state
any algod will serve.

```ts
import { decodeRainRec, rainBoxName, rainStanding } from '@corvidlabs/arcron-rain/rain';
import { enter } from '@corvidlabs/arcron-rain/rain-txns';

const raw = await algod.getApplicationBoxByName(appId, rainBoxName(1n)).do();
const rain = decodeRainRec(1n, raw.value);
rainStanding(rain, currentRound); // 'due' | 'scheduled' | 'waiting'
```

Four entry points, no root export:

| import | what it is |
|---|---|
| `./rain` | box names, the box decoder, MBR and fee constants, the live hub's id, the display helpers |
| `./rain-abi` | every method signature, checked against the compiled artifact |
| `./rain-txns` | `AtomicTransactionComposer` builders for the calls a person sends |
| `./vendor` | the handful of things copied from CorvidLabs/arcron — see below |

`TESTNET_RAIN` in `./rain` is the one place the deployment is written down: hub
**770746178**, upkeep **113**, keeper app 769891898. Its docstring says why the
previous hub's id appears nowhere, and
`scripts/verify_build.py --contract rain --app-id 770746178` in the repository
root is what turns that constant into something checkable.

`draw` has no builder and never will: it is the Arcron hook, sent by a keeper
on a schedule. `rain-abi.test.ts` holds the list of methods with no builder and
the reason for each, so a gap has to be argued for rather than merely
happening — which is how `abandon` went a whole contract's lifetime with no way
to send it, and it is why `set_rain`, still without one, is at least written
down as a gap rather than forgotten.

## Installing

**Nothing publishes this, and nothing is planned to.** It is consumed from
inside the repository — `web/` depends on it as a workspace package — and it is
not on npm or GitHub Packages under any name. If you want it, copy `src/`,
which is what this package does to its own upstream one directory down. The
version in `package.json` is `0.1.0` and means nothing; the hub id in `./rain`
is the number that matters.

`algosdk` v3 is a peer dependency you install yourself. This ships **raw
TypeScript**, deliberately: it is the same source the tests here pin against
the compiled contract, with no build step in between. That means the consumer
must be a bundler — Bun, Vite, esbuild, Angular, Next. Plain `node` cannot
import it at any version, because Node refuses to strip types from files under
`node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).

## `src/vendor.ts`

Rain runs on the Arcron keeper network, so this client is built on Arcron's,
and by rights `vendor.ts` would be `import { … } from '@corvidlabs/arcron'`.
It is a copy instead because that package is published to GitHub Packages,
which will not serve a package — public or not — without a token scoped to
`read:packages`. A dependency on it would make `bun install` fail here for
anyone who has not been granted one, in a public repository. Three hundred and
twenty lines, 184 of them code, buys that back. It carries ALGO and token
formatting, the signing pair, and the decoder for the one keeper box the page
reads to know when a drop is expected. The file says what would let it be
deleted; the reasoning
in full is [`arcron/docs/design/split.md`](https://github.com/CorvidLabs/arcron/blob/main/docs/design/split.md),
decision D7.

Fix a bug in it by fixing it in arcron first and copying the fix down. Edited
in place, the two repositories quietly stop agreeing about what a transaction
needs, which is the exact failure vendoring is always paying for.

## Tests

```sh
bun install
bun test
```

88 tests on 2026-09-03, all in `rain-abi.test.ts`. It reads
`smart_contracts/artifacts/rain/Rain.arc56.json` from the repository root, so
the contract has to have been built (`poetry run python -m smart_contracts
build`) before the suite will load. That coupling is the point: a signature
here that has drifted from the compiled contract is a failed test rather than a
rejected transaction in front of a user.

What it cannot check is that a transaction it builds is accepted by a chain.
Nothing here talks to algod. That is settled one directory up, by the LocalNet
demos and `web/scripts/localnet-txns.ts`.

## What it does not do

No signing and no wallet handling. `rain-txns.ts` builds an
`AtomicTransactionComposer` group and takes a `TransactionSigner`, so how a
person authorises anything is entirely yours. A payment or asset-transfer
argument is signed by that same function: a second signer on the payment is
two wallet popups, because `gatherSignatures` treats each function identity
as a separate prompt.
