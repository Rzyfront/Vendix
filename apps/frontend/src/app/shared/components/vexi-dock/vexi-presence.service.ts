import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { VEXI_GREETINGS, VexiGreeting } from './vexi-greetings.constant';

/**
 * Sibling of `vendix_vexi_dock_position`: the presence budget lives in the same
 * store as the dock position because both are per-device dock preferences that
 * must survive a hard reload. A SPA navigation never reloads the document, but
 * an F5 or a second tab would otherwise hand the user a fresh quota — and a
 * user who reloads a few times while working would be greeted on every reload.
 */
const STORAGE_KEY = 'vendix_vexi_presence';

/**
 * Any real use of Vexi (opening the panel, sending a message, holding to talk)
 * buys this much silence. Somebody who is already using the assistant does not
 * need to be offered it.
 */
const INTERACTION_SILENCE_MS = 2 * 60 * 60 * 1000;

/** Baseline gap between two proactive greetings while nothing is ignored. */
const BASE_CADENCE_MS = 15 * 60 * 1000;

/** Ignored greetings after which the cadence doubles. */
const FATIGUE_SLOWDOWN_AT = 3;

/** Ignored greetings after which presence shuts down for the session. */
const FATIGUE_SHUTDOWN_AT = 5;

/** How long a greeting stays on screen before it counts as ignored. */
const GREETING_VISIBLE_MS = 9_000;

/**
 * The budget is evaluated on a slow tick rather than a single armed timeout:
 * every suppression rule (panel open, voice, drag, hidden tab) can flip at any
 * moment, and re-arming a timeout on each of those transitions is how a
 * greeting ends up firing the instant a panel closes.
 */
const TICK_MS = 30_000;

/**
 * A gap this long since the last recorded activity is treated as a new
 * session, which is what re-enables presence after the 5-ignore shutdown.
 * Wall-clock is the only session signal that also survives a reload — using
 * `sessionStorage` would reset the shutdown on every F5, which is exactly the
 * loophole the persistence rule exists to close.
 */
const SESSION_GAP_MS = 8 * 60 * 60 * 1000;

interface PresenceRecord {
  /** Epoch ms of the last greeting shown. */
  lastGreetingAt: number;
  /** Epoch ms of the last real interaction with Vexi. */
  lastInteractionAt: number;
  /** Consecutive greetings that expired without the user reacting. */
  ignoredStreak: number;
}

/**
 * Decides *when* Vexi may speak first.
 *
 * The line between company and harassment is frequency, so the rules are hard
 * and cumulative: recent use silences presence outright, context suppresses it
 * while it could not be seen or would interrupt, and fatigue slows it down and
 * then stops it. The dock only supplies context and consumes `proactiveHint`;
 * it never decides whether a greeting is due.
 */
@Injectable({ providedIn: 'root' })
export class VexiPresenceService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  private readonly hint = signal<VexiGreeting | null>(null);

  /** The greeting the dock should be showing, or `null`. */
  readonly proactiveHint = this.hint.asReadonly();

  /**
   * True while the dock is in a state where a greeting must not appear: panel
   * open, voice turn, or an in-flight drag. Pushed by the dock rather than
   * pulled, so this service stays free of any component reference.
   */
  private readonly busy = signal(false);

  private lastGreetingAt = 0;
  private lastInteractionAt = 0;
  private ignoredStreak = 0;
  private lastPickedIndex = -1;

  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (!this.isBrowser) return;

    this.restore();

    const tick = setInterval(() => this.evaluate(), TICK_MS);
    this.destroyRef.onDestroy(() => {
      clearInterval(tick);
      this.clearHintTimer();
    });
  }

  // ── Signals the dock pushes in ──────────────────────────────────────────

  /**
   * Records a real interaction: resets fatigue, drops any greeting on screen
   * and buys two hours of silence. Called on panel toggle and on entering
   * voice mode — which also covers "sent a message", since a message can only
   * be sent through an open panel.
   */
  noteInteraction(): void {
    if (!this.isBrowser) return;

    this.clearHintTimer();
    this.hint.set(null);
    this.lastInteractionAt = Date.now();
    this.ignoredStreak = 0;
    this.persist();
  }

  /**
   * Context suppression. Hiding a greeting because the dock got busy is not an
   * ignore: the user never had the chance to react to it, so the fatigue
   * counter is left alone.
   */
  setBusy(busy: boolean): void {
    if (!this.isBrowser) return;

    this.busy.set(busy);
    if (busy && this.hint()) {
      this.clearHintTimer();
      this.hint.set(null);
    }
  }

  // ── Budget machine ──────────────────────────────────────────────────────

  private evaluate(): void {
    // One greeting at a time; a second would stack on the same bubble.
    if (this.hint()) return;
    if (!this.canGreetNow()) return;

    this.show(this.pick());
  }

  private canGreetNow(): boolean {
    if (this.ignoredStreak >= FATIGUE_SHUTDOWN_AT) return false;
    if (this.busy()) return false;
    // A greeting nobody can see still spends its slot, so a backgrounded tab
    // must not consume the budget.
    if (document.visibilityState !== 'visible') return false;

    const now = Date.now();
    if (now - this.lastInteractionAt < INTERACTION_SILENCE_MS) return false;

    return now - this.lastGreetingAt >= this.cadenceMs();
  }

  private cadenceMs(): number {
    return this.ignoredStreak >= FATIGUE_SLOWDOWN_AT
      ? BASE_CADENCE_MS * 2
      : BASE_CADENCE_MS;
  }

  private show(greeting: VexiGreeting): void {
    this.hint.set(greeting);
    this.lastGreetingAt = Date.now();
    this.persist();

    this.clearHintTimer();
    this.hintTimer = setTimeout(() => this.expire(), GREETING_VISIBLE_MS);
  }

  /** The greeting ran its course untouched — that is one ignore. */
  private expire(): void {
    this.hintTimer = null;
    if (!this.hint()) return;

    this.hint.set(null);
    this.ignoredStreak += 1;
    this.persist();
  }

  /** Never repeats the previous line back-to-back. */
  private pick(): VexiGreeting {
    if (VEXI_GREETINGS.length === 1) return VEXI_GREETINGS[0];

    let index = this.lastPickedIndex;
    while (index === this.lastPickedIndex) {
      index = Math.floor(Math.random() * VEXI_GREETINGS.length);
    }
    this.lastPickedIndex = index;
    return VEXI_GREETINGS[index];
  }

  private clearHintTimer(): void {
    if (this.hintTimer === null) return;
    clearTimeout(this.hintTimer);
    this.hintTimer = null;
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  private restore(): void {
    const stored = this.read();
    const now = Date.now();

    if (!stored) {
      // No history: start the clock now instead of at epoch, otherwise the
      // very first tick would greet a user who just arrived. Written through
      // so the clock survives a reload — reseeding it on every load would let
      // a user who reloads often outrun the cadence forever.
      this.lastGreetingAt = now;
      this.persist();
      return;
    }

    this.lastGreetingAt = stored.lastGreetingAt;
    this.lastInteractionAt = stored.lastInteractionAt;

    const lastActivity = Math.max(stored.lastGreetingAt, stored.lastInteractionAt);
    this.ignoredStreak =
      now - lastActivity >= SESSION_GAP_MS ? 0 : stored.ignoredStreak;
  }

  private read(): PresenceRecord | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as Partial<PresenceRecord>;
      if (
        typeof parsed?.lastGreetingAt !== 'number' ||
        typeof parsed?.lastInteractionAt !== 'number' ||
        typeof parsed?.ignoredStreak !== 'number'
      ) {
        return null;
      }

      return {
        lastGreetingAt: parsed.lastGreetingAt,
        lastInteractionAt: parsed.lastInteractionAt,
        ignoredStreak: parsed.ignoredStreak,
      };
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      const record: PresenceRecord = {
        lastGreetingAt: this.lastGreetingAt,
        lastInteractionAt: this.lastInteractionAt,
        ignoredStreak: this.ignoredStreak,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Private browsing / quota exceeded — the budget just won't survive a
      // reload. Presence still behaves correctly within the session.
    }
  }
}
