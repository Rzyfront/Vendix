import { Component, inject, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';

import { InvoiceResolution } from '../../interfaces/invoice.interface';
import {
  selectResolutions,
  selectResolutionsLoading,
} from '../../state/selectors/invoicing.selectors';
import * as InvoicingActions from '../../state/actions/invoicing.actions';
import { ResolutionCreateComponent } from './resolution-create/resolution-create.component';

import {
  CardComponent,
  StatsComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  InputsearchComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  DropdownAction,
} from '../../../../../../shared/components/index';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

interface ResolutionStats {
  total: number;
  active: number;
  expiringSoon: number;
  avgUsage: number;
}

type ResolutionStatus = 'expired' | 'exhausted' | 'expiring' | 'active' | 'inactive';

@Component({
  selector: 'vendix-resolutions-page',
  standalone: true,
  imports: [
    CardComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    InputsearchComponent,
    ResolutionCreateComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        @if (stats(); as s) {
          <app-stats
            title="Total Resoluciones"
            [value]="s.total"
            smallText="Resoluciones registradas"
            iconName="file-text"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Activas"
            [value]="s.active"
            smallText="En uso actualmente"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Por Vencer"
            [value]="s.expiringSoon"
            smallText="En los próximos 30 días"
            iconName="clock"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Consumo Promedio"
            [value]="s.avgUsage + '%'"
            smallText="Uso sobre el rango total"
            iconName="activity"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
            [clickable]="false"
          ></app-stats>
        }
      </div>

      <!-- Unified Container: Header + Data -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Header sticky -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              Resoluciones ({{ filteredResolutions().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar por prefijo o número..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              ></app-inputsearch>
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
            [data]="filteredResolutions()"
            [columns]="columns"
            [cardConfig]="card_config"
            [actions]="table_actions"
            [loading]="loading()"
            emptyMessage="No hay resoluciones configuradas"
            emptyIcon="file-text"
          ></app-responsive-data-view>
        </div>
      </app-card>

      <!-- Create/Edit Resolution Modal -->
      <vendix-resolution-create
        [(isOpen)]="is_create_modal_open"
        [resolution]="selected_resolution()"
      ></vendix-resolution-create>
    </div>
  `,
})
export class ResolutionsPageComponent {
  private store = inject(Store);

  // State via toSignal (con initialValue obligatorio)
  readonly resolutions = toSignal(this.store.select(selectResolutions), {
    initialValue: [] as InvoiceResolution[],
  });
  readonly loading = toSignal(this.store.select(selectResolutionsLoading), {
    initialValue: false,
  });

  // Local UI state
  readonly search_term = signal('');
  readonly is_create_modal_open = signal(false);
  readonly selected_resolution = signal<InvoiceResolution | null>(null);

  // Derivados
  readonly filteredResolutions = computed(() => {
    const term = this.search_term().trim().toLowerCase();
    const list = this.resolutions();
    if (!term) return list;
    return list.filter(
      (r) =>
        (r.prefix || '').toLowerCase().includes(term) ||
        (r.resolution_number || '').toLowerCase().includes(term),
    );
  });

  readonly stats = computed<ResolutionStats>(() => {
    const list = this.resolutions();
    const total = list.length;
    const now = Date.now();
    const in30d = now + 30 * 24 * 60 * 60 * 1000;

    let active = 0;
    let expiringSoon = 0;
    let usageSum = 0;
    let usageCount = 0;

    for (const r of list) {
      if (r.is_active) active++;

      const validTo = r.valid_to ? new Date(r.valid_to).getTime() : NaN;
      if (!isNaN(validTo) && validTo >= now && validTo <= in30d) {
        expiringSoon++;
      }

      const max = (r.range_to ?? 0) - (r.range_from ?? 0) + 1;
      const used = (r.current_number ?? r.range_from ?? 0) - (r.range_from ?? 0);
      if (max > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((used / max) * 100)));
        usageSum += pct;
        usageCount++;
      }
    }

    const avgUsage = usageCount > 0 ? Math.round(usageSum / usageCount) : 0;

    return { total, active, expiringSoon, avgUsage };
  });

  constructor() {
    // Despachar solo si no hay datos cargados (evita refetch innecesario)
    if (this.resolutions().length === 0 && !this.loading()) {
      this.store.dispatch(InvoicingActions.loadResolutions());
    }
  }

  dropdown_actions: DropdownAction[] = [
    {
      label: 'Nueva resolución',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  columns: TableColumn[] = [
    {
      key: 'prefix',
      label: 'Prefijo',
      sortable: true,
      priority: 1,
      transform: (_val: any, item?: InvoiceResolution) =>
        item ? `${item.prefix} · ${item.resolution_number}` : '',
    },
    {
      key: 'range_from',
      label: 'Rango',
      priority: 2,
      transform: (_val: any, item?: InvoiceResolution) =>
        item ? `${item.range_from} - ${item.range_to}` : '',
    },
    {
      key: 'valid_to',
      label: 'Vigencia',
      priority: 2,
      transform: (_val: any, item?: InvoiceResolution) => {
        if (!item) return '';
        const from = item.valid_from ? formatDateOnlyUTC(item.valid_from) : '-';
        const to = item.valid_to ? formatDateOnlyUTC(item.valid_to) : '-';
        return `${from} → ${to}`;
      },
    },
    {
      key: 'current_number',
      label: 'Consumo',
      align: 'center',
      priority: 2,
      transform: (_val: any, item?: InvoiceResolution) =>
        this.getUsageLabel(item),
    },
    {
      key: 'is_active',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          expired: 'danger',
          exhausted: 'danger',
          expiring: 'warn',
          active: 'success',
          inactive: 'neutral',
        },
      },
      transform: (_val: any, item?: InvoiceResolution) =>
        this.getStatusLabel(this.getResolutionStatus(item)),
      cellClass: (_val: any, item?: InvoiceResolution) => {
        const s = this.getResolutionStatus(item);
        return s || '';
      },
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (row: InvoiceResolution) => this.editResolution(row),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: InvoiceResolution) => this.onDeleteResolution(row.id),
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'prefix',
    titleTransform: (item: InvoiceResolution) =>
      `${item.prefix} · ${item.resolution_number}`,
    subtitleKey: 'range_from',
    subtitleTransform: (item: InvoiceResolution) =>
      `Rango ${item.range_from} - ${item.range_to}`,
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'status',
      colorMap: {
        expired: 'danger',
        exhausted: 'danger',
        expiring: 'warn',
        active: 'success',
        inactive: 'neutral',
      },
    },
    badgeTransform: (_val: any) => '',
    detailKeys: [
      {
        key: 'valid_from',
        label: 'Desde',
        icon: 'calendar',
        transform: (val: any) => (val ? formatDateOnlyUTC(val) : '-'),
      },
      {
        key: 'valid_to',
        label: 'Hasta',
        icon: 'calendar',
        transform: (val: any) => (val ? formatDateOnlyUTC(val) : '-'),
      },
      {
        key: 'current_number',
        label: 'Consumo',
        icon: 'activity',
        transform: (_val: any, item?: InvoiceResolution) =>
          this.getUsageLabel(item),
      },
    ],
  };

  onSearch(term: string): void {
    this.search_term.set(term ?? '');
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.selected_resolution.set(null);
      this.is_create_modal_open.set(true);
    }
  }

  editResolution(resolution: InvoiceResolution): void {
    this.selected_resolution.set(resolution);
    this.is_create_modal_open.set(true);
  }

  onDeleteResolution(id: number): void {
    this.store.dispatch(InvoicingActions.deleteResolution({ id }));
  }

  private getResolutionStatus(
    item: InvoiceResolution | undefined,
  ): ResolutionStatus {
    if (!item) return 'inactive';

    const now = Date.now();
    const validTo = item.valid_to ? new Date(item.valid_to).getTime() : NaN;
    const max = item.range_to ?? 0;
    const used = item.current_number ?? item.range_from ?? 0;

    if (!isNaN(validTo) && validTo < now) return 'expired';
    if (max > 0 && used >= max) return 'exhausted';
    if (
      !isNaN(validTo) &&
      validTo >= now &&
      validTo <= now + 30 * 24 * 60 * 60 * 1000
    ) {
      return 'expiring';
    }
    return item.is_active ? 'active' : 'inactive';
  }

  private getStatusLabel(status: ResolutionStatus): string {
    const labels: Record<ResolutionStatus, string> = {
      expired: 'Vencida',
      exhausted: 'Agotada',
      expiring: 'Por vencer',
      active: 'Activa',
      inactive: 'Inactiva',
    };
    return labels[status] || String(status);
  }

  private getUsageLabel(item: InvoiceResolution | undefined): string {
    if (!item) return '-';
    const from = item.range_from ?? 0;
    const to = item.range_to ?? 0;
    const max = to - from + 1;
    if (!max || max <= 0) return '-';
    const used = Math.max(0, (item.current_number ?? from) - from);
    const pct = Math.min(100, Math.round((used / max) * 100));
    return `${used}/${max} (${pct}%)`;
  }
}
