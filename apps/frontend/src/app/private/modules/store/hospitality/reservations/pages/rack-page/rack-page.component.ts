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
import { FormsModule } from '@angular/forms';
import { addDays, format, isWeekend, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ButtonComponent,
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
  SelectorOption,
  SpinnerComponent,
  StatsComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { ReservationDetailModalComponent } from '../../components/reservation-detail-modal/reservation-detail-modal.component';
import {
  RoomChangeModalComponent,
  RoomChangeTarget,
} from '../../components/room-change-modal/room-change-modal.component';
import {
  RoomBlockModalComponent,
  RoomBlockTarget,
} from '../../components/room-block-modal/room-block-modal.component';
import {
  INVENTORY_BLOCK_REASON_LABELS,
  LodgingReservationStatus,
  Rack,
  RackBar,
  RackBlock,
  RackType,
  RESERVATION_STATUS_LABELS,
  RoomChangeRequest,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { storeToday } from '../../../../../../../shared/utils/date.util';
import {
  HOUSEKEEPING_STATUS_LABELS,
  HousekeepingStatus,
} from '../../../rooms/interfaces/unit.interface';

/** Days the arrows move the window. */
const STEP_DAYS = 14;

/** Window sizes the desk can pick. */
const WINDOW_OPTIONS: SelectorOption[] = [
  { value: '', label: '14 días' },
  { value: '30', label: '30 días' },
];

const DEFAULT_DAYS = 14;

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

/** A type stays on the rack when its name, a room or a stay matches. */
function typeMatches(type: RackType, term: string): boolean {
  return (
    matches(term, type.name) ||
    type.units.some((u) => matches(term, u.code, u.floor)) ||
    type.bars.some((b) => matches(term, b.guest, b.reservation_number))
  );
}

/** One status, one shade of the theme's single accent. */
const BAR_CLASSES: Partial<Record<LodgingReservationStatus, string>> = {
  tentative: 'border border-dashed border-primary bg-primary/5 text-primary',
  confirmed: 'border border-primary/40 bg-primary/15 text-primary',
  checked_in: 'border border-primary bg-primary text-white',
  checked_out: 'border border-border bg-surface-secondary text-text-secondary',
};

/** Statuses whose room and dates can still change (H1.4). */
const MOVABLE_STATUSES: LodgingReservationStatus[] = ['tentative', 'confirmed', 'checked_in'];

type DragMode = 'move' | 'resize';

interface RackRow {
  kind: 'type' | 'unit' | 'unassigned';
  key: string;
  label: string;
  /** 1-based CSS grid row (row 1 is the nights header). */
  row: number;
  typeId: number;
  unitId?: number;
  free?: number[];
  /** H2.5 — allotment rooms held per night. */
  held?: number[];
  /** H5.3 — rooms blocked per night (maintenance, owner use). */
  blocked?: number[];
  /** H1.6 — nights sold above the type's rooms, and the "Sobreventa: 3/2" alert. */
  overbooked?: boolean[];
  overbooking?: string;
  muted?: boolean;
  hint?: string;
}

interface PlacedBlock extends RackBlock {
  row: number;
  label: string;
  title: string;
}

interface PlacedBar extends RackBar {
  row: number;
  classes: string;
  title: string;
  movable: boolean;
}

const toDateString = (date: Date) => format(date, 'yyyy-MM-dd');

/**
 * Hospitality Suite (H1.3) — occupancy rack (read only): rooms grouped by type
 * × nights, stays as bars coloured by status. CSS grid + date-fns (D7: no
 * paid or GPL timeline). Rows: the type with its free rooms per night, its
 * rooms, and a "Sin asignar" row per lane of unassigned stays. Tapping a bar
 * opens the reservation detail.
 *
 * H1.4: on desktop a bar is dragged onto another room (assign/move) and its
 * right edge is dragged to lengthen or shorten the stay. Every drop is
 * validated first: a collision shows its message and nothing moves;
 * otherwise the change modal shows the price difference to confirm. On
 * mobile the same change is made with "Mover" in the reservation detail.
 *
 * H5.3: "Bloquear" takes a room out of sale for maintenance or owner use;
 * the block shows on its room row and tapping it releases it.
 *
 * Standard admin module around the grid: four stats of the window, one card
 * with the sticky search (type, room, guest or reservation), the options
 * dropdown ("Bloquear habitación" + type and window filters) and the date
 * navigation. Search and type filter hide whole types client-side.
 */
@Component({
  selector: 'app-hospitality-rack-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    SpinnerComponent,
    StatsComponent,
    ReservationDetailModalComponent,
    RoomChangeModalComponent,
    RoomBlockModalComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Habitaciones"
          [value]="stats().rooms"
          [smallText]="'activas en ' + stats().types + ' tipos'"
          iconName="door-open"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading() && !rack()"
        />
        <app-stats
          title="Ocupación"
          [value]="stats().occupancy + '%'"
          [smallText]="stats().soldNights + ' de ' + stats().roomNights + ' noches'"
          iconName="gauge"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading() && !rack()"
        />
        <app-stats
          title="Estadías"
          [value]="stats().stays"
          [smallText]="stats().unassigned + ' sin habitación asignada'"
          iconName="calendar-check"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading() && !rack()"
        />
        <app-stats
          title="Bloqueos"
          [value]="stats().blocks"
          smallText="mantenimiento, propietario o canal"
          iconName="lock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading() && !rack()"
        />
      </div>

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
              Rack de ocupación
              <span class="text-text-secondary font-normal">({{ visibleTypes().length }} tipos)</span>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar en el rack..."
                [debounceTime]="300"
                [ngModel]="searchTerm()"
                (ngModelChange)="searchTerm.set($event ?? '')"
              />
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs()"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onFilterChange({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <!-- Date navigation of the window -->
        <div class="flex items-center gap-1 px-2 pt-3 md:px-6">
          <app-button variant="outline" size="sm" ariaLabel="14 días antes" (clicked)="move(-1)">
            <app-icon slot="icon" name="chevron-left" [size]="16" />
          </app-button>
          <app-button variant="outline" size="sm" (clicked)="goToday()">Hoy</app-button>
          <app-button variant="outline" size="sm" ariaLabel="14 días después" (clicked)="move(1)">
            <app-icon slot="icon" name="chevron-right" [size]="16" />
          </app-button>
          <span class="ml-2 text-sm font-medium text-text-primary" data-testid="rack-range">
            {{ rangeLabel() }}
          </span>
          @if (loading() && rack()) {
            <app-spinner size="sm" class="ml-2" />
          }
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (loading() && !rack()) {
            <div class="p-4 md:p-6 text-center">
              <div
                class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
              <p class="mt-2 text-text-secondary">Cargando rack...</p>
            </div>
          } @else if ((rack()?.types ?? []).length === 0) {
            <app-empty-state
              icon="bed-double"
              title="Aún no hay tipos de habitación activos"
              description="Créalos en Hotelería → Habitaciones para ver su ocupación por noches."
            />
          } @else if (rows().length === 0) {
            <app-empty-state
              icon="search"
              title="Sin resultados"
              description="Ningún tipo, habitación o huésped coincide con la búsqueda o los filtros."
              actionButtonText="Limpiar filtros"
              [showActionButton]="true"
              (actionClick)="clearFilters()"
            />
          } @else {
            <div class="overflow-x-auto rounded-md border border-border" data-testid="rack-scroll">
              <div
                class="grid w-max min-w-full text-xs"
                [style.grid-template-columns]="gridColumns()"
                [style.grid-template-rows]="'repeat(' + (rows().length + 1) + ', 2.25rem)'"
                data-testid="rack-grid"
              >
                <!-- Nights header -->
                <div
                  class="sticky left-0 z-30 flex items-center border-b border-r border-border bg-surface px-2 font-semibold text-text-secondary"
                  style="grid-row: 1; grid-column: 1"
                >
                  Habitación
                </div>
                @for (night of nightHeaders(); track night.date; let i = $index) {
                  <div
                    class="flex flex-col items-center justify-center border-b border-r border-border/50 leading-tight"
                    [class.bg-surface-secondary]="night.weekend"
                    [class.bg-surface]="!night.weekend"
                    [class.text-primary]="night.today"
                    [class.font-bold]="night.today"
                    [style.grid-row]="1"
                    [style.grid-column]="i + 2"
                  >
                    <span class="text-[10px] uppercase text-text-secondary">{{ night.weekday }}</span>
                    <span>{{ night.day }}</span>
                  </div>
                }

                @for (row of rows(); track row.key) {
                  <div
                    class="sticky left-0 z-20 flex items-center truncate border-b border-r border-border px-2"
                    [class.bg-surface-secondary]="row.kind === 'type'"
                    [class.bg-surface]="row.kind !== 'type'"
                    [class.font-semibold]="row.kind === 'type'"
                    [class.text-text-secondary]="row.muted || row.kind === 'unassigned'"
                    [class.italic]="row.kind === 'unassigned'"
                    [class.line-through]="row.muted"
                    [attr.title]="row.hint ?? row.label"
                    [style.grid-row]="row.row"
                    [style.grid-column]="1"
                  >
                    <span class="truncate">{{ row.label }}</span>
                    @if (row.overbooking) {
                      <span
                        class="ml-1 shrink-0 rounded bg-primary/10 px-1 text-[10px] font-bold text-primary"
                        title="Noches vendidas por encima de las habitaciones del tipo"
                        >{{ row.overbooking }}</span
                      >
                    }
                  </div>
                  @for (night of nightHeaders(); track night.date; let i = $index) {
                    <div
                      class="flex items-center justify-center border-b border-r border-border/50"
                      [class.bg-surface-secondary]="row.kind === 'type' || night.weekend"
                      [class.bg-surface]="row.kind !== 'type' && !night.weekend"
                      [class.ring-2]="dropHover() === row.key + ':' + i"
                      [class.ring-inset]="dropHover() === row.key + ':' + i"
                      [class.ring-primary]="dropHover() === row.key + ':' + i"
                      [style.grid-row]="row.row"
                      [style.grid-column]="i + 2"
                      (dragover)="onDragOver($event, row, i)"
                      (dragleave)="dropHover.set(null)"
                      (drop)="onDrop($event, row, i)"
                    >
                      @if (row.free) {
                        <span
                          class="text-[10px]"
                          [class.text-text-secondary]="row.free[i] > 0"
                          [class.text-primary]="row.free[i] === 0"
                          [class.font-bold]="row.free[i] === 0 || row.overbooked?.[i]"
                          [class.underline]="row.overbooked?.[i]"
                          [attr.title]="
                            (row.overbooked?.[i] ? 'Sobreventa: ' : '') +
                            row.free[i] +
                            ' libres' +
                            (row.held?.[i] ? ' · ' + row.held?.[i] + ' en cupo' : '') +
                            (row.blocked?.[i] ? ' · ' + row.blocked?.[i] + ' bloqueadas' : '')
                          "
                          >{{ row.free[i] }}</span
                        >
                        @if (row.held?.[i]) {
                          <span
                            class="ml-0.5 rounded bg-amber-100 px-0.5 text-[9px] leading-tight text-amber-800"
                            data-testid="rack-held"
                            >{{ row.held?.[i] }}c</span
                          >
                        }
                      }
                    </div>
                  }
                }

                <!-- H5.3 — maintenance / owner use (and H6.2 iCal) blocks on their room row -->
                @for (block of blockBars(); track block.id) {
                  <button
                    type="button"
                    class="relative z-10 mx-0.5 my-1 flex min-w-0 items-center truncate border border-dashed border-text-secondary/50 bg-surface-secondary px-1.5 text-left text-[11px] font-medium text-text-secondary"
                    [class.rounded-l-md]="!block.continues_before"
                    [class.rounded-r-md]="!block.continues_after"
                    [class.pointer-events-none]="drag() !== null"
                    [style.grid-row]="block.row"
                    [style.grid-column]="block.start + 2 + ' / span ' + block.span"
                    [attr.title]="block.title"
                    [attr.data-testid]="'rack-block-' + block.id"
                    (click)="openBlock(block)"
                  >
                    <app-icon name="lock" [size]="12" class="mr-1 shrink-0" />
                    <span class="truncate">{{ block.label }}</span>
                  </button>
                }

                @for (bar of bars(); track bar.reservation_room_id) {
                  <button
                    type="button"
                    class="relative z-10 mx-0.5 my-1 flex min-w-0 items-center truncate px-1.5 text-left text-[11px] font-medium"
                    [class]="bar.classes"
                    [class.rounded-l-md]="!bar.continues_before"
                    [class.rounded-r-md]="!bar.continues_after"
                    [class.cursor-grab]="bar.movable"
                    [class.pointer-events-none]="drag() !== null"
                    [class.opacity-50]="drag()?.bar?.reservation_room_id === bar.reservation_room_id"
                    [style.grid-row]="bar.row"
                    [style.grid-column]="bar.start + 2 + ' / span ' + bar.span"
                    [attr.title]="bar.title"
                    [attr.draggable]="bar.movable"
                    [attr.data-testid]="'rack-bar-' + bar.reservation_number"
                    (click)="detailId.set(bar.reservation_id)"
                    (dragstart)="onDragStart($event, bar, 'move')"
                    (dragend)="onDragEnd()"
                  >
                    @if (bar.continues_before) {
                      <span aria-hidden="true">‹&nbsp;</span>
                    }
                    <span class="truncate">{{ bar.guest || bar.reservation_number }}</span>
                    @if (bar.movable && !bar.continues_after) {
                      <span
                        class="absolute inset-y-0 right-0 hidden w-2 cursor-ew-resize rounded-r-md bg-current opacity-20 hover:opacity-50 md:block"
                        draggable="true"
                        title="Arrastra para alargar o acortar la estadía"
                        [attr.data-testid]="'rack-resize-' + bar.reservation_number"
                        (click)="$event.stopPropagation()"
                        (dragstart)="onDragStart($event, bar, 'resize')"
                      ></span>
                    }
                  </button>
                }
              </div>
            </div>
          }
        </div>
      </app-card>

      <app-reservation-detail-modal
        [reservationId]="detailId()"
        (closed)="detailId.set(null)"
        (changed)="load()"
      />

      <app-room-change-modal
        [target]="changeTarget()"
        (closed)="changeTarget.set(null)"
        (changed)="load()"
      />

      <app-room-block-modal
        [target]="blockTarget()"
        [units]="unitOptions()"
        (closed)="blockTarget.set(null)"
        (changed)="load()"
      />
    </div>
  `,
})
export class HospitalityRackPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly authFacade = inject(AuthFacade);

  readonly searchTerm = signal('');
  /** `days` empty = default 14-night window (not counted as an active filter). */
  readonly filterValues = signal<FilterValues>({});

  /** H5.3: blocking and releasing need the inventory write permission. */
  readonly canBlock = this.authFacade.hasPermission('store:lodging:inventory:write');

  readonly dropdownActions: DropdownAction[] = this.canBlock
    ? [{ label: 'Bloquear habitación', icon: 'lock', action: 'block', variant: 'primary' }]
    : [];

  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'unit_type_id',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos los tipos' },
        ...(this.rack()?.types ?? []).map((t) => ({ value: String(t.id), label: t.name })),
      ],
    },
    {
      key: 'days',
      label: 'Ventana',
      type: 'select',
      options: WINDOW_OPTIONS,
    },
  ]);

  /** Types shown after the search and the type filter. */
  readonly visibleTypes = computed<RackType[]>(() => {
    const term = this.searchTerm();
    const typeId = this.filterValues()['unit_type_id'];
    return (this.rack()?.types ?? []).filter(
      (t) => (!typeId || String(t.id) === typeId) && typeMatches(t, term),
    );
  });

  /** Window numbers of the visible types. */
  readonly stats = computed(() => {
    const types = this.visibleTypes();
    const rooms = types.reduce((sum, t) => sum + t.capacity, 0);
    const soldNights = types.reduce(
      (sum, t) => sum + t.sold.reduce((a, b) => a + b, 0),
      0,
    );
    const roomNights = rooms * this.days();
    const bars = types.flatMap((t) => t.bars);
    return {
      types: types.length,
      rooms,
      soldNights,
      roomNights,
      occupancy: roomNights ? Math.round((soldNights / roomNights) * 100) : 0,
      stays: new Set(bars.map((b) => b.reservation_id)).size,
      unassigned: bars.filter((b) => b.unit_id === null).length,
      blocks: types.reduce((sum, t) => sum + t.blocks.length, 0),
    };
  });

  /** The store's civil date, not the browser's (the desk may be elsewhere). */
  private readonly today = () => storeToday(this.settingsFacade.timezone());

  readonly from = signal(this.today());
  readonly days = signal(DEFAULT_DAYS);
  readonly rack = signal<Rack | null>(null);
  readonly loading = signal(false);
  readonly detailId = signal<number | null>(null);
  /** Bar being dragged and whether it moves or resizes. */
  readonly drag = signal<{ bar: PlacedBar; mode: DragMode } | null>(null);
  /** `rowKey:night` of the cell under the dragged bar. */
  readonly dropHover = signal<string | null>(null);
  readonly changeTarget = signal<RoomChangeTarget | null>(null);
  /** H5.3 — block being created or viewed. */
  readonly blockTarget = signal<RoomBlockTarget | null>(null);

  readonly gridColumns = computed(
    () => `minmax(6.5rem, 9rem) repeat(${this.days()}, minmax(2.5rem, 1fr))`,
  );

  readonly rangeLabel = computed(() => {
    const start = parseISO(this.from());
    const last = addDays(start, this.days() - 1);
    return `${format(start, 'd MMM', { locale: es })} – ${format(last, 'd MMM yyyy', { locale: es })}`;
  });

  readonly nightHeaders = computed(() => {
    const today = this.today();
    const start = parseISO(this.from());
    return Array.from({ length: this.days() }, (_, i) => {
      const date = addDays(start, i);
      const value = toDateString(date);
      return {
        date: value,
        weekday: format(date, 'EEEEEE', { locale: es }),
        day: format(date, 'd'),
        weekend: isWeekend(date),
        today: value === today,
      };
    });
  });

  /** Grid rows in order, with their 1-based CSS row. */
  private readonly layout = computed(() => {
    const rows: RackRow[] = [];
    const unitRow = new Map<number, number>();
    const laneRow = new Map<string, number>();
    const push = (row: Omit<RackRow, 'row'>) => {
      rows.push({ ...row, row: rows.length + 2 });
      return rows.length + 1;
    };
    for (const type of this.visibleTypes()) {
      const overbooked = type.sold.map((sold) => sold > type.capacity);
      const peak = Math.max(0, ...type.sold);
      push({
        kind: 'type',
        key: `t${type.id}`,
        label: type.name,
        typeId: type.id,
        free: type.free,
        held: type.held,
        blocked: type.blocked,
        overbooked,
        overbooking: peak > type.capacity ? `Sobreventa: ${peak}/${type.capacity}` : undefined,
      });
      for (const unit of type.units) {
        const outOfOrder =
          unit.housekeeping_status === 'out_of_order' ||
          unit.housekeeping_status === 'out_of_service';
        const row = push({
          kind: 'unit',
          key: `u${unit.id}`,
          label: unit.floor ? `${unit.code} · ${unit.floor}` : unit.code,
          typeId: type.id,
          unitId: unit.id,
          muted: !unit.is_active || outOfOrder,
          // H5.1 — housekeeping status set on the Housekeeping board.
          hint: !unit.is_active
            ? 'Inactiva'
            : outOfOrder || unit.housekeeping_status === 'dirty'
              ? HOUSEKEEPING_STATUS_LABELS[unit.housekeeping_status as HousekeepingStatus]
              : undefined,
        });
        unitRow.set(unit.id, row);
      }
      for (let lane = 0; lane < type.unassigned_lanes; lane++) {
        const row = push({
          kind: 'unassigned',
          key: `n${type.id}-${lane}`,
          label: 'Sin asignar',
          typeId: type.id,
        });
        laneRow.set(`${type.id}-${lane}`, row);
      }
    }
    return { rows, unitRow, laneRow };
  });

  readonly rows = computed(() => this.layout().rows);

  readonly bars = computed<PlacedBar[]>(() => {
    const { unitRow, laneRow } = this.layout();
    return this.visibleTypes().flatMap((type) =>
      type.bars.flatMap((bar) => {
        const row =
          bar.unit_id !== null ? unitRow.get(bar.unit_id) : laneRow.get(`${type.id}-${bar.lane}`);
        if (row === undefined) return [];
        return [
          {
            ...bar,
            row,
            classes: BAR_CLASSES[bar.status] ?? BAR_CLASSES.confirmed!,
            title: `${bar.reservation_number} · ${bar.guest} · ${RESERVATION_STATUS_LABELS[bar.status]} · ${bar.arrival_date} → ${bar.departure_date}`,
            movable: MOVABLE_STATUSES.includes(bar.status),
          },
        ];
      }),
    );
  });

  /** H5.3 — blocks placed on their room rows. */
  readonly blockBars = computed<PlacedBlock[]>(() => {
    const { unitRow } = this.layout();
    return this.visibleTypes().flatMap((type) =>
      type.blocks.flatMap((block) => {
        const row = unitRow.get(block.unit_id);
        if (row === undefined) return [];
        // H6.2 — an imported block is labelled with its channel ("Airbnb").
        const label =
          block.reason === 'ical' && block.notes
            ? block.notes
            : INVENTORY_BLOCK_REASON_LABELS[block.reason];
        return [
          {
            ...block,
            row,
            label,
            title: `${label} · ${block.from_date} → ${block.to_date}${block.notes && block.notes !== label ? ' · ' + block.notes : ''}`,
          },
        ];
      }),
    );
  });

  /** Rooms the manager can block: active rooms of the rack. */
  readonly unitOptions = computed(() =>
    (this.rack()?.types ?? []).flatMap((type) =>
      type.units
        .filter((unit) => unit.is_active)
        .map((unit) => ({ value: unit.id, label: `${unit.code} · ${type.name}` })),
    ),
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const from = this.from();
    const to = toDateString(addDays(parseISO(from), this.days()));
    this.loading.set(true);
    this.reservationsService
      .rack(from, to)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rack) => {
          this.rack.set(rack);
          this.loading.set(false);
        },
        error: (message: string) => {
          this.loading.set(false);
          this.toast.error(message);
        },
      });
  }

  onDragStart(event: DragEvent, bar: PlacedBar, mode: DragMode): void {
    event.stopPropagation();
    if (!bar.movable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData('text/plain', String(bar.reservation_room_id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    // Next tick: hiding bars from the pointer inside dragstart cancels the drag.
    setTimeout(() => this.drag.set({ bar, mode }));
  }

  onDragEnd(): void {
    this.drag.set(null);
    this.dropHover.set(null);
  }

  onDragOver(event: DragEvent, row: RackRow, night: number): void {
    if (this.proposalFor(row, night) === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropHover.set(`${row.key}:${night}`);
  }

  /** Validates the drop; a collision shows its message and nothing moves. */
  onDrop(event: DragEvent, row: RackRow, night: number): void {
    event.preventDefault();
    const bar = this.drag()?.bar;
    const proposal = this.proposalFor(row, night);
    this.onDragEnd();
    if (!bar || !proposal) return;
    this.reservationsService
      .changeQuote(bar.reservation_room_id, proposal)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (quote) =>
          this.changeTarget.set({
            reservation_room_id: bar.reservation_room_id,
            reservation_number: bar.reservation_number,
            guest: bar.guest,
            unit_id: bar.unit_id,
            arrival_date: bar.arrival_date,
            departure_date: bar.departure_date,
            proposal,
            quote,
          }),
        error: (message: string) => this.toast.error(message),
      });
  }

  /** Change a drop on `row`/`night` asks for, or null when it is not a target. */
  private proposalFor(row: RackRow, night: number): RoomChangeRequest | null {
    const drag = this.drag();
    if (!drag) return null;
    const { bar, mode } = drag;
    if (mode === 'move') {
      if (row.kind !== 'unit' || row.muted || row.unitId === undefined) return null;
      return row.unitId === bar.unit_id ? null : { unit_id: row.unitId };
    }
    // Resize: along the bar's own row; the hovered night becomes the last one.
    if (row.row !== bar.row) return null;
    const departure = toDateString(addDays(parseISO(this.from()), night + 1));
    if (departure <= bar.arrival_date || departure === bar.departure_date) return null;
    return { departure_date: departure };
  }

  openBlock(block: PlacedBlock): void {
    const row = this.rows().find((r) => r.unitId === block.unit_id);
    this.blockTarget.set({ mode: 'view', block, unit_label: row?.label ?? '' });
  }

  move(direction: 1 | -1): void {
    this.from.set(toDateString(addDays(parseISO(this.from()), direction * STEP_DAYS)));
    this.load();
  }

  goToday(): void {
    this.from.set(this.today());
    this.load();
  }

  onFilterChange(values: FilterValues): void {
    const days = Number(values['days']) === 30 ? 30 : DEFAULT_DAYS;
    this.filterValues.set({ ...values, days: days === 30 ? '30' : '' });
    if (days !== this.days()) {
      this.days.set(days);
      this.load();
    }
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.onFilterChange({});
  }

  onActionClick(action: string): void {
    if (action === 'block' && this.canBlock) this.blockTarget.set({ mode: 'create', from_date: this.from() });
  }
}
