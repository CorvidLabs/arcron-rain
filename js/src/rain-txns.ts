/**
 * Building and sending Rain's holder-facing calls.
 *
 * `draw` is the Arcron hook and is not sent from this UI. Create a rain,
 * enter once (SPLIT/ONE) or check in (WAVE), deposit, claim. ONE still
 * needs `resolve` after the committed round, or `abandon` once that
 * round's seed is too old to read.
 */

import algosdk from 'algosdk';

import { rainMethod } from './rain-abi';
import {
  CLAIM_FEE,
  CREATE_FEE,
  DEPOSIT_FEE,
  ENTER_FEE,
  GM_FEE,
  OPT_IN_FEE,
  RAIN_BOX_MBR,
  RESOLVE_FEE,
  ABANDON_FEE,
  // Algorand charges the same flat 0.1 ALGO for an app account's first byte of
  // state and for every asset it goes on to hold, and `rain.ts` already names
  // that number. Vendoring arcron's `ASSET_OPT_IN_MBR` beside it would give a
  // reader two constants to keep in step that the protocol keeps as one.
  APP_BASE_MBR as ASSET_OPT_IN_MBR,
  enterMbr,
  indexBoxName,
  rainBoxName,
  ticketBoxName,
  ONE,
} from './rain';
import { foldUnnamedResources, type CallResult, type ResourceRefs, type Signing } from './vendor';

export type { Signing, CallResult } from './vendor';

export interface CreateRainParams {
  readonly label: Uint8Array;
  readonly gateCreator: string;
  readonly prizeAsset: number | bigint;
  readonly drip: number | bigint;
  readonly intervalRounds: number | bigint;
  readonly mode: number | bigint;
  readonly waveCap: number | bigint;
  /**
   * Opt the hub into the prize asset in the same group. The caller decides:
   * `opt_in_asset` asserts the hub is not already opted in, so including it
   * for an asset the hub holds reverts the whole open.
   */
  readonly optInAsset?: number;
  /**
   * Seed the new rain's pot in the same group. An unseeded rain is not one
   * that starts empty and fills up: `_fire_split` and `_fire_wave` return 0
   * below one payout, so the upkeep calls `draw` on schedule, the rain
   * declines, and nothing reports a problem. Two rains on the live hub sat
   * dead this way, one of them for forty-four hours.
   */
  readonly seedMicroAlgo?: number;
}

/** Which calls a grouped open carries, and which one answers. */
export interface OpenRainPlan {
  readonly optIn: number;
  readonly seed: number;
  /** Index of the `createRain` call among the group's method results. */
  readonly resultIndex: number;
  readonly calls: readonly ('optInPrizeAsset' | 'createRain' | 'deposit')[];
}

/**
 * The shape of one atomic open.
 *
 * Exported so a test drives the function the builder calls rather than a
 * copy of its arithmetic. The index is the part worth pinning: a group ends
 * on `deposit` when it seeds, and `deposit` answers with the pot's balance,
 * so taking the last result hands the caller a balance where it expects a
 * rain id, and it is a plausible-looking number either way.
 */
export function openRainPlan(params: {
  readonly optInAsset?: number;
  readonly seedMicroAlgo?: number;
}): OpenRainPlan {
  const optIn = params.optInAsset ?? 0;
  const seed = params.seedMicroAlgo ?? 0;
  const calls: OpenRainPlan['calls'] = [
    ...(optIn > 0 ? (['optInPrizeAsset'] as const) : []),
    'createRain' as const,
    ...(seed > 0 ? (['deposit'] as const) : []),
  ];
  return { optIn, seed, resultIndex: calls.indexOf('createRain'), calls };
}

async function run(
  algod: algosdk.Algodv2,
  composer: algosdk.AtomicTransactionComposer,
  /**
   * Which method call in the group the caller wants the answer from.
   * Defaults to the last, which is right for every single-call group. A
   * grouped open ends on `deposit`, whose return is the pot's new balance,
   * so it names the `createRain` call instead and gets the rain id.
   */
  resultIndex = -1,
): Promise<CallResult> {
  const result = await composer.execute(algod, 6);
  const returned = result.methodResults.at(resultIndex);
  if (returned?.decodeError) throw returned.decodeError;
  return {
    txId: result.txIDs.at(-1) ?? '',
    confirmedRound: result.confirmedRound,
    returnValue: returned?.returnValue as bigint | undefined,
  };
}

function payArg(
  signing: Signing,
  appId: number,
  amount: number,
  suggestedParams: algosdk.SuggestedParams,
): { txn: algosdk.Transaction; signer: algosdk.TransactionSigner } {
  return {
    txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: signing.sender,
      receiver: algosdk.getApplicationAddress(appId),
      amount,
      suggestedParams,
    }),
    signer: signing.signer,
  };
}

type CallBuilder = (
  composer: algosdk.AtomicTransactionComposer,
  signer: algosdk.TransactionSigner,
  resources: ResourceRefs,
) => void;

async function discoverCall(
  algod: algosdk.Algodv2,
  appId: number,
  known: ResourceRefs,
  addCall: CallBuilder,
): Promise<ResourceRefs> {
  const probe = new algosdk.AtomicTransactionComposer();
  addCall(probe, algosdk.makeEmptyTransactionSigner(), known);
  const { simulateResponse } = await probe.simulate(
    algod,
    new algosdk.modelsv2.SimulateRequest({
      txnGroups: [],
      allowEmptySignatures: true,
      allowUnnamedResources: true,
    }),
  );
  const group = simulateResponse.txnGroups[0];
  if (group?.failureMessage) {
    throw new Error(`This call would fail, so it was not sent: ${group.failureMessage}`);
  }
  let resources = foldUnnamedResources(known, group?.unnamedResourcesAccessed, appId);
  for (const result of group?.txnResults ?? []) {
    resources = foldUnnamedResources(resources, result.unnamedResourcesAccessed, appId);
  }
  return resources;
}

function emptyRefs(): ResourceRefs {
  return { appAccounts: [], appForeignApps: [], appForeignAssets: [], boxes: [] };
}

export async function createRain(
  algod: algosdk.Algodv2,
  appId: number,
  signing: Signing,
  params: CreateRainParams,
): Promise<CallResult> {
  const suggestedParams = await algod.getTransactionParams().do();
  const application = await algod.getApplicationByID(appId).do();
  const next = application.params?.globalState?.find(
    (entry) => new TextDecoder().decode(entry.key) === 'next_rain_id',
  );
  const nextId = BigInt(next?.value.uint ?? 0) + 1n;
  const known: ResourceRefs = {
    ...emptyRefs(),
    boxes: [{ appIndex: 0, name: rainBoxName(nextId) }],
  };
  // One atomic group: opt in if asked, create, seed if asked. Separately
  // signed, an opt-in that lands before a create that fails leaves the hub
  // holding an asset no rain uses and its minimum balance spent for it, and
  // a create that lands without its seed leaves a rain that declines every
  // draw in silence. Grouped, all of it happens or none does, on one
  // signature.
  const { optIn, seed, resultIndex: createIndex } = openRainPlan(params);
  const addCall: CallBuilder = (composer, signer, refs) => {
    if (optIn > 0) {
      composer.addMethodCall({
        appID: appId,
        method: rainMethod('optInPrizeAsset'),
        sender: signing.sender,
        signer,
        suggestedParams: { ...suggestedParams, fee: BigInt(OPT_IN_FEE), flatFee: true },
        methodArgs: [BigInt(optIn), payArg(signing, appId, ASSET_OPT_IN_MBR, suggestedParams)],
        appForeignAssets: [optIn],
      });
    }
    composer.addMethodCall({
      appID: appId,
      method: rainMethod('createRain'),
      sender: signing.sender,
      signer,
      suggestedParams: { ...suggestedParams, fee: BigInt(CREATE_FEE), flatFee: true },
      methodArgs: [
        payArg(signing, appId, RAIN_BOX_MBR, suggestedParams),
        params.label,
        params.gateCreator,
        BigInt(params.prizeAsset),
        BigInt(params.drip),
        BigInt(params.intervalRounds),
        BigInt(params.mode),
        BigInt(params.waveCap),
      ],
      appForeignAssets: [...refs.appForeignAssets],
      appForeignApps: [...refs.appForeignApps],
      appAccounts: [...refs.appAccounts],
      boxes: [...refs.boxes],
    });
    if (seed > 0) {
      composer.addMethodCall({
        appID: appId,
        method: rainMethod('deposit'),
        sender: signing.sender,
        signer,
        suggestedParams: { ...suggestedParams, fee: BigInt(DEPOSIT_FEE), flatFee: true },
        methodArgs: [payArg(signing, appId, seed, suggestedParams), nextId],
        boxes: [...refs.boxes],
      });
    }
  };
  const resources = await discoverCall(algod, appId, known, addCall);
  const composer = new algosdk.AtomicTransactionComposer();
  addCall(composer, signing.signer, resources);
  // Not the last result: a seeded open ends on `deposit`, which answers with
  // the pot's balance. The caller is opening a rain and wants its id.
  return run(algod, composer, createIndex);
}

export async function optInPrizeAsset(
  algod: algosdk.Algodv2,
  appId: number,
  signing: Signing,
  assetId: number,
): Promise<CallResult> {
  const suggestedParams = await algod.getTransactionParams().do();
  const composer = new algosdk.AtomicTransactionComposer();
  composer.addMethodCall({
    appID: appId,
    method: rainMethod('optInPrizeAsset'),
    sender: signing.sender,
    signer: signing.signer,
    suggestedParams: { ...suggestedParams, fee: BigInt(OPT_IN_FEE), flatFee: true },
    methodArgs: [BigInt(assetId), payArg(signing, appId, ASSET_OPT_IN_MBR, suggestedParams)],
    appForeignAssets: [assetId],
  });
  return run(algod, composer);
}

/** The connected account opts into an ASA so it can hold the prize. */
export async function optInHolderAsset(
  algod: algosdk.Algodv2,
  signing: Signing,
  assetId: number,
): Promise<CallResult> {
  const suggestedParams = await algod.getTransactionParams().do();
  const minFee = Number(suggestedParams.minFee ?? 1_000);
  const composer = new algosdk.AtomicTransactionComposer();
  composer.addTransaction({
    txn: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: signing.sender,
      receiver: signing.sender,
      assetIndex: assetId,
      amount: 0,
      suggestedParams: { ...suggestedParams, fee: BigInt(Math.max(minFee, OPT_IN_FEE)), flatFee: true },
    }),
    signer: signing.signer,
  });
  const result = await composer.execute(algod, 6);
  return {
    txId: result.txIDs.at(-1) ?? '',
    confirmedRound: result.confirmedRound,
    returnValue: undefined,
  };
}

export async function enter(
  algod: algosdk.Algodv2,
  appId: number,
  signing: Signing,
  rainId: bigint,
  gateAsset: number,
  mode: bigint,
): Promise<CallResult> {
  const suggestedParams = await algod.getTransactionParams().do();
  const boxes = [
    { appIndex: 0, name: rainBoxName(rainId) },
    { appIndex: 0, name: ticketBoxName(rainId, signing.sender) },
  ];
  if (mode === ONE) {
    // Index of the ticket about to be written is the current ticket count;
    // simulation attaches the real one.
    boxes.push({ appIndex: 0, name: indexBoxName(rainId, 0n) });
  }
  const known: ResourceRefs = {
    appAccounts: [],
    appForeignApps: [],
    appForeignAssets: gateAsset > 0 ? [gateAsset] : [],
    boxes,
  };
  const addCall: CallBuilder = (composer, signer, refs) => {
    composer.addMethodCall({
      appID: appId,
      method: rainMethod('enter'),
      sender: signing.sender,
      signer,
      suggestedParams: { ...suggestedParams, fee: BigInt(ENTER_FEE), flatFee: true },
      methodArgs: [payArg(signing, appId, enterMbr(mode), suggestedParams), rainId, BigInt(gateAsset)],
      appForeignAssets: [...refs.appForeignAssets],
      appForeignApps: [...refs.appForeignApps],
      appAccounts: [...refs.appAccounts],
      boxes: [...refs.boxes],
    });
  };
  const resources = await discoverCall(algod, appId, known, addCall);
  const composer = new algosdk.AtomicTransactionComposer();
  addCall(composer, signing.signer, resources);
  return run(algod, composer);
}

export async function gm(
  algod: algosdk.Algodv2,
  appId: number,
  signing: Signing,
  rainId: bigint,
  gateAsset: number,
): Promise<CallResult> {
  const suggestedParams = await algod.getTransactionParams().do();
  const known: ResourceRefs = {
    appAccounts: [],
    appForeignApps: [],
    appForeignAssets: gateAsset > 0 ? [gateAsset] : [],
    boxes: [
      { appIndex: 0, name: rainBoxName(rainId) },
      { appIndex: 0, name: ticketBoxName(rainId, signing.sender) },
    ],
  };
  const addCall: CallBuilder = (composer, signer, refs) => {
    composer.addMethodCall({
      appID: appId,
      method: rainMethod('gm'),
      sender: signing.sender,
      signer,
      suggestedParams: { ...suggestedParams, fee: BigInt(GM_FEE), flatFee: true },
      methodArgs: [rainId, BigInt(gateAsset)],
      appForeignAssets: [...refs.appForeignAssets],
      appForeignApps: [...refs.appForeignApps],
      appAccounts: [...refs.appAccounts],
      boxes: [...refs.boxes],
    });
  };
  const resources = await discoverCall(algod, appId, known, addCall);
  const composer = new algosdk.AtomicTransactionComposer();
  addCall(composer, signing.signer, resources);
  return run(algod, composer);
}

export async function deposit(
  algod: algosdk.Algodv2,
  appId: number,
  signing: Signing,
  rainId: bigint,
  microAlgo: number,
): Promise<CallResult> {
  if (microAlgo <= 0) throw new Error('Deposit something');
  const suggestedParams = await algod.getTransactionParams().do();
  const known: ResourceRefs = {
    ...emptyRefs(),
    boxes: [{ appIndex: 0, name: rainBoxName(rainId) }],
  };
  const addCall: CallBuilder = (composer, signer, refs) => {
    composer.addMethodCall({
      appID: appId,
      method: rainMethod('deposit'),
      sender: signing.sender,
      signer,
      suggestedParams: { ...suggestedParams, fee: BigInt(DEPOSIT_FEE), flatFee: true },
      methodArgs: [payArg(signing, appId, microAlgo, suggestedParams), rainId],
      boxes: [...refs.boxes],
    });
  };
  const resources = await discoverCall(algod, appId, known, addCall);
  const composer = new algosdk.AtomicTransactionComposer();
  addCall(composer, signing.signer, resources);
  return run(algod, composer);
}

export async function depositAsset(
  algod: algosdk.Algodv2,
  appId: number,
  signing: Signing,
  rainId: bigint,
  assetId: number,
  baseUnits: bigint,
): Promise<CallResult> {
  if (baseUnits <= 0n) throw new Error('Deposit something');
  const suggestedParams = await algod.getTransactionParams().do();
  const transfer = {
    txn: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: signing.sender,
      receiver: algosdk.getApplicationAddress(appId),
      assetIndex: assetId,
      amount: baseUnits,
      suggestedParams,
    }),
    signer: signing.signer,
  };
  const known: ResourceRefs = {
    appAccounts: [],
    appForeignApps: [],
    appForeignAssets: [assetId],
    boxes: [{ appIndex: 0, name: rainBoxName(rainId) }],
  };
  const addCall: CallBuilder = (composer, signer, refs) => {
    composer.addMethodCall({
      appID: appId,
      method: rainMethod('depositAsset'),
      sender: signing.sender,
      signer,
      suggestedParams: { ...suggestedParams, fee: BigInt(DEPOSIT_FEE), flatFee: true },
      methodArgs: [transfer, rainId],
      appForeignAssets: [...refs.appForeignAssets],
      boxes: [...refs.boxes],
    });
  };
  const resources = await discoverCall(algod, appId, known, addCall);
  const composer = new algosdk.AtomicTransactionComposer();
  addCall(composer, signing.signer, resources);
  return run(algod, composer);
}

export async function claim(
  algod: algosdk.Algodv2,
  appId: number,
  signing: Signing,
  rainId: bigint,
  gateAsset: number,
): Promise<CallResult> {
  const suggestedParams = await algod.getTransactionParams().do();
  const known: ResourceRefs = {
    appAccounts: [],
    appForeignApps: [],
    appForeignAssets: gateAsset > 0 ? [gateAsset] : [],
    boxes: [
      { appIndex: 0, name: rainBoxName(rainId) },
      { appIndex: 0, name: ticketBoxName(rainId, signing.sender) },
    ],
  };
  const addCall: CallBuilder = (composer, signer, refs) => {
    composer.addMethodCall({
      appID: appId,
      method: rainMethod('claim'),
      sender: signing.sender,
      signer,
      suggestedParams: { ...suggestedParams, fee: BigInt(CLAIM_FEE), flatFee: true },
      methodArgs: [rainId, BigInt(gateAsset)],
      appForeignAssets: [...refs.appForeignAssets],
      appForeignApps: [...refs.appForeignApps],
      appAccounts: [...refs.appAccounts],
      boxes: [...refs.boxes],
    });
  };
  const resources = await discoverCall(algod, appId, known, addCall);
  const composer = new algosdk.AtomicTransactionComposer();
  addCall(composer, signing.signer, resources);
  return run(algod, composer);
}

export async function resolve(
  algod: algosdk.Algodv2,
  appId: number,
  signing: Signing,
  rainId: bigint,
): Promise<CallResult> {
  const suggestedParams = await algod.getTransactionParams().do();
  const known: ResourceRefs = {
    ...emptyRefs(),
    boxes: [{ appIndex: 0, name: rainBoxName(rainId) }],
  };
  const addCall: CallBuilder = (composer, signer, refs) => {
    composer.addMethodCall({
      appID: appId,
      method: rainMethod('resolve'),
      sender: signing.sender,
      signer,
      suggestedParams: { ...suggestedParams, fee: BigInt(RESOLVE_FEE), flatFee: true },
      methodArgs: [rainId],
      appAccounts: [...refs.appAccounts],
      appForeignApps: [...refs.appForeignApps],
      appForeignAssets: [...refs.appForeignAssets],
      boxes: [...refs.boxes],
    });
  };
  const resources = await discoverCall(algod, appId, known, addCall);
  const composer = new algosdk.AtomicTransactionComposer();
  addCall(composer, signing.signer, resources);
  return run(algod, composer);
}

/**
 * Return an unresolved ONE prize to the pot, once its seed window has closed.
 *
 * The recovery path for the only way a rain can stop permanently. `_fire_one`
 * refuses to fire while `prize_locked > 0`, and the lock clears two ways:
 * `resolve` inside `SEED_WINDOW`, or this after it. Miss the window with no
 * `abandon` available and that rain never fires again -- on an immutable hub,
 * that is forever. This existed in the contract and in the ABI from the start
 * and had no builder anywhere until 2026-08-31, so the recovery was reachable
 * only by hand-rolling the call.
 *
 * Permissionless on purpose: anyone may unstick a rain they do not own.
 * Cheaper than `resolve` in references -- no seed is read, so no index box and
 * no winner's ticket box, just the rain itself.
 */
export async function abandon(
  algod: algosdk.Algodv2,
  appId: number,
  signing: Signing,
  rainId: bigint,
): Promise<CallResult> {
  const suggestedParams = await algod.getTransactionParams().do();
  const known: ResourceRefs = {
    ...emptyRefs(),
    boxes: [{ appIndex: 0, name: rainBoxName(rainId) }],
  };
  const addCall: CallBuilder = (composer, signer, refs) => {
    composer.addMethodCall({
      appID: appId,
      method: rainMethod('abandon'),
      sender: signing.sender,
      signer,
      suggestedParams: { ...suggestedParams, fee: BigInt(ABANDON_FEE), flatFee: true },
      methodArgs: [rainId],
      appAccounts: [...refs.appAccounts],
      appForeignApps: [...refs.appForeignApps],
      appForeignAssets: [...refs.appForeignAssets],
      boxes: [...refs.boxes],
    });
  };
  const resources = await discoverCall(algod, appId, known, addCall);
  const composer = new algosdk.AtomicTransactionComposer();
  addCall(composer, signing.signer, resources);
  return run(algod, composer);
}

export async function readTicket(
  algod: algosdk.Algodv2,
  appId: number,
  rainId: bigint,
  who: string,
): Promise<Uint8Array | null> {
  try {
    const box = await algod.getApplicationBoxByName(appId, ticketBoxName(rainId, who)).do();
    return box.value instanceof Uint8Array ? box.value : new Uint8Array();
  } catch {
    return null;
  }
}

/** @deprecated ticket boxes are per-rain; use readTicket. */
export async function readTicketDebt(
  algod: algosdk.Algodv2,
  appId: number,
  who: string,
): Promise<bigint | null> {
  try {
    const name = new Uint8Array(33);
    name[0] = 0x74;
    name.set(algosdk.decodeAddress(who).publicKey, 1);
    const box = await algod.getApplicationBoxByName(appId, name).do();
    const raw = box.value instanceof Uint8Array ? box.value : new Uint8Array();
    if (raw.length < 8) return 0n;
    return new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getBigUint64(0);
  } catch {
    return null;
  }
}
