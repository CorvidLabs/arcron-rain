import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ChainService } from '../core/chain.service';
import { shortAddress } from '@corvidlabs/arcron-rain/vendor';
import { WalletService } from '../core/wallet.service';

/**
 * Connect, switch account, disconnect.
 *
 * Kept from the keeper console it was forked from, because Rain needs it more,
 * not less: entering, checking in, depositing and collecting all need a
 * signature, and `youStatus` cannot answer "you're in" or "you don't hold this
 * NFT" for a wallet nobody has named. Without this bar every gate on every
 * rain reads "connect to check" for ever.
 */
@Component({
  selector: 'rain-signer-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="signer">
      @if (wallet.connected()) {
        <div class="active">
          @if (wallet.activeWallet(); as active) {
            @if (active.icon; as icon) {
              <img class="icon" [src]="icon" alt="" width="20" height="20" />
            }
            <span class="name">{{ active.name }}</span>
          }

          @if (wallet.addresses().length > 1) {
            <label>
              <span class="sr-only">Signing account</span>
              <select (change)="use($event)">
                @for (address of wallet.addresses(); track address) {
                  <option [value]="address" [selected]="address === wallet.activeAddress()">
                    {{ label(address) }}
                  </option>
                }
              </select>
            </label>
          } @else {
            <span class="address mono">{{ label(wallet.activeAddress() ?? '') }}</span>
          }

          <button type="button" class="ghost small" (click)="disconnect()">Disconnect</button>
        </div>
      } @else {
        <p class="prompt">
          <span class="eyebrow">Connect</span>
          {{ prompt() }}
        </p>
        <div class="choices">
          @for (option of wallet.wallets(); track option.id) {
            <button
              type="button"
              class="ghost small wallet"
              [class.pending]="wallet.connecting() === option.id"
              (click)="connect(option.id)"
            >
              @if (option.icon; as icon) {
                <img class="icon" [src]="icon" alt="" width="18" height="18" />
              }
              {{ wallet.connecting() === option.id ? 'Waiting…' : option.name }}
            </button>
          }
          @if (wallet.connecting() !== null) {
            <button type="button" class="ghost small" (click)="cancel()">Cancel</button>
          }
        </div>
      }

      @if (wallet.error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
    </div>
  `,
  styles: `
    .signer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.6rem 0.9rem;
      padding: 0.7rem 0.9rem;
      border: 1px solid var(--hairline);
      border-radius: 3px;
      background: var(--ink-06);
    }
    .active { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
    .name { font-weight: 500; }
    .address { color: var(--text-faint); font-size: 0.85rem; }
    .prompt { margin: 0; color: var(--text-faint); font-size: 0.82rem; max-width: 46ch; }
    .prompt .eyebrow { margin-right: 0.4rem; }
    .choices { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .wallet { display: inline-flex; align-items: center; gap: 0.4rem; }
    .wallet.pending { border-color: var(--sheen); color: var(--sheen); }
    .icon { border-radius: 3px; }
    .error { margin: 0; flex-basis: 100%; color: var(--danger); font-size: 0.82rem; }
  `,
})
export class SignerBar {
  protected readonly wallet = inject(WalletService);
  private readonly chain = inject(ChainService);

  /**
   * Why anyone would connect.
   *
   * Named actions rather than "connect to interact", because a holder arrives
   * asking two questions — am I in, and what am I owed — and neither is
   * answerable until this page knows which wallet to check. Every page below
   * says "connect an account above"; this bar is the "above".
   */
  protected readonly prompt = computed(() =>
    this.chain.network() === 'localnet'
      ? 'LocalNet accounts come from KMD, with no extension or mnemonic. Any wallet below works too.'
      : 'Watching costs nothing. Connect a wallet to see whether you qualify, enter a rain, and collect what it drops on you.',
  );

  protected connect(walletId: string): void {
    void this.wallet.connect(walletId);
  }

  protected cancel(): void {
    this.wallet.cancelConnecting();
  }

  protected disconnect(): void {
    void this.wallet.disconnect();
  }

  protected use(event: Event): void {
    this.wallet.use((event.target as HTMLSelectElement).value);
  }

  protected label(address: string): string {
    return address === '' ? '' : shortAddress(address);
  }
}
