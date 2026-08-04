import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Vexi's expression vocabulary.
 *
 * The names ARE the sprite filenames (`assets/vexi/vexi-<pose>.png`), so a
 * pose that has no artwork cannot be named — the previous vocabulary was
 * chosen independently of the sheet and drifted from it, and when the sprites
 * were replaced every `<img>` silently 404'd while the code still typechecked.
 */
export type VexiExpression =
  | 'idle'
  | 'thinking'
  | 'excited'
  | 'happy'
  | 'wow'
  | 'sad'
  | 'sleeping'
  | 'error';

/**
 * Every pose, in render order. All eight are mounted at once so switching
 * expression is an opacity cross-fade between two already-decoded layers: a
 * single `<img>` whose `src` changes cannot fade by construction — the old
 * frame is gone the moment the new one is assigned, and the new one may not be
 * decoded yet, so the swap reads as a flicker. Mounting them all also doubles
 * as the preload: the browser fetches every sprite on first paint, long before
 * the first state change needs one.
 */
export const VEXI_EXPRESSIONS: readonly VexiExpression[] = [
  'idle',
  'thinking',
  'excited',
  'happy',
  'wow',
  'sad',
  'sleeping',
  'error',
];

const LABELS: Record<VexiExpression, string> = {
  idle: 'Vexi en reposo',
  thinking: 'Vexi está pensando',
  excited: 'Vexi está respondiendo',
  happy: 'Vexi se alegra de verte',
  wow: 'Vexi tiene algo que proponerte',
  sad: 'Vexi se despide',
  sleeping: 'Vexi está descansando',
  error: 'Vexi encontró un problema',
};

@Component({
  selector: 'app-vexi-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'label()',
  },
  template: `
    <span
      class="vexi-avatar__halo"
      [class.vexi-avatar__halo--voice]="voice()"
      aria-hidden="true"
    ></span>

    <!-- The breathing lives on the body, not on the layers: animating the
         stack as one keeps the cross-fade and the motion independent, so a
         sprite swap mid-breath does not restart the cycle. -->
    <span class="vexi-avatar__body">
      @for (pose of poses; track pose) {
        <img
          class="vexi-avatar__layer"
          [class.vexi-avatar__layer--active]="pose === expression()"
          [src]="'assets/vexi/vexi-' + pose + '.png'"
          alt=""
          aria-hidden="true"
          draggable="false"
          decoding="async"
        />
      }
    </span>
  `,
  styles: [
    `
      /* Pinned to the dock's padding box rather than sized with percentages:
         the dock centers its children, so a grid item's width is fit-content
         and a percentage height has no definite base to resolve against —
         the sprite would keep its intrinsic 174x256 ratio and overflow. */
      :host {
        position: absolute;
        inset: 0;
        display: block;
        pointer-events: none;
      }

      /* Resting presence is meant to be almost subliminal: a floating dock
         that visibly glows over every screen of the panel stops being company
         and becomes a permanent distraction. Contrast is what carries state —
         at rest the halo is barely there, in voice it is unmistakable. */
      .vexi-avatar__halo {
        position: absolute;
        inset: -12%;
        border-radius: 50%;
        background: radial-gradient(
          circle,
          rgba(var(--color-primary-rgb, 46, 204, 113), 0.85) 0%,
          rgba(var(--color-primary-rgb, 46, 204, 113), 0) 68%
        );
        opacity: 0.104;
        transition: opacity 260ms ease;
        pointer-events: none;
      }

      .vexi-avatar__halo--voice {
        opacity: 0.6;
      }

      /* The concentric pulse rides a pseudo-element so the halo's own opacity
         stays a stable, readable signal of voice state instead of sweeping
         through the animation's keyframe values. */
      .vexi-avatar__halo--voice::after {
        content: '';
        position: absolute;
        inset: 6%;
        border-radius: 50%;
        border: 2px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.55);
        animation: vexi-halo-pulse 1.8s ease-out infinite;
      }

      .vexi-avatar__body {
        position: absolute;
        inset: 0;
        display: block;
        animation: vexi-breathe 4s ease-in-out infinite;
      }

      /* The outgoing layer leaves slower than the incoming one arrives (260ms
         vs 200ms) and shrinks a touch on its way out. With both layers on the
         same symmetric fade there is a midpoint where each sits at ~0.5 and
         the two faces show through one another — harmless when the poses were
         near-identical, very visible now that they differ by mouth, eyes and
         props. The asymmetry keeps the stack visually opaque throughout. */
      .vexi-avatar__layer {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        opacity: 0;
        transform: scale(0.965);
        transition:
          opacity 260ms ease-in,
          transform 260ms ease-in;
        user-select: none;
        -webkit-user-drag: none;
        filter: drop-shadow(0 4px 10px rgb(0 0 0 / 0.28));
      }

      .vexi-avatar__layer--active {
        opacity: 1;
        transform: scale(1);
        transition:
          opacity 200ms ease-out,
          transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      /* Two rounds of "+15%" went unnoticed because the amplitude was the wrong
         knob: 15% of 2.9px is 0.4px, well under what the eye resolves on a 94px
         avatar, and a 6s cycle is slow enough to read as a static image between
         glances. Amplitude and tempo both moved. Still a float, not a bounce —
         the dock sits over live screens and must not compete with them. */
      @keyframes vexi-breathe {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-4.5px);
        }
      }

      @keyframes vexi-halo-pulse {
        0% {
          transform: scale(0.86);
          opacity: 0.85;
        }
        100% {
          transform: scale(1.32);
          opacity: 0;
        }
      }

      /* Completely still: no breathing, no pulse. The halo keeps its opacity
         step so voice state is still legible without any motion at all. */
      @media (prefers-reduced-motion: reduce) {
        .vexi-avatar__body {
          animation: none;
        }

        .vexi-avatar__halo--voice::after {
          animation: none;
          opacity: 0;
        }

        /* The pose still changes — it just cuts instead of crossing, and
           never scales. Reduced motion is about movement, not about hiding
           what Vexi is doing. */
        .vexi-avatar__layer,
        .vexi-avatar__layer--active {
          transition: none;
          transform: none;
        }
      }
    `,
  ],
})
export class VexiAvatarComponent {
  readonly expression = input<VexiExpression>('idle');

  /** True while a voice turn is open — drives the halo's contrast jump. */
  readonly voice = input(false);

  protected readonly poses = VEXI_EXPRESSIONS;
  protected readonly label = computed(() => LABELS[this.expression()]);
}
