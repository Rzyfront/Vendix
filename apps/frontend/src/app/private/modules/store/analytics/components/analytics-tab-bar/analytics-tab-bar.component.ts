import { Component, computed, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  AnalyticsCategoryId,
  getViewsByCategory,
} from '../../config/analytics-registry';

interface AnalyticsTabView {
  id: string;
  label: string;
  icon: string;
  route: string;
}

/**
 * Tab bar reutilizable para los shells de Analíticas.
 *
 * - Mobile-first: scroll horizontal con gradient-fade en los bordes (mask-image).
 * - Desktop (≥ 768px): tabs centradas con underline en la activa.
 * - Accesible: `role="tablist"` + `role="tab"` + `aria-current="page"` + `aria-selected`.
 * - Signals-based: las tabs se derivan del registry via `computed()`.
 *
 * El shell padre (`AnalyticsShellComponent`) lee `data.categoryId` de la ruta
 * y se lo pasa como input. Este componente no se suscribe a la ruta
 * directamente — single responsibility.
 */
@Component({
  selector: 'app-analytics-tab-bar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  template: `
    <nav
      role="tablist"
      [attr.aria-label]="ariaLabel()"
      class="tab-bar"
    >
      @for (tab of tabs(); track tab.id) {
        <a
          [routerLink]="tab.route"
          routerLinkActive="active"
          #rla="routerLinkActive"
          role="tab"
          [attr.aria-current]="rla.isActive ? 'page' : null"
          [attr.aria-selected]="rla.isActive"
          class="tab-item"
        >
          @if (tab.icon) {
            <app-icon [name]="tab.icon" size="14" />
          }
          <span class="tab-label">{{ tab.label }}</span>
        </a>
      }
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .tab-bar {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        padding: 0.5rem 0.75rem;
        overflow-x: auto;
        scroll-snap-type: x proximity;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        background: var(--color-surface);
        border-bottom: 1px solid rgba(var(--color-muted-rgb), 0.16);

        // Gradient-fade en los bordes del área de scroll (mobile)
        -webkit-mask-image: linear-gradient(
          to right,
          transparent 0,
          black 24px,
          black calc(100% - 24px),
          transparent 100%
        );
        mask-image: linear-gradient(
          to right,
          transparent 0,
          black 24px,
          black calc(100% - 24px),
          transparent 100%
        );
      }
      .tab-bar::-webkit-scrollbar {
        display: none;
      }

      .tab-item {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.75rem;
        border-radius: var(--radius-pill);
        font-size: var(--fs-xs-mobile);
        font-weight: 500;
        color: var(--color-text-secondary);
        text-decoration: none;
        white-space: nowrap;
        scroll-snap-align: start;
        transition:
          color var(--transition-fast),
          background var(--transition-fast);
      }
      .tab-item:hover {
        color: var(--color-text-primary);
        background: rgba(var(--color-primary-rgb), 0.06);
      }
      .tab-item.active {
        color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.1);
        font-weight: 600;
      }

      @media (min-width: 768px) {
        .tab-bar {
          justify-content: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          // En desktop las tabs caben — el mask no es necesario
          -webkit-mask-image: none;
          mask-image: none;
        }
        .tab-item {
          padding: 0.5rem 1rem;
          background: transparent;
          border-radius: 0;
          position: relative;
        }
        .tab-item::after {
          content: '';
          position: absolute;
          left: 0.75rem;
          right: 0.75rem;
          bottom: -0.25rem;
          height: 2px;
          background: var(--color-primary);
          transform: scaleX(0);
          transform-origin: center;
          transition: transform var(--transition-fast);
        }
        .tab-item.active {
          background: transparent;
        }
        .tab-item.active::after {
          transform: scaleX(1);
        }
      }
    `,
  ],
})
export class AnalyticsTabBarComponent {
  /** ID de la categoría (lee tabs del registry). */
  readonly categoryId = input.required<AnalyticsCategoryId>();

  /** Etiqueta ARIA del tablist (override para i18n). */
  readonly ariaLabel = input<string>('Navegación de analíticas');

  /** Tabs derivadas del registry, re-evaluadas al cambiar `categoryId`. */
  readonly tabs = computed<AnalyticsTabView[]>(() =>
    getViewsByCategory(this.categoryId()).map((view) => ({
      id: view.key,
      label: view.title,
      icon: view.icon,
      route: view.route,
    })),
  );
}
