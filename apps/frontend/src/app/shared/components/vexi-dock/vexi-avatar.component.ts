import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Vexi's expression vocabulary. Mirrors the sprite filenames in
 * `assets/vexi/` — the character sheet defines many more poses, these are the
 * states the dock can actually be in.
 */
export type VexiExpression =
  | 'neutro'
  | 'pensando'
  | 'hablando'
  | 'escuchando'
  | 'error'
  | 'ok';

/**
 * Every pose, in render order. All six are mounted at once so switching
 * expression is an opacity cross-fade between two already-decoded layers: a
 * single `<img>` whose `src` changes cannot fade by construction — the old
 * frame is gone the moment the new one is assigned, and the new one may not be
 * decoded yet, so the swap reads as a flicker. Mounting all six also doubles
 * as the preload: the browser fetches every sprite on first paint, long before
 * the first state change needs one.
 */
export const VEXI_EXPRESSIONS: readonly VexiExpression[] = [
  'neutro',
  'pensando',
  'hablando',
  'escuchando',
  'error',
  'ok',
];

const LABELS: Record<VexiExpression, string> = {
  neutro: 'Vexi en reposo',
  pensando: 'Vexi está procesando',
  hablando: 'Vexi está respondiendo',
  escuchando: 'Vexi te está escuchando',
  error: 'Vexi encontró un error',
  ok: 'Vexi completó la acción',
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
          [src]="'assets/vexi/' + pose + '.png'"
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
        opacity: 0.08;
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
        animation: vexi-breathe 6s ease-in-out infinite;
      }

      .vexi-avatar__layer {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        opacity: 0;
        transition: opacity 180ms ease;
        user-select: none;
        -webkit-user-drag: none;
        filter: drop-shadow(0 4px 10px rgb(0 0 0 / 0.28));
      }

      .vexi-avatar__layer--active {
        opacity: 1;
      }

      /* Sub-3px over a slow cycle: enough to read as alive at a glance, not
         enough to pull the eye away from the screen underneath. */
      @keyframes vexi-breathe {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-2.5px);
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
      }
    `,
  ],
})
export class VexiAvatarComponent {
  readonly expression = input<VexiExpression>('neutro');

  /** True while a voice turn is open — drives the halo's contrast jump. */
  readonly voice = input(false);

  protected readonly poses = VEXI_EXPRESSIONS;
  protected readonly label = computed(() => LABELS[this.expression()]);
}
