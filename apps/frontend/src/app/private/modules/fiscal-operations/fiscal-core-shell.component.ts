import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';

import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { FiscalArea } from '../../../core/models/fiscal-status.model';
import { FiscalManagementPanelComponent } from '../../../shared/components/fiscal-management-panel/fiscal-management-panel.component';
import {
  StickyHeaderActionButton,
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../shared/components/sticky-header/sticky-header.component';
import { FiscalOperationsHeaderActionsService } from './services/fiscal-operations-header-actions.service';
import { FiscalApiScope } from './interfaces/fiscal-operations.interface';

type FiscalTabId =
  | 'dashboard'
  | 'identity'
  | 'obligations'
  | 'declarations'
  | 'close'
  | 'audit'
  | 'rules';

interface TabDefinition {
  id: FiscalTabId;
  label: string;
  shortLabel: string;
  icon: string;
  /** Prefijo de ruta. El shell lo combina con la base según el scope. */
  routeSuffix: string;
}

const TAB_DEFINITIONS: TabDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Inicio',
    icon: 'layout-dashboard',
    routeSuffix: 'dashboard',
  },
  {
    id: 'identity',
    label: 'Identidad',
    shortLabel: 'Ident.',
    icon: 'landmark',
    routeSuffix: 'identity',
  },
  {
    id: 'obligations',
    label: 'Obligaciones',
    shortLabel: 'Oblig.',
    icon: 'calendar-days',
    routeSuffix: 'obligations',
  },
  {
    id: 'declarations',
    label: 'Declaraciones',
    shortLabel: 'Decl.',
    icon: 'file-spreadsheet',
    routeSuffix: 'declarations',
  },
  {
    id: 'close',
    label: 'Cierre',
    shortLabel: 'Cierre',
    icon: 'check-square',
    routeSuffix: 'close',
  },
  {
    id: 'audit',
    label: 'Auditoría',
    shortLabel: 'Audit.',
    icon: 'shield-check',
    routeSuffix: 'audit',
  },
  {
    id: 'rules',
    label: 'Reglas',
    shortLabel: 'Reglas',
    icon: 'file-text',
    routeSuffix: 'rules',
  },
];

/** Prefijo absoluto donde el shell está montado, según el `fiscalApiScope`. */
function basePrefixForScope(scope: FiscalApiScope): string {
  return scope === 'platform' ? '/super-admin/fiscal' : '/admin/fiscal';
}

/**
 * Single entry-point for the fiscal module.
 *
 * Renders either the *activation layer* (`FiscalManagementPanel` +
 * wizard CTA) when no fiscal area is in ACTIVE/LOCKED state, or the
 * *operation layer* (6 fiscal tabs + sticky-header) when at least one
 * area is already active. The decision is reactive — it follows the
 * `fiscalStatus` signal exposed by `AuthFacade`.
 */
@Component({
  selector: 'app-fiscal-core-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    StickyHeaderComponent,
    FiscalManagementPanelComponent,
  ],
  template: `
    <section class="fiscal-shell">
      @if (onChildActivationRoute()) {
        <!-- Wizard / panel de activación: traen su propio app-sticky-header,
             así que el shell solo presta el outlet (evita header duplicado). -->
        <div class="fiscal-shell__body">
          <router-outlet />
        </div>
      } @else if (showActivation()) {
        <!-- Sin áreas fiscales activas: el panel de manejo fiscal es el
             empty-state guiado (sus tarjetas por área ya enlazan al wizard).
             Va directo al slot, SIN wrapper con padding/CTA encima, para que
             su app-sticky-header quede pegado a la parte superior del slot. -->
        <app-fiscal-management-panel />
      } @else {
        <!-- Capa OPERACIÓN: el shell es dueño del sticky-header con tabs. -->
        <app-sticky-header
          [title]="shellTitle()"
          [subtitle]="shellTitle()"
          icon="file-check"
          variant="glass"
          [showBackButton]="true"
          [backRoute]="backRoute()"
          [actions]="headerActions()"
          [tabs]="stickyHeaderTabs()"
          [activeTab]="activeTabId()"
          tabsAriaLabel="Secciones fiscales"
          (actionClicked)="onActionClicked($event)"
          (tabChanged)="onTabChanged($event)"
        ></app-sticky-header>

        <div class="fiscal-shell__body">
          <router-outlet />
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .fiscal-shell {
        width: 100%;
        min-height: 100%;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .fiscal-shell__body {
        width: 100%;
      }
    `,
  ],
})
export class FiscalCoreShellComponent {
  private readonly authFacade = inject(AuthFacade);
  private readonly headerActionsBus = inject(FiscalOperationsHeaderActionsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly fiscalStatus = this.authFacade.fiscalStatus;
  private readonly activeFiscalAreas = this.authFacade.activeFiscalAreas;

  /**
   * `true` when no fiscal area has reached ACTIVE/LOCKED state — i.e.
   * the store/org still needs to walk the activation wizard. The
   * signal treats a `null` fiscal status (settings never loaded) the
   * same as all-INACTIVE so the activation layer shows by default.
   *
   * El scope `platform` SIEMPRE opera (su bootstrap es de sistema, no
   * requiere activación), así que se omite la capa de activación.
   */
  readonly showActivation = computed<boolean>(() => {
    if (this.scope() === 'platform') return false;
    const active = this.activeFiscalAreas();
    if (Array.isArray(active) && active.length > 0) return false;
    const status = this.fiscalStatus();
    if (!status) return true;
    const FISCAL_AREAS: FiscalArea[] = ['invoicing', 'accounting', 'payroll'];
    return FISCAL_AREAS.every(
      (area) => status[area]?.state !== 'ACTIVE' && status[area]?.state !== 'LOCKED',
    );
  });

  /** Título del sticky-header: tenants ven "Operación fiscal", plataforma ve "Fiscal Vendix". */
  readonly shellTitle = computed<string>(() =>
    this.scope() === 'platform' ? 'Fiscal Vendix' : 'Operación fiscal',
  );

  /** Ruta de retorno del botón "atrás" del sticky-header. */
  readonly backRoute = computed<string>(() =>
    this.scope() === 'platform' ? '/super-admin/dashboard' : '/admin',
  );

  /** Scope leído del route data `fiscalApiScope` (default = 'store'). */
  readonly scope = computed<FiscalApiScope>(() => {
    const value = this.route.pathFromRoot
      .map((r) => r.snapshot.data['fiscalApiScope'])
      .find(
        (v) => v === 'store' || v === 'organization' || v === 'platform',
      );
    return (value as FiscalApiScope | undefined) ?? 'store';
  });

  readonly stickyHeaderTabs = computed<StickyHeaderTab[]>(() => {
    const base = basePrefixForScope(this.scope());
    return TAB_DEFINITIONS.map((tab) => ({
      id: tab.id,
      label: tab.label,
      shortLabel: tab.shortLabel,
      icon: tab.icon,
      route: `${base}/${tab.routeSuffix}`,
      exact: tab.id === 'dashboard',
    }));
  });

  readonly headerActionsList = signal<StickyHeaderActionButton[]>([
    {
      id: 'refresh',
      label: 'Actualizar',
      variant: 'outline',
      icon: 'refresh-cw',
    },
    {
      id: 'generate-obligations',
      label: 'Generar mes',
      variant: 'primary',
      icon: 'plus-circle',
    },
  ]);

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    // Refresh is always available; the working/loading state of the
    // concrete operations tab is surfaced via the service so we just
    // emit the action descriptors here.
    return this.headerActionsList();
  });

  /**
   * Active tab id derived from the current router URL. Lets the
   * sticky header highlight the right pill when the user navigates
   * between operations tabs.
   */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly activeTabId = computed<string>(() => {
    const url = this.currentUrl();
    const base = basePrefixForScope(this.scope());
    const match = TAB_DEFINITIONS.find((tab) => {
      const route = `${base}/${tab.routeSuffix}`;
      return url === route || url.startsWith(`${route}/`);
    });
    return match?.id ?? 'dashboard';
  });

  /**
   * `true` when the active child route is the wizard or the dedicated
   * activation panel. Those views own their `app-sticky-header`, so the
   * shell must yield the `<router-outlet>` instead of rendering its own
   * activation/operation chrome — otherwise navigating to `/wizard`
   * while no area is active would keep showing the inline activation
   * panel (the "clicking does nothing" bug) and stack two headers.
   *
   * En el scope `platform` las rutas de activación están registradas
   * (mismas que el tenant, para compartir la base) pero la plataforma
   * siempre opera, por lo que esta ruta es inalcanzable en flujo normal.
   * Aún así se protege contra deep-links para evitar el bug de doble
   * sticky-header.
   */
  readonly onChildActivationRoute = computed<boolean>(() => {
    const url = this.currentUrl();
    const base = basePrefixForScope(this.scope());
    return (
      url.startsWith(`${base}/wizard`) ||
      url.startsWith(`${base}/activation`)
    );
  });

  constructor() {
    // The component is rendered as a router-outlet parent so its
    // lifecycle outlives the routed operations tabs. We don't need
    // any explicit teardown because the service is providedIn: 'root'.
    effect(() => {
      // Track showActivation to allow future per-layer side effects
      // (e.g. lazy-loading the activation panel only when needed).
      this.showActivation();
    });

    this.destroyRef.onDestroy(() => {
      this.headerActionsBus.unregister('refresh');
      this.headerActionsBus.unregister('generate-obligations');
    });
  }

  onActionClicked(actionId: string): void {
    if (this.showActivation()) return;
    this.headerActionsBus.trigger(actionId);
  }

  onTabChanged(tabId: string): void {
    const target = TAB_DEFINITIONS.find((tab) => tab.id === tabId);
    if (!target) return;
    const base = basePrefixForScope(this.scope());
    void this.router.navigateByUrl(`${base}/${target.routeSuffix}`);
  }
}
