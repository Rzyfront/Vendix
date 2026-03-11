import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';

import { JournalEntry } from '../../interfaces/accounting.interface';
import {
  selectEntries,
  selectEntriesLoading,
  selectEntriesMeta,
  selectPage,
} from '../../state/selectors/accounting.selectors';
import * as AccountingActions from '../../state/actions/accounting.actions';
import { JournalEntryCreateComponent } from './journal-entry-create/journal-entry-create.component';
import { JournalEntryDetailComponent } from './journal-entry-detail/journal-entry-detail.component';
import {
  InputsearchComponent,
  StatsComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  FilterConfig,
  DropdownAction,
  FilterValues,
} from '../../../../../../shared/components/index';

interface EntryStats {
  total: number;
  draft: number;
  posted: number;
  voided: number;
}

@Component({
  selector: 'vendix-journal-entries',
  standalone: true,
  imports: [
    CommonModule,
    InputsearchComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    JournalEntryCreateComponent,
    JournalEntryDetailComponent,
  ],
  template: `
    <div class="w-full">

      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        @if (stats$ | async; as stats) {
          <app-stats
            title="Total Asientos"
            [value]="stats.total"
            iconName="file-text"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Borradores"
            [value]="stats.draft"
            iconName="edit"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Contabilizados"
            [value]="stats.posted"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Anulados"
            [value]="stats.voided"
            iconName="x-circle"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
            [clickable]="false"
          ></app-stats>
        }
      </div>

      <!-- Unified Container: Search Header + Data -->
      <div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)]
                  md:border md:border-border md:min-h-[400px]">

        <!-- Search Header -->
        <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                    md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border">
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide
                       md:text-lg md:font-semibold md:text-text-primary">
              Asientos Contables ({{ (entries$ | async)?.length || 0 }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar asientos..."
                [debounceTime]="300"
                (searchChange)="onSearchChange($event)"
              ></app-inputsearch>
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filter_configs"
                [actions]="dropdown_actions"
                (filterChange)="onFilterChange($event)"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Data Content -->
        <div class="relative p-2 md:p-4">
          <app-responsive-data-view
            [data]="(entries$ | async) || []"
            [columns]="columns"
            [cardConfig]="card_config"
            [actions]="table_actions"
            [loading]="(loading$ | async) || false"
            emptyMessage="No se encontraron asientos contables"
            emptyIcon="file-text"
            (rowClick)="onRowClick($event)"
          ></app-responsive-data-view>
        </div>
      </div>

      <!-- Pagination -->
      @if (meta$ | async; as meta) {
        @if (meta && meta.totalPages > 1) {
          <div class="mt-4 flex justify-center">
            <app-pagination
              [currentPage]="(page$ | async) || 1"
              [totalPages]="meta.totalPages"
              [total]="meta.total"
              (pageChange)="onPageChange($event)"
            ></app-pagination>
          </div>
        }
      }

      <!-- Create Modal -->
      <vendix-journal-entry-create
        [(isOpen)]="is_create_modal_open"
      ></vendix-journal-entry-create>

      <!-- Detail Modal -->
      <vendix-journal-entry-detail
        [(isOpen)]="is_detail_modal_open"
        [entry]="selected_entry"
      ></vendix-journal-entry-detail>
    </div>
  `,
})
export class JournalEntriesComponent implements OnInit {
  private store = inject(Store);

  entries$: Observable<JournalEntry[]> = this.store.select(selectEntries);
  loading$: Observable<boolean> = this.store.select(selectEntriesLoading);
  meta$ = this.store.select(selectEntriesMeta);
  page$ = this.store.select(selectPage);

  // Stats computed from entries
  stats$: Observable<EntryStats> = this.entries$.pipe(
    map((entries) => ({
      total: entries.length,
      draft: entries.filter((e) => e.status === 'draft').length,
      posted: entries.filter((e) => e.status === 'posted').length,
      voided: entries.filter((e) => e.status === 'voided').length,
    })),
  );

  is_create_modal_open = false;
  is_detail_modal_open = false;
  selected_entry: JournalEntry | null = null;
  filter_values: FilterValues = {};

  filter_configs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'posted', label: 'Contabilizado' },
        { value: 'voided', label: 'Anulado' },
      ],
    },
  ];

  dropdown_actions: DropdownAction[] = [
    { label: 'Nuevo Asiento', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'primary',
      action: (row: JournalEntry) => this.viewEntry(row),
    },
  ];

  columns: TableColumn[] = [
    { key: 'entry_number', label: 'Número', sortable: true, priority: 1 },
    { key: 'entry_date', label: 'Fecha', sortable: true, priority: 1,
      transform: (val: any) => val ? new Date(val).toLocaleDateString() : '' },
    { key: 'entry_type', label: 'Tipo', priority: 2 },
    { key: 'description', label: 'Descripción', sortable: true, priority: 2 },
    { key: 'total_debit', label: 'Débito', sortable: true, align: 'right', priority: 1,
      transform: (val: any) => val ? `$${Number(val).toFixed(2)}` : '$0.00' },
    { key: 'total_credit', label: 'Crédito', sortable: true, align: 'right', priority: 1,
      transform: (val: any) => val ? `$${Number(val).toFixed(2)}` : '$0.00' },
    { key: 'status', label: 'Estado', align: 'center', priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          draft: 'warn',
          posted: 'success',
          voided: 'danger',
        },
      },
      transform: (val: any) => this.getStatusLabel(val),
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'entry_number',
    subtitleKey: 'description',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        draft: 'warn',
        posted: 'success',
        voided: 'danger',
      },
    },
    badgeTransform: (val: any) => this.getStatusLabel(val),
    footerKey: 'total_debit',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (val: any) => `$${Number(val).toFixed(2)}`,
    detailKeys: [
      { key: 'entry_date', label: 'Fecha', icon: 'calendar',
        transform: (val: any) => val ? new Date(val).toLocaleDateString() : '-' },
      { key: 'entry_type', label: 'Tipo', icon: 'tag' },
    ],
  };

  ngOnInit(): void {
    this.store.dispatch(AccountingActions.loadEntries());
  }

  onSearchChange(term: string): void {
    this.store.dispatch(AccountingActions.setSearch({ search: term }));
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values = { ...values };
    const status_filter = (values['status'] as string) || '';
    this.store.dispatch(AccountingActions.setStatusFilter({ status_filter }));
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.is_create_modal_open = true;
    }
  }

  onRowClick(entry: JournalEntry): void {
    this.viewEntry(entry);
  }

  viewEntry(entry: JournalEntry): void {
    this.selected_entry = entry;
    this.is_detail_modal_open = true;
  }

  onPageChange(page: number): void {
    this.store.dispatch(AccountingActions.setPage({ page }));
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      posted: 'Contabilizado',
      voided: 'Anulado',
    };
    return labels[status] || status;
  }
}
