import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { ActivityLog } from './components/activity-log';
import { ExplorerLink } from './components/explorer-link';
import { NetworkBar } from './components/network-bar';
import { RainStatTiles } from './components/rain-stat-tiles';
import { SignerBar } from './components/signer-bar';
import { ChainService } from './core/chain.service';
import { RainService } from './core/rain.service';

/**
 * The shell.
 *
 * There is no surface fork here any more. The console this was forked from
 * swapped keeper tiles for hub tiles on `/rain` and hid the keeper's activity
 * log there; the whole site is that surface now, so the tiles are simply the
 * hub's and the log is simply Rain's.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityLog, ExplorerLink, NetworkBar, RainStatTiles, RouterOutlet, SignerBar],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly chain = inject(ChainService);
  protected readonly rain = inject(RainService);
  private readonly router = inject(Router);

  /** The routed region: everything that changes when the URL changes. */
  private readonly routed = viewChild<ElementRef<HTMLElement>>('routed');

  /** The last URL the router settled on, empty until the first navigation ends. */
  private readonly settledUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: '' },
  );

  /** The path of the destination on screen, without the query string. */
  private readonly path = computed(() => this.settledUrl().split('?')[0]);

  /** The path focus was last moved to, so a query-only rewrite does not move it again. */
  private focusedPath: string | null = null;

  constructor() {
    // A single-page router swaps the content without moving the caret, so a
    // screen reader stays where it was and a keyboard user tabs on from a link
    // that no longer exists. Moving focus to the top of the new content is
    // what makes a navigation a navigation.
    effect(() => {
      const path = this.path();
      if (path === '') return;
      const previous = this.focusedPath;
      this.focusedPath = path;
      // The first settled path is the page opening. Focus belongs at the top
      // of the document then, not stolen from it.
      if (previous === null || previous === path) return;
      // preventScroll: default focus() scrolls `.routed` (below the tiles) to
      // the top of the viewport, so a rain landed a screen-height of chrome
      // down instead of at the top. The router already restores or resets
      // scroll; this only moves the caret.
      this.routed()?.nativeElement.focus({ preventScroll: true });
    });
  }

  /**
   * The one banner that is about the chain rather than about a rain.
   *
   * A wrong-chain node answers perfectly well, so it has to be named
   * explicitly rather than left to look like a read failure. A plain read
   * failure matters here for a reason worth saying out loud: every pot, ticket
   * count and countdown below it is then stale, and this is the only place
   * that says so — the console this was forked from had a second banner
   * component for it, whose other three notices were all about upkeep boxes.
   */
  protected readonly nodeError = computed(() => {
    if (this.chain.genesisMatches() === false) {
      return (
        `The node answering for ${this.chain.config().label} reports genesis ` +
        `${this.chain.genesisId()}. Nothing on this page is coming from the chain you ` +
        `think it is. Check the endpoint before entering or depositing anything.`
      );
    }
    const error = this.chain.error();
    if (error === null) return null;
    return `${error} — the pots and countdowns below are from the last read that worked, not from now.`;
  });

  /** The hub this page reads, for the footer's explorer link. */
  protected readonly hubAppId = computed(() => this.rain.deployment()?.appId ?? null);
}
