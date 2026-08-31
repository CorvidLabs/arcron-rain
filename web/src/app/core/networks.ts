/**
 * Which chain this page talks to, and how to reach it.
 *
 * `js/src/vendor.ts` deliberately stops at `NetworkKey` — node endpoints are a
 * front end's business, not the client library's, and Rain's page brings its
 * own rather than inheriting a keeper console's.
 *
 * TestNet is the default and, today, the only place a hub exists: `rainFor`
 * returns null everywhere else and every page says so rather than showing an
 * empty list. LocalNet stays configured because the contract is verified there
 * first, and because a developer switching to it must land on "no hub here"
 * rather than on a page silently reading TestNet boxes.
 *
 * Every config is checked against the node's genesis id after connecting, so a
 * misconfigured endpoint fails loudly instead of quietly answering for the
 * wrong chain.
 */

import type { NetworkKey } from '@corvidlabs/arcron-rain/vendor';

export type { NetworkKey };

export interface NodeConfig {
  readonly server: string;
  readonly port: number | '';
  readonly token: string;
}

export interface NetworkConfig {
  readonly key: NetworkKey;
  readonly label: string;
  readonly algod: NodeConfig;
  /** KMD is LocalNet-only: it is how the browser signs without a wallet extension. */
  readonly kmd?: NodeConfig;
  readonly genesisIds: readonly string[];
  /**
   * Links out to a block explorer, where the network has one.
   *
   * Absent on LocalNet, which nothing outside the machine can see, so every
   * caller has to handle "no link" rather than assuming one exists. A dead
   * link to a chain that is not public is worse than plain text — and on this
   * page the explorer link is load-bearing, because looking the hub up
   * somewhere we do not control is the one check a reader can make that this
   * page cannot fake.
   */
  readonly explorerApp?: (appId: number | bigint) => string;
  readonly explorerAccount?: (address: string) => string;
  readonly explorerTx?: (txId: string) => string;
  readonly explorerAsset?: (assetId: number | bigint) => string;
  /**
   * Seconds per round to assume before the chain has been watched long enough
   * to measure it.
   *
   * Measured per network rather than taken from Algorand's nominal 2.8: over a
   * million rounds, about 31 days, TestNet ran at 2.695 on 2026-08-28, and 2.8
   * is about 4% slow, which compounds into hours on a daily cadence. Still
   * only a fallback — "next drop in ~6 h" should come from the chain actually
   * being watched.
   */
  readonly nominalRoundSeconds: number;
  /**
   * Dev mode: a block is produced per transaction rather than on a timer, so
   * elapsed wall-clock says nothing about how fast rounds pass. Cadences are
   * still shown in human time, using the nominal rate.
   */
  readonly devMode?: boolean;
}

const LOCALNET_TOKEN = 'a'.repeat(64);

export const NETWORKS: Readonly<Record<NetworkKey, NetworkConfig>> = {
  localnet: {
    key: 'localnet',
    label: 'LocalNet',
    algod: { server: 'http://localhost', port: 4001, token: LOCALNET_TOKEN },
    kmd: { server: 'http://localhost', port: 4002, token: LOCALNET_TOKEN },
    genesisIds: ['dockernet-v1', 'sandnet-v1', 'devnet-v1'],
    nominalRoundSeconds: 2.8,
    devMode: true,
  },
  testnet: {
    key: 'testnet',
    label: 'TestNet',
    algod: { server: 'https://testnet-api.algonode.cloud', port: '', token: '' },
    genesisIds: ['testnet-v1.0'],
    nominalRoundSeconds: 2.695,
    explorerApp: (appId) => `https://testnet.explorer.perawallet.app/application/${appId}`,
    explorerAccount: (address) => `https://testnet.explorer.perawallet.app/address/${address}`,
    explorerTx: (txId) => `https://testnet.explorer.perawallet.app/tx/${txId}`,
    explorerAsset: (assetId) => `https://testnet.explorer.perawallet.app/asset/${assetId}`,
  },
};

/**
 * Where the page opens.
 *
 * TestNet, because that is where the hub is. This was 'localnet' in the
 * console this page was forked from, and nothing pinned it, so a published
 * bundle rewrote its own address to `?network=localnet` and pointed every
 * stranger at `http://localhost:4001`, which HTTPS blocks as mixed content.
 */
export const DEFAULT_NETWORK: NetworkKey = 'testnet';

export function isNetworkKey(value: string | null): value is NetworkKey {
  return value === 'localnet' || value === 'testnet';
}
