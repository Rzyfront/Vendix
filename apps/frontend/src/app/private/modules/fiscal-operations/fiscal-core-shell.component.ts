import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
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
import { IconComponent } from '../../../shared/components/icon/icon.component';
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
    icon: 'lock',
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
    icon: 'history',
    route: '/admin/fiscal/history',
  },
  {
    id: 'rules',
    label: 'Reglas',
    shortLabel: 'Reglas',
    icon: 'book',
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
    RouterLink,
    StickyHeaderComponent,
    FiscalManagementPanelComponent,
    IconComponent,
  ],
  template: `
    <section class="fiscal-shell">
      <app-sticky-header
        title="Manejo fiscal"
        [subtitle]="headerSubtitle()"
        icon="settings"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin"
        [actions]="showActivation() ? [] : headerActions()"
        [tabs]="showActivation() ? [] : stickyHeaderTabs()"
        [activeTab]="activeTabId()"
        tabsAriaLabel="Secciones fiscales"
        (actionClicked)="onActionClicked($event)"
        (tabChanged)="onTabChanged($event)"
      ></app-sticky-header>

      <div class="fiscal-shell__body">
        @if (showActivation()) {
          <div class="fiscal-shell__activation">
            <div class="activation-cta">
              <app-icon name="shield-check" size="22" class="activation-cta__icon" />
              <div class="activation-cta__copy">
                <h2>Activa tus áreas fiscales</h2>
                <p>
                  Aún no tienes áreas fiscales en operación. Configúralas para
                  empezar a manejar facturación, contabilidad o nómina.
                </p>
              </div>
              <a
                class="activation-cta__button"
                routerLink="/admin/fiscal/wizard"
                aria-label="Iniciar activación fiscal"
              >
                <app-icon name="sparkles" size="18" />
                <span>Iniciar activación</span>
              </a>
            </div>

            <app-fiscal-management-panel />
          </div>
        } @else {
          <router-outlet />
        }
      </div>
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

      .fiscal-shell__activation {
        width: min(1120px, 100%);
        margin: 0 auto;
        padding: 0 0 2rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .activation-cta {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.6rem;
        background: var(--surface-color, #ffffff);
        padding: 1rem 1.25rem;
      }

      .activation-cta__icon {
        flex: 0 0 auto;
        color: var(--primary-color, #2563eb);
        background: color-mix(in srgb, var(--primary-color, #2563eb) 10%, transparent);
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.5rem;
        display: grid;
        place-items: center;
      }

      .activation-cta__copy {
        flex: 1 1 18rem;
        min-width: 0;
      }

      .activation-cta__copy h2 {
        margin: 0;
        font-size: 1.05rem;
        color: var(--text-primary, #111827);
      }

      .activation-cta__copy p {
        margin: 0.25rem 0 0;
        font-size: 0.9rem;
        color: var(--text-secondary, #4b5563);
        line-height: 1.35rem;
      }

      .activation-cta__button {
        min-height: 2.75rem;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.55rem 1.1rem;
        border-radius: 0.5rem;
        border: 1px solid var(--primary-color, #2563eb);
        background: var(--primary-color, #2563eb);
        color: #ffffff;
        font-weight: 700;
        font-size: 0.92rem;
        text-decoration: none;
        cursor: pointer;
        transition: transform 0.12s ease, box-shadow 0.12s ease;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      }

      .activation-cta__button:hover {
        box-shadow: 0 4px 14px color-mix(in srgb, var(--primary-color, #2563eb) 30%, transparent);
        transform: translateY(-1px);
      }

      .activation-cta__button:focus-visible {
        outline: 2px solid var(--primary-color, #2563eb);
        outline-offset: 2px;
      }

      @media (max-width: 640px) {
        .activation-cta {
          flex-direction: column;
          align-items: flex-start;
        }

        .activation-cta__button {
          width: 100%;
          justify-content: center;
        }
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

  readonly headerSubtitle = computed<string>(() =>
    this.showActivation()
      ? 'Configuración inicial'
      : 'Operación fiscal',
  );

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
