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

/**
 * A typed whole-token amount as the ASA's base units: 1.5 of a 6-decimal
 * asset is 1_500_000n. Rounds to the nearest base unit, the same way the
 * ALGO forms round to the nearest µALGO.
 */
export function toBaseUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function rounds(count: bigint): string {
  const magnitude = count < 0n ? -count : count;
  return `${magnitude.toLocaleString('en-US')} round${magnitude === 1n ? '' : 's'}`;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A duration a person can hold in their head: seconds up to a minute, then
 * minutes, hours, days. One unit of precision, plus a second when it earns
 * its place ("1 d 6 h", not "1 d 6 h 13 min 2 s").
 */
export function duration(seconds: number): string {
  const magnitude = Math.abs(Math.round(seconds));
  if (magnitude < 1) return 'moments';
  if (magnitude < MINUTE) return `${magnitude} s`;
  if (magnitude < HOUR) return split(magnitude, MINUTE, 1, 'min', 's');
  if (magnitude < DAY) return split(magnitude, HOUR, MINUTE, 'h', 'min');
  return split(magnitude, DAY, HOUR, 'd', 'h');
}

/**
 * One unit, plus a second when it earns its place ("1 d 6 h", never
 * "1 d 6 h 13 min"). The remainder is rounded, then carried, so 23.9 hours
 * reads as "1 d" rather than the misleading "23 h".
 */
function split(seconds: number, unit: number, subUnit: number, name: string, subName: string): string {
  let whole = Math.floor(seconds / unit);
  let rest = Math.round((seconds % unit) / subUnit);
  if (rest >= unit / subUnit) {
    whole += 1;
    rest = 0;
  }
  const showRest = rest > 0 && whole < 10 && (subUnit > 1 || rest >= 5);
  return showRest ? `${whole} ${name} ${rest} ${subName}` : `${whole} ${name}`;
}

/** Rounds as time, when we know how fast the chain is moving. */
export function roundsAsTime(count: bigint, secondsPerRound: number | null): string | null {
  if (secondsPerRound === null || secondsPerRound <= 0) return null;
  const magnitude = count < 0n ? -count : count;
  return duration(Number(magnitude) * secondsPerRound);
}

/**
 * Keep a phrase together, so a value only ever wraps where it means something.
 *
 * These labels are "A · B" compounds, and as one plain string they wrap
 * wherever the box runs out: a card on a phone rendered a cadence as
 * "214 rounds · ~8" on one line and "min 55 s" on the next, splitting a
 * duration between its number and its unit. Replacing the spaces *inside* each
 * half with non-breaking ones leaves the separator as the only break
 * opportunity, so a value that must wrap does it between the two facts rather
 * than through one of them.
 */
function unbreakable(phrase: string): string {
  return phrase.replace(/ /g, '\u00a0');
}

/** "every 10 rounds · ~28 s": the round count leads, time explains it. */
export function intervalLabel(intervalRounds: bigint, secondsPerRound: number | null): string {
  const time = roundsAsTime(intervalRounds, secondsPerRound);
  const count = unbreakable(rounds(intervalRounds));
  return time === null ? count : `${count} · ${unbreakable(`~${time}`)}`;
}

/** "due now", "overdue by ~2 min", "in ~1 d 6 h". */
export function dueLabel(untilDue: bigint, secondsPerRound: number | null): string {
  if (untilDue === 0n) return 'due now';
  const time = roundsAsTime(untilDue, secondsPerRound);
  const amount = unbreakable(time === null ? rounds(untilDue) : `~${time}`);
  return untilDue < 0n ? `overdue by ${amount}` : `in ${amount}`;
}

// From `js/src/upkeep.ts` in CorvidLabs/arcron.
//
// Rain does not own an upkeep and never writes one. It reads exactly one box
// on the keeper app — the upkeep that calls `draw()` — so that the page can
// tell "this rain is due" apart from "this rain is due and something is
// coming to fire it". `_fire_split` leaves `last_rain_round` untouched when a
// rain cannot pay, so a dry rain reads as due for ever; the keeper's own
// schedule is the only second opinion available.
//
// Only the read is copied. Registering, cancelling, funding and the fee
// arithmetic are arcron's business and are deliberately absent: nothing in
// Rain's surface may grow a reason to want them.

/** Box names are `"u"` followed by the id as a big-endian uint64. */
const UPKEEP_BOX_NAME_PREFIX = 'u';
const UPKEEP_BOX_NAME_BYTES = 9;
const UPKEEP_HEAD_BYTES = 130;

export interface Upkeep {
  readonly id: bigint;
  readonly creator: string;
  readonly targetApp: bigint;
  readonly intervalRounds: bigint;
  readonly nextExecutionRound: bigint;
  readonly feePerExecution: bigint;
  readonly balance: bigint;
  readonly timesExecuted: bigint;
  /** The round it last ran in, not the round it was scheduled for. */
  readonly lastServicedRound: bigint;
}

export function upkeepBoxName(id: bigint | number): Uint8Array {
  const name = new Uint8Array(UPKEEP_BOX_NAME_BYTES);
  name[0] = UPKEEP_BOX_NAME_PREFIX.charCodeAt(0);
  new DataView(name.buffer).setBigUint64(1, BigInt(id));
  return name;
}

/**
 * Read an upkeep box, refusing anything that is not this exact struct.
 *
 * The tail-offset check is the whole point of throwing rather than returning
 * partial data. A box whose offset has been patched decodes as a plausible
 * upkeep with no call args, so a foreign app's boxes read as ordinary and a
 * reader invents a schedule that is not there. Rain shows the result as "next
 * drop expected around round N"; inventing that number is worse than saying
 * "waiting".
 */
export function decodeUpkeep(id: bigint, raw: Uint8Array): Upkeep {
  if (raw.length < UPKEEP_HEAD_BYTES + 2) {
    throw new Error(`Upkeep box ${id} is ${raw.length} bytes, too short to decode`);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const tailOffset = view.getUint16(40);
  if (tailOffset !== UPKEEP_HEAD_BYTES) {
    throw new Error(
      `Upkeep box ${id} has a tail offset of ${tailOffset}, not ${UPKEEP_HEAD_BYTES}. ` +
        `This is not the keeper's Upkeep struct.`,
    );
  }
  return {
    id,
    creator: algosdk.encodeAddress(raw.subarray(0, 32)),
    targetApp: view.getBigUint64(32),
    intervalRounds: view.getBigUint64(42),
    nextExecutionRound: view.getBigUint64(50),
    feePerExecution: view.getBigUint64(58),
    balance: view.getBigUint64(66),
    timesExecuted: view.getBigUint64(74),
    lastServicedRound: view.getBigUint64(98),
  };
}

/** Rounds until the keeper's next scheduled run; negative once overdue. */
export function roundsUntilDue(upkeep: Upkeep, currentRound: bigint): bigint {
  return upkeep.nextExecutionRound - currentRound;
}

// From `js/src/networks.ts` in CorvidLabs/arcron. Only the key: which chain a
// deployment is on. Rain has no need for arcron's node configs, and its own
// console will bring its own.

export type NetworkKey = 'localnet' | 'testnet';
