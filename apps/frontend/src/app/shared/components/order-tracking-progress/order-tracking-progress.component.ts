import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons.registry';

type TrackingStepStatus = 'done' | 'current' | 'todo';

interface TrackingStep {
  label: string;
  icon: IconName;
  status: TrackingStepStatus;
}

/**
 * Paso 10 (roku-shop-checkout-tarifa-detalle-orden) — barra híbrida de
 * seguimiento del pedido guest, estilo Rappi.
 *
 * Máquina híbrida: hitos reales (15/45/75/100% según `orderState`) más un
 * micro-avance simulado con topes (30/65/92%) que jamás cruza al hito
 * siguiente; el avance simulado se reabsorbe cuando llega señal real (el
 * offset se resetea al cambiar el estado). Ritmo base: 15 min
 * (`baseMinutes`, el guest pasa `prep_minutes_max ?? 15`).
 *
 * - `cancelled`/`refunded` congelan la barra en gris, sin deriva ni sheen.
 * - `animateFromZero` (`?success=true`) crece 0→% en ~1s vía transición CSS.
 * - `reducedMotion` salta al % real: sin entrada, sin sheen, sin intervalo.
 * - Todo el estado es signals; el intervalo se limpia en `DestroyRef`.
 */
const REAL_PERCENT: Record<string, number> = {
  draft: 15,
  created: 15,
  pending_payment: 15,
  processing: 45,
  shipped: 75,
  pending_delivery: 75,
  delivered: 100,
  finished: 100,
};

const FROZEN_STATES: ReadonlySet<string> = new Set(['cancelled', 'refunded']);

const MILESTONE_OF_STATE: Record<string, number> = {
  draft: 0,
  created: 0,
  pending_payment: 0,
  processing: 1,
  shipped: 2,
  pending_delivery: 2,
  delivered: 3,
  finished: 3,
};

/** Topes del micro-avance por hito: siempre por debajo del hito siguiente. */
const MILESTONE_CAPS = [30, 65, 92];

const TICK_MS = 10_000;
const ENTER_DELAY_MS = 60;

@Component({
  selector: 'app-order-tracking-progress',
  standalone: true,
  imports: [CommonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="tracking"
      [class.is-frozen]="isFrozen()"
      [class.is-reduced]="reducedMotion()"
      [class.is-complete]="milestoneIndex() === 3 && !isFrozen()"
      aria-label="Seguimiento del pedido"
    >
      <p class="tracking-status">{{ statusText() }}</p>
      <div
        class="tracking-track"
        role="progressbar"
        aria-label="Progreso del pedido"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="displayed()"
        [attr.aria-valuetext]="statusText() + ', ' + displayed() + '%'"
      >
        <div class="tracking-fill" [style.width.%]="displayed()">
          @if (showSheen()) {
            <span class="tracking-sheen" aria-hidden="true"></span>
          }
        </div>
      </div>
      <ol class="tracking-steps">
        @for (step of steps(); track step.label) {
          <li
            class="tracking-step"
            [class.is-done]="step.status === 'done'"
            [class.is-current]="step.status === 'current'"
          >
            <span class="tracking-dot" aria-hidden="true">
              <app-icon [name]="step.icon" [size]="12" />
            </span>
            <span class="tracking-label">{{ step.label }}</span>
          </li>
        }
      </ol>
    </section>
  `,
  styles: [
    `
      .tracking {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        padding: 1rem 1.1rem;
        border-radius: var(--radius-md);
        background: var(--color-background);
      }

      .tracking-status {
        margin: 0;
        font-size: var(--fs-sm);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
      }

      .tracking-track {
        height: 10px;
        border-radius: 999px;
        background: var(--color-border);
        overflow: hidden;
      }

      .tracking-fill {
        position: relative;
        height: 100%;
        border-radius: 999px;
        background: var(--color-primary);
        transition: width 1s ease;
        overflow: hidden;
      }

      .is-complete .tracking-fill {
        background: var(--color-success);
      }

      .is-frozen .tracking-fill {
        background: var(--color-text-muted);
      }

      .is-frozen .tracking-status {
        color: var(--color-text-secondary);
      }

      .tracking-sheen {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.45) 50%,
          transparent 100%
        );
        animation: tracking-sheen 2.2s ease-in-out infinite;
      }

      @keyframes tracking-sheen {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(100%);
        }
      }

      .tracking-steps {
        list-style: none;
        margin: 0.15rem 0 0;
        padding: 0;
        display: flex;
        gap: 0.25rem;
      }

      .tracking-step {
        position: relative;
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.3rem;
        min-width: 0;
      }

      .tracking-step:not(:last-child)::after {
        content: '';
        position: absolute;
        top: 11px;
        left: calc(50% + 14px);
        right: calc(-50% + 14px);
        height: 2px;
        border-radius: 2px;
        background: var(--color-border);
      }

      .tracking-step.is-done:not(:last-child)::after {
        background: var(--color-success);
      }

      .tracking-dot {
        position: relative;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--color-surface);
        border: 2px solid var(--color-border);
        color: var(--color-text-muted);
      }

      .tracking-step.is-done .tracking-dot {
        background: var(--color-success);
        border-color: var(--color-success);
        color: #fff;
      }

      .tracking-step.is-current .tracking-dot {
        border-color: var(--color-primary);
        color: var(--color-primary);
        background: var(--color-surface);
      }

      .tracking-step.is-current .tracking-dot::after {
        content: '';
        position: absolute;
        inset: -6px;
        border-radius: 50%;
        border: 2px solid var(--color-primary);
        opacity: 0.35;
        animation: tracking-ping 1.8s ease-out infinite;
      }

      @keyframes tracking-ping {
        0% {
          transform: scale(0.7);
          opacity: 0.5;
        }
        100% {
          transform: scale(1.15);
          opacity: 0;
        }
      }

      .tracking-label {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        text-align: center;
        line-height: 1.25;
      }

      .tracking-step.is-current .tracking-label {
        color: var(--color-text-primary);
        font-weight: var(--fw-semibold);
      }

      .is-frozen .tracking-step.is-current .tracking-dot {
        border-color: var(--color-text-muted);
        color: var(--color-text-muted);
      }

      .is-frozen .tracking-step.is-current .tracking-dot::after {
        display: none;
      }

      .is-frozen .tracking-step.is-done .tracking-dot {
        background: var(--color-text-muted);
        border-color: var(--color-text-muted);
      }

      .is-frozen .tracking-step.is-done:not(:last-child)::after {
        background: var(--color-border);
      }

      .is-reduced .tracking-fill {
        transition: none;
      }

      .is-reduced .tracking-step.is-current .tracking-dot::after {
        display: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .tracking-fill {
          transition: none;
        }
        .tracking-sheen {
          display: none;
        }
        .tracking-step.is-current .tracking-dot::after {
          display: none;
        }
      }

      @media (max-width: 480px) {
        .tracking {
          padding: 0.85rem 0.9rem;
        }
      }
    `,
  ],
})
export class OrderTrackingProgressComponent {
  /** Estado de la orden (order_state_enum): gobierna hitos y %. */
  readonly orderState = input.required<string>();
  /** Domicilio vs recoger (el plan lo infiere por shipping_address). */
  readonly hasShippingAddress = input(false);
  /** `?success=true`: la barra crece 0→% en ~1s al montar. */
  readonly animateFromZero = input(false);
  /** Ritmo base en minutos (el guest pasa `prep_minutes_max ?? 15`). */
  readonly baseMinutes = input(15);
  /** `prefers-reduced-motion`: salta al % real, sin sheen ni deriva. */
  readonly reducedMotion = input(false);

  private readonly destroyRef = inject(DestroyRef);

  readonly isFrozen = computed(() => FROZEN_STATES.has(this.orderState()));

  readonly milestoneIndex = computed(() => {
    if (this.isFrozen()) return 0;
    return MILESTONE_OF_STATE[this.orderState()] ?? 0;
  });

  readonly realPercent = computed(() => {
    if (this.isFrozen()) return 15;
    return REAL_PERCENT[this.orderState()] ?? 15;
  });

  /** Offset simulado sobre el % real; se resetea con cada señal real. */
  private readonly simOffset = signal(0);
  /** Puerta de entrada: arranca en 0 y se abre justo tras montar. */
  private readonly entered = signal(false);

  private readonly liveTarget = computed(() => {
    const real = this.realPercent();
    if (this.isFrozen() || this.reducedMotion()) return real;
    const milestone = this.milestoneIndex();
    if (milestone >= 3) return real;
    const cap = MILESTONE_CAPS[milestone] ?? 100;
    return Math.min(real + this.simOffset(), cap);
  });

  readonly displayed = computed(() => {
    if (
      !this.entered() &&
      this.animateFromZero() &&
      !this.reducedMotion() &&
      !this.isFrozen()
    ) {
      return 0;
    }
    return Math.round(this.liveTarget());
  });

  readonly statusText = computed(() => {
    const state = this.orderState();
    if (state === 'cancelled') return 'Pedido cancelado';
    if (state === 'refunded') return 'Pedido reembolsado';
    const delivery = this.hasShippingAddress();
    switch (this.milestoneIndex()) {
      case 1:
        return 'Tu pedido se está preparando';
      case 2:
        return delivery
          ? 'Tu pedido va en camino'
          : 'Tu pedido está listo para recoger';
      case 3:
        return delivery ? '¡Pedido entregado!' : '¡Pedido recogido!';
      default:
        return 'Estamos siguiendo tu pedido';
    }
  });

  readonly steps = computed<TrackingStep[]>(() => {
    const delivery = this.hasShippingAddress();
    const current = this.milestoneIndex();
    const defs: Array<{ label: string; icon: IconName }> = [
      { label: 'Confirmado', icon: 'shopping-bag' },
      { label: 'En preparación', icon: 'flame' },
      {
        label: delivery ? 'En camino' : 'Listo para recoger',
        icon: delivery ? 'truck' : 'store',
      },
      {
        label: delivery ? 'Entregado' : 'Recogido',
        icon: 'package-check',
      },
    ];
    return defs.map((d, i) => ({
      label: d.label,
      icon: i < current ? 'check' : d.icon,
      status: i < current ? 'done' : i === current ? 'current' : 'todo',
    }));
  });

  readonly showSheen = computed(
    () =>
      !this.reducedMotion() &&
      !this.isFrozen() &&
      this.milestoneIndex() < 3,
  );

  private activeIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const enterTimer = setTimeout(() => this.entered.set(true), ENTER_DELAY_MS);
    this.destroyRef.onDestroy(() => clearTimeout(enterTimer));

    // Deriva simulada: avanza del % real al tope del hito en `baseMinutes`.
    // El offset se resetea (untracked) ante cualquier señal real, y el tick
    // se clampéa al tope y se detiene ahí: jamás cruza hitos.
    effect((onCleanup) => {
      const frozen = this.isFrozen();
      const reduced = this.reducedMotion();
      const milestone = this.milestoneIndex();
      const real = this.realPercent();
      const base = this.baseMinutes();
      untracked(() => this.simOffset.set(0));
      if (frozen || reduced || milestone >= 3) return;
      const cap = MILESTONE_CAPS[milestone] ?? 100;
      const span = Math.max(cap - real, 0);
      if (span <= 0) return;
      const minutes =
        Number.isFinite(base) && base > 0 ? base : 15;
      const totalTicks = Math.max(
        1,
        Math.round((minutes * 60 * 1000) / TICK_MS),
      );
      const step = span / totalTicks;
      const id = setInterval(() => {
        const next = this.simOffset() + step;
        if (next >= span) {
          this.simOffset.set(span);
          clearInterval(id);
          if (this.activeIntervalId === id) this.activeIntervalId = null;
          return;
        }
        this.simOffset.set(next);
      }, TICK_MS);
      this.activeIntervalId = id;
      onCleanup(() => {
        clearInterval(id);
        if (this.activeIntervalId === id) this.activeIntervalId = null;
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.activeIntervalId !== null) {
        clearInterval(this.activeIntervalId);
        this.activeIntervalId = null;
      }
    });
  }
}
