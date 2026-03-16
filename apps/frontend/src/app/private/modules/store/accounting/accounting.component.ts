import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Store } from '@ngrx/store';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

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
export class AccountingComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.store.dispatch(loadAccounts());
    this.store.dispatch(loadFiscalPeriods());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
