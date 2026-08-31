/**
 * A hub that never moves.
 *
 * Rain is a live view of a chain, which is the worst possible thing to point a
 * rendering suite at: the round ticks every 2.5 seconds, a rain that was due
 * becomes scheduled, and a TestNet outage turns every check red for reasons
 * that have nothing to do with the page. A suite that fails when a round
 * number changes is one people delete.
 *
 * So the chain is stubbed at the HTTP boundary rather than mocked inside the
 * app: `page.route` answers algod, and everything above it — algosdk, the poll
 * in `ChainService`, the ARC-4 box decoders — is the real code running against
 * fixed bytes. Nothing here needs LocalNet, a funded account, or a network.
 *
 * Two apps are stubbed, not one. The hub is obvious. The second is the keeper
 * app, for the single upkeep box Rain reads to know when the next drop is
 * expected — without it every rain past its cadence renders "Waiting" and the
 * suite would never audit the "Due" state at all. That is the whole keeper
 * surface here: one box, no registry, no fees, no fixtures for five upkeeps
 * that nothing on this site can draw.
 */

import algosdk from 'algosdk';
import type { Page } from '@playwright/test';

import {
  CORVID_TESTNET_MINTER,
  encodeRainRec,
  ONE,
  rainBoxName,
  SPLIT,
  TESTNET_RAIN,
  WAVE,
  type RainRec,
} from '@corvidlabs/arcron-rain/rain';
import { upkeepBoxName } from '@corvidlabs/arcron-rain/vendor';

/**
 * Taken from the client rather than written down again.
 *
 * The hub id moved once already (770130162 to 770746178) and a copy here went
 * stale, which stubs a 404 for the one app the whole suite is about — every
 * page then renders its empty state and every check passes against nothing.
 */
export const RAIN_APP_ID = TESTNET_RAIN.appId;
/** The keeper app holding the schedule behind this hub. */
export const KEEPER_APP_ID = TESTNET_RAIN.keeperAppId;
/** The upkeep that calls `draw()`. Rain reads this one box and no other. */
export const UPKEEP_ID = BigInt(TESTNET_RAIN.upkeepId);

/** Frozen. Every "due in N rounds" on the page is derived from this one number. */
export const ROUND = 55_400_000n;

export const GENESIS_ID = 'testnet-v1.0';
const GENESIS_HASH = 'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=';
const MIN_FEE = 1_000n;

const ALGOD_HOST = 'testnet-api.algonode.cloud';

/** A deterministic 32-byte public key, so every address is stable across runs. */
function creator(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) key[index] = (seed * 31 + index * 7) % 251;
  return key;
}

/**
 * The keeper's schedule, as its 130-byte ARC-4 head plus an empty tail.
 *
 * Written out by offset and deliberately not sharing a table with
 * `decodeUpkeep`. If the fixture were generated from the constants the decoder
 * reads, a wrong offset would cancel out and the suite would happily render
 * nonsense.
 *
 * `nextExecutionRound` sits just behind the frozen round, so the schedule is
 * itself due: that is the state in which a rain past its cadence is allowed to
 * say "Due" rather than "Waiting".
 */
function encodeUpkeep(nextExecutionRound: bigint): Uint8Array {
  const head = new Uint8Array(130);
  const view = new DataView(head.buffer);
  head.set(creator(1), 0);
  view.setBigUint64(32, BigInt(RAIN_APP_ID));
  view.setUint16(40, 130);
  view.setBigUint64(42, 1_286n);
  view.setBigUint64(50, nextExecutionRound);
  view.setBigUint64(58, 10_000n);
  view.setBigUint64(66, 604_000n);
  view.setBigUint64(74, 151n);
  view.setBigUint64(82, 1n);
  view.setBigUint64(90, 0n);
  view.setBigUint64(98, ROUND - 1_298n);
  view.setBigUint64(106, 0n);
  view.setBigUint64(114, 0n);
  view.setBigUint64(122, 0n);

  // An empty ARC-4 `byte[][]`: a uint16 count of zero and nothing after it.
  const box = new Uint8Array(head.length + 2);
  box.set(head, 0);
  return box;
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** The keeper's boxes: exactly the one Rain reads. */
const KEEPER_BOXES = [
  { name: base64(upkeepBoxName(UPKEEP_ID)), value: base64(encodeUpkeep(ROUND - 12n)) },
];

/** Every app id the stub answers for. Anything else is a genuine 404. */
const KNOWN_APPS = new Set([RAIN_APP_ID, KEEPER_APP_ID]);

function statusBody(): unknown {
  return {
    'catchup-time': 0,
    'last-round': Number(ROUND),
    'last-version': 'https://github.com/algorandfoundation/specs/tree/rain-e2e',
    'next-version': 'https://github.com/algorandfoundation/specs/tree/rain-e2e',
    'next-version-round': Number(ROUND) + 1,
    'next-version-supported': true,
    'stopped-at-unsupported-round': false,
    'time-since-last-round': 2_800_000_000,
  };
}

function paramsBody(): unknown {
  return {
    'consensus-version': 'https://github.com/algorandfoundation/specs/tree/rain-e2e',
    fee: 0,
    'genesis-hash': GENESIS_HASH,
    'genesis-id': GENESIS_ID,
    'last-round': Number(ROUND),
    'min-fee': Number(MIN_FEE),
  };
}

function rainState(nextRainId: number): unknown[] {
  return [
    { key: base64(new TextEncoder().encode('next_rain_id')), value: { bytes: '', type: 2, uint: nextRainId } },
    { key: base64(new TextEncoder().encode('cursor')), value: { bytes: '', type: 2, uint: 0 } },
    { key: base64(new TextEncoder().encode('bootstrapped')), value: { bytes: '', type: 2, uint: 1 } },
  ];
}

function rainBox(
  partial: Pick<RainRec, 'id' | 'label' | 'mode' | 'waveCap' | 'pot'> &
    Partial<
      Pick<
        RainRec,
        | 'tickets'
        | 'lastRainRound'
        | 'waveCount'
        | 'prizeAsset'
        | 'drip'
        | 'gateCreator'
        | 'commitRound'
        | 'prizeLocked'
      >
    >,
): { name: string; value: string } {
  const raw = encodeRainRec({
    id: partial.id,
    creator: algosdk.encodeAddress(creator(9)),
    gateCreator: partial.gateCreator ?? CORVID_TESTNET_MINTER,
    label: partial.label,
    prizeAsset: partial.prizeAsset ?? 0n,
    drip: partial.drip ?? 50_000n,
    intervalRounds: 30_857n,
    lastRainRound: partial.lastRainRound ?? 0n,
    pot: partial.pot,
    tickets: partial.tickets ?? 0n,
    drawId: 0n,
    cumulative: 0n,
    mode: partial.mode,
    waveCap: partial.waveCap,
    waveCount: partial.waveCount ?? 0n,
    lastShare: 0n,
    lastWaveId: 0n,
    waveUnclaimed: 0n,
    commitRound: partial.commitRound ?? 0n,
    prizeLocked: partial.prizeLocked ?? 0n,
  });
  return { name: base64(rainBoxName(partial.id)), value: base64(raw) };
}

/**
 * Four rains, one of each mode plus an ASA pot, so the hub table and each
 * detail page have something to draw. Daily is due (tickets and a pot, never
 * fired). GM is waiting (nobody checked in). Lottery is armed. ASA split
 * shows a prize asset id a person can opt in to.
 */
const RAIN_BOXES = [
  rainBox({ id: 1n, label: 'Corvid daily', mode: SPLIT, waveCap: 0n, pot: 1_000_000n, tickets: 4n }),
  rainBox({ id: 2n, label: 'Corvid GM', mode: WAVE, waveCap: 10n, pot: 0n }),
  rainBox({
    id: 3n,
    label: 'Corvid lottery',
    mode: ONE,
    waveCap: 0n,
    pot: 500_000n,
    tickets: 7n,
    lastRainRound: ROUND - 1_000n,
  }),
  rainBox({
    id: 4n,
    label: 'live ASA split',
    mode: SPLIT,
    waveCap: 0n,
    pot: 0n,
    tickets: 1n,
    prizeAsset: 770_131_837n,
    drip: 1_000n,
  }),
];

/** Rain 3, stuck: the prize from its last draw is locked and nobody has resolved it. */
const LOCKED_LOTTERY = rainBox({
  id: 3n,
  label: 'Corvid lottery',
  mode: ONE,
  waveCap: 0n,
  pot: 500_000n,
  tickets: 7n,
  lastRainRound: ROUND - 40_000n,
  prizeLocked: 50_000n,
  commitRound: ROUND - 39_992n,
});

const PRIZE_ASA = 770_131_837;

function assetBody(id: number): unknown | null {
  if (id !== PRIZE_ASA) return null;
  return {
    index: id,
    params: {
      creator: algosdk.encodeAddress(creator(9)),
      decimals: 0,
      name: 'Rain Drops',
      unitName: 'DROP',
      'unit-name': 'DROP',
      total: 1_000_000,
      url: '',
      reserve: algosdk.encodeAddress(creator(9)),
    },
  };
}

function applicationBody(appId: number, nextRainId: number): unknown {
  if (appId === RAIN_APP_ID) {
    return {
      id: appId,
      params: {
        'approval-program': base64(new Uint8Array([0x0a, 0x81, 0x01])),
        'clear-state-program': base64(new Uint8Array([0x0a, 0x81, 0x01])),
        creator: algosdk.encodeAddress(creator(9)),
        'global-state': rainState(nextRainId),
        'global-state-schema': { 'num-byte-slice': 0, 'num-uint': 3 },
        'local-state-schema': { 'num-byte-slice': 0, 'num-uint': 0 },
      },
    };
  }
  // The keeper app. Rain never reads its global state — only the one box — so
  // there is nothing here to model beyond existing.
  return {
    id: appId,
    params: {
      'approval-program': base64(new Uint8Array([0x0a, 0x81, 0x01])),
      'clear-state-program': base64(new Uint8Array([0x0a, 0x81, 0x01])),
      creator: algosdk.encodeAddress(creator(9)),
      'global-state': [],
      'global-state-schema': { 'num-byte-slice': 0, 'num-uint': 0 },
      'local-state-schema': { 'num-byte-slice': 0, 'num-uint': 0 },
    },
  };
}

function accountBody(address: string, amount: bigint, minBalance: bigint): unknown {
  return {
    address,
    amount: Number(amount),
    'amount-without-pending-rewards': Number(amount),
    'min-balance': Number(minBalance),
    'pending-rewards': 0,
    rewards: 0,
    round: Number(ROUND),
    status: 'Offline',
    'total-apps-opted-in': 0,
    'total-assets-opted-in': 1,
    'total-created-apps': 0,
    'total-created-assets': 0,
  };
}

/** Enough to cover every pot on the hub, with a margin. */
const APP_AMOUNT = 20_000_000n;
const APP_MIN_BALANCE = 100_000n + 4n * 95_700n;

function json(body: unknown): { status: number; contentType: string; body: string } {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

/**
 * Answer every algod call the console makes, and fail loudly on one it does not.
 *
 * A stub that quietly 200s an unknown path is worse than no stub: the console
 * would render a blank registry and the suite would audit an empty page while
 * reporting success. Anything unrecognised comes back 501 with the path in it.
 */
export interface AlgodStubOptions {
  /** Hub with no rain boxes, so the empty state and its "Open one" link render. */
  readonly emptyRains?: boolean;
  /**
   * Swap the lottery for one whose last draw is still locked and long past its
   * cadence.
   *
   * `_fire_one` returns on `prize_locked > 0` before it writes
   * `last_rain_round`, so this rain is overdue for ever and only `resolve` or
   * `abandon` frees it. It is a swap rather than a fifth box because the hub
   * chrome counts rains, and a suite that has to be told a number twice will
   * one day be told two different numbers.
   */
  readonly lockedOne?: boolean;
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export async function stubAlgod(page: Page, options: AlgodStubOptions = {}): Promise<void> {
  const rains =
    options.lockedOne === true
      ? RAIN_BOXES.map((box) => (box.name === LOCKED_LOTTERY.name ? LOCKED_LOTTERY : box))
      : RAIN_BOXES;
  const rainBoxes = options.emptyRains === true ? [] : rains;
  const nextRainId = rainBoxes.length === 0 ? 1 : rainBoxes.length + 1;

  await page.route(/https:\/\/(ipfs\.io|dweb\.link|nftstorage\.link)\/ipfs\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );

  await page.route(`**://${ALGOD_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/v2/status') return route.fulfill(json(statusBody()));
    if (path === '/v2/transactions/params') return route.fulfill(json(paramsBody()));

    const application = /^\/v2\/applications\/(\d+)$/.exec(path);
    if (application) {
      const appId = Number(application[1]);
      if (!KNOWN_APPS.has(appId)) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'application does not exist' }),
        });
      }
      return route.fulfill(json(applicationBody(appId, nextRainId)));
    }

    const boxes = /^\/v2\/applications\/(\d+)\/boxes$/.exec(path);
    if (boxes) {
      const appId = Number(boxes[1]);
      if (appId === RAIN_APP_ID) {
        return route.fulfill(json({ boxes: rainBoxes.map((box) => ({ name: box.name })) }));
      }
      return route.fulfill(json({ boxes: KEEPER_BOXES.map((box) => ({ name: box.name })) }));
    }

    const box = /^\/v2\/applications\/(\d+)\/box$/.exec(path);
    if (box) {
      // `URLSearchParams` decodes `+` as a space, which corrupts base64 box
      // names, so the query is read off the raw URL instead.
      const raw = /[?&]name=([^&]*)/.exec(url.search);
      const name = raw === null ? '' : decodeURIComponent(raw[1]).replace(/^b64:/, '');
      const found =
        KEEPER_BOXES.find((candidate) => candidate.name === name) ??
        rainBoxes.find((candidate) => candidate.name === name);
      if (found === undefined) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'box not found' }),
        });
      }
      return route.fulfill(json({ name: found.name, round: Number(ROUND), value: found.value }));
    }

    const asset = /^\/v2\/assets\/(\d+)$/.exec(path);
    if (asset) {
      const body = assetBody(Number(asset[1]));
      if (body === null) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'asset does not exist' }),
        });
      }
      return route.fulfill(json(body));
    }

    const account = /^\/v2\/accounts\/([A-Z2-7]+)$/.exec(path);
    if (account) {
      const address = account[1];
      const appAddresses = new Set(
        [...KNOWN_APPS].map((appId) => algosdk.getApplicationAddress(appId).toString()),
      );
      return route.fulfill(
        json(
          appAddresses.has(address)
            ? accountBody(address, APP_AMOUNT, APP_MIN_BALANCE)
            : accountBody(address, 25_000_000n, 200_000n),
        ),
      );
    }

    return route.fulfill({
      status: 501,
      contentType: 'application/json',
      body: JSON.stringify({ message: `rain e2e: no stub for ${path}` }),
    });
  });
}

/**
 * Cut the page off from the internet entirely.
 *
 * `index.html` pulls Schibsted Grotesk and Spline Sans Mono from Google Fonts.
 * Left alone, every measurement here would depend on whether the machine
 * running the suite had a network, which is the definition of a flaky test:
 * the same code would report different overflow on a plane. The stylesheet is
 * answered with nothing, so the fallback stack applies on every run.
 *
 * Set `RAIN_E2E_WEBFONTS=1` to let the real faces through when the point of
 * the run is a screenshot somebody is going to look at.
 */
export async function stubWebFonts(page: Page): Promise<void> {
  if (process.env['RAIN_E2E_WEBFONTS'] === '1') return;
  await page.route('**://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* blocked by the e2e suite */' }),
  );
  await page.route('**://fonts.gstatic.com/**', (route) => route.abort());
}
