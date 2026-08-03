import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { VexiAvatarComponent, VexiExpression } from './vexi-avatar.component';
import { VexiPanelComponent } from './vexi-panel.component';
import { VexiDockPositionService, DOCK_SIZE } from './vexi-dock-position.service';
import { VexiRealtimeService } from '../../../core/services/vexi-realtime.service';

/**
 * Gesture the pointer has committed to.
 *
 * `pending` is the ambiguous window right after pointerdown: it is not yet
 * known whether the user is tapping, dragging or holding. It resolves into
 * exactly one of the other three.
 */
type DockMode = 'idle' | 'pending' | 'drag' | 'voice';

/**
 * Movement past this many pixels means "drag", not "hold". Below it, small
 * finger tremor during a long-press should not cancel the hold.
 */
const DRAG_THRESHOLD_PX = 8;

/** How long the pointer must stay still before voice mode opens. */
const LONG_PRESS_MS = 450;

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
        [class.vexi-dock--voice]="mode() === 'voice'"
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
        <app-vexi-avatar
          [expression]="expression()"
          [pulsing]="mode() === 'voice'"
        />

        @if (mode() === 'voice') {
          <span class="vexi-dock__ring" aria-hidden="true"></span>
        }
      </div>

      @if (voiceHint(); as hint) {
        <span
          class="vexi-dock__hint"
          [class.vexi-dock__hint--left]="anchoredLeft()"
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
         and the panel (inset: 0) keep resolving against the same 60px box they
         did when they were children of .vexi-dock itself. */
      .vexi-dock__anchor {
        position: absolute;
        top: 0;
        left: 0;
        width: var(--vexi-dock-size, 78px);
        height: var(--vexi-dock-size, 78px);
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
        outline: 2px solid rgb(var(--color-primary-500, 34 197 94));
        outline-offset: 4px;
        border-radius: 50%;
      }

      .vexi-dock--dragging {
        cursor: grabbing;
      }

      .vexi-dock__panel {
        position: absolute;
        inset: 0;
        /* Children escape the 60px box; the wrapper itself must not intercept
           pointer events outside the panel's own bounds. */
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
      }

      .vexi-dock__hint--left {
        right: auto;
        left: 0;
      }

      .vexi-dock__ring {
        position: absolute;
        inset: -6px;
        border-radius: 50%;
        border: 2px solid rgb(var(--color-primary-500, 34 197 94) / 0.65);
        animation: vexi-ring 1.4s ease-out infinite;
        pointer-events: none;
      }

      @keyframes vexi-ring {
        0% {
          transform: scale(0.9);
          opacity: 0.9;
        }
        100% {
          transform: scale(1.35);
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .vexi-dock__ring {
          animation: none;
          opacity: 0.5;
        }
      }
    `,
  ],
})
export class VexiDockComponent {
  private readonly positionService = inject(VexiDockPositionService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly voice = inject(VexiRealtimeService);

  protected readonly mode = signal<DockMode>('idle');
  protected readonly panelOpen = signal(false);

  /**
   * Voice state wins over the resting expression whenever a turn is open —
   * that is the only time Vexi has something to say about itself.
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
        return 'error';
      default:
        return 'neutro';
    }
  });

  protected readonly voiceHint = computed(() => {
    if (this.voice.state() === 'error') return this.voice.errorMessage();
    if (this.voice.state() === 'permission') return 'Autoriza el micrófono…';
    return null;
  });

  private readonly position = this.positionService.position;

  protected readonly transform = computed(() => {
    const { x, y } = this.position();
    return `translate3d(${x}px, ${y}px, 0)`;
  });

  /**
   * True when the dock sits on the left half of the viewport, so the panel
   * opens rightward instead of off-screen.
   */
  protected readonly anchoredLeft = computed(() => {
    if (!this.isBrowser) return false;
    return this.position().x + DOCK_SIZE / 2 < window.innerWidth / 2;
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
    // leaves its 60px box mid-drag.
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
    this.panelOpen.update((open) => !open);
  }

  // ── Voice mode ──────────────────────────────────────────────────────────

  private enterVoiceMode(): void {
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
