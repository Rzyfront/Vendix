import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { VexiAvatarComponent, VexiExpression } from './vexi-avatar.component';
import { VexiPanelComponent } from './vexi-panel.component';
import { VexiDockPositionService, DOCK_SIZE } from './vexi-dock-position.service';
import { VexiPresenceService } from './vexi-presence.service';
import { VexiRealtimeService } from '../../../core/services/vexi-realtime.service';

/**
 * Gesture the pointer has committed to.
 *
 * `pending` is the ambiguous window right after pointerdown: it is not yet
 * known whether the user is tapping, dragging or holding. It resolves into
 * exactly one of the other three.
 */
type DockMode = 'idle' | 'pending' | 'drag' | 'voice';

/** Which source currently owns the bubble. Voice always outranks presence. */
type HintSource = 'voice' | 'proactive';

/**
 * Movement past this many pixels means "drag", not "hold". Below it, small
 * finger tremor during a long-press should not cancel the hold.
 */
const DRAG_THRESHOLD_PX = 8;

/** How long the pointer must stay still before voice mode opens. */
const LONG_PRESS_MS = 450;

/**
 * A voice notice is transient by nature — a failed turn is over the moment it
 * is reported. Leaving the bubble (and the error face) pinned would make a
 * one-off hiccup look like a permanent broken state.
 */
const VOICE_HINT_MS = 5_000;

/**
 * Matches the bubble's opacity transition. The text is only unmounted once the
 * fade has finished, otherwise the element would vanish mid-transition.
 */
const HINT_FADE_MS = 200;

@Component({
  selector: 'app-vexi-dock',
  standalone: true,
  imports: [VexiAvatarComponent, VexiPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:resize)': 'onViewportChange()',
    '(window:orientationchange)': 'onViewportChange()',
  },
  template: `
    <!-- The anchor owns the transform so the panel travels with the dock while
         staying *outside* the role="button" element: assistive tech announces a
         button as a leaf, so anything interactive nested inside it (the panel's
         input, send and close controls) is not reliably reachable. -->
    <div class="vexi-dock__anchor" [style.transform]="transform()">
      <div
        class="vexi-dock"
        [class.vexi-dock--dragging]="mode() === 'drag'"
        [class.vexi-dock--voice]="voiceActive()"
        role="button"
        tabindex="0"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-expanded]="panelOpen()"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp()"
        (pointercancel)="onPointerCancel()"
        (contextmenu)="$event.preventDefault()"
        (keydown.enter)="togglePanel()"
        (keydown.space)="togglePanel()"
      >
        <!-- The halo replaces the old standalone ring: two concentric pulses
             on the same 94px circle read as a rendering glitch, and the halo
             carries the same "I'm listening" signal with real contrast. -->
        <app-vexi-avatar [expression]="expression()" [voice]="voiceActive()" />
      </div>

      @if (hintText(); as hint) {
        <span
          class="vexi-dock__hint"
          [class.vexi-dock__hint--left]="anchoredLeft()"
          [class.vexi-dock__hint--below]="anchoredTop()"
          [class.vexi-dock__hint--visible]="hintVisible()"
          role="status"
          >{{ hint }}</span
        >
      }

      @if (panelOpen()) {
        <!-- stopPropagation keeps clicks inside the panel from reaching the
             dock's gesture handlers, which would read them as taps. -->
        <div class="vexi-dock__panel" (pointerdown)="$event.stopPropagation()">
          <app-vexi-panel
            [anchorLeft]="anchoredLeft()"
            (closed)="panelOpen.set(false)"
          />
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 1200;
        /* The host is a 0x0 anchor; the child carries size and transform so
           the fixed-position element never participates in page layout. */
        width: 0;
        height: 0;
      }

      /* Carries the position. Sized like the dock so the hint (bottom: 100%)
         and the panel (inset: 0) keep resolving against the same box. The
         fallback must track DOCK_SIZE in vexi-dock-position.service.ts. */
      .vexi-dock__anchor {
        position: absolute;
        top: 0;
        left: 0;
        width: var(--vexi-dock-size, 94px);
        height: var(--vexi-dock-size, 94px);
        will-change: transform;
      }

      .vexi-dock {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        cursor: grab;
        /* Required for the gesture machine: without this, the browser claims
           the pointer stream for scrolling and pointermove stops firing. */
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        /* iOS fires the selection callout on long-press, which visually
           hijacks exactly the gesture that opens voice mode. */
        -webkit-touch-callout: none;
        -webkit-tap-highlight-color: transparent;
      }

      .vexi-dock:focus-visible {
        outline: 2px solid var(--color-primary, #2ecc71);
        outline-offset: 4px;
        border-radius: 50%;
      }

      .vexi-dock--dragging {
        cursor: grabbing;
      }

      .vexi-dock__panel {
        position: absolute;
        inset: 0;
        /* Children escape the dock's box; the wrapper itself must not
           intercept pointer events outside the panel's own bounds. */
        pointer-events: none;
        cursor: default;
      }

      .vexi-dock__panel > * {
        pointer-events: auto;
      }

      /* Anchored to an edge rather than centred: the dock snaps flush against
         the viewport border, so a centred bubble spills past it and the
         message gets clipped — which is precisely the default resting
         position, where errors are most likely to be read. It grows inward,
         away from the nearest edge. */
      .vexi-dock__hint {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        padding: 5px 10px;
        border-radius: 8px;
        background: rgb(0 0 0 / 0.82);
        color: #fff;
        font-size: 0.72rem;
        line-height: 1.3;
        /* Wrapping instead of nowrap: a long message on a narrow phone would
           overflow in whichever direction it grows. */
        width: max-content;
        max-width: min(240px, calc(100vw - 24px));
        pointer-events: none;
        opacity: 0;
        transition: opacity 180ms ease;
      }

      /* The class is already present on the first frame, so the entrance needs
         a keyframe: a transition has no earlier value to interpolate from. The
         exit is the transition above, when the class is removed. */
      .vexi-dock__hint--visible {
        opacity: 1;
        animation: vexi-hint-in 180ms ease;
      }

      .vexi-dock__hint--left {
        right: auto;
        left: 0;
      }

      /* Flipped downward when the dock rests in the upper half: pinned to the
         top edge, a bubble that grows upward is clipped by the viewport — the
         same failure the left/right flip already solves horizontally. */
      .vexi-dock__hint--below {
        bottom: auto;
        top: calc(100% + 8px);
      }

      @keyframes vexi-hint-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .vexi-dock__hint--visible {
          animation: none;
        }
      }
    `,
  ],
})
export class VexiDockComponent {
  private readonly positionService = inject(VexiDockPositionService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  private readonly voice = inject(VexiRealtimeService);
  private readonly presence = inject(VexiPresenceService);

  protected readonly mode = signal<DockMode>('idle');
  protected readonly panelOpen = signal(false);

  // ── Bubble ──────────────────────────────────────────────────────────────
  //
  // One bubble, two producers. `hintText` drives mounting and `hintVisible`
  // drives opacity, kept apart so the element survives its own fade-out
  // instead of being ripped out of the DOM the instant it stops being needed.

  protected readonly hintText = signal<string | null>(null);
  protected readonly hintVisible = signal(false);
  private readonly hintSource = signal<HintSource | null>(null);

  private hintTtlTimer: ReturnType<typeof setTimeout> | null = null;
  private hintFadeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * True whenever a voice turn is actually open, not merely while the finger
   * is down. The hold ends on pointerup but Vexi keeps thinking and speaking
   * after it, and the halo has to stay lit for exactly that window.
   */
  protected readonly voiceActive = computed(() => {
    if (this.mode() === 'voice') return true;

    const state = this.voice.state();
    return (
      state === 'connecting' ||
      state === 'listening' ||
      state === 'thinking' ||
      state === 'speaking'
    );
  });

  /**
   * Voice state wins over everything else whenever a turn is open — that is
   * the only time Vexi has something to say about itself. A proactive greeting
   * borrows the face only while its bubble is up.
   */
  protected readonly expression = computed<VexiExpression>(() => {
    switch (this.voice.state()) {
      case 'permission':
      case 'connecting':
      case 'thinking':
        return 'pensando';
      case 'listening':
        return 'escuchando';
      case 'speaking':
        return 'hablando';
      case 'error':
        // Transient: once the notice has faded, Vexi returns to rest even
        // though the service still reports the failed turn.
        return this.hintVisible() && this.hintSource() === 'voice'
          ? 'error'
          : 'neutro';
    }

    const greeting = this.presence.proactiveHint();
    return greeting && this.hintVisible() && this.hintSource() === 'proactive'
      ? greeting.expression
      : 'neutro';
  });

  private readonly position = this.positionService.position;

  protected readonly transform = computed(() => {
    const { x, y } = this.position();
    return `translate3d(${x}px, ${y}px, 0)`;
  });

  /**
   * True when the dock sits on the left half of the viewport, so the panel and
   * the bubble open rightward instead of off-screen.
   */
  protected readonly anchoredLeft = computed(() => {
    if (!this.isBrowser) return false;
    return this.position().x + DOCK_SIZE / 2 < window.innerWidth / 2;
  });

  /**
   * Vertical counterpart of `anchoredLeft`: on the upper half the bubble must
   * grow downward. Both re-evaluate on resize because `reclamp()` always
   * publishes a fresh position object.
   */
  protected readonly anchoredTop = computed(() => {
    if (!this.isBrowser) return false;
    return this.position().y + DOCK_SIZE / 2 < window.innerHeight / 2;
  });

  protected readonly ariaLabel = computed(() =>
    this.panelOpen()
      ? 'Cerrar Vexi. Mantén presionado para hablar.'
      : 'Abrir Vexi. Mantén presionado para hablar.',
  );

  private origin = { x: 0, y: 0 };
  private grabOffset = { x: 0, y: 0 };
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private activePointerId: number | null = null;

  constructor() {
    // Position depends on window dimensions, so it can only be resolved once
    // the browser has laid out — never during SSR.
    afterNextRender(() => this.positionService.restore());

    // Bubble arbitration. A voice notice always displaces a greeting; a
    // greeting only shows when voice has nothing to report.
    effect(() => {
      const state = this.voice.state();
      const error = this.voice.errorMessage();
      const greeting = this.presence.proactiveHint();

      const voiceMessage =
        state === 'error'
          ? (error ?? 'La sesión de voz falló.')
          : state === 'permission'
            ? 'Autoriza el micrófono…'
            : null;

      untracked(() => {
        if (voiceMessage) {
          this.pushHint('voice', voiceMessage, VOICE_HINT_MS);
        } else if (greeting) {
          // Presence owns the greeting's lifetime, so no local TTL here.
          this.pushHint('proactive', greeting.message, null);
        } else {
          this.fadeOutHint();
        }
      });
    });

    // Context suppression for presence: a greeting must never land on top of
    // an open panel, an active voice turn, or a drag in progress.
    effect(() => {
      const busy =
        this.panelOpen() || this.mode() === 'drag' || this.voiceActive();
      untracked(() => this.presence.setBusy(busy));
    });

    this.destroyRef.onDestroy(() => {
      this.cancelHoldTimer();
      this.clearHintTimers();
      // Presence is root-scoped and outlives the dock. Leaving it suppressed
      // because the dock happened to be busy at teardown would silence Vexi
      // for the rest of the session.
      this.presence.setBusy(false);
    });
  }

  // ── Gesture machine ─────────────────────────────────────────────────────
  //
  // tap, drag and long-press all begin with the same pointerdown. They are
  // separated by which of two thresholds is crossed first: 8px of travel
  // (drag) or 450ms of stillness (voice). Whichever wins cancels the other.

  protected onPointerDown(event: PointerEvent): void {
    if (!this.isBrowser || this.mode() !== 'idle') return;

    this.activePointerId = event.pointerId;
    this.origin = { x: event.clientX, y: event.clientY };

    const { x, y } = this.position();
    this.grabOffset = { x: event.clientX - x, y: event.clientY - y };

    // Keeps pointermove/up flowing to this element even when the pointer
    // leaves the dock's box mid-drag.
    (event.target as Element).setPointerCapture?.(event.pointerId);

    this.mode.set('pending');
    this.holdTimer = setTimeout(() => {
      if (this.mode() === 'pending') this.enterVoiceMode();
    }, LONG_PRESS_MS);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) return;

    const mode = this.mode();
    // Once voice is open the pointer is holding the mic, not dragging.
    if (mode === 'voice' || mode === 'idle') return;

    if (mode === 'pending') {
      const dx = event.clientX - this.origin.x;
      const dy = event.clientY - this.origin.y;
      if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;

      this.cancelHoldTimer();
      this.mode.set('drag');
    }

    this.positionService.moveTo(
      event.clientX - this.grabOffset.x,
      event.clientY - this.grabOffset.y,
    );
  }

  protected onPointerUp(): void {
    const mode = this.mode();
    this.cancelHoldTimer();
    this.activePointerId = null;

    switch (mode) {
      case 'pending':
        this.togglePanel();
        break;
      case 'drag':
        this.positionService.snapToEdge();
        break;
      case 'voice':
        this.exitVoiceMode();
        break;
    }

    if (mode !== 'idle') this.mode.set('idle');
  }

  /**
   * The OS took the pointer away (call, notification, gesture nav). Treated as
   * an abort, never as a tap — otherwise an interrupted drag would open the
   * panel the user never asked for.
   */
  protected onPointerCancel(): void {
    const mode = this.mode();
    this.cancelHoldTimer();
    this.activePointerId = null;

    if (mode === 'drag') this.positionService.snapToEdge();
    if (mode === 'voice') this.exitVoiceMode();

    this.mode.set('idle');
  }

  protected onViewportChange(): void {
    this.positionService.reclamp();
  }

  protected togglePanel(): void {
    // Tapping the dock while a greeting is up dismisses it and counts as real
    // use, which resets fatigue and buys the two-hour silence.
    this.presence.noteInteraction();
    this.panelOpen.update((open) => !open);
  }

  // ── Bubble plumbing ─────────────────────────────────────────────────────

  private pushHint(
    source: HintSource,
    text: string,
    ttlMs: number | null,
  ): void {
    // Re-arming on every emission of an unchanged state would keep the notice
    // alive forever, since the voice service republishes on each tick.
    if (
      this.hintVisible() &&
      this.hintSource() === source &&
      this.hintText() === text
    ) {
      return;
    }

    this.clearHintTimers();
    this.hintSource.set(source);
    this.hintText.set(text);
    this.hintVisible.set(true);

    if (ttlMs !== null) {
      this.hintTtlTimer = setTimeout(() => this.fadeOutHint(), ttlMs);
    }
  }

  private fadeOutHint(): void {
    this.clearHintTimers();
    if (!this.hintVisible() && this.hintText() === null) return;

    this.hintVisible.set(false);
    this.hintFadeTimer = setTimeout(() => {
      this.hintFadeTimer = null;
      this.hintText.set(null);
      this.hintSource.set(null);
    }, HINT_FADE_MS);
  }

  private clearHintTimers(): void {
    if (this.hintTtlTimer !== null) {
      clearTimeout(this.hintTtlTimer);
      this.hintTtlTimer = null;
    }
    if (this.hintFadeTimer !== null) {
      clearTimeout(this.hintFadeTimer);
      this.hintFadeTimer = null;
    }
  }

  // ── Voice mode ──────────────────────────────────────────────────────────

  private enterVoiceMode(): void {
    this.presence.noteInteraction();
    this.mode.set('voice');
    void this.voice.start().then((opened) => {
      // The attempt was spent on the permission dialog, which also killed the
      // hold. Drop back to idle so the next press starts a real turn.
      if (!opened) this.mode.set('idle');
    });
  }

  private exitVoiceMode(): void {
    void this.voice.stop();
  }

  private cancelHoldTimer(): void {
    if (this.holdTimer === null) return;
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  protected readonly dockSize = DOCK_SIZE;
}
