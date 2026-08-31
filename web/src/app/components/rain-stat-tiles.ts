import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';

import { RainService } from '../core/rain.service';
import { ChainService } from '../core/chain.service';
import { algos, roundsAsTime } from '@corvidlabs/arcron-rain/vendor';

/**
 * The four numbers at the top of every page: rains, tickets, next drop, pots.
 *
 * "Next drop" is held to the same rule as a rain's own page — it will not say
 * Due unless the schedule behind the hub can actually be read. A tile that
 * says Due while the page below it says Waiting is worse than either.
 */
@Component({
  selector: 'rain-stat-tiles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dl class="tiles">
      <div class="tile">
        <dt class="eyebrow">Rains</dt>
        <dd class="mono">{{ rain.rains().length }}</dd>
        <dd class="hint">{{ rainsHint() }}</dd>
      </div>

      <div class="tile">
        <dt class="eyebrow">Tickets</dt>
        <dd class="mono">{{ rain.hubTickets().toString() }}</dd>
        <dd class="hint">across every rain</dd>
      </div>

      <div class="tile" [class.live]="nextLabel() === 'Due'">
        <dt class="eyebrow">Next drop</dt>
        <dd class="mono">{{ nextLabel() }}</dd>
        <dd class="hint">{{ nextHint() }}</dd>
      </div>

      <div class="tile">
        <dt class="eyebrow">Pots</dt>
        <dd class="mono">{{ algos(rain.hubAlgoPot()) }}</dd>
        <dd class="hint">{{ potsHint() }}</dd>
      </div>
    </dl>
  `,
  styles: `
    .tiles {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      margin: 0;
      background: var(--hairline);
      border: 1px solid var(--hairline);
      border-radius: 3px;
      overflow: hidden;
    }
    @media (max-width: 26rem) {
      .tiles { grid-template-columns: minmax(0, 1fr); }
    }
    @media (min-width: 56rem) {
      .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    .tile { background: var(--surface); padding: 0.9rem 1.1rem; }
    .tile dd { margin: 0.3rem 0 0; font-size: 1.35rem; font-weight: 500; letter-spacing: -0.01em; }
    .tile.live { background: var(--surface-strong); }
    .tile.live dd { color: var(--sheen-strong); }
    .tile.live::after {
      content: '';
      display: block;
      height: 2px;
      margin-top: 0.6rem;
      background: var(--iridescence);
    }
    .hint { margin: 0.25rem 0 0; font-size: 0.74rem; color: var(--text-faint); }
    .tile dd.hint { font-size: 0.74rem; font-weight: 400; letter-spacing: 0; }
  `,
})
export class RainStatTiles {
  protected readonly rain = inject(RainService);
  private readonly chain = inject(ChainService);
  protected readonly algos = algos;

  constructor() {
    const stop = this.rain.watch();
    inject(DestroyRef).onDestroy(stop);
  }

  protected rainsHint(): string {
    const count = this.rain.rains().length;
    if (this.rain.status() !== 'ready') return 'reading the hub…';
    if (count === 0) return 'none open yet';
    return count === 1 ? 'one box on this hub' : `${count} boxes on this hub`;
  }

  /** `hubStanding` already applies the schedule rule; see `RainService.standingOf`. */
  protected nextLabel(): string {
    const standing = this.rain.hubStanding();
    if (standing === null) return '—';
    if (standing === 'waiting') return 'Waiting';
    if (standing === 'scheduled') return 'Scheduled';
    return 'Due';
  }

  protected nextHint(): string {
    const standing = this.rain.hubStanding();
    const next = this.rain.nextHubRain();
    if (standing === null || next === null) return 'no rains yet';
    if (standing === 'due') return 'a rain can drop at any moment';
    if (standing === 'waiting') {
      // Deliberately not a list of causes. This tile rolls up every rain on
      // the hub, and there are now more ways to be waiting than a two-item
      // enumeration can hold honestly — an unresolved draw, a drop too small
      // to divide, no tickets, an empty pot. Each rain names its own reason in
      // the Next column below.
      return this.rain.upkeep() === null
        ? 'the schedule cannot be read right now'
        : 'no rain is ready to drop yet';
    }
    const time = roundsAsTime(next, this.chain.secondsPerRound());
    return time === null ? `in ${next.toString()} rounds` : `in ~${time}`;
  }

  protected potsHint(): string {
    const asa = this.rain.hubAsaRains();
    if (asa === 0) return 'ALGO across every rain';
    return `ALGO, plus ${asa} ASA rain${asa === 1 ? '' : 's'}`;
  }
}
