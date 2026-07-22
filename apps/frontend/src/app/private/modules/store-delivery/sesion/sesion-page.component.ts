import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  ModalComponent,
  StatsComponent,
} from '../../../../shared/components/index';
import { CurrencyPipe } from '../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../shared/utils/date.util';

import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ActiveRouteStore } from '../state/active-route.store';
import { RepartosService } from '../services/repartos.service';
import type { DispatchRoute } from '../interfaces/repartos.interface';

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
    ModalComponent,
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

      <!-- Historial de rutas (Item 3b) -->
      <div>
        <div class="mb-2 flex items-center justify-between px-1">
          <h3
            class="text-xs font-bold uppercase tracking-wide text-text-secondary"
          >
            Historial de rutas
          </h3>
          @if (routeHistory().length > 0) {
            <span class="text-[11px] text-text-secondary">
              {{ routeHistory().length }}
            </span>
          }
        </div>

        @if (historyLoading()) {
          <div
            class="rounded-lg border border-border bg-background px-4 py-3 text-sm text-text-secondary"
          >
            Cargando historial…
          </div>
        } @else if (historyError()) {
          <div
            class="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 flex items-start gap-3"
          >
            <app-icon
              name="alert-triangle"
              [size]="18"
              class="text-danger mt-0.5 shrink-0"
            ></app-icon>
            <div class="min-w-0 flex-1">
              <p class="text-sm text-text-primary">{{ historyError() }}</p>
              <button
                type="button"
                class="mt-1 text-xs font-semibold text-primary-600"
                (click)="loadHistory()"
              >
                Reintentar
              </button>
            </div>
          </div>
        } @else if (routeHistory().length === 0) {
          <div
            class="rounded-lg border border-border bg-background px-4 py-3 flex items-start gap-3"
          >
            <app-icon
              name="truck"
              [size]="18"
              class="text-text-secondary mt-0.5 shrink-0"
            ></app-icon>
            <p class="text-sm text-text-secondary">
              Aún no tienes rutas en tu historial.
            </p>
          </div>
        } @else {
          <div class="space-y-2">
            @for (r of routeHistory(); track r.id) {
              <button
                type="button"
                class="history-card"
                (click)="openRouteSummary(r)"
              >
                <span class="history-card-icon">
                  <app-icon name="truck" [size]="18"></app-icon>
                </span>
                <div class="min-w-0 flex-1 text-left">
                  <div class="flex items-center gap-2">
                    <span
                      class="text-sm font-bold text-text-primary truncate"
                    >
                      {{ r.route_number }}
                    </span>
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide shrink-0"
                      [style.color]="routeStatusColor(r.status).fg"
                      [style.background]="routeStatusColor(r.status).bg"
                    >
                      {{ routeStatusLabel(r.status) }}
                    </span>
                  </div>
                  <p class="mt-0.5 text-xs text-text-secondary">
                    {{ formatRouteDate(r.planned_date) }} ·
                    {{ routeStopsCount(r) }} paradas
                  </p>
                </div>
                <div class="text-right shrink-0">
                  <p class="text-sm font-bold text-text-primary font-mono">
                    {{ +r.total_collected | currency }}
                  </p>
                  <p class="text-[10px] text-text-secondary">recaudo</p>
                </div>
                <app-icon
                  name="chevron-right"
                  [size]="16"
                  class="text-text-secondary shrink-0"
                ></app-icon>
              </button>
            }
          </div>
        }
      </div>

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

    <!-- Resumen de una ruta del historial (modal) -->
    @if (selectedRoute(); as r) {
      <app-modal
        [isOpen]="true"
        title="Resumen de la ruta"
        [subtitle]="r.route_number"
        size="md"
        (cancel)="closeRouteSummary()"
        (closed)="closeRouteSummary()"
      >
        <div class="space-y-4">
          <!-- Estado + fechas -->
          <div class="flex items-center justify-between gap-2">
            <span
              class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide"
              [style.color]="routeStatusColor(r.status).fg"
              [style.background]="routeStatusColor(r.status).bg"
            >
              {{ routeStatusLabel(r.status) }}
            </span>
            @if (detailLoading()) {
              <span class="text-xs text-text-secondary italic">
                Actualizando…
              </span>
            }
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-xl border border-border bg-surface p-3">
              <span
                class="text-[11px] font-bold uppercase tracking-wide text-text-secondary block mb-0.5"
              >
                Planificada
              </span>
              <span class="text-sm text-text-primary">
                {{ formatRouteDate(r.planned_date) }}
              </span>
            </div>
            <div class="rounded-xl border border-border bg-surface p-3">
              <span
                class="text-[11px] font-bold uppercase tracking-wide text-text-secondary block mb-0.5"
              >
                Cerrada
              </span>
              <span class="text-sm text-text-primary">
                {{ formatRouteDate(r.closed_at) }}
              </span>
            </div>
          </div>

          <!-- KPIs de entrega -->
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-xl border border-border bg-surface p-3">
              <span
                class="text-[11px] font-bold uppercase tracking-wide text-text-secondary block mb-0.5"
              >
                Entregas
              </span>
              <span class="text-base font-bold text-text-primary">
                {{ selectedDeliveredCount() }} / {{ selectedStopsCount() }}
              </span>
            </div>
            <div class="rounded-xl border border-border bg-surface p-3">
              <span
                class="text-[11px] font-bold uppercase tracking-wide text-text-secondary block mb-0.5"
              >
                Recaudo
              </span>
              <span class="text-base font-bold text-text-primary font-mono">
                {{ +r.total_collected | currency }}
              </span>
            </div>
          </div>

          <!-- Totales financieros -->
          <div class="rounded-xl border border-border bg-surface divide-y divide-border">
            <div class="flex items-center justify-between px-3 py-2">
              <span class="text-xs text-text-secondary">Por cobrar</span>
              <span class="text-sm font-mono text-text-primary">
                {{ +r.total_to_collect | currency }}
              </span>
            </div>
            <div class="flex items-center justify-between px-3 py-2">
              <span class="text-xs text-text-secondary">Crédito</span>
              <span class="text-sm font-mono text-text-primary">
                {{ +r.total_credit | currency }}
              </span>
            </div>
            <div class="flex items-center justify-between px-3 py-2">
              <span class="text-xs text-text-secondary">Retenciones</span>
              <span class="text-sm font-mono text-text-primary">
                {{ +r.total_withholdings | currency }}
              </span>
            </div>
            @if (r.declared_cash != null) {
              <div class="flex items-center justify-between px-3 py-2">
                <span class="text-xs text-text-secondary">Efectivo declarado</span>
                <span class="text-sm font-mono text-text-primary">
                  {{ +r.declared_cash | currency }}
                </span>
              </div>
            }
            @if (r.cash_variance != null) {
              <div class="flex items-center justify-between px-3 py-2">
                <span class="text-xs text-text-secondary">Varianza de caja</span>
                <span
                  class="text-sm font-mono font-bold"
                  [style.color]="+r.cash_variance < 0 ? '#b91c1c' : '#047857'"
                >
                  {{ +r.cash_variance | currency }}
                </span>
              </div>
            }
          </div>
        </div>

        <div slot="footer" class="flex items-center justify-end">
          <button
            type="button"
            (click)="closeRouteSummary()"
            class="rounded-md border border-border bg-surface px-4 py-2 text-sm"
          >
            Cerrar
          </button>
        </div>
      </app-modal>
    }
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

      /* ── Tarjeta de una ruta del historial (botón táctil ≥44px) ── */
      .history-card {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 12px;
        border-radius: 0.75rem;
        border: 1px solid var(--color-border);
        background: var(--color-surface);
        cursor: pointer;
        transition:
          background var(--transition-fast) ease,
          border-color var(--transition-fast) ease;
        -webkit-tap-highlight-color: transparent;
      }
      .history-card:hover {
        background: var(--color-background);
        border-color: var(--color-primary);
      }
      .history-card:focus-visible {
        outline: 2px solid var(--color-ring);
        outline-offset: 2px;
      }
      .history-card-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 0.625rem;
        color: var(--color-primary);
        background: rgba(var(--color-primary-rgb, 126, 215, 165), 0.1);
        border: 1px solid rgba(var(--color-primary-rgb, 126, 215, 165), 0.18);
      }
    `,
  ],
})
export class SesionPageComponent {
  private readonly authFacade = inject(AuthFacade);
  private readonly routeStore = inject(ActiveRouteStore);
  private readonly repartosService = inject(RepartosService);
  private readonly destroyRef = inject(DestroyRef);

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

  /**
   * Total de paradas que cuentan para el avance: EXCLUYE las liberadas
   * (`released`), que volvieron al pool. Las rechazadas/parciales permanecen
   * (intentos cerrados). Mismo criterio que el denominador del header del shell.
   */
  readonly totalStops = computed(
    () => this.routeStore.stops().filter((s) => s.status !== 'released').length,
  );

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

  // ─── Historial de rutas (Item 3b) ──────────────────────────────────────────
  /** Planillas pasadas del repartidor (`GET /store/carrier/routes`). */
  readonly routeHistory = signal<DispatchRoute[]>([]);
  readonly historyLoading = signal(false);
  readonly historyError = signal<string | null>(null);

  /** Ruta seleccionada para el resumen (modal). `null` = modal cerrado. */
  readonly selectedRoute = signal<DispatchRoute | null>(null);
  /** True mientras se resuelve el detalle completo de la ruta seleccionada. */
  readonly detailLoading = signal(false);

  /** Nº de paradas entregadas de la ruta seleccionada (para el resumen). */
  readonly selectedDeliveredCount = computed(
    () =>
      (this.selectedRoute()?.stops ?? []).filter(
        (s) => s.status === 'delivered',
      ).length,
  );

  /** Nº total de paradas de la ruta seleccionada (prefiere `_count`). */
  readonly selectedStopsCount = computed(() => {
    const r = this.selectedRoute();
    return r?._count?.stops ?? r?.stops?.length ?? 0;
  });

  constructor() {
    // Idempotente: si ya se resolvió (shell), no re-pide. Garantiza KPIs con
    // datos aunque se entre directo a la pestaña Sesión.
    this.routeStore.resolve();
    this.loadHistory();
  }

  /** Carga la primera página del historial de planillas del repartidor. */
  loadHistory(): void {
    this.historyLoading.set(true);
    this.historyError.set(null);
    this.repartosService
      .getRouteHistory({ page: 1, limit: 20 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.routeHistory.set(res.data);
          this.historyLoading.set(false);
        },
        error: (e) => {
          this.historyLoading.set(false);
          this.historyError.set(
            e?.message || 'No se pudo cargar el historial de rutas.',
          );
        },
      });
  }

  /**
   * Abre el resumen de una planilla. Muestra de inmediato lo que ya trae la
   * lista y, en paralelo, pide el detalle completo (con paradas) para enriquecer
   * los KPIs (entregas/total). Si el detalle falla, se conserva el resumen de la
   * lista y solo se corta el spinner.
   */
  openRouteSummary(route: DispatchRoute): void {
    this.selectedRoute.set(route);
    this.detailLoading.set(true);
    this.repartosService
      .getRouteById(route.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (full) => {
          this.selectedRoute.set(full);
          this.detailLoading.set(false);
        },
        error: () => {
          this.detailLoading.set(false);
        },
      });
  }

  /** Cierra el modal de resumen de ruta. */
  closeRouteSummary(): void {
    this.selectedRoute.set(null);
    this.detailLoading.set(false);
  }

  /** Formatea una fecha (date-only, UTC) o devuelve un guion si es nula. */
  formatRouteDate(value?: string | null): string {
    return value ? formatDateOnlyUTC(value) : '—';
  }

  /** Etiqueta legible del estado de una planilla. */
  routeStatusLabel(status?: string): string {
    const map: Record<string, string> = {
      draft: 'Borrador',
      dispatched: 'Despachada',
      in_transit: 'En ruta',
      settling: 'Cuadrando',
      closed: 'Cerrada',
      voided: 'Anulada',
    };
    return map[status ?? ''] || status || '—';
  }

  /** Colores inline (WCAG-AA) para el badge de estado de la planilla. */
  routeStatusColor(status?: string): { fg: string; bg: string } {
    const map: Record<string, { fg: string; bg: string }> = {
      draft: { fg: '#475569', bg: '#f1f5f9' },
      dispatched: { fg: '#1d4ed8', bg: '#dbeafe' },
      in_transit: { fg: '#b45309', bg: '#fef3c7' },
      settling: { fg: '#7e22ce', bg: '#f3e8ff' },
      closed: { fg: '#047857', bg: '#d1fae5' },
      voided: { fg: '#b91c1c', bg: '#fee2e2' },
    };
    return map[status ?? ''] || { fg: '#475569', bg: '#f1f5f9' };
  }

  /** Nº de paradas de una fila del historial (prefiere `_count`). */
  routeStopsCount(route: DispatchRoute): number {
    return route._count?.stops ?? route.stops?.length ?? 0;
  }

  /** Cierra la sesión del repartidor (toast + limpieza vía SessionService). */
  logout(): void {
    this.authFacade.logout();
  }
}
