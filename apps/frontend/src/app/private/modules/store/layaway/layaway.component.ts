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
import * as LayawayActions from './state/actions/layaway.actions';
import {
  selectLayaways,
  selectLayawaysLoading,
  selectStats,
  selectLayawaysMeta,
} from './state/selectors/layaway.selectors';
import { LayawayPlan } from './interfaces/layaway.interface';
import { CurrencyFormatService, CurrencyPipe } from '../../../../shared/pipes/currency';
import { LayawayPrintService } from './services/layaway-print.service';
import {
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../shared/components/responsive-data-view/responsive-data-view.component';

@Component({
  selector: 'app-layaway',
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
  templateUrl: './layaway.component.html',
  styleUrls: ['./layaway.component.scss'],
})
export class LayawayComponent implements OnInit {
  private store = inject(Store);
  private router = inject(Router);
  private currencyService = inject(CurrencyFormatService);
  private printService = inject(LayawayPrintService);

  layaways = this.store.selectSignal(selectLayaways);
  loading = this.store.selectSignal(selectLayawaysLoading);
  stats = this.store.selectSignal(selectStats);
  meta = this.store.selectSignal(selectLayawaysMeta);

  columns: TableColumn[] = [
    { key: 'plan_number', label: 'Plan #', sortable: true, priority: 1 },
    {
      key: 'customer',
      label: 'Cliente',
      priority: 1,
      transform: (val: any) =>
        val ? `${val.first_name} ${val.last_name}` : '-',
    },
    {
      key: 'total_amount',
      label: 'Total',
      priority: 2,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'paid_amount',
      label: 'Pagado',
      priority: 3,
      transform: (val: any, row: any) => {
        const pct =
          row.total_amount > 0
            ? Math.round((Number(val) / Number(row.total_amount)) * 100)
            : 0;
        return `${this.currencyService.format(Number(val) || 0)} (${pct}%)`;
      },
    },
    {
      key: 'remaining_amount',
      label: 'Pendiente',
      priority: 2,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'state',
      label: 'Estado',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          active: '#3b82f6',
          completed: '#22c55e',
          cancelled: '#9ca3af',
          overdue: '#ef4444',
          defaulted: '#ef4444',
        },
      },
      transform: (val: string) => {
        const labels: Record<string, string> = {
          active: 'Activo',
          completed: 'Completado',
          cancelled: 'Cancelado',
          overdue: 'Vencido',
          defaulted: 'Incumplido',
        };
        return labels[val] || val;
      },
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'plan_number',
    subtitleKey: 'customer',
    subtitleTransform: (val: any) =>
      val ? `${val.first_name} ${val.last_name}` : '-',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        active: '#3b82f6',
        completed: '#22c55e',
        cancelled: '#9ca3af',
        overdue: '#ef4444',
        defaulted: '#ef4444',
      },
    },
    badgeTransform: (val: string) => {
      const labels: Record<string, string> = {
        active: 'Activo',
        completed: 'Completado',
        cancelled: 'Cancelado',
        overdue: 'Vencido',
        defaulted: 'Incumplido',
      };
      return labels[val] || val;
    },
    detailKeys: [
      {
        key: 'total_amount',
        label: 'Total',
        transform: (v: any) => this.currencyService.format(Number(v) || 0),
      },
      {
        key: 'paid_amount',
        label: 'Pagado',
        transform: (v: any) => this.currencyService.format(Number(v) || 0),
      },
    ],
    footerKey: 'remaining_amount',
    footerLabel: 'Pendiente',
    footerStyle: 'prominent' as const,
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
  };

  actions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      variant: 'secondary',
      action: (item: LayawayPlan) =>
        this.router.navigate(['/admin/orders/layaway', item.id]),
    },
    {
      label: 'Imprimir',
      icon: 'printer',
      variant: 'info',
      action: (item: LayawayPlan) => this.printService.printLayawayPlan(item),
      show: (item: LayawayPlan) => item.state !== 'cancelled',
    },
  ];

  ngOnInit() {
    this.store.dispatch(LayawayActions.loadLayaways());
    this.store.dispatch(LayawayActions.loadStats());
  }

  onSearch(search: string) {
    this.store.dispatch(LayawayActions.setSearch({ search }));
  }

  onPageChange(page: number) {
    this.store.dispatch(LayawayActions.setPage({ page }));
  }

  onSort(event: { sort_by: string; sort_order: 'asc' | 'desc' }) {
    this.store.dispatch(LayawayActions.setSort(event));
  }

  openCreateModal() {
    this.router.navigate(['/admin/pos'], { queryParams: { mode: 'layaway' } });
  }
}
