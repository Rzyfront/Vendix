import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ModalComponent,
  OptionsDropdownComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  StatsComponent,
  ToastService,
  SpinnerComponent,
} from '../../../../../../../shared/components/index';
import { BadgeVariant } from '../../../../../../../shared/components/badge/badge.component';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import {
  HOUSEKEEPING_STATUS_LABELS,
  HousekeepingStatus,
} from '../../../rooms/interfaces/unit.interface';
import {
  HOUSEKEEPING_QUICK_ACTION,
  HOUSEKEEPING_STATUS_PERMISSIONS,
  HOUSEKEEPING_TRANSITIONS,
  HousekeepingBoard,
  HousekeepingBoardUnit,
} from '../../interfaces/housekeeping.interface';
import { LodgingHousekeepingService } from '../../services/housekeeping.service';
import {
  HOUSEKEEPING_STATUS_CHIPS,
  VARIANT_BORDER,
} from '../../../shared/hospitality-status';
import { HousekeepingTasksPanelComponent } from '../../components/housekeeping-tasks-panel/housekeeping-tasks-panel.component';
import { HospitalityLoadErrorComponent } from '../../../shared/load-error.component';

type HousekeepingTab = 'rooms' | 'tasks';

const OCCUPANCY_LABELS = { in_house: 'En casa', departs_today: 'Sale hoy' } as const;

interface FloorGroup {
  floor: string;
  units: HousekeepingBoardUnit[];
}

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

const stringFilter = (values: FilterValues, key: string): string => {
  const value = values[key];
  return typeof value === 'string' ? value : '';
};

/**
 * Hospitality Suite — Housekeeping (H5.1). Rooms grouped by floor with their
 * cleaning status; the housekeeper moves each room through the cycle
 * (sucia → limpia → inspeccionada) or takes it out of service, which removes
 * it from the sale. Check-out leaves the room "Sucia" on its own. The second
 * tab holds the day's tasks per housekeeper (H5.2).
 *
 * Standard admin list module: four stats, the tabs, one card with the sticky
 * search and the options dropdown (filters + refresh). Rooms keep the floor
 * board; tasks use the responsive data view. Search and filters run on the
 * loaded data.
 */
@Component({
  selector: 'app-hospitality-housekeeping-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HospitalityLoadErrorComponent,
    SpinnerComponent,
    FormsModule,
    StatsComponent,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ScrollableTabsComponent,
    ModalComponent,
    HousekeepingTasksPanelComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Sucias"
          [value]="loadError() ? '—' : count('dirty')"
          smallText="por limpiar"
          iconName="alert-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="board() === null && !loadError()"
        />
        <app-stats
          title="Limpias"
          [value]="loadError() ? '—' : count('clean')"
          smallText="por inspeccionar"
          iconName="sparkles"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="board() === null && !loadError()"
        />
        <app-stats
          title="Inspeccionadas"
          [value]="loadError() ? '—' : count('inspected')"
          smallText="listas para la venta"
          iconName="clipboard-check"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="board() === null && !loadError()"
        />
        <app-stats
          title="Fuera de venta"
          [value]="loadError() ? '—' : count('out_of_order') + count('out_of_service')"
          smallText="fuera de servicio o no disponibles"
          iconName="ban"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="board() === null && !loadError()"
        />
      </div>

      @if (tasksMode()) {
        <app-scrollable-tabs
          ariaLabel="Limpieza"
          [tabs]="tabs()"
          [activeTab]="tab()"
          (tabChange)="onTab($event)"
        />
      }

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Sticky search header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              @if (tab() === 'rooms') {
                Habitaciones
                <span class="text-text-secondary font-normal">({{ visibleUnits() }})</span>
              } @else {
                {{ tasksMode() === 'assign' ? 'Tareas de hoy' : 'Mis tareas de hoy' }}
                <span class="text-text-secondary font-normal">
                  ({{ tasksPanel()?.pendingCount() ?? 0 }} pendientes de
                  {{ tasksPanel()?.total() ?? 0 }})
                </span>
              }
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                [placeholder]="
                  tab() === 'rooms' ? 'Buscar habitación...' : 'Buscar tarea...'
                "
                [debounceTime]="300"
                [ngModel]="search()"
                (ngModelChange)="onSearch($event)"
              />
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs()"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="board() === null"
                (filterChange)="filterValues.set($event)"
                (clearAllFilters)="filterValues.set({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (tab() === 'tasks' && tasksMode(); as mode) {
            <!-- H5.2 — head housekeeper assigns rooms; a housekeeper sees only hers. -->
            <app-housekeeping-tasks-panel
              [mode]="mode"
              [search]="search()"
              [statusFilter]="taskStatusFilter()"
              [assignmentFilter]="assignmentFilter()"
              (roomChanged)="load()"
              (clearFilters)="clearFilters()"
            />
          } @else if (loadError() !== null) {
            <app-hospitality-load-error
              what="las habitaciones"
              [message]="loadError()"
              (retry)="load()"
            />
          } @else if (board() === null) {
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando habitaciones…" />
            </div>
          } @else if ((board()?.units ?? []).length === 0) {
            <app-empty-state
              icon="bed-double"
              title="Sin habitaciones activas"
              description="Crea las habitaciones en Hotelería → Habitaciones para verlas aquí."
              [showActionButton]="false"
            />
          } @else if (floors().length === 0) {
            <app-empty-state
              icon="search"
              title="Sin resultados"
              description="Ninguna habitación coincide con la búsqueda o los filtros."
              actionButtonText="Limpiar filtros"
              [showActionButton]="true"
              (actionClick)="clearFilters()"
            />
          } @else {
            <div class="flex flex-col gap-5">
              @for (group of floors(); track group.floor) {
                <section>
                  <h3 class="mb-2 text-sm font-semibold text-text-secondary">{{ group.floor }}</h3>
                  <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    @for (unit of group.units; track unit.id) {
                      <div
                        class="flex flex-col gap-2 rounded-lg border border-border border-l-4 bg-surface p-3"
                        [class]="border(unit)"
                        [attr.data-testid]="'hk-unit-' + unit.code"
                      >
                        <button
                          type="button"
                          class="flex items-start justify-between gap-2 text-left"
                          [disabled]="!canOperate()"
                          [attr.aria-label]="'Cambiar estado de la ' + unit.code"
                          (click)="openChange(unit)"
                        >
                          <span class="min-w-0">
                            <span class="block text-base font-semibold text-text-primary">{{ unit.code }}</span>
                            <span class="block truncate text-xs text-text-secondary">{{ unit.unit_type.name }}</span>
                          </span>
                          <app-badge [variant]="badge(unit)" size="xs">{{ label(unit.housekeeping_status) }}</app-badge>
                        </button>
                        @if (unit.occupancy) {
                          <span class="text-xs font-medium text-text-secondary">{{ occupancy(unit) }}</span>
                        }
                        @if (canOperate() && quickAction(unit); as action) {
                          <app-button
                            variant="outline"
                            size="sm"
                            [fullWidth]="true"
                            [loading]="saving() === unit.id"
                            [disabled]="saving() !== null"
                            (clicked)="change(unit, action.to)"
                          >
                            {{ action.label }}
                          </app-button>
                        }
                      </div>
                    }
                  </div>
                </section>
              }
            </div>
          }
        </div>
      </app-card>

      <app-modal
        [isOpen]="selected() !== null"
        (isOpenChange)="!$event && selected.set(null)"
        (cancel)="selected.set(null)"
        size="sm"
        [title]="'Habitación ' + (selected()?.code ?? '')"
        [subtitle]="'Ahora: ' + (selected() ? label(selected()!.housekeeping_status) : '')"
      >
        <div class="flex flex-col gap-2">
          @for (to of targets(); track to) {
            <app-button
              [variant]="to === 'out_of_order' || to === 'out_of_service' ? 'outline' : 'secondary'"
              [fullWidth]="true"
              [disabled]="saving() !== null"
              (clicked)="change(selected()!, to)"
            >
              {{ label(to) }}
            </app-button>
          }
          <p class="text-xs text-text-secondary">
            Fuera de servicio y No disponible sacan la habitación de la venta y del check-in.
            Para cerrarla por fechas usa «Bloquear habitación» en el rack.
          </p>
        </div>
      </app-modal>
    </div>
  `,
})
export class HospitalityHousekeepingPageComponent implements OnInit {
  private readonly housekeepingService = inject(LodgingHousekeepingService);
  private readonly authFacade = inject(AuthFacade);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tasksPanel = viewChild(HousekeepingTasksPanelComponent);

  readonly board = signal<HousekeepingBoard | null>(null);
  /** R-FB-02 — reason of the last failed load; null = loaded or loading. */
  readonly loadError = signal<string | null>(null);
  /** Room whose status change is in flight (blocks a double click). */
  readonly saving = signal<number | null>(null);
  readonly selected = signal<HousekeepingBoardUnit | null>(null);
  readonly canOperate = signal(this.authFacade.hasPermission('store:lodging:housekeeping:operate'));
  readonly tasksMode = signal<'assign' | 'mine' | null>(
    this.authFacade.hasPermission('store:lodging:housekeeping:assign')
      ? 'assign'
      : this.canOperate()
        ? 'mine'
        : null,
  );

  readonly tab = signal<HousekeepingTab>('rooms');
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});

  readonly tabs = computed<ScrollableTab[]>(() => [
    { id: 'rooms', label: `Habitaciones (${this.board()?.units.length ?? 0})`, icon: 'bed-double' },
    {
      id: 'tasks',
      label: this.tasksMode() === 'assign' ? 'Tareas de hoy' : 'Mis tareas',
      icon: 'clipboard-list',
    },
  ]);

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ];

  readonly filterConfigs = computed<FilterConfig[]>(() => {
    if (this.tab() === 'tasks') {
      return [
        {
          key: 'task_status',
          label: 'Estado de la tarea',
          type: 'select',
          options: [
            { value: '', label: 'Todas' },
            { value: 'pending', label: 'Pendientes' },
            { value: 'done', label: 'Terminadas' },
          ],
        },
        ...(this.tasksMode() === 'assign'
          ? [
              {
                key: 'assignment',
                label: 'Asignación',
                type: 'select' as const,
                options: [
                  { value: '', label: 'Todas' },
                  { value: 'assigned', label: 'Asignadas' },
                  { value: 'unassigned', label: 'Sin asignar' },
                ],
              },
            ]
          : []),
      ];
    }
    const floors = [...new Set((this.board()?.units ?? []).map((u) => u.floor ?? ''))].sort(
      (a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'es', { numeric: true })),
    );
    return [
      {
        key: 'status',
        label: 'Estado de limpieza',
        type: 'select',
        options: [
          { value: '', label: 'Todos' },
          ...(Object.keys(HOUSEKEEPING_STATUS_LABELS) as HousekeepingStatus[]).map((s) => ({
            value: s,
            label: HOUSEKEEPING_STATUS_LABELS[s],
          })),
        ],
      },
      {
        key: 'floor',
        label: 'Piso',
        type: 'select',
        options: [
          { value: '', label: 'Todos' },
          ...floors.map((f) => ({ value: f || 'none', label: f ? `Piso ${f}` : 'Sin piso' })),
        ],
      },
      {
        key: 'occupancy',
        label: 'Ocupación hoy',
        type: 'select',
        options: [
          { value: '', label: 'Todas' },
          { value: 'in_house', label: 'En casa' },
          { value: 'departs_today', label: 'Sale hoy' },
          { value: 'vacant', label: 'Libre' },
        ],
      },
    ];
  });

  readonly taskStatusFilter = computed(() => stringFilter(this.filterValues(), 'task_status'));
  readonly assignmentFilter = computed(() => stringFilter(this.filterValues(), 'assignment'));

  private readonly filteredUnits = computed(() => {
    const values = this.filterValues();
    const status = stringFilter(values, 'status');
    const floor = stringFilter(values, 'floor');
    const occupancy = stringFilter(values, 'occupancy');
    return (this.board()?.units ?? []).filter(
      (unit) =>
        matches(this.search(), unit.code, unit.unit_type.name, unit.floor, unit.zone) &&
        (!status || unit.housekeeping_status === status) &&
        (!floor || (unit.floor ?? 'none') === floor) &&
        (!occupancy || (unit.occupancy ?? 'vacant') === occupancy),
    );
  });

  readonly visibleUnits = computed(() => this.filteredUnits().length);

  readonly floors = computed<FloorGroup[]>(() => {
    const groups = new Map<string, HousekeepingBoardUnit[]>();
    for (const unit of this.filteredUnits()) {
      const floor = unit.floor ?? '';
      groups.set(floor, [...(groups.get(floor) ?? []), unit]);
    }
    // Numeric floor order ("2" before "10"); rooms without floor go last.
    return [...groups.entries()]
      .sort(([a], [b]) =>
        !a ? 1 : !b ? -1 : a.localeCompare(b, 'es', { numeric: true }),
      )
      .map(([floor, units]) => ({ floor: floor ? `Piso ${floor}` : 'Sin piso', units }));
  });

  readonly targets = computed<HousekeepingStatus[]>(() => {
    const unit = this.selected();
    return unit
      ? HOUSEKEEPING_TRANSITIONS[unit.housekeeping_status].filter((to) => this.mayChangeTo(to))
      : [];
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadError.set(null);
    this.housekeepingService
      .board()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (board) => this.board.set(board),
        // R-FB-02: a failed load shows the error block, never an empty board.
        error: (message: unknown) => {
          this.board.set(null);
          this.loadError.set(
            typeof message === 'string' ? message : 'Revisa tu conexión e inténtalo de nuevo.',
          );
        },
      });
  }

  onTab(id: string): void {
    this.tab.set(id as HousekeepingTab);
    this.clearFilters();
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  clearFilters(): void {
    this.search.set('');
    this.filterValues.set({});
  }

  onActionClick(action: string): void {
    if (action !== 'refresh') return;
    this.load();
    this.tasksPanel()?.load();
  }

  count(status: HousekeepingStatus): number {
    return (this.board()?.units ?? []).filter((u) => u.housekeeping_status === status).length;
  }

  label(status: HousekeepingStatus): string {
    return HOUSEKEEPING_STATUS_LABELS[status];
  }

  badge(unit: HousekeepingBoardUnit): BadgeVariant {
    return HOUSEKEEPING_STATUS_CHIPS[unit.housekeeping_status].variant;
  }

  border(unit: HousekeepingBoardUnit): string {
    return VARIANT_BORDER[HOUSEKEEPING_STATUS_CHIPS[unit.housekeeping_status].variant];
  }

  occupancy(unit: HousekeepingBoardUnit): string {
    return unit.occupancy ? OCCUPANCY_LABELS[unit.occupancy] : '';
  }

  /** The housekeeper cleans; inspecting or leaving the sale needs more (API rule). */
  mayChangeTo(to: HousekeepingStatus): boolean {
    const required = HOUSEKEEPING_STATUS_PERMISSIONS[to];
    return !required || this.authFacade.hasAnyPermission(required);
  }

  quickAction(unit: HousekeepingBoardUnit) {
    const action = HOUSEKEEPING_QUICK_ACTION[unit.housekeeping_status];
    return action && this.mayChangeTo(action.to) ? action : null;
  }

  openChange(unit: HousekeepingBoardUnit): void {
    if (this.canOperate()) this.selected.set(unit);
  }

  change(unit: HousekeepingBoardUnit, to: HousekeepingStatus): void {
    if (this.saving() !== null) return;
    this.saving.set(unit.id);
    this.housekeepingService
      .changeStatus(unit.id, unit.housekeeping_status, to)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.saving.set(null);
          this.selected.set(null);
          this.board.update((board) =>
            board && {
              ...board,
              units: board.units.map((u) =>
                u.id === updated.id ? { ...u, housekeeping_status: updated.housekeeping_status } : u,
              ),
            },
          );
          this.toastService.success(`La ${updated.code} quedó ${this.label(to).toLowerCase()}`);
        },
        error: (message: unknown) => {
          this.saving.set(null);
          this.selected.set(null);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo cambiar el estado',
          );
          this.load();
        },
      });
  }
}
