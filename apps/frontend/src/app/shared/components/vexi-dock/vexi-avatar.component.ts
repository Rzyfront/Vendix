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
  template: `
    <img
      class="vexi-avatar"
      [class.vexi-avatar--pulsing]="pulsing()"
      [src]="src()"
      [alt]="label()"
      draggable="false"
      decoding="async"
    />
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

      .vexi-avatar {
        width: 100%;
        height: 100%;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
        filter: drop-shadow(0 4px 10px rgb(0 0 0 / 0.28));
      }

      /* Breathing ring while a voice turn is open. Transform-only so it stays
         on the compositor and never triggers layout. */
      .vexi-avatar--pulsing {
        animation: vexi-pulse 1.4s ease-in-out infinite;
      }

      @keyframes vexi-pulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.07);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .vexi-avatar--pulsing {
          animation: none;
        }
      }
    `,
  ],
})
export class VexiAvatarComponent {
  readonly expression = input<VexiExpression>('neutro');
  readonly pulsing = input(false);

  protected readonly src = computed(
    () => `assets/vexi/${this.expression()}.png`,
  );
  protected readonly label = computed(() => LABELS[this.expression()]);
}
