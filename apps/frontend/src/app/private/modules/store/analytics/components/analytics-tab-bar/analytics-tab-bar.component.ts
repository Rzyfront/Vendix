import {
  Component,
  computed,
  input,
  viewChild,
  effect,
  ElementRef,
  inject,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
 * - Mobile-first: scroll horizontal con scroll-snap centro, gradient-fade
 *   en los bordes del área scrollable (mask-image condicional) y
 *   auto-centrado de la tab activa al cambiar.
 * - Desktop (≥ 768px): tabs centradas con underline en la activa.
 * - Accesible: `role="tablist"` + `role="tab"` + roving tabindex + keyboard
 *   navigation (ArrowLeft/Right/Home/End) + honor a `prefers-reduced-motion`.
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
      #tabsContainer
      role="tablist"
      [attr.aria-label]="ariaLabel()"
      class="tab-bar"
      (keydown)="onTabsKeydown($event)"
      (scroll)="updateOverflowClasses()"
    >
      @for (tab of tabs(); track tab.id) {
        <a
          [routerLink]="tab.route"
          routerLinkActive="active"
          #rla="routerLinkActive"
          role="tab"
          [attr.aria-current]="rla.isActive ? 'page' : null"
          [attr.aria-selected]="rla.isActive"
          [attr.data-tab-id]="tab.id"
          [attr.tabindex]="rla.isActive ? 0 : -1"
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
        /* snap the active tab to the center of the visible area */
        scroll-snap-type: x mandatory;
        scroll-padding-inline: 16px;
        /* avoid vertical scroll-jacking on Firefox mobile during horizontal pan */
        touch-action: pan-x;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        background: var(--color-surface);
        border-bottom: 1px solid rgba(var(--color-muted-rgb), 0.16);
      }
      .tab-bar::-webkit-scrollbar {
        display: none;
      }

      /* Gradient-fade en los bordes. Solo se aplica cuando hay overflow
         en ese extremo (clase toggled por updateOverflowClasses). Sin
         overflow → sin mask (gradiente queda invisible). */
      .tab-bar.has-overflow-start {
        -webkit-mask-image: linear-gradient(
          to right,
          transparent 0,
          black 24px,
          black 100%
        );
        mask-image: linear-gradient(
          to right,
          transparent 0,
          black 24px,
          black 100%
        );
      }
      .tab-bar.has-overflow-end {
        -webkit-mask-image: linear-gradient(
          to right,
          black 0,
          black calc(100% - 24px),
          transparent 100%
        );
        mask-image: linear-gradient(
          to right,
          black 0,
          black calc(100% - 24px),
          transparent 100%
        );
      }
      .tab-bar.has-overflow-both {
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
        /* center the active tab inside the scroll viewport when snapped */
        scroll-snap-align: center;
        scroll-margin-inline: 16px;
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
      .tab-item:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }

      @media (min-width: 768px) {
        .tab-bar {
          justify-content: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          /* En desktop las tabs caben — el mask no es necesario */
          -webkit-mask-image: none;
          mask-image: none;
        }
        .tab-item {
          padding: 0.5rem 1rem;
          background: transparent;
          border-radius: 0;
          position: relative;
          scroll-snap-align: none;
          scroll-margin: 0;
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

      @media (prefers-reduced-motion: reduce) {
        .tab-item {
          transition: none;
        }
      }
    `,
  ],
})
export class AnalyticsTabBarComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly tabsContainer =
    viewChild<ElementRef<HTMLElement>>('tabsContainer');

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

  constructor() {
    // Auto-centrar la tab activa cuando cambia. `effect()` corre después
    // de la render, así que el DOM ya tiene el nuevo active tab y podemos
    // hacer scrollIntoView sin flashes. Respetamos prefers-reduced-motion.
    effect(() => {
      // Dependencias: la tab activa cambia con `categoryId` y con `tabs()`.
      this.tabs();
      queueMicrotask(() => this.scrollActiveTabIntoView());
    });

    // Setup del overflow indicator + ResizeObserver.
    queueMicrotask(() => this.setupOverflowIndicators());

    // Cleanup en destroy.
    this.destroyRef.onDestroy(() => this.cleanupOverflowIndicators());
  }

  /**
   * Scroll the active tab into the center of the visible scroll area.
   * Called via effect() on every change of categoryId/tabs so the active
   * tab is always visible after navigation.
   */
  private scrollActiveTabIntoView(): void {
    const container = this.tabsContainer()?.nativeElement;
    if (!container) return;

    const activeTab = container.querySelector<HTMLElement>('.tab-item.active');
    if (!activeTab) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    activeTab.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }

  /**
   * Toggle has-overflow-* classes based on scrollLeft + scrollWidth
   * to drive the mask-image gradient-fade indicator.
   */
  updateOverflowClasses(): void {
    const container = this.tabsContainer()?.nativeElement;
    if (!container) return;

    const tolerance = 4; // px — avoid jitter at exact boundaries
    const hasStart = container.scrollLeft > tolerance;
    const hasEnd =
      container.scrollWidth - container.clientWidth - container.scrollLeft >
      tolerance;

    container.classList.toggle('has-overflow-start', hasStart);
    container.classList.toggle('has-overflow-end', hasEnd);
    // 'has-overflow-both' is the union; both masks layered via CSS.
    container.classList.toggle('has-overflow-both', hasStart && hasEnd);
  }

  private resizeObserver?: ResizeObserver;

  /**
   * Set up a ResizeObserver + initial measurement so the fade gradient
   * tracks content size changes (font-load, lazy tabs, orientation, etc.).
   */
  private setupOverflowIndicators(): void {
    const container = this.tabsContainer()?.nativeElement;
    if (!container) return;

    this.updateOverflowClasses();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.updateOverflowClasses());
      this.resizeObserver.observe(container);
    }
  }

  private cleanupOverflowIndicators(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
  }

  /**
   * Roving-tabindex keyboard navigation. Mirrors the WAI-ARIA tablist
   * pattern: ArrowLeft/Right move between tabs, Home/End jump to the
   * first/last. The active tab keeps tabindex=0; the others -1.
   */
  onTabsKeydown(event: KeyboardEvent): void {
    const container = this.tabsContainer()?.nativeElement;
    if (!container) return;

    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('.tab-item'),
    );
    if (tabs.length === 0) return;

    const currentIndex = tabs.indexOf(
      document.activeElement as HTMLElement | null as HTMLElement,
    );
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    tabs[nextIndex].focus();
  }
}
