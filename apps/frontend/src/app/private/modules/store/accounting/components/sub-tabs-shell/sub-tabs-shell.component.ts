import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';

import {
  ScrollableTab,
  ScrollableTabsComponent,
} from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';

/**
 * Optional page header for parents with no sticky header of their own. When
 * set, the sub-tabs are the view's first tab row (navigation layer 3), so they
 * render as `app-sticky-header` tabs instead of the `app-scrollable-tabs`
 * sub-row reserved for layer 4.
 */
export interface AccountingSubTabsHeader {
  title: string;
  subtitle?: string;
  icon?: string;
}

/** Sub-tab definition consumed by {@link AccountingSubTabsShellComponent}. */
export interface AccountingSubTab extends ScrollableTab {
  /** Absolute route the sub-tab navigates to. */
  route: string;
}

/**
 * Lightweight route-driven shell for accounting super-tabs (Configuración,
 * Cartera, Impuestos). Renders an internal sub-tab row + `<router-outlet>`
 * below the module's persistent sticky-header, mirroring the children-routes
 * pattern already used by `reports/` and `consolidation/`.
 *
 * Route `data` contract (set on the shell's parent route):
 * - `subTabs: AccountingSubTab[]` — ordered sub-tabs; each `route` is absolute.
 * - `subTabsAriaLabel?: string`   — accessible label for the tab row.
 * - `subTabsHeader?: AccountingSubTabsHeader` — set it when the parent has no
 *   sticky header: the tabs then render in an `app-sticky-header` (layer 3).
 */
@Component({
  selector: 'vendix-accounting-sub-tabs-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ScrollableTabsComponent, StickyHeaderComponent],
  template: `
    <div class="w-full">
      @if (header(); as h) {
        <app-sticky-header
          [title]="h.title"
          [subtitle]="h.subtitle ?? ''"
          [icon]="h.icon ?? 'book-open'"
          [tabs]="headerTabs()"
          [activeTab]="activeTabId()"
          [tabsAriaLabel]="ariaLabel()"
          (tabChanged)="onTabChange($event)"
        />
      } @else {
        <div class="mb-4 border-b border-border">
          <app-scrollable-tabs
            [tabs]="tabs()"
            [activeTab]="activeTabId()"
            size="sm"
            [ariaLabel]="ariaLabel()"
            (tabChange)="onTabChange($event)"
          />
        </div>
      }
      <router-outlet />
    </div>
  `,
})
export class AccountingSubTabsShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly data = toSignal(this.route.data, {
    initialValue: this.route.snapshot.data,
  });

  readonly tabs = computed<AccountingSubTab[]>(
    () => (this.data()?.['subTabs'] as AccountingSubTab[]) ?? [],
  );

  readonly header = computed<AccountingSubTabsHeader | null>(
    () => (this.data()?.['subTabsHeader'] as AccountingSubTabsHeader) ?? null,
  );

  /**
   * State tabs (no `route`): navigation stays in {@link onTabChange} so the
   * query params are preserved exactly as with the scrollable sub-row.
   */
  readonly headerTabs = computed<StickyHeaderTab[]>(() =>
    this.tabs().map(({ id, label, icon }) => ({ id, label, icon })),
  );

  readonly ariaLabel = computed<string>(
    () => (this.data()?.['subTabsAriaLabel'] as string) ?? 'Sub-secciones',
  );

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly activeTabId = computed<string>(() => {
    const url = this.currentUrl().split('?')[0];
    const match = this.tabs().find(
      (tab) => url === tab.route || url.startsWith(`${tab.route}/`),
    );
    return match?.id ?? this.tabs()[0]?.id ?? '';
  });

  onTabChange(tabId: string): void {
    const target = this.tabs().find((tab) => tab.id === tabId);
    if (target?.route) {
      // Preserve query params (e.g. the org shell's `store_id` fiscal-scope
      // filter) when switching between sibling sub-tabs.
      void this.router.navigate([target.route], {
        queryParamsHandling: 'preserve',
      });
    }
  }
}
