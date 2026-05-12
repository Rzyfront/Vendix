import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OrgFiscalScopeSelectorComponent } from '../shared/components/org-fiscal-scope-selector.component';

/**
 * Org-scoped accounting shell.
 * Hosts read-only sub-pages consuming /api/organization/accounting/*.
 */
@Component({
  selector: 'vendix-org-accounting',
  standalone: true,
  imports: [RouterModule, OrgFiscalScopeSelectorComponent],
  template: `
    <div class="w-full">
      <app-org-fiscal-scope-selector
        [selectedStoreId]="selectedStoreId()"
        (storeChange)="onFiscalStoreChange($event)"
      />
      <router-outlet></router-outlet>
    </div>
  `,
})
export class OrgAccountingComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly selectedStoreId = signal<number | null>(null);

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const raw = params.get('store_id');
        const storeId = raw ? Number(raw) : null;
        this.selectedStoreId.set(Number.isFinite(storeId) ? storeId : null);
      });
  }

  onFiscalStoreChange(storeId: number | null): void {
    this.selectedStoreId.set(storeId);
    this.syncStoreQueryParam(storeId);
  }

  private syncStoreQueryParam(storeId: number | null): void {
    this.router.navigate([], {
      queryParams: { store_id: storeId || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
