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

type FiscalTabId =
  | 'dashboard'
  | 'obligations'
  | 'declarations'
  | 'close'
  | 'evidence'
  | 'history'
  | 'rules';

interface TabDefinition {
  id: FiscalTabId;
  label: string;
  shortLabel: string;
  icon: string;
  route: string;
}

const TAB_DEFINITIONS: TabDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Inicio',
    icon: 'layout-dashboard',
    route: '/admin/fiscal/dashboard',
  },
  {
    id: 'obligations',
    label: 'Obligaciones',
    shortLabel: 'Oblig.',
    icon: 'calendar-days',
    route: '/admin/fiscal/obligations',
  },
  {
    id: 'declarations',
    label: 'Declaraciones',
    shortLabel: 'Decl.',
    icon: 'file-spreadsheet',
    route: '/admin/fiscal/declarations',
  },
  {
    id: 'close',
    label: 'Cierre',
    shortLabel: 'Cierre',
    icon: 'check-square',
    route: '/admin/fiscal/close',
  },
  {
    id: 'evidence',
    label: 'Evidencias',
    shortLabel: 'Evid.',
    icon: 'folder-open',
    route: '/admin/fiscal/evidence',
  },
  {
    id: 'history',
    label: 'Historial',
    shortLabel: 'Hist.',
    icon: 'clipboard-list',
    route: '/admin/fiscal/history',
  },
  {
    id: 'rules',
    label: 'Reglas',
    shortLabel: 'Reglas',
    icon: 'file-text',
    route: '/admin/fiscal/rules',
  },
];

/**
 * Single entry-point for the fiscal module.
 *
 * Renders either the *activation layer* (`FiscalManagementPanel` +
 * wizard CTA) when no fiscal area is in ACTIVE/LOCKED state, or the
 * *operation layer* (7 fiscal tabs + sticky-header) when at least one
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
          title="Operación fiscal"
          subtitle="Operación fiscal"
          icon="file-check"
          variant="glass"
          [showBackButton]="true"
          backRoute="/admin"
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
   */
  readonly showActivation = computed<boolean>(() => {
    const active = this.activeFiscalAreas();
    if (Array.isArray(active) && active.length > 0) return false;
    const status = this.fiscalStatus();
    if (!status) return true;
    const FISCAL_AREAS: FiscalArea[] = ['invoicing', 'accounting', 'payroll'];
    return FISCAL_AREAS.every(
      (area) => status[area]?.state !== 'ACTIVE' && status[area]?.state !== 'LOCKED',
    );
  });

  readonly stickyHeaderTabs = computed<StickyHeaderTab[]>(() =>
    TAB_DEFINITIONS.map((tab) => ({
      id: tab.id,
      label: tab.label,
      shortLabel: tab.shortLabel,
      icon: tab.icon,
      route: tab.route,
      exact: tab.id === 'dashboard',
    })),
  );

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
    const match = TAB_DEFINITIONS.find(
      (tab) => url === tab.route || url.startsWith(`${tab.route}/`),
    );
    return match?.id ?? 'dashboard';
  });

  /**
   * `true` when the active child route is the wizard or the dedicated
   * activation panel. Those views own their `app-sticky-header`, so the
   * shell must yield the `<router-outlet>` instead of rendering its own
   * activation/operation chrome — otherwise navigating to `/wizard`
   * while no area is active would keep showing the inline activation
   * panel (the "clicking does nothing" bug) and stack two headers.
   */
  readonly onChildActivationRoute = computed<boolean>(() => {
    const url = this.currentUrl();
    return (
      url.startsWith('/admin/fiscal/wizard') ||
      url.startsWith('/admin/fiscal/activation')
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
    void this.router.navigateByUrl(target.route);
  }
}
