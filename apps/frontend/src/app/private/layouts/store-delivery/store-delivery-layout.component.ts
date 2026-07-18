import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ActiveRouteStore } from '../../modules/store-delivery/state/active-route.store';
import { DeliveryBottomNavComponent } from './components/delivery-bottom-nav.component';

/**
 * Cáscara móvil dedicada de Vendix Repartos (app_type STORE_DELIVERY).
 *
 * NO es `/admin`: es una app interna de delivery para usuarios `carrier`. Por
 * eso NO usa Sidebar/Header/banners/tour del admin — solo un header compacto
 * con "estado del día" (saludo + resumen de la jornada + progreso de la ruta
 * activa; el branding llega por las variables CSS que aplica el ThemeService
 * globalmente), el `<router-outlet>` de las pestañas (pool/ruta/mapa/sesión) y
 * el bottom-nav fijo.
 *
 * Al montar dispara `ActiveRouteStore.resolve()` (idempotente) para hidratar
 * "mi ruta" y alimentar tanto el resumen del header como el badge de paradas
 * pendientes del bottom-nav.
 *
 * Zoneless: TODO el estado leído por la plantilla vive en signals — del
 * `ActiveRouteStore` (ruta activa, paradas, loading) y del `AuthFacade`
 * (nombre/logo de la tienda, nombre del repartidor). Los derivados son
 * `computed`. NO se muta el store; solo se lee.
 */
@Component({
  selector: 'app-store-delivery-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, IconComponent, DeliveryBottomNavComponent],
  template: `
    <div class="delivery-shell">
      <header class="delivery-header">
        <div class="header-top">
          <div class="brand">
            @if (storeLogo(); as logo) {
              <img class="store-logo" [src]="logo" [alt]="storeName()" />
            } @else {
              <span class="store-logo-fallback" aria-hidden="true">
                <app-icon name="truck" [size]="18" />
              </span>
            }
            <div class="brand-text">
              <span class="store-name">{{ storeName() }}</span>
              <span class="app-tag">
                <app-icon name="truck" [size]="11" />
                Repartos
              </span>
            </div>
          </div>

          <span
            class="route-chip"
            [class.route-chip--active]="hasActiveRoute()"
            [attr.aria-label]="hasActiveRoute() ? 'En ruta' : 'Sin ruta activa'"
          >
            <span class="route-dot" aria-hidden="true"></span>
            {{ hasActiveRoute() ? 'En ruta' : 'Libre' }}
          </span>
        </div>

        <div class="header-status">
          <p class="greeting">{{ greeting() }}</p>
          <p class="status-line">
            <app-icon [name]="statusIcon()" [size]="15" />
            <span>{{ statusLine() }}</span>
          </p>

          @if (hasActiveRoute() && totalStops() > 0) {
            <div
              class="progress"
              role="progressbar"
              [attr.aria-valuenow]="deliveredStops()"
              [attr.aria-valuemin]="0"
              [attr.aria-valuemax]="totalStops()"
              [attr.aria-label]="
                'Entregas: ' + deliveredStops() + ' de ' + totalStops()
              "
            >
              <span
                class="progress-fill"
                [style.transform]="'scaleX(' + progressRatio() + ')'"
              ></span>
            </div>
          }
        </div>
      </header>

      <main class="delivery-content">
        <router-outlet />
      </main>

      <app-delivery-bottom-nav
        [activeRouteId]="activeRouteId()"
        [pendingStops]="pendingStops()"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .delivery-shell {
        /* ── Identidad de MARCA Vendix (white-label OFF) ──────────────────
           Vendix Repartos es una app operativa INTERNA de Vendix (rol
           carrier), NO un storefront white-label. Por eso NO debe heredar el
           branding del tenant (que puede ser azul u otro matiz ajeno a la
           marca). Aquí redefinimos los tokens de marca a la paleta fija de
           Vendix (verde + menta); como .delivery-shell es el ancestro común
           de TODO /repartos, sus descendientes (botones, sticky-header,
           stepper, chips, badges, halos) resuelven estos valores por herencia
           CSS y quedan inmunes al override inline que ThemeService aplica en
           <html>. Los neutros (background/surface/text) se dejan del tenant. */
        --color-primary: #2ecc71;
        --color-primary-rgb: 126, 215, 165;
        --color-secondary: #2f6f4e;
        --color-secondary-rgb: 47, 111, 78;
        --color-accent: #a1f4d9;
        --color-accent-rgb: 161, 244, 217;
        --color-ring: rgba(46, 204, 113, 0.28);

        /* Tokens neón de marca para la capa "AI Style" (halos/destellos). */
        --vx-neon: 46, 204, 113; /* #2ecc71 núcleo neón */
        --vx-mint: 161, 244, 217; /* #a1f4d9 menta */

        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        background: var(--color-background);
      }

      /* ── Header: estado del día ── */
      .delivery-header {
        position: sticky;
        top: 0;
        z-index: 40;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px 16px 14px;
        padding-top: calc(12px + env(safe-area-inset-top, 0px));
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
        box-shadow: var(--shadow-sm);
      }

      .header-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .store-logo {
        width: 36px;
        height: 36px;
        border-radius: var(--radius-md);
        object-fit: cover;
        flex-shrink: 0;
        border: 1px solid var(--color-border);
      }

      .store-logo-fallback {
        width: 36px;
        height: 36px;
        border-radius: var(--radius-md);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--color-primary);
        color: var(--color-text-on-primary, #ffffff);
        flex-shrink: 0;
      }

      .brand-text {
        display: flex;
        flex-direction: column;
        line-height: 1.15;
        min-width: 0;
      }

      .store-name {
        font-size: 15px;
        font-weight: 700;
        color: var(--color-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .app-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--color-primary);
      }

      /* Chip de estado de ruta: color + punto + texto (no solo color). */
      .route-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        padding: 4px 10px;
        border-radius: var(--radius-pill);
        font-size: 12px;
        font-weight: 600;
        background: var(--color-background);
        color: var(--color-text-secondary);
        border: 1px solid var(--color-border);
      }

      .route-chip--active {
        background: var(--color-success-light);
        color: var(--color-success);
        border-color: transparent;
        box-shadow: 0 0 0 3px rgba(var(--color-success-rgb, 34, 197, 94), 0.14);
      }

      .route-dot {
        width: 8px;
        height: 8px;
        border-radius: var(--radius-pill);
        background: var(--color-text-muted);
        flex-shrink: 0;
      }

      .route-chip--active .route-dot {
        background: var(--color-success);
        animation: route-pulse 1.8s ease-in-out infinite;
      }

      @keyframes route-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.45;
          transform: scale(0.72);
        }
      }

      /* ── Bloque de estado (saludo + resumen + progreso) ── */
      .header-status {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .greeting {
        font-size: 13px;
        color: var(--color-text-secondary);
      }

      .status-line {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .status-line app-icon {
        color: var(--color-primary);
        flex-shrink: 0;
      }

      .status-line span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .progress {
        position: relative;
        height: 7px;
        margin-top: 6px;
        border-radius: var(--radius-pill);
        background: rgba(var(--color-secondary-rgb, 47, 111, 78), 0.14);
        overflow: hidden;
      }

      /* Relleno neón de marca: menta → neón → verde profundo, con glow suave
         (capa "AI Style", solo colores Vendix). */
      .progress-fill {
        position: absolute;
        inset: 0;
        transform-origin: left center;
        border-radius: var(--radius-pill);
        background: linear-gradient(
          90deg,
          rgb(var(--vx-mint, 161, 244, 217)) 0%,
          rgb(var(--vx-neon, 46, 204, 113)) 48%,
          rgb(var(--color-secondary-rgb, 47, 111, 78)) 100%
        );
        box-shadow:
          0 0 8px rgba(var(--vx-neon, 46, 204, 113), 0.55),
          0 0 2px rgba(var(--vx-mint, 161, 244, 217), 0.9);
        transition: transform var(--transition-fast) ease;
        will-change: transform;
      }

      /* ── Contenido ── */
      .delivery-content {
        flex: 1 1 auto;
        min-height: 0; /* Fix para mapa fullscreen: permite que flex-1 children (ej. mapa) se encojan sin overflow. */
        /* Contenedor flex-column: da contexto de alto resoluble a la página
           enrutada. El mapa (app-mapa-page) usa flex:1 para llenar; las páginas
           de contenido (pool/ruta/sesión) no declaran flex-grow, así que se
           dimensionan por contenido y el body scrollea como siempre. Sin esto,
           el height:100% de la cadena del mapa no resuelve (block + height auto)
           y el canvas de MapLibre colapsa a ~18px (mapa gris). */
        display: flex;
        flex-direction: column;
        /* Deja espacio para el bottom-nav fijo + safe-area. */
        padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
      }
    `,
  ],
})
export class StoreDeliveryLayoutComponent {
  private readonly authFacade = inject(AuthFacade);
  private readonly activeRouteStore = inject(ActiveRouteStore);

  /** Nombre de la tienda del carrier (fallback mientras hidrata el AuthFacade). */
  readonly storeName = computed(
    () => this.authFacade.userStoreName() ?? 'Repartos',
  );
  /** Logo de la tienda (o `null` → glifo de camión). */
  readonly storeLogo = computed<string | null>(
    () => this.authFacade.userStore()?.logo_url ?? null,
  );
  /** Nombre del repartidor para el saludo (o `null`). */
  readonly userName = computed<string | null>(
    () => this.authFacade.userName() ?? null,
  );

  // ── Estado de la ruta (ActiveRouteStore, solo lectura) ──
  readonly activeRouteId = this.activeRouteStore.activeRouteId;
  readonly pendingStops = this.activeRouteStore.pendingStopsCount;
  private readonly loading = this.activeRouteStore.loading;
  private readonly activeRoute = this.activeRouteStore.activeRoute;

  readonly hasActiveRoute = computed(() => this.activeRouteId() !== null);
  readonly totalStops = computed(() => this.activeRouteStore.stops().length);
  readonly deliveredStops = computed(
    () =>
      this.activeRouteStore
        .stops()
        .filter((s) => s.status === 'delivered').length,
  );
  /** Progreso 0..1 de entregas para el transform del progress bar. */
  readonly progressRatio = computed(() => {
    const total = this.totalStops();
    return total > 0 ? this.deliveredStops() / total : 0;
  });

  /** Saludo por hora del día + primer nombre del repartidor si está disponible. */
  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const part =
      hour < 12
        ? 'Buenos días'
        : hour < 19
          ? 'Buenas tardes'
          : 'Buenas noches';
    const name = this.userName();
    const first = name ? name.trim().split(' ')[0] : '';
    return first ? `${part}, ${first}` : part;
  });

  /** Icono del resumen según el estado de la jornada. */
  readonly statusIcon = computed<'inbox' | 'check-circle' | 'navigation'>(
    () => {
      if (!this.hasActiveRoute()) return 'inbox';
      return this.pendingStops() === 0 ? 'check-circle' : 'navigation';
    },
  );

  /** Resumen textual de la jornada (fuente de verdad: ActiveRouteStore). */
  readonly statusLine = computed(() => {
    if (this.loading() && !this.hasActiveRoute()) {
      return 'Cargando tu jornada…';
    }
    if (!this.hasActiveRoute()) {
      return 'Sin ruta activa · toma pedidos disponibles';
    }
    const route = this.activeRoute();
    const label = route?.route_number ? `Ruta ${route.route_number}` : 'Ruta activa';
    const pending = this.pendingStops();
    if (pending === 0) {
      return `${label} · todas las paradas entregadas`;
    }
    const stopWord = pending === 1 ? 'parada' : 'paradas';
    return `${label} · ${pending} ${stopWord} por atender`;
  });

  constructor() {
    // Hidrata "mi ruta" al montar la cáscara (idempotente).
    this.activeRouteStore.resolve();
  }
}
