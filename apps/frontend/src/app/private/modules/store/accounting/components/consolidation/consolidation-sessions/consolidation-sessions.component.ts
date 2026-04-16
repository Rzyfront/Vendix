import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { AccountingService } from '../../../services/accounting.service';
import { ConsolidationSession } from '../../../interfaces/accounting.interface';
import {
  CardComponent,
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  ButtonComponent,
  ToastService,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  DropdownAction,
  FilterValues,
} from '../../../../../../../shared/components/index';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import { SessionCreateModalComponent } from '../session-create-modal/session-create-modal.component';

@Component({
  selector: 'vendix-consolidation-sessions',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    SessionCreateModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Sesiones"
          [value]="stats().total"
          iconName="layers"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="En Progreso"
          [value]="stats().in_progress"
          iconName="loader"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Completadas"
          [value]="stats().completed"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Borradores"
          [value]="stats().draft"
          iconName="edit"
          iconBgColor="bg-gray-100"
          iconColor="text-gray-600"
          [clickable]="false"
        ></app-stats>
      </div>

      <!-- Unified Container: Search Header + Data -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Search Header -->
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
              Sesiones de Consolidacion ({{ filtered_sessions().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar sesiones..."
                [debounceTime]="300"
                (searchChange)="onSearchChange($event)"
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
            [data]="filtered_sessions()"
            [columns]="columns"
            [cardConfig]="card_config"
            [actions]="table_actions"
            [loading]="loading()"
            emptyMessage="No se encontraron sesiones de consolidacion"
            emptyIcon="layers"
            (rowClick)="onRowClick($event)"
          ></app-responsive-data-view>
        </div>
      </app-card>

      <!-- Create Modal -->
      <vendix-session-create-modal
        [(isOpen)]="is_create_modal_open"
        (created)="onSessionCreated($event)"
      ></vendix-session-create-modal>
    </div>
  `,
})
export class ConsolidationSessionsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private accounting_service = inject(AccountingService);
  private toast_service = inject(ToastService);
  private router = inject(Router);

  sessions = signal<ConsolidationSession[]>([]);
  loading = signal(false);
  search_term = signal('');
  is_create_modal_open = false;

  filtered_sessions = computed(() => {
    const term = this.search_term().toLowerCase();
    if (!term) return this.sessions();
    return this.sessions().filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.fiscal_period?.name?.toLowerCase().includes(term),
    );
  });

  stats = computed(() => {
    const all = this.sessions();
    return {
      total: all.length,
      in_progress: all.filter((s) => s.status === 'in_progress').length,
      completed: all.filter((s) => s.status === 'completed').length,
      draft: all.filter((s) => s.status === 'draft').length,
    };
  });

  dropdown_actions: DropdownAction[] = [
    {
      label: 'Nueva Sesion',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'secondary',
      action: (row: ConsolidationSession) => this.onRowClick(row),
    },
  ];

  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'fiscal_period',
      label: 'Periodo Fiscal',
      priority: 2,
      transform: (val: any) => val?.name || '-',
    },
    {
      key: 'session_date',
      label: 'Fecha',
      sortable: true,
      priority: 1,
      transform: (val: any) => (val ? formatDateOnlyUTC(val) : '-'),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (val: any) => this.getStatusLabel(val),
    },
    {
      key: 'adjustments_count',
      label: 'Ajustes',
      align: 'center',
      priority: 2,
      transform: (val: any) => val ?? 0,
    },
    {
      key: 'intercompany_count',
      label: 'IC Trans.',
      align: 'center',
      priority: 2,
      transform: (val: any) => val ?? 0,
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'session_date',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        draft: 'warn',
        in_progress: 'info',
        completed: 'success',
        cancelled: 'danger',
      },
    },
    badgeTransform: (val: any) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'fiscal_period',
        label: 'Periodo',
        icon: 'calendar',
        transform: (val: any) => val?.name || '-',
      },
      {
        key: 'adjustments_count',
        label: 'Ajustes',
        icon: 'sliders',
        transform: (val: any) => `${val ?? 0}`,
      },
    ],
  };

  ngOnInit(): void {
    this.loadSessions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadSessions(): void {
    this.loading.set(true);
    this.accounting_service
      .getConsolidationSessions()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sessions.set(res.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.toast_service.show({
            variant: 'error',
            description: 'Error cargando sesiones de consolidacion',
          });
          this.loading.set(false);
        },
      });
  }

  onSearchChange(term: string): void {
    this.search_term.set(term);
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.is_create_modal_open = true;
    }
  }

  onRowClick(session: ConsolidationSession): void {
    this.router.navigate(['/store/accounting/consolidation', session.id]);
  }

  onSessionCreated(session: ConsolidationSession): void {
    this.is_create_modal_open = false;
    this.router.navigate(['/store/accounting/consolidation', session.id]);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      in_progress: 'En Progreso',
      completed: 'Completada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }
}
