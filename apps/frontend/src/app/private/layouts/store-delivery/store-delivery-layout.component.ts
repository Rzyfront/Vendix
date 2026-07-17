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
 * (nombre + logo de la tienda desde el AuthFacade; el branding llega por las
 * variables CSS que aplica el ThemeService globalmente), el `<router-outlet>`
 * de las pestañas (pool/ruta/mapa/sesión) y el bottom-nav fijo.
 *
 * Al montar dispara `ActiveRouteStore.resolve()` (idempotente) para hidratar
 * "mi ruta" y alimentar el badge de paradas pendientes del bottom-nav.
 *
 * Zoneless: estado de la ruta vía signals del `ActiveRouteStore`; header vía
 * signals del `AuthFacade`.
 */
@Component({
  selector: 'app-store-delivery-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, IconComponent, DeliveryBottomNavComponent],
  template: `
    <div class="delivery-shell">
      <header class="delivery-header">
        @if (storeLogo(); as logo) {
          <img class="store-logo" [src]="logo" [alt]="storeName()" />
        } @else {
          <span class="store-logo-fallback">
            <app-icon name="truck" [size]="18" />
          </span>
        }
        <div class="header-text">
          <span class="store-name">{{ storeName() }}</span>
          <span class="app-tag">Repartos</span>
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
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        background: var(--color-background, #f4f4f4);
      }

      .delivery-header {
        position: sticky;
        top: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        padding-top: calc(10px + env(safe-area-inset-top, 0px));
        background: var(--color-surface, #ffffff);
        border-bottom: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
      }

      .store-logo {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        object-fit: cover;
        flex-shrink: 0;
      }

      .store-logo-fallback {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--color-primary, #3b82f6);
        color: #ffffff;
        flex-shrink: 0;
      }

      .header-text {
        display: flex;
        flex-direction: column;
        line-height: 1.1;
        min-width: 0;
      }

      .store-name {
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .app-tag {
        font-size: 11px;
        color: var(--color-text-secondary, #6b7280);
      }

      .delivery-content {
        flex: 1 1 auto;
        /* Deja espacio para el bottom-nav fijo (56px) + safe-area. */
        padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px));
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

  /** Ruta activa + paradas pendientes → bottom-nav. */
  readonly activeRouteId = this.activeRouteStore.activeRouteId;
  readonly pendingStops = this.activeRouteStore.pendingStopsCount;

  constructor() {
    // Hidrata "mi ruta" al montar la cáscara (idempotente).
    this.activeRouteStore.resolve();
  }
}
