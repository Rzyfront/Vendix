import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

import {
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components/index';

/**
 * Empty-state animado y "precioso" para el pool de Repartos (`/repartos/pool`),
 * mostrado cuando NO hay pedidos disponibles y NO hay filtros activos.
 *
 * Composición (todo CSS puro, sin librerías de animación):
 * - Un **blob** de gradiente de marca difuminado que respira detrás de todo.
 * - **Anillos radar** concéntricos que pulsan hacia afuera (mismo lenguaje que
 *   `.gps-halo` de `route-map-view`), sugiriendo "escaneando pedidos".
 * - Un **ícono `package` flotante** dentro de un círculo con el gradiente de
 *   marca y glow de sombra de color.
 * - Título + descripción (provistos por el host) + botón "Actualizar".
 *
 * El gradiente usa los tokens `--color-primary-rgb`/`--color-secondary-rgb` que
 * `ThemeService` recalcula por tienda → white-label correcto (no hardcodea el
 * verde de Vendix). Las animaciones respetan `prefers-reduced-motion` vía la
 * regla global de `styles.scss` (no hace falta duplicarla aquí).
 *
 * Es un componente LOCAL a propósito: no toca el `EmptyStateComponent` compartido
 * (100+ usos en todo el admin) para no arriesgar regresión cruzada.
 */
@Component({
  selector: 'app-pool-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ButtonComponent],
  template: `
    <div class="pool-empty">
      <div class="pool-empty-stage">
        <span class="pool-empty-aura" aria-hidden="true"></span>
        <span class="pool-empty-blob" aria-hidden="true"></span>
        <span class="pool-empty-radar" aria-hidden="true"></span>
        <span class="pool-empty-radar pool-empty-radar--mid" aria-hidden="true"></span>
        <span class="pool-empty-radar pool-empty-radar--delayed" aria-hidden="true"></span>
        <span class="pool-empty-badge">
          <app-icon name="package" [size]="34" class="pool-empty-icon"></app-icon>
        </span>
      </div>

      <h3 class="pool-empty-title">{{ title() }}</h3>
      <p class="pool-empty-desc">{{ description() }}</p>

      <div class="pool-empty-actions">
        <app-button variant="primary" size="sm" (clicked)="refresh.emit()">
          <app-icon slot="icon" name="refresh-cw" [size]="16"></app-icon>
          Actualizar
        </app-button>
      </div>
    </div>
  `,
  styles: [
    `
      .pool-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 8px;
        padding: 44px 20px 40px;
        animation: pool-empty-enter 0.5s ease-out both;
      }

      /* Escenario que contiene blob + anillos + badge (todos superpuestos). */
      .pool-empty-stage {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 132px;
        height: 132px;
        margin-bottom: 10px;
      }

      /* Aura ambiental grande y muy suave (capa "AI Style"): resplandor de
         marca que rebasa el escenario para un efecto amplio y etéreo. */
      .pool-empty-aura {
        position: absolute;
        inset: -70px;
        border-radius: 9999px;
        background: radial-gradient(
          circle at 50% 45%,
          rgba(var(--vx-neon, 46, 204, 113), 0.35) 0%,
          rgba(var(--vx-mint, 161, 244, 217), 0.18) 38%,
          transparent 70%
        );
        filter: blur(26px);
        animation: pool-empty-aura-pulse 5.5s ease-in-out infinite;
      }

      /* Blob de gradiente difuminado que respira detrás de todo. */
      .pool-empty-blob {
        position: absolute;
        inset: -12px;
        border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%;
        background: linear-gradient(
          135deg,
          rgb(var(--vx-mint, 161, 244, 217)) 0%,
          rgb(var(--vx-neon, 46, 204, 113)) 45%,
          rgb(var(--color-secondary-rgb, 47, 111, 78)) 100%
        );
        opacity: 0.22;
        filter: blur(14px);
        animation: pool-empty-breathe 4.5s ease-in-out infinite;
      }

      /* Anillos radar concéntricos que pulsan hacia afuera (neón de marca). */
      .pool-empty-radar {
        position: absolute;
        width: 88px;
        height: 88px;
        border-radius: 9999px;
        border: 1.5px solid rgba(var(--vx-neon, 46, 204, 113), 0.55);
        background: rgba(var(--vx-neon, 46, 204, 113), 0.14);
        opacity: 0.5;
        animation: pool-empty-radar 2.8s ease-out infinite;
      }
      .pool-empty-radar--mid {
        animation-delay: 0.9s;
      }
      .pool-empty-radar--delayed {
        animation-delay: 1.8s;
      }

      /* Círculo central con gradiente neón de marca + glow de color, flotante. */
      .pool-empty-badge {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 84px;
        height: 84px;
        border-radius: 9999px;
        color: #ffffff;
        background: linear-gradient(
          135deg,
          rgb(var(--vx-neon, 46, 204, 113)) 0%,
          rgb(var(--color-secondary-rgb, 47, 111, 78)) 100%
        );
        border: 1px solid rgba(var(--vx-mint, 161, 244, 217), 0.7);
        box-shadow:
          0 12px 30px -8px rgba(var(--vx-neon, 46, 204, 113), 0.6),
          0 0 22px rgba(var(--vx-neon, 46, 204, 113), 0.45),
          inset 0 1px 2px rgba(255, 255, 255, 0.4);
        animation: pool-empty-float 3.4s ease-in-out infinite;
      }
      .pool-empty-icon {
        position: relative;
        z-index: 1;
      }

      .pool-empty-title {
        font-size: 17px;
        font-weight: 800;
        color: var(--color-text-primary, #111827);
        letter-spacing: -0.01em;
      }
      .pool-empty-desc {
        font-size: 13px;
        line-height: 1.5;
        color: var(--color-text-secondary, #6b7280);
        max-width: 320px;
      }
      .pool-empty-actions {
        margin-top: 14px;
      }

      @keyframes pool-empty-aura-pulse {
        0%,
        100% {
          transform: scale(1);
          opacity: 0.65;
        }
        50% {
          transform: scale(1.1);
          opacity: 0.95;
        }
      }
      @keyframes pool-empty-breathe {
        0%,
        100% {
          transform: scale(1) rotate(0deg);
          opacity: 0.16;
        }
        50% {
          transform: scale(1.12) rotate(8deg);
          opacity: 0.24;
        }
      }
      @keyframes pool-empty-radar {
        0% {
          transform: scale(0.55);
          opacity: 0.4;
        }
        70% {
          transform: scale(1.5);
          opacity: 0;
        }
        100% {
          transform: scale(1.5);
          opacity: 0;
        }
      }
      @keyframes pool-empty-float {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-8px);
        }
      }
      @keyframes pool-empty-enter {
        from {
          opacity: 0;
          transform: translateY(12px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class PoolEmptyStateComponent {
  /** Título grande del empty-state. */
  readonly title = input<string>('No hay pedidos disponibles');
  /** Descripción secundaria. */
  readonly description = input<string>(
    'Cuando haya pedidos listos para reparto aparecerán aquí para tomarlos.',
  );
  /** Emitido al pulsar "Actualizar" — el host recarga el pool. */
  readonly refresh = output<void>();
}
