import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterModule, ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';

import {
  StickyHeaderActionButton,
  StickyHeaderComponent,
} from '../../../../shared/components/index';

@Component({
  selector: 'vendix-org-invoicing',
  standalone: true,
  imports: [RouterModule, StickyHeaderComponent],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Facturación"
        subtitle="Facturas, resoluciones y configuración DIAN"
        icon="receipt"
        variant="glass"
        badgeText="Fiscal"
        badgeColor="blue"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <router-outlet />
    </div>
  `,
})
export class OrgInvoicingComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly activeSection = computed(() => {
    const url = this.currentUrl();
    if (url.includes('/resolutions')) return 'resolutions';
    if (url.includes('/dian-config')) return 'dian-config';
    return 'invoices';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const active = this.activeSection();
    return [
      {
        id: 'invoices',
        label: 'Facturas',
        icon: 'receipt',
        variant: active === 'invoices' ? 'primary' : 'outline',
      },
      {
        id: 'resolutions',
        label: 'Resoluciones',
        icon: 'hash',
        variant: active === 'resolutions' ? 'primary' : 'outline',
      },
      {
        id: 'dian-config',
        label: 'DIAN',
        icon: 'settings',
        variant: active === 'dian-config' ? 'primary' : 'outline',
      },
    ];
  });

  onHeaderAction(actionId: string): void {
    this.router.navigate([actionId], {
      relativeTo: this.route,
      queryParamsHandling: 'preserve',
    });
  }
}
