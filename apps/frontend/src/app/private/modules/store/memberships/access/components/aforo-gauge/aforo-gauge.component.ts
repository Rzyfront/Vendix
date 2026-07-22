import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  CardComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';

interface GaugeTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Presentational HERO gauge for gym occupancy (aforo).
 *
 * Renders a professional radial SVG gauge (concentric track + progress arc via
 * stroke-dasharray) plus a meta panel with live status, availability pills and a
 * "EN VIVO" indicator. Pure presentation: no services, no business logic — all
 * geometry is derived with `computed()` from signal inputs.
 *
 * Anti-SSE-bug rule: the gauge repaints on every SSE tick, so it uses FIXED
 * dimensions and transitions ONLY `stroke-dashoffset`. It NEVER uses
 * `transition: all` (a known repo bug that restarts animations under continuous
 * change detection).
 */
@Component({
  selector: 'app-aforo-gauge',
  standalone: true,
  imports: [CardComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './aforo-gauge.component.css',
  template: `
    <app-card
      [shadow]="'sm'"
      [responsivePadding]="true"
      [showHeader]="true"
      [fullHeight]="true"
    >
      <div slot="header" class="ag-header">
        <span class="ag-header-icon">
          <app-icon name="gauge" [size]="18" />
        </span>
        <div class="ag-header-text">
          <h3>Aforo en vivo</h3>
          <p>Ocupación actual del local</p>
        </div>
        @if (live()) {
          <span class="ag-live" role="status" aria-label="Datos en vivo">
            <span class="ag-live-dot" aria-hidden="true"></span>
            EN VIVO
          </span>
        }
      </div>

      <div
        class="ag-hero"
        [class.ag-hero--full]="isFull()"
        [style.box-shadow]="heroShadow()"
      >
        <!-- Radial gauge -->
        <div class="ag-gauge">
          <svg
            class="ag-gauge-svg"
            viewBox="0 0 120 120"
            role="img"
            [attr.aria-label]="gaugeAria()"
          >
            <defs>
              <linearGradient
                id="aforoArcGradient"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop
                  offset="0%"
                  [attr.stop-color]="color()"
                  stop-opacity="0.55"
                />
                <stop
                  offset="100%"
                  [attr.stop-color]="color()"
                  stop-opacity="1"
                />
              </linearGradient>
            </defs>

            <!-- Decorative bezel ticks -->
            <g class="ag-ticks" aria-hidden="true">
              @for (t of ticks; track $index) {
                <line
                  [attr.x1]="t.x1"
                  [attr.y1]="t.y1"
                  [attr.x2]="t.x2"
                  [attr.y2]="t.y2"
                />
              }
            </g>

            <!-- Background track -->
            <circle class="ag-track" cx="60" cy="60" [attr.r]="radius" />

            <!-- Progress arc -->
            <circle
              class="ag-arc"
              cx="60"
              cy="60"
              [attr.r]="radius"
              stroke="url(#aforoArcGradient)"
              [attr.stroke-dasharray]="circumference"
              [attr.stroke-dashoffset]="dashOffset()"
              transform="rotate(-90 60 60)"
            />
          </svg>

          <div class="ag-gauge-center">
            <span class="ag-count">{{ count() }}</span>
            <span class="ag-count-label">adentro ahora</span>
            @if (capacityControlEnabled() && maxCapacity() > 0) {
              <span class="ag-capacity">Capacidad {{ maxCapacity() }}</span>
            }
          </div>
        </div>

        <!-- Meta panel -->
        <div class="ag-meta">
          <div class="ag-meta-status">
            <span
              class="ag-status-dot"
              [style.background]="color()"
              aria-hidden="true"
            ></span>
            <div class="ag-status-text">
              @if (capacityControlEnabled()) {
                @if (isFull()) {
                  <strong class="ag-status-title ag-status-title--full">
                    Aforo lleno
                  </strong>
                } @else {
                  <strong class="ag-status-title">
                    {{ availableSpots() ?? 0 }} cupos disponibles
                  </strong>
                }
              } @else {
                <strong class="ag-status-title ag-status-title--muted">
                  Control de aforo desactivado
                </strong>
              }
              @if (syncing()) {
                <span class="ag-syncing">actualizando…</span>
              }
            </div>
          </div>

          @if (capacityControlEnabled()) {
            <div class="ag-pills">
              <span class="ag-pill">
                <app-icon name="activity" [size]="13" />
                {{ clampedPct() }}% ocupado
              </span>
              @if (availableSpots() !== null) {
                <span class="ag-pill">
                  <app-icon name="door-open" [size]="13" />
                  {{ availableSpots() }} cupos
                </span>
              }
              <span class="ag-pill">
                <app-icon name="check-circle" [size]="13" />
                Concedidos hoy: {{ grantedToday() }}
              </span>
            </div>
          } @else {
            <div class="ag-help">
              <span>
                Activa el control de aforo en la configuración para ver cupos
                disponibles y bloquear ingresos cuando el local se llene.
              </span>
            </div>
          }
        </div>
      </div>
    </app-card>
  `,
})
export class AforoGaugeComponent {
  // --- Inputs (Angular 20 signal API) ---
  readonly count = input<number>(0);
  readonly maxCapacity = input<number>(0);
  readonly pct = input<number>(0);
  readonly color = input<string>('#16a34a');
  readonly availableSpots = input<number | null>(null);
  readonly grantedToday = input<number>(0);
  readonly capacityControlEnabled = input<boolean>(false);
  readonly isFull = input<boolean>(false);
  readonly live = input<boolean>(false);
  readonly syncing = input<boolean>(false);

  // --- Gauge geometry (fixed radius; viewBox 0 0 120 120, center 60,60) ---
  readonly radius = 52;
  readonly circumference = 2 * Math.PI * this.radius;

  /** Occupancy clamped to a safe 0..100 range for the arc. */
  readonly clampedPct = computed(() =>
    Math.max(0, Math.min(100, this.pct() ?? 0)),
  );

  /** Dash offset that reveals the arc proportionally to occupancy. */
  readonly dashOffset = computed(
    () => this.circumference * (1 - this.clampedPct() / 100),
  );

  /** Accessible description of the gauge for screen readers. */
  readonly gaugeAria = computed(() =>
    this.capacityControlEnabled() && this.maxCapacity() > 0
      ? `${this.count()} personas dentro de ${this.maxCapacity()}, ${this.clampedPct()}% de ocupación`
      : `${this.count()} personas dentro`,
  );

  /** Halo ring around the hero when the venue is full (uses the input color). */
  readonly heroShadow = computed(() =>
    this.isFull() ? `0 0 0 1.5px ${this.color()}` : null,
  );

  /** Fine decorative bezel ticks (inner ring), computed once. */
  readonly ticks: GaugeTick[] = this.buildTicks();

  private buildTicks(): GaugeTick[] {
    const count = 48;
    const inner = 40;
    const outer = 44;
    const cx = 60;
    const cy = 60;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        x1: +(cx + cos * inner).toFixed(2),
        y1: +(cy + sin * inner).toFixed(2),
        x2: +(cx + cos * outer).toFixed(2),
        y2: +(cy + sin * outer).toFixed(2),
      };
    });
  }
}
