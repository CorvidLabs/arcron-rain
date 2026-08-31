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

Three entry points, no root export:

| import | what it is |
|---|---|
| `./rain` | box names, the box decoder, MBR and fee constants, the display helpers |
| `./rain-abi` | every method signature, checked against the compiled artifact |
| `./rain-txns` | `AtomicTransactionComposer` builders for the calls a person sends |

`draw` has no builder and never will: it is the Arcron hook, sent by a keeper
on a schedule. `rain-abi.test.ts` holds the list of methods with no builder and
the reason for each, so a gap has to be argued for rather than merely
happening — which is how `abandon` went a whole contract's lifetime with no way
to send it.

## Installing

Nothing publishes this yet. It is consumed from inside the repository, and the
version number will start tracking the deployment ladder once there is a
deployment to track. If you want it before then, copy `src/` — which is what
this package does to its own upstream, one directory down.

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
anyone who has not been granted one, in a public repository. Sixty-odd lines of
copy buys that back. The file says what would let it be deleted; the reasoning
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

`rain-abi.test.ts` reads `smart_contracts/artifacts/rain/Rain.arc56.json` from
the repository root, so the contract has to have been built (`poetry run python
-m smart_contracts build`) before the suite will load. That coupling is the
point: a signature
here that has drifted from the compiled contract is a failed test rather than a
rejected transaction in front of a user.

## What it does not do

No signing and no wallet handling. `rain-txns.ts` builds an
`AtomicTransactionComposer` group and takes a `TransactionSigner`, so how a
person authorises anything is entirely yours.
