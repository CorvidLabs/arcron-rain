import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ExplorerLink } from './explorer-link';
import { RainService } from '../core/rain.service';

/**
 * What this browser has sent, and the transaction id to prove it.
 *
 * Every write on this site is a signature a person made, and the confirmation
 * a wallet shows is gone the moment it is dismissed. Without a log, somebody
 * who entered a rain and then watched the pot not change has nothing to check
 * — and "did that go through" is the question a permissionless hub gets asked
 * most. The explorer link is the answer, because it is the half of it this
 * page cannot fake.
 *
 * Local to the tab and deliberately not persisted: a receipt for what just
 * happened here, not an account history.
 */
@Component({
  selector: 'rain-activity-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ExplorerLink],
  template: `
    <section class="panel">
      <header>
        <h2>Activity</h2>
        <p class="subtitle">What this browser has sent, and what the hub returned.</p>
      </header>

      @if (rain.writeError(); as error) {
        <div class="alert" role="alert">
          <p>{{ error }}</p>
          <button type="button" class="ghost small" (click)="dismiss()">Dismiss</button>
        </div>
      }

      @if (rain.activity().length === 0) {
        <p class="empty">Nothing sent yet.</p>
      } @else {
        <ol>
          @for (entry of rain.activity(); track entry.txId) {
            <li>
              <span class="op">{{ entry.operation }}</span>
              <span class="message">{{ entry.message }}</span>
              <span class="meta">
                round {{ entry.round }} ·
                <rain-explorer-link kind="transaction" [value]="entry.txId" />
              </span>
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: `
    .panel { display: grid; gap: 1rem; align-content: start; }
    header h2 { margin: 0; font-size: 1.1rem; }
    .subtitle { margin: 0.25rem 0 0; color: var(--text-faint); font-size: 0.85rem; }
    .empty { margin: 0; color: var(--text-faint); font-size: 0.85rem; }
    ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
    li {
      display: grid;
      gap: 0.2rem;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--hairline);
      border-radius: 2px;
      background: var(--surface);
    }
    .op {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--sheen-strong);
    }
    .message { font-size: 0.88rem; }
    .meta { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-faint); overflow-wrap: anywhere; }
    .alert {
      display: flex;
      gap: 0.75rem;
      align-items: start;
      justify-content: space-between;
      padding: 0.7rem 0.85rem;
      border: 1px solid var(--danger);
      border-radius: 2px;
      color: var(--danger);
    }
    .alert p { margin: 0; font-size: 0.85rem; overflow-wrap: anywhere; }
  `,
})
export class ActivityLog {
  protected readonly rain = inject(RainService);

  protected dismiss(): void {
    this.rain.dismissWriteError();
  }
}
