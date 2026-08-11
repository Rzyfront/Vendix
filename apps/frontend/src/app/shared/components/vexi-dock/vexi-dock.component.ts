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
import { VexiFacade } from '../../../core/store/vexi/vexi.facade';
import { VexiPanelComponent } from './vexi-panel.component';
import { VexiDockPositionService } from './vexi-dock-position.service';
import { VexiPresenceService } from './vexi-presence.service';
import { VexiRealtimeService } from '../../../core/services/vexi-realtime.service';
import { StoreSettingsFacade } from '../../../core/store/store-settings/store-settings.facade';

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

/**
 * How long the dock takes to glide back to its edge after a drag.
 *
 * Must match the transition on `.vexi-dock__anchor--settling`: the timer is
 * what decides when the landing shake fires, so a shorter value would shake
 * mid-flight and a longer one would leave a visible pause on arrival.
 */
const SETTLE_MS = 300;

/** Duration of the landing / open / close shake. Matches `vexi-wobble`. */
const WOBBLE_MS = 200;

/**
 * How far before the glide ends the landing shake starts.
 *
 * Firing the shake exactly on arrival reads as two separate events — the dock
 * stops, then it wobbles. Overlapping the last 50ms makes the shake look
 * caused by the landing instead of appended to it. It has to stay well under
 * SETTLE_MS: start too early and the dock is shaking in mid-flight.
 */
const WOBBLE_LEAD_MS = 50;

/** How long the greeting pose stays up when the panel opens. */
const GREETING_POSE_MS = 900;

/**
 * The goodbye lingers, and for a randomised while.
 *
 * Closing the panel starts the two-hour silence, so the state underneath is
 * already `sleeping` — without a pause the dock would snap from conversation
 * straight to a nap. Holding `sad` bridges the two, and randomising the hold
 * keeps it from reading as a scripted animation that always lasts the same.
 */
const FAREWELL_MIN_MS = 5_000;
const FAREWELL_MAX_MS = 15_000;

@Component({
  selector: 'app-vexi-dock',
  standalone: true,
  imports: [VexiAvatarComponent, VexiPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:resize)': 'onViewportChange()',
    '(window:orientationchange)': 'onViewportChange()',
    // Publicada en el host y no en el ancla para que herede hasta la avatar: su
    // flotación se mide contra el diámetro, y un span suelto dentro del ancla no
    // la alcanzaría sin repetir la variable.
    '[style.--vexi-dock-size]': 'dockSizeVar()',
  },
  template: `
    <!-- The anchor owns the transform so the panel travels with the dock while
         staying *outside* the role="button" element: assistive tech announces a
         button as a leaf, so anything interactive nested inside it (the panel's
         input, send and close controls) is not reliably reachable. -->
    <div
      class="vexi-dock__anchor"
      [class.vexi-dock__anchor--settling]="settling()"
      [style.transform]="transform()"
    >
      <div
        class="vexi-dock"
        [class.vexi-dock--dragging]="mode() === 'drag'"
        [class.vexi-dock--voice]="voiceActive()"
        [class.vexi-dock--wobble]="wobbling()"
        [class.vexi-dock--covered]="panelOpen()"
        role="button"
        [attr.tabindex]="panelOpen() ? -1 : 0"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-expanded]="panelOpen()"
        [attr.aria-hidden]="panelOpen()"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp()"
        (pointercancel)="onPointerCancel()"
        (contextmenu)="$event.preventDefault()"
        (keydown.enter)="togglePanel()"
        (keydown.space)="togglePanel()"
      >
        <!-- El velo existe para tener un transform PROPIO, no por estructura.
             La cadena ya tiene tres dueños y ninguno se puede compartir:
             .vexi-dock__anchor lleva la posición (drag + settle), .vexi-dock
             lleva vexi-wobble y .vexi-avatar__body lleva vexi-breathe.
             Poner el encogido de ocultación en .vexi-dock chocaría con el
             wobble, que togglePanel() dispara en el MISMO instante en que cambia
             panelOpen — la colisión no sería un riesgo, sería simultánea por
             construcción.

             Y es position:absolute con inset:0, no un span pelado, a propósito:
             un elemento con transform se vuelve el bloque contenedor de sus
             descendientes absolutos, y app-vexi-avatar es :host con
             position:absolute e inset:0. Con un envoltorio de 0x0 la avatar
             colapsaría a nada.

             (Sin comillas invertidas en todo este literal: una sola cierra la
             plantilla y Angular falla con "Code 1010".)

             El halo reemplaza al anillo suelto de antes: dos pulsos
             concéntricos sobre el mismo círculo de 94px leen como un glitch de
             render, y el halo lleva la misma señal de "te estoy escuchando"
             con contraste de verdad. -->
        <span
          class="vexi-dock__veil"
          [class.vexi-dock__veil--hidden]="panelOpen()"
        >
          <app-vexi-avatar [expression]="expression()" [voice]="voiceActive()" />
        </span>
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
            [openInVoice]="openPanelInVoice()"
            (closed)="closePanel()"
            (gripDown)="onGripDown($event)"
            (gripMove)="onPointerMove($event)"
            (gripUp)="onPointerUp()"
            (gripCancel)="onPointerCancel()"
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
         and the panel (inset: 0) keep resolving against the same box.

         La variable la publica el host desde dockSizeVar(), que es el mismo
         número con el que el servicio recorta e imanta la posición: el recorte
         por tamaño de pantalla no puede vivir en una media query de aquí, o el
         dock se imantaría reservando 94px para un círculo de 56. El fallback
         solo cubre el frame previo a la hidratación. */
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

      /* Only while returning to the edge. Sitting on the anchor permanently
         would put a half-second transition on the same transform the drag
         writes every pointermove, and the dock would trail the finger. The
         easing overshoots slightly, so the arrival reads as settling rather
         than as stopping dead. Keep in sync with SETTLE_MS. */
      .vexi-dock__anchor--settling {
        transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      /* Applied to the inner dock, never to the anchor: the anchor's transform
         is the position, and animating it here would fight the settle
         transition and leave the dock a few pixels off its edge. */
      .vexi-dock--wobble {
        animation: vexi-wobble 200ms ease-in-out;
      }

      /* Horizontal, and small. It starts 50ms before the glide ends, so for
         that overlap the dock is still moving sideways underneath — a shake on
         the same axis reads as the impact absorbing, whereas a rotation would
         read as a second, unrelated motion. The amplitude stays under the
         dock's own margin so it never crosses the viewport edge it is landing
         against. */
      @keyframes vexi-wobble {
        0%,
        100% {
          transform: translateX(0);
        }
        25% {
          transform: translateX(-5px);
        }
        55% {
          transform: translateX(4px);
        }
        80% {
          transform: translateX(-2px);
        }
      }

      /* Capa exclusiva del ocultamiento. Ver el comentario del template para por
         qué no puede compartir elemento con el wobble ni ser un span sin caja.
         Hereda el cursor del dock para que el hueco no cambie de puntero. */
      /* La salida y la entrada duran lo mismo pero no se sienten igual, y eso es
         deliberado. Yéndose usa ease-in: acelera al final, que es cómo se ve
         algo que se mete detrás de otra cosa. Volviendo usa un cubic-bezier con
         rebase leve, que es cómo se ve algo que se asoma. Un ease simétrico en
         las dos direcciones haría que aparecer y desaparecer se leyeran como el
         mismo gesto reproducido al revés, y aparecer es el que tiene que llamar
         la atención. */
      .vexi-dock__veil {
        position: absolute;
        inset: 0;
        display: block;
        transition:
          opacity 200ms ease-out,
          transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      /* Se esconde HACIA ARRIBA porque ahí está el panel: .vexi-panel se ancla
         con bottom: calc(100% + 12px), siempre encima del dock, y pinta por
         delante al ir después en el DOM. Así que subir encogiendo lee como
         meterse detrás de la ventana, y el regreso lee como asomarse por su
         borde inferior. La dirección es fija: el panel nunca voltea en
         vertical — solo el globo de pista tiene su variante --below.

         La visibility va con delay en vez de sumarse a la transición porque no
         interpola: cambiaría al primer frame y la avatar desaparecería de golpe
         en lugar de irse. Con el delay cae justo cuando ya no se ve, y es lo que
         la saca del árbol de accesibilidad además del aria-hidden. */
      .vexi-dock__veil--hidden {
        opacity: 0;
        transform: translateY(-14px) scale(0.72);
        visibility: hidden;
        transition:
          opacity 200ms ease-in,
          transform 200ms ease-in,
          visibility 0s linear 200ms;
      }

      /* El puntero se apaga en el dock y no en el velo: el velo es solo pintura
         —la avatar ya tiene pointer-events en none— y el que recibe los gestos es
         .vexi-dock. Dejarlo activo mientras está invisible daría un círculo
         fantasma de 96px que se puede arrastrar sobre el panel. */
      .vexi-dock--covered {
        pointer-events: none;
        cursor: default;
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

        /* The dock still returns to its edge — it just arrives instantly. */
        .vexi-dock__anchor--settling {
          transition: none;
        }

        .vexi-dock--wobble {
          animation: none;
        }

        /* La avatar sigue apareciendo y desapareciendo —eso es información, no
           adorno— pero sin desplazarse ni encogerse. Solo el cross-fade, que es
           lo que prefers-reduced-motion permite. Sin esta regla el velo sería
           lo único del dock que se sigue moviendo. */
        .vexi-dock__veil,
        .vexi-dock__veil--hidden {
          transform: none;
          transition:
            opacity 200ms linear,
            visibility 0s linear 200ms;
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
  private readonly chat = inject(VexiFacade);

  protected readonly mode = signal<DockMode>('idle');
  protected readonly panelOpen = signal(false);

  /**
   * Which engine the hold gesture routes to, per store setting.
   *
   * Absent reads as `realtime`, so nothing changes for a store that predates the
   * key. See `StoreSettingsFacade.vexiVoiceEngine`.
   */
  private readonly voiceEngine = inject(StoreSettingsFacade).vexiVoiceEngine;

  /**
   * True when the panel was opened by the hold gesture under the pipeline engine.
   *
   * Not derived from `voiceEngine` alone: a pipeline store still opens the panel
   * in chat mode on a plain tap. What decides the mode is *how* it was opened.
   */
  protected readonly openPanelInVoice = signal(false);

  // ── Reacciones ──────────────────────────────────────────────────────────
  //
  // Two primitives cover every "the dock should react to this" request:
  // a transient pose and a transient shake. Both are plain timers rather than
  // Angular animations because the dock is `OnPush` in a zoneless app and the
  // signal write is what schedules the frame.

  /** Pose held for a moment, overriding whatever state would otherwise show. */
  private readonly flashedExpression = signal<VexiExpression | null>(null);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  /** True while the little shake plays. */
  protected readonly wobbling = signal(false);
  private wobbleTimer: ReturnType<typeof setTimeout> | null = null;

  /** True while the dock glides back to its edge after a drag. */
  protected readonly settling = signal(false);
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Fires the landing shake `WOBBLE_LEAD_MS` before the glide finishes. */
  private settleShakeTimer: ReturnType<typeof setTimeout> | null = null;

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
    // A short-lived pose wins over every derived state.
    //
    // Some moments have no state to derive from: opening the panel, closing
    // it, or the reply landing are events, not conditions, and the avatar was
    // silent through all of them. Measuring a real turn showed the vocabulary
    // in practice was two poses out of the whole sheet — the resting one and
    // the thinking one — which is why the face read as frozen on the wink.
    const flash = this.flashedExpression();
    if (flash) return flash;

    switch (this.voice.state()) {
      case 'permission':
      case 'connecting':
      case 'thinking':
      case 'listening':
        return 'thinking';
      case 'speaking':
        return 'excited';
      case 'error':
        // Only while the notice is on screen. `error` is a *sticky* state —
        // the service keeps reporting the failed turn forever, so a user who
        // denies the microphone once would otherwise pin the face here for the
        // rest of the session. Crucially this falls THROUGH instead of
        // returning a resting pose: returning would short-circuit every state
        // below it, and a denied microphone would silently cost the avatar its
        // chat, proactive and sleeping faces too. Measured live: with
        // `voice.state() === 'error'` and the notice faded, `dormant()` was
        // true and the face still read `idle`.
        if (this.hintVisible() && this.hintSource() === 'voice') return 'error';
        break;
    }

    // Every proactive offer wears the same face. It is one behaviour — Vexi
    // stepping forward to suggest something — and varying the pose per line
    // made it read as nine unrelated moods.
    if (
      this.presence.proactiveHint() &&
      this.hintVisible() &&
      this.hintSource() === 'proactive'
    ) {
      return 'wow';
    }

    // The typed conversation gets a face too. Until now only the voice surface
    // and proactive greetings moved it, so a chat turn — the way Vexi is
    // actually used — ran from question to answer with the avatar frozen.
    if (this.chat.error()) return 'error';
    // A queued write is Vexi holding something out for approval, the same
    // gesture as a proactive offer, so it wears the same face.
    if (this.chat.pendingProposal()) return 'wow';
    // `streamingContent` is NOT checked here even though it looks like the
    // obvious witness for "talking": sampling a real turn at 50ms showed it
    // stays empty from start to finish, and the assistant message jumps from 0
    // to its full length in one step — the UI never renders a typing phase, so
    // there is no condition to derive it from. `excited` is flashed when the
    // reply lands instead (see the effect below).
    if (this.chat.isSending() || this.chat.isStreaming()) return 'thinking';
    if (this.chat.toolSteps().some((step) => step.status === 'running')) {
      return 'thinking';
    }

    // Asleep during the two hours of silence that recent use buys, and only
    // with the panel shut. Ranked below every active state on purpose: being
    // inside the quiet window says nothing about whether Vexi is busy right
    // now, and a dock that dozed off mid-answer would be worse than one that
    // never sleeps.
    //
    // The open-panel clause is the load-bearing half. `dormant` is true
    // *because* the panel was opened — `togglePanel()` calls
    // `noteInteraction()`, which starts the silence — so without it the face
    // fell asleep the moment the conversation began and stayed asleep between
    // turns, in front of somebody actively typing.
    if (!this.panelOpen() && this.presence.dormant()) return 'sleeping';

    return 'idle';
  });

  private readonly position = this.positionService.position;

  protected readonly transform = computed(() => {
    const { x, y } = this.position();
    return `translate3d(${x}px, ${y}px, 0)`;
  });

  /**
   * Orientación del panel y la burbuja, congelada mientras dura un arrastre.
   *
   * Sin esto el arrastre se rompe al cruzar la mitad de la pantalla: los dos
   * predicados de abajo derivan de `position()`, que se reescribe en CADA
   * `pointermove`, así que al pasar el eje `anchoredLeft` cambia, el panel salta
   * de `right: 0` a `left: 0` y se teletransporta ~370px lateralmente debajo del
   * dedo. El dock en sí no salta —`grabOffset` se mide contra el dock, no contra
   * la barra— pero el conjunto sí, y desde el otro lado del vidrio eso se lee
   * exactamente como perder el agarre y recuperarlo.
   *
   * Se congela al entrar en `drag` y se libera cuando termina el asentado, no al
   * soltar: al final del glide el dock ya está clavado en su borde, así que el
   * único reacomodo del panel coincide con un movimiento que ya existe y pasa
   * desapercibido. Un solo salto al aterrizar en vez de uno por píxel.
   */
  private readonly anchorFrozen = signal<{
    left: boolean;
    top: boolean;
  } | null>(null);

  /**
   * True when the dock sits on the left half of the viewport, so the panel and
   * the bubble open rightward instead of off-screen.
   */
  protected readonly anchoredLeft = computed(() => {
    const frozen = this.anchorFrozen();
    // El return temprano es lo que corta la dependencia de `position()`: con el
    // ancla congelada este computed deja de recalcularse durante el gesto.
    if (frozen) return frozen.left;
    if (!this.isBrowser) return false;
    return this.position().x + this.positionService.size() / 2 < window.innerWidth / 2;
  });

  /**
   * Vertical counterpart of `anchoredLeft`: on the upper half the bubble must
   * grow downward. Both re-evaluate on resize because `reclamp()` always
   * publishes a fresh position object.
   */
  protected readonly anchoredTop = computed(() => {
    const frozen = this.anchorFrozen();
    if (frozen) return frozen.top;
    if (!this.isBrowser) return false;
    return this.position().y + this.positionService.size() / 2 < window.innerHeight / 2;
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

    // The reply landing.
    //
    // The UI has no typing phase — the assistant message goes from empty to
    // complete in a single step — so "Vexi is talking" is an instant, not a
    // condition, and no computed can express it. Watching the busy flags fall
    // is what turns that instant into a visible pose.
    let wasBusy = false;
    effect(() => {
      const busy = this.chat.isSending() || this.chat.isStreaming();

      untracked(() => {
        if (wasBusy && !busy) {
          // Not when the turn ended badly: `error` and `pendingProposal` are
          // real states the face should keep showing, and a cheerful `excited`
          // over a failure would be the avatar contradicting the message.
          if (!this.chat.error() && !this.chat.pendingProposal()) {
            this.flashExpression('excited', 1400);
            this.wobble();
          }
        }
        wasBusy = busy;
      });
    });

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
      if (this.flashTimer) clearTimeout(this.flashTimer);
      if (this.wobbleTimer) clearTimeout(this.wobbleTimer);
      if (this.settleTimer) clearTimeout(this.settleTimer);
      if (this.settleShakeTimer) clearTimeout(this.settleShakeTimer);
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

  /**
   * Arrastre desde una de las barras del panel.
   *
   * Puerta aparte de `onPointerDown` a propósito, no por comodidad. Esa entra en
   * `'pending'` y arranca el temporizador de 450 ms hacia modo voz, y resuelve un
   * `pointerup` sin movimiento como tap —que cerraría el panel—. Las dos cosas
   * son defectos en una barra de arrastre: agarrar el asa de una hoja no puede
   * abrir el micrófono ni cerrar la ventana que estás intentando mover.
   *
   * Y por eso mismo no hay umbral de 8 px: ese umbral existe para desambiguar un
   * gesto sobre la avatar, que sirve para tres cosas. La barra sirve para una,
   * así que el arrastre empieza en el primer píxel.
   *
   * `grabOffset` se calcula igual que en el camino de la avatar aunque el puntero
   * esté lejos del dock —el panel está 12 px por encima—: al ser puntero menos
   * posición del dock, conserva la distancia relativa y el conjunto se mueve
   * rígido en vez de saltar para centrarse bajo el dedo.
   */
  protected onGripDown(event: PointerEvent): void {
    if (!this.isBrowser || this.mode() !== 'idle') return;

    this.activePointerId = event.pointerId;
    this.origin = { x: event.clientX, y: event.clientY };

    const { x, y } = this.position();
    this.grabOffset = { x: event.clientX - x, y: event.clientY - y };

    // Sobre la barra, que es donde nacieron los eventos: sin esto el flujo se
    // corta en cuanto el puntero sale de sus 12 px de alto, o sea de inmediato.
    (event.target as Element).setPointerCapture?.(event.pointerId);

    // Antes de entrar en drag, no después: el panel está abierto y es el caso
    // donde el flip de orientación a mitad de gesto se ve más.
    this.freezeAnchor();
    this.mode.set('drag');
  }

  /**
   * Fija la orientación actual para el resto del gesto. Se llama con el ancla
   * todavía libre, así que los predicados devuelven el valor real calculado.
   */
  private freezeAnchor(): void {
    if (!this.isBrowser) return;
    this.anchorFrozen.set({
      left: this.anchoredLeft(),
      top: this.anchoredTop(),
    });
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
      // Mismo congelado que en la barra: este camino arrastra desde la avatar,
      // con el panel cerrado casi siempre, pero la burbuja de saludo también se
      // reorienta con estos predicados y saltaría igual.
      this.freezeAnchor();
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
        this.settleToEdge();
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

    if (mode === 'drag') this.settleToEdge();
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
    // A tap always opens the panel in chat mode, even on a pipeline store: only
    // the hold gesture asks to talk. Cleared unconditionally so a previous hold
    // cannot reseed voice mode on this tap.
    this.openPanelInVoice.set(false);
    this.panelOpen.update((open) => !open);

    // Opening is a greeting, closing is a goodbye. The goodbye matters beyond
    // politeness: `noteInteraction()` above just started the two-hour silence,
    // so the state underneath is already `sleeping`, and `sad` is what makes
    // the dock look like it is settling down rather than snapping to a nap.
    // Which is also why the goodbye outlasts the greeting by an order of
    // magnitude — it has a transition to cover, not just a moment to mark.
    this.wobble();
    if (this.panelOpen()) {
      this.flashExpression('happy', GREETING_POSE_MS);
    } else {
      this.flashExpression('sad', this.farewellMs());
    }
  }

  // ── Primitivas de reacción ──────────────────────────────────────────────

  /**
   * Shows a pose for `ms` and then hands the face back to the derived state.
   *
   * Re-entrant on purpose: a second flash before the first expires replaces it
   * rather than queueing, so rapid open/close cannot leave the avatar stuck on
   * a stale pose.
   */
  /**
   * A fresh goodbye length, 5s-15s, drawn per close.
   *
   * Uniform on purpose: the point is that two consecutive closes do not look
   * alike, and any distribution achieves that — but a uniform one also keeps
   * the short goodbyes as likely as the long ones, so the dock does not
   * settle into one apparent duration with occasional outliers.
   */
  private farewellMs(): number {
    return (
      FAREWELL_MIN_MS + Math.random() * (FAREWELL_MAX_MS - FAREWELL_MIN_MS)
    );
  }

  private flashExpression(pose: VexiExpression, ms: number): void {
    if (!this.isBrowser) return;
    this.clearFlash();

    this.flashedExpression.set(pose);
    this.flashTimer = setTimeout(() => {
      this.flashedExpression.set(null);
      this.flashTimer = null;
    }, ms);
  }

  /** Hands the face straight back to the derived state. */
  private clearFlash(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
    this.flashedExpression.set(null);
  }

  /**
   * Plays the shake once.
   *
   * The class has to come off and go back on for the animation to replay: CSS
   * will not restart an animation that is already applied, so a second wobble
   * during the first one would do nothing at all.
   */
  private wobble(): void {
    if (!this.isBrowser) return;
    if (this.wobbleTimer) clearTimeout(this.wobbleTimer);

    this.wobbling.set(false);
    requestAnimationFrame(() => {
      this.wobbling.set(true);
      this.wobbleTimer = setTimeout(() => {
        this.wobbling.set(false);
        this.wobbleTimer = null;
      }, WOBBLE_MS);
    });
  }

  /**
   * Snaps back to the edge as a glide, then shakes on landing.
   *
   * The transition lives behind a class instead of sitting on the anchor
   * permanently: the same `transform` carries the drag, and a transition on it
   * would make the dock trail the finger by half a second.
   */
  private settleToEdge(): void {
    this.positionService.snapToEdge();

    if (!this.isBrowser) return;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    if (this.settleShakeTimer) clearTimeout(this.settleShakeTimer);

    this.settling.set(true);

    // Two timers, not one. The shake has to start *before* the glide ends, so
    // it cannot hang off the timer that ends the glide — the overlap is the
    // whole point, and a single timer can only place them back to back.
    this.settleShakeTimer = setTimeout(() => {
      this.settleShakeTimer = null;
      this.wobble();
    }, SETTLE_MS - WOBBLE_LEAD_MS);

    this.settleTimer = setTimeout(() => {
      this.settling.set(false);
      this.settleTimer = null;
      // Liberar acá y no en el pointerup es lo que convierte el reacomodo del
      // panel en un solo salto, y encima tapado por la llegada del dock.
      this.anchorFrozen.set(null);
    }, SETTLE_MS);
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
    // A flash outranks every derived state, and the goodbye now holds for up
    // to fifteen seconds — long enough that pressing to talk right after
    // closing the panel would leave a sad face on a Vexi that is listening.
    // A voice turn is a live state, so it takes the face back.
    this.clearFlash();
    this.presence.noteInteraction();

    // The pipeline engine has no session to negotiate from here: its turn is a
    // chat turn, and the surface that can render a confirmation card is the
    // panel. So the hold opens the panel already in voice mode, and the mic
    // there takes over the gesture. The dock stays out of the audio path.
    if (this.voiceEngine() === 'pipeline') {
      this.mode.set('idle');
      this.openPanelInVoice.set(true);
      this.panelOpen.set(true);
      return;
    }

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

  /**
   * Closes the panel and forgets how it was opened.
   *
   * Without the reset, a panel first opened by holding would reopen in voice mode
   * on the next plain tap — `openInVoice` is a `linkedSignal` source, so a stale
   * `true` reseeds the fresh instance.
   */
  protected closePanel(): void {
    this.panelOpen.set(false);
    this.openPanelInVoice.set(false);
  }

  private cancelHoldTimer(): void {
    if (this.holdTimer === null) return;
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  /** Diámetro vigente como valor CSS, para la custom property del host. */
  protected readonly dockSizeVar = computed(() => `${this.positionService.size()}px`);
}
