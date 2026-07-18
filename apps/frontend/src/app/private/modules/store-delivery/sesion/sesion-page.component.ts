import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  StatsComponent,
} from '../../../../shared/components/index';
import { CurrencyPipe } from '../../../../shared/pipes/currency';

import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ActiveRouteStore } from '../state/active-route.store';

/**
 * Fase F6 — "Sesión" del repartidor (`/repartos/sesion`).
 *
 * Pestaña 4 de la cáscara `/repartos` (app_type STORE_DELIVERY, rol `carrier`).
 * Reúne, en una vista de solo lectura mobile-first:
 *
 * 1. **Identidad** del repartidor y su tienda, leída de `AuthFacade`
 *    (`userName` / `userStoreName` / `userEmail`, signals ya derivados del JWT).
 * 2. **KPIs de la ruta** (`StatsComponent` + `stats-container` global): entregas
 *    (paradas `delivered`), recaudo (suma de `collected_amount` de las entregadas,
 *    formato moneda) y pendientes (`ActiveRouteStore.pendingStopsCount`). Cuando
 *    no hay ruta activa todo cae a cero de forma natural (stops = []).
 * 3. **Payout informativo** (READ-ONLY): `payout` del `ActiveRouteStore` con su
 *    `mode`/`amount`/`estimated`/`earned` en formato moneda. Se deja explícito
 *    que es un valor informativo, NO un pago real ni una transacción.
 * 4. Botón **Cerrar sesión** → `AuthFacade.logout()`.
 *
 * Zoneless-safe: no muta nada del backend; solo lee signals del `ActiveRouteStore`
 * (fuente de verdad de "mi ruta", ya resuelta por el shell) y de `AuthFacade`.
 * Todos los derivados son `computed`. Llama a `resolve()` (idempotente) por si se
 * entra directo a esta pestaña sin pasar por el resto del shell.
 */
@Component({
  selector: 'app-sesion-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    IconComponent,
    StatsComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full min-h-screen p-3 md:p-4 space-y-4">
      <!-- Identidad del repartidor (hero con gradiente de marca) -->
      <div class="identity-hero">
        <span class="identity-hero-blob identity-hero-blob--1" aria-hidden="true"></span>
        <span class="identity-hero-blob identity-hero-blob--2" aria-hidden="true"></span>
        <div class="identity-hero-content">
          <span class="identity-hero-avatar">
            <app-icon name="user" [size]="26"></app-icon>
          </span>
          <div class="min-w-0">
            <p class="identity-hero-name">{{ carrierName() }}</p>
            @if (storeName()) {
              <p class="identity-hero-store">
                <app-icon name="store" [size]="14" class="shrink-0"></app-icon>
                <span class="truncate">{{ storeName() }}</span>
              </p>
            }
            @if (userEmail()) {
              <p class="identity-hero-email">{{ userEmail() }}</p>
            }
          </div>
        </div>
      </div>

      <!-- KPIs de la ruta -->
      <div>
        <h3
          class="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-text-secondary"
        >
          Resumen de tu ruta
        </h3>
        <div class="stats-container">
          <app-stats
            title="Entregas"
            [value]="deliveredCount()"
            smallText="Paradas entregadas"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-500"
          />
          <app-stats
            title="Recaudo"
            [value]="collectedTotal() | currency"
            smallText="Efectivo cobrado hoy"
            iconName="coins"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-500"
          />
          <app-stats
            title="Pendientes"
            [value]="pendingCount()"
            smallText="Paradas por atender"
            iconName="clock"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-500"
          />
          <app-stats
            title="Avance"
            [value]="progressLabel()"
            smallText="Ruta completada"
            iconName="gauge"
            iconBgColor="bg-teal-100"
            iconColor="text-teal-600"
          />
        </div>
      </div>

      <!-- Sin ruta activa -->
      @if (!hasActiveRoute() && !loading()) {
        <div
          class="rounded-lg border border-border bg-background px-4 py-3 flex items-start gap-3"
        >
          <app-icon
            name="info"
            [size]="18"
            class="text-text-secondary mt-0.5 shrink-0"
          ></app-icon>
          <p class="text-sm text-text-secondary">
            No tienes una ruta activa. Toma pedidos disponibles para empezar a
            repartir.
          </p>
        </div>
      }

      <!-- Payout informativo (solo lectura) -->
      @if (payout(); as p) {
        <app-card shadow="sm" [responsivePadding]="true">
          <div class="flex items-start gap-3">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50 border border-purple-200 text-purple-600"
            >
              <app-icon name="hand-coins" [size]="20"></app-icon>
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-bold text-gray-900">
                  {{ payoutIsEarned() ? 'Tu pago ganado' : 'Tu pago estimado' }}
                </p>
                <span
                  class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 shrink-0"
                >
                  {{ payoutModeLabel() }}
                </span>
              </div>
              <p class="mt-1 text-2xl font-black text-gray-900">
                {{ payoutHeadline() | currency }}
              </p>
              <p class="mt-0.5 text-xs text-text-secondary">
                {{ payoutUnit() | currency }} · {{ payoutModeLabel() }}
              </p>
              <p
                class="mt-2 flex items-start gap-1 text-xs text-text-secondary"
              >
                <app-icon
                  name="info"
                  [size]="13"
                  class="mt-0.5 shrink-0"
                ></app-icon>
                <span>
                  Valor informativo. No representa un pago realizado ni una
                  transacción; el pago real lo gestiona tu tienda.
                </span>
              </p>
            </div>
          </div>
        </app-card>
      }

      <!-- Cerrar sesión -->
      <app-button
        variant="outline-danger"
        [fullWidth]="true"
        (clicked)="logout()"
      >
        <app-icon slot="icon" name="log-out" [size]="18"></app-icon>
        Cerrar sesión
      </app-button>
    </div>
  `,
  styles: [
    `
      /* ── Hero de identidad: gradiente de marca tokenizado por tienda ── */
      .identity-hero {
        position: relative;
        overflow: hidden;
        border-radius: 1rem;
        padding: 1.15rem 1.25rem;
        color: #ffffff;
        background: linear-gradient(
          135deg,
          rgb(var(--vx-neon, 46, 204, 113)) 0%,
          rgb(var(--color-secondary-rgb, 47, 111, 78)) 60%,
          color-mix(in srgb, rgb(var(--color-secondary-rgb, 47, 111, 78)) 68%, black) 100%
        );
        border: 1px solid rgba(var(--vx-mint, 161, 244, 217), 0.28);
        box-shadow:
          0 16px 34px -14px rgba(var(--color-secondary-rgb, 47, 111, 78), 0.6),
          0 0 30px -6px rgba(var(--vx-neon, 46, 204, 113), 0.45);
      }
      /* Auroras neón que derivan lento detrás del contenido (capa "AI Style"),
         recortadas por overflow:hidden; screen para sumar solo luz de marca. */
      .identity-hero::before {
        content: '';
        position: absolute;
        inset: -30%;
        background:
          radial-gradient(
            32% 42% at 16% 18%,
            rgba(var(--vx-mint, 161, 244, 217), 0.55) 0%,
            transparent 70%
          ),
          radial-gradient(
            36% 46% at 84% 82%,
            rgba(var(--vx-neon, 46, 204, 113), 0.5) 0%,
            transparent 72%
          );
        mix-blend-mode: screen;
        pointer-events: none;
        animation: identity-hero-aurora 12s ease-in-out infinite alternate;
      }
      @keyframes identity-hero-aurora {
        0% {
          transform: translate3d(-4%, -3%, 0) scale(1);
          opacity: 0.85;
        }
        100% {
          transform: translate3d(5%, 4%, 0) scale(1.12);
          opacity: 1;
        }
      }
      .identity-hero-blob {
        position: absolute;
        border-radius: 9999px;
        background: #ffffff;
        pointer-events: none;
        filter: blur(28px);
      }
      .identity-hero-blob--1 {
        width: 150px;
        height: 150px;
        top: -70px;
        right: -40px;
        opacity: 0.12;
      }
      .identity-hero-blob--2 {
        width: 110px;
        height: 110px;
        bottom: -60px;
        left: -20px;
        opacity: 0.08;
      }
      .identity-hero-content {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 14px;
      }
      /* Avatar glass translúcido sobre el gradiente. */
      .identity-hero-avatar {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        flex-shrink: 0;
        border-radius: 9999px;
        color: #ffffff;
        background: rgba(255, 255, 255, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.35);
        backdrop-filter: blur(6px);
      }
      .identity-hero-name {
        font-size: 18px;
        font-weight: 800;
        line-height: 1.2;
        color: #ffffff;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .identity-hero-store {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-top: 3px;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.9);
        overflow: hidden;
      }
      .identity-hero-email {
        margin-top: 2px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.75);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class SesionPageComponent {
  private readonly authFacade = inject(AuthFacade);
  private readonly routeStore = inject(ActiveRouteStore);

  // ─── Identidad (AuthFacade) ────────────────────────────────────────────────
  readonly carrierName = computed(
    () => this.authFacade.userName() ?? 'Repartidor',
  );
  readonly storeName = this.authFacade.userStoreName;
  readonly userEmail = this.authFacade.userEmail;

  // ─── Estado de la ruta activa (ActiveRouteStore) ───────────────────────────
  readonly loading = this.routeStore.loading;
  readonly hasActiveRoute = computed(
    () => this.routeStore.activeRoute() !== null,
  );
  readonly pendingCount = this.routeStore.pendingStopsCount;

  /** Paradas efectivamente entregadas. */
  readonly deliveredCount = computed(
    () =>
      this.routeStore.stops().filter((s) => s.status === 'delivered').length,
  );

  /**
   * Efectivo recaudado en las paradas entregadas. `collected_amount` llega como
   * string (Decimal) o number; se coacciona con `Number(...) || 0` antes de sumar.
   */
  readonly collectedTotal = computed(() =>
    this.routeStore
      .stops()
      .filter((s) => s.status === 'delivered')
      .reduce((sum, s) => sum + (Number(s.collected_amount) || 0), 0),
  );

  /** Total de paradas de la ruta (base del cálculo de avance). */
  readonly totalStops = computed(() => this.routeStore.stops().length);

  /**
   * Avance de la ruta en porcentaje (entregadas / total). Cae a 0% de forma
   * natural cuando no hay ruta activa (stops = []). Cuarta KPI para completar
   * la cuadrícula simétrica de 4 columnas del `stats-container`.
   */
  readonly progressPct = computed(() => {
    const total = this.totalStops();
    return total > 0
      ? Math.round((this.deliveredCount() / total) * 100)
      : 0;
  });

  /** Etiqueta lista para la stat card (`"80%"`). */
  readonly progressLabel = computed(() => `${this.progressPct()}%`);

  // ─── Payout informativo (read-only) ────────────────────────────────────────
  readonly payout = this.routeStore.payout;

  /** True cuando la ruta ya cerró y el payout trae `earned`. */
  readonly payoutIsEarned = computed(() => this.payout()?.earned != null);

  /** Valor principal a mostrar: ganado > estimado > monto unitario. */
  readonly payoutHeadline = computed(() => {
    const p = this.payout();
    if (!p) return 0;
    return Number(p.earned ?? p.estimated ?? p.amount) || 0;
  });

  /** Monto unitario configurado del payout (por parada o por ruta). */
  readonly payoutUnit = computed(() => Number(this.payout()?.amount ?? 0) || 0);

  readonly payoutModeLabel = computed(() =>
    this.payout()?.mode === 'per_route' ? 'Por ruta' : 'Por parada',
  );

  constructor() {
    // Idempotente: si ya se resolvió (shell), no re-pide. Garantiza KPIs con
    // datos aunque se entre directo a la pestaña Sesión.
    this.routeStore.resolve();
  }

  /** Cierra la sesión del repartidor (toast + limpieza vía SessionService). */
  logout(): void {
    this.authFacade.logout();
  }
}
