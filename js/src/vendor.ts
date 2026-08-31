/**
 * The handful of things Rain's client needs from `@corvidlabs/arcron`, copied.
 *
 * Rain runs on the Arcron keeper network and its client is built on Arcron's,
 * so by rights every symbol below would arrive as
 * `import { … } from '@corvidlabs/arcron'`. It does not, because that package
 * cannot be installed without credentials. It is published to GitHub Packages,
 * and GitHub Packages refuses to serve a package without an authenticated
 * token scoped to `read:packages` — even a package it reports as public, since
 * visibility and read access are separate things on that registry. Depending
 * on it would mean `bun install` failing in a public repository for anyone who
 * has not first been granted and configured a token, which is the opposite of
 * what a public repository is for. Sixty-odd lines of copy buys that back.
 *
 * Nothing here is Rain's, and nothing here should grow. Fix a bug in this file
 * only by fixing it in arcron first and copying the fix down; edit it in place
 * and the two repositories quietly stop agreeing about what a transaction
 * needs, which is the failure vendoring is always paying for.
 *
 * Delete this file the day `@corvidlabs/arcron` is installable without a token
 * — published to npmjs.org, or reachable some other tokenless way — and point
 * `rain.ts` and `rain-txns.ts` at the package instead. Nothing else imports it.
 */

import algosdk from 'algosdk';

// From `js/src/keeper-txns.ts` in CorvidLabs/arcron.

export interface Signing {
  readonly sender: string;
  readonly signer: algosdk.TransactionSigner;
}

/** A confirmed call: the round it landed in and whatever the method returned. */
export interface CallResult<Value = bigint | undefined> {
  readonly txId: string;
  readonly confirmedRound: bigint;
  readonly returnValue: Value;
}

/** The four legacy foreign-reference arrays a v1 AVM app call still uses. */
export interface ResourceRefs {
  readonly appAccounts: readonly string[];
  readonly appForeignApps: readonly number[];
  readonly appForeignAssets: readonly number[];
  readonly boxes: readonly { appIndex: number; name: Uint8Array }[];
}

/**
 * Fold a simulate response's `unnamedResourcesAccessed` into `known`, the same
 * union `algokit-utils`' `populate_app_call_resources` produces.
 *
 * Pure, with no `algod` argument, so this folding logic can be tested without
 * a node; the network round trip is the caller's. `callingAppId` is the app
 * being called, so a reference to it (or the sentinel `0` the API uses for
 * "the calling app") needs no declaration of its own.
 */
export function foldUnnamedResources(
  known: ResourceRefs,
  unnamed: algosdk.modelsv2.SimulateUnnamedResourcesAccessed | undefined,
  callingAppId: number,
): ResourceRefs {
  if (!unnamed) return known;

  const accounts = new Set(known.appAccounts);
  const apps = new Set(known.appForeignApps);
  const assets = new Set(known.appForeignAssets);
  const boxes = [...known.boxes];
  const zero = algosdk.Address.zeroAddress();

  const addAccount = (address: algosdk.Address) => {
    if (!address.equals(zero)) accounts.add(address.toString());
  };
  const addApp = (id: bigint) => {
    if (id !== 0n && id !== BigInt(callingAppId)) apps.add(Number(id));
  };

  for (const address of unnamed.accounts ?? []) addAccount(address);
  for (const app of unnamed.apps ?? []) addApp(app);
  for (const asset of unnamed.assets ?? []) assets.add(Number(asset));
  for (const box of unnamed.boxes ?? []) {
    const isOwn = box.app === 0n || box.app === BigInt(callingAppId);
    if (!isOwn) addApp(box.app);
    boxes.push({ appIndex: isOwn ? 0 : Number(box.app), name: box.name });
  }
  // A holding or a local read needs the account AND the asset or app present;
  // the legacy arrays have no reference shape narrower than that cross
  // product, so this is the closest a v1 app call can declare either.
  for (const holding of unnamed.assetHoldings ?? []) {
    addAccount(holding.account);
    assets.add(Number(holding.asset));
  }
  for (const local of unnamed.appLocals ?? []) {
    addAccount(local.account);
    addApp(local.app);
  }
  // Extra box references bump the box I/O budget without naming a box: an
  // empty reference asks for exactly that and nothing else.
  for (let index = 0; index < (unnamed.extraBoxRefs ?? 0); index += 1) {
    boxes.push({ appIndex: 0, name: new Uint8Array(0) });
  }

  return {
    appAccounts: [...accounts],
    appForeignApps: [...apps],
    appForeignAssets: [...assets],
    boxes,
  };
}

// From `js/src/format.ts` in CorvidLabs/arcron. µALGO and base units are what
// the contract counts in; nobody reads a pot in millionths.

const MICRO_ALGO_IN_ALGO = 1_000_000n;
const MAX_DECIMALS = 6;

/** "1.5 ALGO", "0.004 ALGO", "0 ALGO", with trailing zeros trimmed. */
export function algos(microAlgo: bigint, options: { sign?: boolean } = {}): string {
  const negative = microAlgo < 0n;
  const magnitude = negative ? -microAlgo : microAlgo;
  const whole = (magnitude / MICRO_ALGO_IN_ALGO).toLocaleString('en-US');
  const fraction = (magnitude % MICRO_ALGO_IN_ALGO)
    .toString()
    .padStart(MAX_DECIMALS, '0')
    .replace(/0+$/, '');
  const value = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  const prefix = negative ? '−' : options.sign ? '+' : '';
  return `${prefix}${value} ALGO`;
}

/**
 * Base units of an ASA as whole tokens: "1.5", "0.004", "1,000", with
 * trailing zeros trimmed. The unit name is the caller's to append.
 */
export function tokens(baseUnits: bigint, decimals: number): string {
  if (decimals <= 0) return baseUnits.toLocaleString('en-US');
  const scale = 10n ** BigInt(decimals);
  const negative = baseUnits < 0n;
  const magnitude = negative ? -baseUnits : baseUnits;
  const whole = (magnitude / scale).toLocaleString('en-US');
  const fraction = (magnitude % scale)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  const value = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `−${value}` : value;
}

// From `js/src/networks.ts` in CorvidLabs/arcron. Only the key: which chain a
// deployment is on. Rain has no need for arcron's node configs, and its own
// console will bring its own.

export type NetworkKey = 'localnet' | 'testnet';
