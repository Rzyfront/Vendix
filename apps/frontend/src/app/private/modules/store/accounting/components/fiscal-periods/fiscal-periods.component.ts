import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';

import { FiscalPeriod } from '../../interfaces/accounting.interface';
import {
  selectFiscalPeriods,
  selectFiscalPeriodsLoading,
} from '../../state/selectors/accounting.selectors';
import { closeFiscalPeriod } from '../../state/actions/accounting.actions';
import { FiscalPeriodCreateComponent } from './fiscal-period-create/fiscal-period-create.component';
import {
  StatsComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  DropdownAction,
} from '../../../../../../shared/components/index';

interface PeriodStats {
  total: number;
  open: number;
  closing: number;
  closed: number;
}

@Component({
  selector: 'vendix-fiscal-periods',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    FiscalPeriodCreateComponent,
  ],
  template: `
    <div class="w-full">

      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        @if (stats$ | async; as stats) {
          <app-stats
            title="Total Periodos"
            [value]="stats.total"
            iconName="calendar"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Abiertos"
            [value]="stats.open"
            iconName="unlock"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="En Cierre"
            [value]="stats.closing"
            iconName="clock"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Cerrados"
            [value]="stats.closed"
            iconName="lock"
            iconBgColor="bg-gray-200"
            iconColor="text-gray-600"
            [clickable]="false"
          ></app-stats>
        }
      </div>

      <!-- Unified Container: Header + Data -->
      <div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)]
                  md:border md:border-border md:min-h-[400px]">

        <!-- Header -->
        <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                    md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border">
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide
                       md:text-lg md:font-semibold md:text-text-primary">
              Periodos Fiscales ({{ (periods$ | async)?.length || 0 }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [actions]="dropdown_actions"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Data Content -->
        <div class="relative p-2 md:p-4">
          <app-responsive-data-view
            [data]="(periods$ | async) || []"
            [columns]="columns"
            [cardConfig]="card_config"
            [actions]="table_actions"
            [loading]="(loading$ | async) || false"
            emptyMessage="No se encontraron periodos fiscales"
            emptyIcon="calendar"
          ></app-responsive-data-view>
        </div>
      </div>

      <!-- Create Modal -->
      <vendix-fiscal-period-create
        [(isOpen)]="is_create_modal_open"
      ></vendix-fiscal-period-create>
    </div>
  `,
})
export class FiscalPeriodsComponent implements OnInit {
  private store = inject(Store);

  periods$: Observable<FiscalPeriod[]> = this.store.select(selectFiscalPeriods);
  loading$: Observable<boolean> = this.store.select(selectFiscalPeriodsLoading);

  stats$: Observable<PeriodStats> = this.periods$.pipe(
    map((periods) => ({
      total: periods.length,
      open: periods.filter((p) => p.status === 'open').length,
      closing: periods.filter((p) => p.status === 'closing').length,
      closed: periods.filter((p) => p.status === 'closed').length,
    })),
  );

  is_create_modal_open = false;

  dropdown_actions: DropdownAction[] = [
    { label: 'Nuevo Periodo', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'start_date',
      label: 'Fecha Inicio',
      priority: 1,
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : ''),
    },
    {
      key: 'end_date',
      label: 'Fecha Fin',
      priority: 2,
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : ''),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          open: 'success',
          closing: 'warn',
          closed: 'neutral',
        },
      },
      transform: (val: any) => this.getStatusLabel(val),
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Cerrar',
      icon: 'lock',
      variant: 'secondary',
      action: (row: FiscalPeriod) => this.onClose(row),
      show: (row: FiscalPeriod) => row.status === 'open',
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'name',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        open: 'success',
        closing: 'warn',
        closed: 'neutral',
      },
    },
    badgeTransform: (val: any) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'start_date',
        label: 'Inicio',
        icon: 'calendar',
        transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
      },
      {
        key: 'end_date',
        label: 'Fin',
        icon: 'calendar',
        transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
      },
    ],
  };

  ngOnInit(): void {
    // Fiscal periods already loaded by parent AccountingComponent
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.is_create_modal_open = true;
    }
  }

  onClose(period: FiscalPeriod): void {
    if (
      confirm(
        `¿Estás seguro de que deseas cerrar "${period.name}"? Esta acción no se puede deshacer.`,
      )
    ) {
      this.store.dispatch(closeFiscalPeriod({ id: period.id }));
    }
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      open: 'Abierto',
      closing: 'En Cierre',
      closed: 'Cerrado',
    };
    return labels[status] || status;
  }
}
