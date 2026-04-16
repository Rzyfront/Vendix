import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Store } from '@ngrx/store';

import {
  loadAccounts,
  loadFiscalPeriods,
} from './state/actions/accounting.actions';

@Component({
  selector: 'vendix-accounting',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="w-full">
      <router-outlet></router-outlet>
    </div>
  `,
})
export class AccountingComponent {
  private store = inject(Store);

  constructor() {
    this.store.dispatch(loadAccounts());
    this.store.dispatch(loadFiscalPeriods());
  }
}
