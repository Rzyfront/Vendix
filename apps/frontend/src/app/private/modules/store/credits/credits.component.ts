import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Store } from '@ngrx/store';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputsearchComponent } from '../../../../shared/components/inputsearch/inputsearch.component';
import { ResponsiveDataViewComponent } from '../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { PaginationComponent } from '../../../../shared/components/pagination/pagination.component';
import * as CreditsActions from './state/actions/credits.actions';
import {
  selectCredits,
  selectCreditsLoading,
  selectStats,
  selectCreditsMeta,
} from './state/selectors/credits.selectors';
import { Credit } from './interfaces/credit.interface';
import { CurrencyFormatService, CurrencyPipe } from '../../../../shared/pipes/currency';
import {
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../shared/components/responsive-data-view/responsive-data-view.component';

@Component({
  selector: 'app-credits',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    IconComponent,
    PaginationComponent,
    CurrencyPipe,
  ],
  templateUrl: './credits.component.html',
  styleUrls: ['./credits.component.scss'],
})
export class CreditsComponent implements OnInit {
  private store = inject(Store);
  private router = inject(Router);
  private currencyService = inject(CurrencyFormatService);

  credits = this.store.selectSignal(selectCredits);
  loading = this.store.selectSignal(selectCreditsLoading);
  stats = this.store.selectSignal(selectStats);
  meta = this.store.selectSignal(selectCreditsMeta);

  columns: TableColumn[] = [
    { key: 'credit_number', label: 'Crédito #', sortable: true },
    {
      key: 'customer',
      label: 'Cliente',
      transform: (val: any) =>
        val ? `${val.first_name} ${val.last_name}` : '-',
    },
    {
      key: 'total_amount',
      label: 'Total',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'remaining_balance',
      label: 'Pendiente',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'installments',
      label: 'Próximo Vencimiento',
      transform: (val: any) => {
        if (!val || !val.length) return '-';
        const next = val.find(
          (i: any) => i.state === 'pending' || i.state === 'overdue',
        );
        if (!next) return '-';
        return new Date(next.due_date).toLocaleDateString('es', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
      },
    },
    {
      key: 'state',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          pending: 'gray',
          active: 'blue',
          paid: 'green',
          overdue: 'red',
          cancelled: 'gray',
          defaulted: 'red',
        },
      },
      transform: (val: string) => {
        const labels: Record<string, string> = {
          pending: 'Pendiente',
          active: 'Activo',
          paid: 'Pagado',
          overdue: 'Vencido',
          cancelled: 'Cancelado',
          defaulted: 'Incobrable',
        };
        return labels[val] || val;
      },
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'credit_number',
    subtitleKey: 'customer',
    subtitleTransform: (val: any) =>
      val ? `${val.first_name} ${val.last_name}` : '-',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        pending: '#9ca3af',
        active: '#3b82f6',
        paid: '#22c55e',
        overdue: '#ef4444',
        cancelled: '#9ca3af',
        defaulted: '#ef4444',
      },
    },
    badgeTransform: (val: string) => {
      const labels: Record<string, string> = {
        pending: 'Pendiente',
        active: 'Activo',
        paid: 'Pagado',
        overdue: 'Vencido',
        cancelled: 'Cancelado',
        defaulted: 'Incobrable',
      };
      return labels[val] || val;
    },
    detailKeys: [
      {
        key: 'total_amount',
        label: 'Total',
        transform: (v: any) => this.currencyService.format(Number(v) || 0),
      },
    ],
    footerKey: 'remaining_balance',
    footerLabel: 'Pendiente',
    footerStyle: 'prominent',
    footerTransform: (v: any) => this.currencyService.format(Number(v) || 0),
  };

  actions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      variant: 'primary',
      action: (item: Credit) =>
        this.router.navigate(['/admin/orders/credits', item.id]),
    },
  ];

  ngOnInit() {
    this.store.dispatch(CreditsActions.loadCredits());
    this.store.dispatch(CreditsActions.loadStats());
  }

  onSearch(search: string) {
    this.store.dispatch(CreditsActions.setSearch({ search }));
  }

  onPageChange(page: number) {
    this.store.dispatch(CreditsActions.setPage({ page }));
  }

  onSort(event: { sort_by: string; sort_order: 'asc' | 'desc' }) {
    this.store.dispatch(CreditsActions.setSort(event));
  }

  onRowClick(item: any) {
    this.router.navigate(['/admin/orders/credits', item.id]);
  }

  openCreateInPos() {
    this.router.navigate(['/admin/pos']);
  }
}
