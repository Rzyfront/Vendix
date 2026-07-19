import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

/**
 * Bottom-nav fijo de la cáscara de reparto (Vendix Repartos, STORE_DELIVERY).
 *
 * 100% presentacional: recibe `activeRouteId` y `pendingStops` como inputs y
 * pinta 4 tabs (Disponibles / Mi Ruta / Mapa / Sesión) con `routerLink` +
 * `routerLinkActive`. Sin estado propio ni HTTP.
 *
 * Accesibilidad: el tab activo NO se comunica solo por color — recibe un
 * tinte de fondo suave (relleno presente/ausente) además del cambio de color,
 * de modo que la señal no dependa únicamente del matiz. Cada tab tiene área
 * táctil ≥44px y estado `:focus-visible` visible. La barra respeta el
 * `env(safe-area-inset-bottom)` de los dispositivos con notch/home-indicator.
 * En "Mi Ruta" se pinta un badge con `pendingStops` cuando hay paradas por
 * atender (> 0), resuelto vía el token `--color-danger`.
 */
@Component({
  selector: 'app-delivery-bottom-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  template: `
    <nav
      class="delivery-bottom-nav"
      role="navigation"
      aria-label="Navegación de reparto"
    >
      <a
        class="nav-tab"
        routerLink="/repartos/pool"
        routerLinkActive="active"
        aria-label="Pedidos disponibles"
      >
        <span class="nav-icon-wrap">
          <app-icon name="inbox" [size]="22" />
        </span>
        <span class="nav-label">Disponibles</span>
      </a>

      <a
        class="nav-tab"
        routerLink="/repartos/ruta"
        routerLinkActive="active"
        aria-label="Mi Ruta"
      >
        <span class="nav-icon-wrap">
          <app-icon name="truck" [size]="22" />
          @if (pendingStops() > 0) {
            <span class="nav-badge" aria-hidden="true">{{
              pendingStops() > 99 ? '99+' : pendingStops()
            }}</span>
          }
        </span>
        <span class="nav-label">Mi Ruta</span>
      </a>

      <a
        class="nav-tab"
        routerLink="/repartos/mapa"
        routerLinkActive="active"
        aria-label="Mapa"
      >
        <span class="nav-icon-wrap">
          <app-icon name="map-pin" [size]="22" />
        </span>
        <span class="nav-label">Mapa</span>
      </a>

      <a
        class="nav-tab"
        routerLink="/repartos/sesion"
        routerLinkActive="active"
        aria-label="Usuario"
      >
        <span class="nav-icon-wrap">
          <app-icon name="user" [size]="22" />
        </span>
        <span class="nav-label">Usuario</span>
      </a>
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .delivery-bottom-nav {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 50;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        align-items: stretch;
        background: var(--color-surface);
        border-top: 1px solid var(--color-border);
        box-shadow: 0 -4px 16px rgba(var(--color-secondary-rgb), 0.08);
        padding-bottom: env(safe-area-inset-bottom, 0px);
      }

      .nav-tab {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        /* Área táctil >= 44px (WCAG / iOS HIG). */
        min-height: 58px;
        padding: 8px 4px;
        text-decoration: none;
        color: var(--color-text-secondary);
        transition: color var(--transition-fast) ease;
        -webkit-tap-highlight-color: transparent;
      }

      .nav-tab:active {
        background: var(--color-background);
      }

      .nav-tab:focus-visible {
        outline: 2px solid var(--color-ring);
        outline-offset: -3px;
        border-radius: var(--radius-sm);
      }

      .nav-tab.active {
        color: var(--color-primary);
        background: rgba(var(--color-primary-rgb, 126, 215, 165), 0.1);
        border-radius: var(--radius-md);
      }

      .nav-icon-wrap {
        position: relative;
        display: inline-flex;
        transition: transform var(--transition-fast) ease;
      }

      /* El ícono siempre por encima del halo. */
      .nav-icon-wrap > * {
        position: relative;
        z-index: 1;
      }

      .nav-label {
        font-size: 11px;
        line-height: 1;
        font-weight: 500;
      }

      .nav-badge {
        position: absolute;
        top: -6px;
        right: -10px;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: var(--radius-pill);
        background: var(--color-danger);
        color: var(--color-text-on-primary, #ffffff);
        font-size: 10px;
        font-weight: 700;
        line-height: 16px;
        text-align: center;
      }
    `,
  ],
})
export class DeliveryBottomNavComponent {
  /** Id de la ruta activa del carrier (reservado para lógica futura del nav). */
  readonly activeRouteId = input<number | null>(null);
  /** Paradas por atender — pinta el badge en "Mi Ruta" cuando es > 0. */
  readonly pendingStops = input<number>(0);
}
