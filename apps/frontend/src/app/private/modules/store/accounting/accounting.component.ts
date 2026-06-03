import { Component, inject } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { Store } from '@ngrx/store';

import {
  loadAccounts,
  loadFiscalPeriods,
} from './state/actions/accounting.actions';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'vendix-accounting',
  standalone: true,
  imports: [RouterModule, IconComponent],
  template: `
    <div class="w-full">
      <div class="flex justify-end px-2 md:px-6 py-2">
        <button
          (click)="goToReports()"
          class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-primary border border-border rounded-lg hover:bg-surface transition-colors"
        >
          <app-icon name="file-text" [size]="16" />
          Ver Reportes
        </button>
      </div>
      <router-outlet></router-outlet>
    </div>
  `,
})
export class AccountingComponent {
  private store = inject(Store);
  private router = inject(Router);

  constructor() {
    this.store.dispatch(loadAccounts());
    this.store.dispatch(loadFiscalPeriods());
  }

  goToReports(): void {
    this.router.navigateByUrl('/admin/reports/accounting/trial-balance');
  }
}
