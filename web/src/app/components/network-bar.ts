import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { RouterLink, RouterLinkActive } from '@angular/router';

import { shortAddress } from '@corvidlabs/arcron-rain/vendor';

import { ChainService, DEV_MODE } from '../core/chain.service';
import type { NetworkKey } from '../core/networks';
import { WalletService } from '../core/wallet.service';

@Component({
  selector: 'rain-network-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  // The house rule is host bindings in the decorator's host object rather than
  // @HostListener. Escape is bound on the document because the drawer's scrim
  // is not focusable, so a keypress will not be inside this component.
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    <div class="bar">
      <div class="brand">
        <!--
          The wordmark is the way back to the rains, which is what everybody
          tries first and what nothing else on the page offers from a rain. The
          link wraps the mark and the name and not the tagline, because "pots
          that fall on the people holding a ticket" describes the site rather
          than naming the destination, and a link should say where it goes.
        -->
        <a class="home" routerLink="/" aria-label="Rain, back to the rains">
          <svg class="mark" viewBox="0 0 64 64" role="img" aria-label="CorvidLabs">
            <circle cx="24" cy="32" r="18" fill="currentColor" />
            <path d="M33 21.5 L58.5 29.5 L33 39.5 Z" fill="currentColor" />
            <circle cx="27.5" cy="26" r="3" fill="var(--paper)" />
          </svg>
          <h1 class="wordmark">Rain</h1>
        </a>
        <span class="tagline">pots that fall on the holders</span>
        <nav class="places" aria-label="Rain">
          <a routerLink="/" routerLinkActive="here" [routerLinkActiveOptions]="{ exact: true }">Rains</a>
          <a routerLink="/new" routerLinkActive="here">Open a rain</a>
        </nav>
      </div>

      <!-- Mobile only. Hidden at every other width by CSS rather than by a
           condition, so the theme toggle inside the drawer is in the DOM
           exactly once and brand/theme.js finds it whatever the viewport. -->
      <button
        type="button"
        class="menu-toggle"
        [attr.aria-expanded]="menuOpen()"
        aria-controls="chrome-menu"
        [attr.aria-label]="menuOpen() ? 'Close menu' : 'Open menu'"
        (click)="toggleMenu()"
      >
        <span class="bars" aria-hidden="true"></span>
      </button>

      <!-- The backdrop is a sibling, not a parent, so the drawer is not nested
           inside something that fades. Click anywhere on it to close. -->
      @if (menuOpen()) {
        <div class="scrim" (click)="closeMenu()" aria-hidden="true"></div>
      }

      <div class="controls" id="chrome-menu" [class.open]="menuOpen()">
        <div class="drawer-head">
          <span class="drawer-label head-title">Menu</span>
        <button
          type="button"
          class="corvid-theme-toggle"
          data-corvid-theme-toggle
          aria-pressed="false"
          aria-label="Switch to dark theme"
          title="Switch theme"
        >
          <svg
            class="sun"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4.2" />
            <path
              d="M12 2.6v2.4M12 19v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.6 12h2.4M19 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"
            />
          </svg>
          <svg
            class="moon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.8A8.6 8.6 0 1 1 11.2 3a6.7 6.7 0 0 0 9.8 9.8z" />
          </svg>
        </button>
          <button type="button" class="drawer-close" (click)="closeMenu()" aria-label="Close menu">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <nav class="drawer-nav" aria-label="Rain">
          <a routerLink="/" (click)="closeMenu()">Rains</a>
          <a routerLink="/new" (click)="closeMenu()">Open a rain</a>
        </nav>

        <!-- The find-an-upkeep box that used to live here is gone with the
             upkeeps. A rain is found by name in a list of a handful, not by an
             id somebody memorised. -->

        <div class="drawer-section">
          <span class="drawer-label">Wallet</span>
          @if (wallet.connected()) {
            <p class="mono connected">{{ shortAddress(wallet.activeAddress() ?? '') }}</p>
            <button type="button" class="ghost small" (click)="disconnectAndClose()">Disconnect</button>
          } @else {
            <p class="hint">Not connected. Watching a rain needs nothing; entering, checking in and collecting need a signature.</p>
            <a routerLink="/" (click)="closeMenu()">Connect a wallet</a>
          }
        </div>

        @if (devMode) {
          <fieldset class="networks">
          <legend class="sr-only">Network</legend>
          @for (option of networks; track option.key) {
            <label class="network" [class.active]="chain.network() === option.key">
              <input
                type="radio"
                name="network"
                class="sr-only"
                [value]="option.key"
                [checked]="chain.network() === option.key"
                (change)="selectNetwork(option.key)"
              />
              {{ option.label }}
            </label>
          }
          </fieldset>
        }



        <span class="drawer-label network-label">Network</span>
        <p class="status" [class]="statusClass()" role="status">
          <span class="dot" aria-hidden="true"></span>
          @if (statusParts(); as parts) {
            <span class="mono"
              >{{ parts.chain }}<span class="part"> &middot; round {{ parts.round }}</span
              ><span class="part pace"> &middot; {{ parts.pace }}</span></span
            >
          } @else {
            <span class="mono">{{ statusLabel() }}</span>
          }
        </p>
      </div>
    </div>
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.85rem 1.5rem;
      align-items: center;
      justify-content: space-between;
    }
    .brand { display: flex; align-items: center; gap: 0.6rem; }
    .home {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      color: inherit;
      text-decoration: none;
      /* WCAG 2.5.5 wants 44x44. The mark is 26px and the wordmark sets the rest,
         which left the whole link 32px tall and failing on every mobile page at
         once, since this bar is on all of them. Growing the hit area rather than
         the mark keeps the bar looking the same. */
      min-height: 44px;
    }
    /* Underlining only the name, because underlining the mark looks like a
       rendering fault rather than a link. */
    .home:hover .wordmark { text-decoration: underline; }
    .home:focus-visible { outline: 2px solid var(--sheen); outline-offset: 3px; border-radius: 2px; }
    .mark { width: 26px; height: 26px; color: var(--ink); }
    .wordmark { margin: 0; font-size: 1.3rem; font-weight: 900; letter-spacing: -0.02em; }
    .tagline {
      color: var(--text-faint);
      font-size: 0.78rem;
      font-family: var(--font-mono);
      padding-left: 0.6rem;
      border-left: 1px solid var(--hairline);
    }
    .places {
      display: flex;
      gap: 0.85rem;
      margin-left: 0.4rem;
      font-size: 0.88rem;
    }
    .places a { color: var(--text-faint); text-decoration: none; }
    .places a:hover { color: var(--ink); text-decoration: underline; }
    .places a.here { color: var(--sheen); font-weight: 500; }
    .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.7rem; }
    /* Above the breakpoint there is no drawer: the controls are an inline row
       exactly as before, and everything the drawer adds is absent from the
       layout rather than hidden inside it.

       .drawer-head is display:contents rather than none, because the theme
       toggle now lives inside it and still has to sit inline up here. Contents
       removes the box and promotes the children, so the toggle is a direct flex
       child of .controls again and the desktop bar is unchanged. Its label and
       close button are hidden individually. */
    .menu-toggle { display: none; }
    .drawer-nav { display: none; }
    /* display:contents promotes the header's children into the controls row,
       and the order property then places the toggle last so it sits at the far right of
       the bar rather than left of the status. The status is the thing that
       changes; the toggle is a control you reach for, and controls go to the
       edge. */
    .drawer-head { display: contents; }
    .drawer-head .corvid-theme-toggle { order: 99; }
    .head-title { display: none; }
    .drawer-close { display: none; }
    .drawer-section { display: none; }
    .network-label { display: none; }
    .networks {
      display: flex;
      margin: 0;
      padding: 2px;
      border: 1px solid var(--hairline);
      border-radius: 2px;
      gap: 2px;
    }
    .network {
      padding: 0.25rem 0.8rem;
      font-size: 0.82rem;
      font-family: var(--font-mono);
      color: var(--text-faint);
      cursor: pointer;
    }
    .network.active { background: var(--ink); color: var(--paper); font-weight: 500; }
    .network:focus-within { outline: 2px solid var(--sheen); outline-offset: 2px; }
    .status { display: flex; align-items: center; gap: 0.45rem; margin: 0; font-size: 0.78rem; }
    /* flex:0 0 auto, because a flex item with a percentage border-radius will
       shrink when the row is tight and a squashed circle reads as a rendering
       fault rather than a status light. It was visibly an oval in the drawer,
       where the status wraps onto three lines and the dot is the only thing
       that can give. */
    .status .dot {
      flex: 0 0 auto;
      width: 0.45rem;
      height: 0.45rem;
      border-radius: 50%;
      background: currentColor;
    }
    .status.ready { color: var(--success); }
    .status.warn { color: var(--warning); }
    .status.bad { color: var(--danger); }

    /* Mobile: one thin row, and everything else in a drawer.

       The bar used to wrap into three rows and cost about 160px before any
       content on an 844px viewport. Removing the tagline and the round rate got
       that to 103px, which was better and still a lot of a phone screen spent
       on chrome that nobody reads twice.

       So under 480px the header is the wordmark and a menu button, and the
       status, the network picker, the navigation and the theme toggle move into
       a drawer. The drawer is styled out of existence above the breakpoint
       rather than removed by a condition, because the theme toggle inside it
       has to be in the DOM exactly once for brand/theme.js to find it, whatever
       the viewport, and a conditional would make that depend on window width at
       the moment the script ran.

       Two earlier attempts at the thin header made it worse and are worth not
       repeating: flex-wrap:nowrap on the bar pushed it 199px past the viewport
       and dragged the footer with it, and so did flex:1-1-auto on the controls,
       because flex children will not shrink below their content. */
    @media (max-width: 480px) {
      /* nowrap is safe here only because the drawer is position:fixed and out
         of flow, so the bar holds the brand and the menu button and nothing
         else. It still needs the brand able to shrink: without min-width:0 the
         wordmark sets a floor, the bar measured 396px inside a 358px content
         box, and the whole document grew to 432px — the same overflow this
         file already records from an earlier attempt. */
      .bar {
        flex-wrap: nowrap;
        gap: 0.5rem;
      }

      .brand {
        min-width: 0;
        overflow: hidden;
      }

      .wordmark {
        white-space: nowrap;
      }

      .tagline { display: none; }
      .places { display: none; }

      .wordmark { font-size: 1.1rem; }

      .mark { width: 22px; height: 22px; }

      /* The hamburger. 44px square, because it is now the only way to reach
         the network, the theme and half the navigation. */
      .menu-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        flex: 0 0 44px;
        padding: 0;
        background: none;
        border: 1px solid var(--hairline);
        border-radius: 3px;
        color: var(--ink);
        cursor: pointer;
      }

      .menu-toggle:focus-visible {
        outline: 2px solid var(--sheen);
        outline-offset: 2px;
      }

      /* Three lines drawn with a box and two shadows, so there is no icon font
         and no second SVG to keep in step with the one in the wordmark. */
      .bars,
      .bars::before,
      .bars::after {
        display: block;
        width: 18px;
        height: 2px;
        background: currentColor;
        border-radius: 1px;
      }

      .bars {
        position: relative;
      }

      .bars::before,
      .bars::after {
        content: '';
        position: absolute;
        left: 0;
      }

      .bars::before { top: -6px; }
      .bars::after { top: 6px; }

      /* overscroll-behavior: contain, because a wheel or a swipe over the scrim
         scrolled the page beneath it, and over the drawer itself it scrolled
         the page while the drawer stayed put — so on a phone the drawer's own
         content could not be scrolled at all. */
      .scrim {
        position: fixed;
        inset: 0;
        overscroll-behavior: contain;
        touch-action: none;
        background: rgb(0 0 0 / 45%);
        z-index: 20;
      }

      .controls {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(78vw, 320px);
        z-index: 21;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        gap: 1rem;
        padding: 1.25rem 1rem;
        background: var(--paper);
        border-left: 1px solid var(--hairline);
        overflow-y: auto;
        overscroll-behavior: contain;
        /* display:none when closed, not an off-canvas transform. Parking it at
           translateX(100%) put a 320px panel outside a 390px viewport, and the
           audit reported it as overflow, correctly: something sitting past the
           edge is past the edge whether or not it was put there on purpose.
           display:none keeps it out of the layout and still leaves the theme
           toggle in the DOM for brand/theme.js, which a condition would not. */
        display: none;
      }

      .controls.open {
        display: flex;
      }

      .drawer-nav {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .drawer-nav a {
        display: flex;
        align-items: center;
        min-height: 44px;
        padding: 0 0.5rem;
        color: var(--ink);
        text-decoration: none;
        border-radius: 3px;
      }

      .drawer-nav a:hover,
      .drawer-nav a:focus-visible {
        background: var(--sheen-faint, rgb(127 127 127 / 12%));
      }

      /* In the drawer there is room for the whole status, so the round rate
         that was hidden in the thin header comes back. */
      .status {
        font-size: 0.82rem;
      }

      .networks {
        flex-direction: column;
        align-items: stretch;
      }

      /* Menu title, close button, and the section labels under it. */
      .drawer-head {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border-bottom: 1px solid var(--hairline);
        padding-bottom: 0.6rem;
      }

      /* The title takes the slack so both buttons sit together on the right,
         theme first and close last: close is the one people reach for without
         looking, so it keeps the corner. */
      .head-title {
        display: block;
        flex: 1 1 auto;
      }

      .drawer-head .corvid-theme-toggle {
        flex: 0 0 auto;
      }

      /* Turned back on: the desktop block sets display:none for this, and the
         mobile block never said otherwise, so the close button disappeared and
         the only ways out were the scrim and Escape. It measured as top:0
         because a hidden element reports a zero box, which read as "same row as
         the toggle" until the screenshot showed there was no button at all. */
      .drawer-close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        padding: 0;
        font-size: 1.5rem;
        line-height: 1;
        background: none;
        border: 1px solid var(--hairline);
        border-radius: 3px;
        color: var(--ink);
        cursor: pointer;
      }

      .drawer-close:focus-visible {
        outline: 2px solid var(--sheen);
        outline-offset: 2px;
      }

      .drawer-label {
        display: block;
        font-size: 0.78rem;
        color: var(--text-faint);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .drawer-section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        border-top: 1px solid var(--hairline);
        padding-top: 0.85rem;
      }

      .drawer-section .connected {
        margin: 0;
        word-break: break-all;
      }

      .drawer-section .hint {
        margin: 0;
        color: var(--text-faint);
      }

      .drawer-section a,
      .drawer-section button {
        min-height: 44px;
        display: flex;
        align-items: center;
      }

      /* Pushed to the foot of the drawer: reference material rather than a
         control, worth being able to check and not worth the first screen.
         margin-top:auto in a column flex container takes all the slack above
         it, so it sits at the bottom however little else is in the drawer. */
      .network-label {
        display: block;
        margin-top: auto;
        border-top: 1px solid var(--hairline);
        padding-top: 0.85rem;
      }

      /* Free to wrap onto as many lines as it needs down here, which is why the
         round rate hidden in the thin header comes back. */
      .status {
        align-items: flex-start;
        line-height: 1.5;
      }

      .status .pace {
        display: inline;
      }
    }
    .status .mono { color: var(--text-faint); }
    .status.bad .mono { color: var(--danger); }
  `,
})
export class NetworkBar {
  protected readonly chain = inject(ChainService);
  protected readonly wallet = inject(WalletService);

  /**
   * The network picker is a developer control.
   *
   * The published page serves one hub, on one chain, and a holder has nothing
   * to choose. Turn it on with `?dev=1`. See `core/dev-mode.ts` for why this
   * is a security boundary and not a preference: without it, a link of the
   * form `?network=localnet` points a stranger's page at
   * `http://localhost:4001`.
   *
   * There is no app id field beside it, and there must not be one. The hub id
   * is a constant in `@corvidlabs/arcron-rain/rain`; making it typeable would
   * reintroduce the one attack this whole surface is free of.
   */
  protected readonly devMode = DEV_MODE;

  /**
   * Whether the mobile drawer is open.
   *
   * Only reachable under 480px: the button that sets it is display:none above
   * that, and the drawer styles itself back into an inline row. Nothing here
   * asks the viewport, because a component that reads a media query in
   * TypeScript disagrees with the stylesheet the first time somebody rotates a
   * phone.
   */
  protected readonly menuOpen = signal(false);

  constructor_menuLock = effect(() => {
    // The page must not scroll behind an open drawer. overscroll-behavior stops
    // a scroll chaining out of the drawer; it does not stop a wheel or swipe
    // that starts on the page itself, and the scrim is not a scroll container.
    // A class on body is the only thing that covers both.
    document.body.classList.toggle('menu-open', this.menuOpen());
  });

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  /** Short form of an address, for the wallet row. */
  protected readonly shortAddress = shortAddress;

  protected disconnectAndClose(): void {
    void this.wallet.disconnect();
    this.closeMenu();
  }

  /** Escape closes it, which is the one keyboard affordance a drawer must have. */
  protected onEscape(): void {
    this.closeMenu();
  }

  constructor() {
    // brand/theme.js wires every [data-corvid-theme-toggle] once, when it
    // loads. Angular renders this header after that would have happened, so
    // the script is loaded here instead, once the button it looks for exists.
    afterNextRender(() => {
      const script = document.createElement('script');
      script.src = 'brand/theme.js';
      document.head.appendChild(script);
    });
  }

  protected readonly networks = [
    { key: 'localnet' as const, label: 'LocalNet' },
    { key: 'testnet' as const, label: 'TestNet' },
  ];

  protected readonly statusClass = computed(() => {
    if (this.chain.status() === 'error') return 'bad';
    if (this.chain.genesisMatches() === false) return 'bad';
    if (this.chain.status() === 'connecting') return 'warn';
    return 'ready';
  });

  /**
   * The healthy status, split so a phone can show less of it.
   *
   * Null whenever something is wrong, because the error strings are sentences
   * and cutting a sentence in half to save room is how a warning stops
   * warning. Those keep using statusLabel and wrap if they must.
   */
  protected readonly statusParts = computed<{ chain: string; round: string; pace: string } | null>(() => {
    if (this.chain.status() === 'error') return null;
    if (this.chain.genesisMatches() === false) return null;
    if (this.chain.status() === 'connecting') return null;
    const basis = this.chain.paceSource() === 'measured' ? '' : ' nominal';
    return {
      chain: this.chain.genesisId() ?? '',
      round: String(this.chain.round()),
      pace: `${this.chain.secondsPerRound().toFixed(1)} s/round${basis}`,
    };
  });

  protected readonly statusLabel = computed(() => {
    const genesis = this.chain.genesisId();
    // Not necessarily the node. Everything before the box read can succeed
    // and the read still fail on data the app itself controls, and blaming
    // the connection sends someone to check their network while the actual
    // cause is the app they are pointed at.
    if (this.chain.status() === 'error') {
      return this.chain.genesisId() === null ? 'node unreachable' : 'read failed';
    }
    if (this.chain.genesisMatches() === false) return `wrong chain: ${genesis}`;
    if (this.chain.status() === 'connecting') return 'connecting…';
    const seconds = this.chain.secondsPerRound();
    const basis = this.chain.paceSource() === 'measured' ? '' : ' nominal';
    return `${genesis} · round ${this.chain.round()} · ${seconds.toFixed(1)} s/round${basis}`;
  });

  protected selectNetwork(network: NetworkKey): void {
    this.chain.setNetwork(network);
  }

}
