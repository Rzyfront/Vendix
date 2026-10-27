import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  ModalComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { BadgeVariant } from '../../../../../../../shared/components/badge/badge.component';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import {
  HOUSEKEEPING_STATUS_LABELS,
  HousekeepingStatus,
} from '../../../rooms/interfaces/unit.interface';
import {
  HOUSEKEEPING_QUICK_ACTION,
  HOUSEKEEPING_TRANSITIONS,
  HousekeepingBoard,
  HousekeepingBoardUnit,
} from '../../interfaces/housekeeping.interface';
import { LodgingHousekeepingService } from '../../services/housekeeping.service';
import { HousekeepingTasksPanelComponent } from '../../components/housekeeping-tasks-panel/housekeeping-tasks-panel.component';

/** Status colors: warning asks for attention, error is out of sale. */
const STATUS_BADGE: Record<HousekeepingStatus, BadgeVariant> = {
  dirty: 'warning',
  clean: 'success',
  inspected: 'primary',
  out_of_order: 'error',
  out_of_service: 'neutral',
};

const STATUS_BORDER: Record<HousekeepingStatus, string> = {
  dirty: 'border-l-yellow-400',
  clean: 'border-l-green-500',
  inspected: 'border-l-blue-500',
  out_of_order: 'border-l-red-500',
  out_of_service: 'border-l-gray-400',
};

const OCCUPANCY_LABELS = { in_house: 'En casa', departs_today: 'Sale hoy' } as const;

interface FloorGroup {
  floor: string;
  units: HousekeepingBoardUnit[];
}

/**
 * Hospitality Suite — Housekeeping (H5.1). Rooms grouped by floor with their
 * cleaning status; the housekeeper moves each room through the cycle
 * (sucia → limpia → inspeccionada) or takes it out of service, which removes
 * it from the sale. Check-out leaves the room "Sucia" on its own. Above the
 * board, the day's tasks per housekeeper (H5.2).
 */
@Component({
  selector: 'app-hospitality-housekeeping-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    SpinnerComponent,
    ModalComponent,
    HousekeepingTasksPanelComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Housekeeping"
        subtitle="Estado de limpieza de las habitaciones"
        icon="sparkles"
        variant="glass"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats title="Sucias" [value]="count('dirty')" iconName="alert-circle" [loading]="board() === null" />
        <app-stats title="Limpias" [value]="count('clean')" iconName="sparkles" [loading]="board() === null" />
        <app-stats title="Inspeccionadas" [value]="count('inspected')" iconName="clipboard-check" [loading]="board() === null" />
        <app-stats
          title="Fuera de venta"
          [value]="count('out_of_order') + count('out_of_service')"
          iconName="ban"
          [loading]="board() === null"
        />
      </div>

      <div class="flex flex-col gap-3 p-2 md:p-4">
        @if (tasksMode(); as mode) {
          <!-- H5.2 — head housekeeper assigns rooms; a housekeeper sees only hers. -->
          <app-housekeeping-tasks-panel [mode]="mode" (roomChanged)="load()" />
        }
        <app-card [responsive]="true">
          <div class="mb-3 flex items-center justify-end">
            <app-button variant="outline" size="sm" (clicked)="load()">Actualizar</app-button>
          </div>

          @if (board() === null) {
            <div class="flex flex-col items-center gap-2 py-8">
              <app-spinner size="md" />
              <p class="text-sm text-text-secondary">Cargando habitaciones…</p>
            </div>
          } @else if (floors().length === 0) {
            <app-empty-state
              icon="bed-double"
              title="Sin habitaciones activas"
              description="Crea las habitaciones en Hotelería → Habitaciones para verlas aquí."
              [showActionButton]="false"
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
                          <span>
                            <span class="block text-base font-semibold text-text-primary">{{ unit.code }}</span>
                            <span class="block text-xs text-text-secondary">{{ unit.unit_type.name }}</span>
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
        </app-card>
      </div>

      <app-modal
        [isOpen]="selected() !== null"
        (isOpenChange)="!$event && selected.set(null)"
        [size]="'sm'"
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
            Fuera de servicio y Bloqueada sacan la habitación de la venta y del check-in.
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

  readonly board = signal<HousekeepingBoard | null>(null);
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

  readonly floors = computed<FloorGroup[]>(() => {
    const groups = new Map<string, HousekeepingBoardUnit[]>();
    for (const unit of this.board()?.units ?? []) {
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
    return unit ? HOUSEKEEPING_TRANSITIONS[unit.housekeeping_status] : [];
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.housekeepingService
      .board()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (board) => this.board.set(board),
        error: (message: unknown) => {
          this.board.set({ business_date: '', units: [] });
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo cargar el tablero',
          );
        },
      });
  }

  count(status: HousekeepingStatus): number {
    return (this.board()?.units ?? []).filter((u) => u.housekeeping_status === status).length;
  }

  label(status: HousekeepingStatus): string {
    return HOUSEKEEPING_STATUS_LABELS[status];
  }

  badge(unit: HousekeepingBoardUnit): BadgeVariant {
    return STATUS_BADGE[unit.housekeeping_status];
  }

  border(unit: HousekeepingBoardUnit): string {
    return STATUS_BORDER[unit.housekeeping_status];
  }

  occupancy(unit: HousekeepingBoardUnit): string {
    return unit.occupancy ? OCCUPANCY_LABELS[unit.occupancy] : '';
  }

  quickAction(unit: HousekeepingBoardUnit) {
    return HOUSEKEEPING_QUICK_ACTION[unit.housekeeping_status] ?? null;
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
