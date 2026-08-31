/**
 * The chain underneath Rain: which network, which node, what round it is on.
 *
 * Everything about *rains* lives in `rain.service.ts`. This holds only what
 * both it and the chrome need: an algod client, a live round, and an honest
 * answer to "is this node the chain it claims to be".
 *
 * There is no app id here and no `?app=` to set one. The hub's id is a
 * constant in `@corvidlabs/arcron-rain/rain` (`TESTNET_RAIN`), so no link can
 * aim this page at a look-alike contract, and the quarantine the keeper
 * console needs has nothing to guard. What replaces it is the explorer link on
 * the hub id, which lets a reader check off-site what this page cannot fake.
 */

import { computed, effect, Injectable, signal } from '@angular/core';
import algosdk from 'algosdk';

import { devModeFrom, type DevModeState } from './dev-mode';
import { DEFAULT_NETWORK, isNetworkKey, NETWORKS, type NetworkKey } from './networks';

/**
 * How often the round is re-read.
 *
 * The round decides whether a rain reads as due and how "next drop in ~6 h" is
 * phrased, so it has to be live. It is one request: the genesis id is read
 * once per network, because a node does not change chains under a page.
 */
const POLL_INTERVAL_MS = 2_500;
/** Round-rate samples kept; at the poll interval this is ~2 minutes of chain. */
const RATE_SAMPLES = 48;
/** Below this the sample window is too short to divide by. */
const MIN_RATE_WINDOW_MS = 8_000;
const NETWORK_STORAGE_KEY = 'rain.network';

export type ConnectionStatus = 'connecting' | 'ready' | 'error';

/**
 * Whether it is safe to put a signature behind a button: the read succeeded
 * and the node is the chain it claims to be.
 *
 * Exported so its test binds to the predicate the page actually runs. The
 * keeper console shipped a version of this inline, and every write guard keyed
 * on `status === 'ready'` alone — a node answering for the wrong chain answers
 * perfectly well, so the page showed "wrong chain" in the header, raised a red
 * banner, and left every money button live underneath it.
 */
export function canCommitMoney(state: {
  status: string;
  genesisMatches: boolean | null;
}): boolean {
  return state.status === 'ready' && state.genesisMatches !== false;
}

@Injectable({ providedIn: 'root' })
export class ChainService {
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly network = signal<NetworkKey>(readNetwork());
  readonly status = signal<ConnectionStatus>('connecting');
  readonly error = signal<string | null>(null);
  readonly round = signal<bigint>(0n);
  readonly genesisId = signal<string | null>(null);

  /** Which refresh is allowed to write. See `refresh`. */
  private generation = 0;
  /** Recent (wall clock, round) pairs, oldest first. */
  private readonly rateSamples = signal<readonly { at: number; round: bigint }[]>([]);

  readonly config = computed(() => NETWORKS[this.network()]);

  readonly algod = computed(() => {
    const { algod } = this.config();
    return new algosdk.Algodv2(algod.token, algod.server, algod.port);
  });

  /** True once the node we reached is the chain we asked for; null until then. */
  readonly genesisMatches = computed(() => {
    const genesis = this.genesisId();
    return genesis === null ? null : this.config().genesisIds.includes(genesis);
  });

  readonly canWrite = computed(() =>
    canCommitMoney({ status: this.status(), genesisMatches: this.genesisMatches() }),
  );

  /**
   * Where the round rate came from: a chain we watched move, or the nominal
   * block time we assume until then. Shown, because "in ~6 h" derived from an
   * assumption and "in ~6 h" derived from measurement are different claims.
   */
  readonly paceSource = computed<'measured' | 'nominal'>(() =>
    this.measuredRoundSeconds() === null ? 'nominal' : 'measured',
  );

  /**
   * Seconds per round, for turning round counts into human time.
   *
   * On a dev-mode chain the measurement is meaningless, because a block
   * appears when a transaction does, so watching the clock would report
   * whatever the gap between your own transactions happened to be. There we
   * keep the nominal rate, which is what the same cadence would mean on a real
   * chain.
   */
  readonly secondsPerRound = computed<number>(
    () => this.measuredRoundSeconds() ?? this.config().nominalRoundSeconds,
  );

  private readonly measuredRoundSeconds = computed<number | null>(() => {
    if (this.config().devMode === true) return null;
    const samples = this.rateSamples();
    const first = samples.at(0);
    const last = samples.at(-1);
    if (first === undefined || last === undefined) return null;
    const elapsed = last.at - first.at;
    const advanced = last.round - first.round;
    if (elapsed < MIN_RATE_WINDOW_MS || advanced <= 0n) return null;
    return elapsed / 1_000 / Number(advanced);
  });

  constructor() {
    effect(() => {
      const network = this.network();
      try {
        localStorage.setItem(NETWORK_STORAGE_KEY, network);
      } catch {
        // A browser blocking site data throws on write. Not remembering the
        // network is survivable; failing to boot is not.
      }
    });
    this.start();
  }

  setNetwork(network: NetworkKey): void {
    if (network === this.network()) return;
    this.network.set(network);
    this.reset();
    void this.refresh();
  }

  start(): void {
    if (this.timer !== null) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    const algod = this.algod();
    // Every write below is guarded by this. `algod` was captured from the
    // config as it was when this refresh started, so a slow read from the
    // previous network would otherwise land afterwards and write both fields
    // anyway — and those two fields are what decides whether a rain reads as
    // due and whether the wrong-chain banner is up.
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    try {
      // Once per network, not once per poll. A node does not change chains
      // under a page, and this halves the request rate of an idle tab.
      if (this.genesisId() === null) {
        const params = await algod.getTransactionParams().do();
        if (!current()) return;
        this.genesisId.set(params.genesisID ?? null);
      }
      const status = await algod.status().do();
      if (!current()) return;
      this.round.set(status.lastRound);
      if (this.config().devMode !== true) this.sampleRate(status.lastRound);
      this.status.set('ready');
      this.error.set(null);
    } catch (cause) {
      if (!current()) return;
      this.status.set('error');
      this.error.set(describe(cause));
    }
  }

  /** Keep a rolling window of (time, round) pairs to derive the round rate. */
  private sampleRate(round: bigint): void {
    this.rateSamples.update((samples) =>
      [...samples, { at: Date.now(), round }].slice(-RATE_SAMPLES),
    );
  }

  private reset(): void {
    this.status.set('connecting');
    this.error.set(null);
    this.genesisId.set(null);
    this.rateSamples.set([]);
  }
}

/**
 * Whether the developer controls are on.
 *
 * Read once at module load rather than per call, so it cannot change under a
 * page that has already decided which chain it is showing.
 */
const DEV_STATE = readDevMode();

/** Whether the network picker is shown at all. */
export const DEV_MODE = DEV_STATE.enabled;

/**
 * Whether dev mode was on *before* this navigation.
 *
 * `?network=` requires this rather than `DEV_MODE`, so that one link cannot
 * both turn dev mode on and move the chain in the same step. See
 * `dev-mode.ts`.
 */
export const DEV_ESTABLISHED = DEV_STATE.established;

function readDevMode(): DevModeState {
  try {
    return devModeFrom(location.search, localStorage);
  } catch {
    // A browser blocking site data throws on access. Dev mode off is the safe
    // answer: one chain, nothing configurable.
    return { enabled: false, established: false };
  }
}

/**
 * Which chain the page opens on.
 *
 * Outside dev mode there is exactly one answer, and neither the link nor the
 * memory is consulted. That is what makes `?network=localnet` inert for a
 * stranger: a published page pointed at `http://localhost:4001` is a page that
 * reads nothing and says the node is unreachable.
 */
function readNetwork(): NetworkKey {
  if (!DEV_ESTABLISHED) return DEFAULT_NETWORK;
  const linked = new URLSearchParams(location.search).get('network');
  if (isNetworkKey(linked)) return linked;
  try {
    const remembered = localStorage.getItem(NETWORK_STORAGE_KEY);
    if (isNetworkKey(remembered)) return remembered;
  } catch {
    // As above.
  }
  return DEFAULT_NETWORK;
}

export function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
