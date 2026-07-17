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
      <!-- Identidad del repartidor -->
      <app-card shadow="sm" [responsivePadding]="true">
        <div class="flex items-center gap-3">
          <span
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 border border-blue-200 text-blue-600"
          >
            <app-icon name="user" [size]="24"></app-icon>
          </span>
          <div class="min-w-0">
            <p class="text-base font-bold text-gray-900 truncate">
              {{ carrierName() }}
            </p>
            @if (storeName()) {
              <p
                class="mt-0.5 flex items-center gap-1 text-sm text-text-secondary truncate"
              >
                <app-icon
                  name="store"
                  [size]="14"
                  class="shrink-0"
                ></app-icon>
                <span class="truncate">{{ storeName() }}</span>
              </p>
            }
            @if (userEmail()) {
              <p class="text-xs text-text-secondary truncate">
                {{ userEmail() }}
              </p>
            }
          </div>
        </div>
      </app-card>

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
