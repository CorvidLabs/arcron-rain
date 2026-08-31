import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { RainCreateForm } from '../components/rain-create-form';
import { RainService } from '../core/rain.service';

/**
 * Opening a rain, and then going to see it.
 *
 * The form used to sit under the hub table, where it ended on itself: opening
 * a rain left you looking at an empty form rather than at the rain. This is a
 * page, so success has somewhere to go — straight to the rain that was just
 * opened.
 */
@Component({
  selector: 'rain-create-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RainCreateForm, RouterLink],
  template: `
    <nav class="back" aria-label="Breadcrumb">
      <a routerLink="/">Back to rains</a>
    </nav>

    @if (!rain.available()) {
      <section class="panel">
        <header>
          <h2>Rain lives on TestNet</h2>
          <p class="subtitle">There is no hub on this chain to open a rain on.</p>
        </header>
      </section>
    } @else {
      <rain-create-form (opened)="show($event)" />
    }
  `,
  styles: `
    :host { display: grid; gap: 1.25rem; align-content: start; }
    .back { font-size: 0.85rem; }
    header h2 { margin: 0; font-size: 1.1rem; }
    .subtitle { margin: 0.2rem 0 0; color: var(--text-faint); font-size: 0.85rem; }
  `,
})
export class RainCreatePage {
  protected readonly rain = inject(RainService);
  private readonly router = inject(Router);

  protected show(id: bigint): void {
    void this.router.navigate(['/r', String(id)]);
  }
}
