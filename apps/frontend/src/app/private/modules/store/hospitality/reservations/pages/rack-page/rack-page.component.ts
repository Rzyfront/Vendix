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
import { addDays, format, isWeekend, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { ReservationDetailModalComponent } from '../../components/reservation-detail-modal/reservation-detail-modal.component';
import {
  LodgingReservationStatus,
  Rack,
  RackBar,
  RESERVATION_STATUS_LABELS,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

/** Days the arrows move the window. */
const STEP_DAYS = 14;

/** Window sizes the desk can pick. */
const WINDOW_OPTIONS: SelectorOption[] = [
  { value: 14, label: '14 días' },
  { value: 30, label: '30 días' },
];

/** One status, one shade of the theme's single accent. */
const BAR_CLASSES: Partial<Record<LodgingReservationStatus, string>> = {
  tentative: 'border border-dashed border-primary bg-primary/5 text-primary',
  confirmed: 'border border-primary/40 bg-primary/15 text-primary',
  checked_in: 'border border-primary bg-primary text-white',
  checked_out: 'border border-border bg-surface-secondary text-text-secondary',
};

interface RackRow {
  kind: 'type' | 'unit' | 'unassigned';
  key: string;
  label: string;
  /** 1-based CSS grid row (row 1 is the nights header). */
  row: number;
  typeId: number;
  free?: number[];
  muted?: boolean;
  hint?: string;
}

interface PlacedBar extends RackBar {
  row: number;
  classes: string;
  title: string;
}

const toDateString = (date: Date) => format(date, 'yyyy-MM-dd');

/**
 * Hospitality Suite (H1.3) — occupancy rack (read only): rooms grouped by type
 * × nights, stays as bars coloured by status. CSS grid + date-fns (D7: no
 * paid or GPL timeline). Rows: the type with its free rooms per night, its
 * rooms, and a "Sin asignar" row per lane of unassigned stays. Tapping a bar
 * opens the reservation detail.
 */
@Component({
  selector: 'app-hospitality-rack-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    IconComponent,
    SelectorComponent,
    SpinnerComponent,
    StickyHeaderComponent,
    ReservationDetailModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Rack"
        subtitle="Ocupación de habitaciones por noches"
        icon="layout-grid"
        variant="glass"
      />

      <div class="p-2 md:p-4">
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div
            class="flex flex-wrap items-center justify-between gap-2 px-2 py-2 md:px-6 md:py-4 md:border-b md:border-border"
          >
            <div class="flex items-center gap-1">
              <app-button
                variant="outline"
                size="sm"
                ariaLabel="14 días antes"
                (clicked)="move(-1)"
              >
                <app-icon slot="icon" name="chevron-left" [size]="16" />
              </app-button>
              <app-button variant="outline" size="sm" (clicked)="goToday()">Hoy</app-button>
              <app-button
                variant="outline"
                size="sm"
                ariaLabel="14 días después"
                (clicked)="move(1)"
              >
                <app-icon slot="icon" name="chevron-right" [size]="16" />
              </app-button>
              <span class="ml-2 text-sm font-medium text-text-primary" data-testid="rack-range">
                {{ rangeLabel() }}
              </span>
            </div>
            <app-selector
              class="w-32"
              size="sm"
              [options]="windowOptions"
              [value]="days()"
              (valueChange)="setDays($event)"
            />
          </div>

          @if (loading() && !rack()) {
            <div class="flex justify-center py-10"><app-spinner size="md" /></div>
          } @else if (rows().length === 0) {
            <p class="px-4 py-10 text-center text-sm text-text-secondary">
              Aún no hay tipos de habitación activos. Créalos en Hotelería → Habitaciones.
            </p>
          } @else {
            <div class="overflow-x-auto" data-testid="rack-scroll">
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
                    {{ row.label }}
                  </div>
                  @for (night of nightHeaders(); track night.date; let i = $index) {
                    <div
                      class="flex items-center justify-center border-b border-r border-border/50"
                      [class.bg-surface-secondary]="row.kind === 'type' || night.weekend"
                      [class.bg-surface]="row.kind !== 'type' && !night.weekend"
                      [style.grid-row]="row.row"
                      [style.grid-column]="i + 2"
                    >
                      @if (row.free) {
                        <span
                          class="text-[10px]"
                          [class.text-text-secondary]="row.free[i] > 0"
                          [class.text-primary]="row.free[i] === 0"
                          [class.font-bold]="row.free[i] === 0"
                          [attr.title]="row.free[i] + ' libres'"
                          >{{ row.free[i] }}</span
                        >
                      }
                    </div>
                  }
                }

                @for (bar of bars(); track bar.reservation_room_id) {
                  <button
                    type="button"
                    class="z-10 mx-0.5 my-1 flex min-w-0 items-center truncate px-1.5 text-left text-[11px] font-medium"
                    [class]="bar.classes"
                    [class.rounded-l-md]="!bar.continues_before"
                    [class.rounded-r-md]="!bar.continues_after"
                    [style.grid-row]="bar.row"
                    [style.grid-column]="bar.start + 2 + ' / span ' + bar.span"
                    [attr.title]="bar.title"
                    [attr.data-testid]="'rack-bar-' + bar.reservation_number"
                    (click)="detailId.set(bar.reservation_id)"
                  >
                    @if (bar.continues_before) {
                      <span aria-hidden="true">‹&nbsp;</span>
                    }
                    <span class="truncate">{{ bar.guest || bar.reservation_number }}</span>
                  </button>
                }
              </div>
            </div>
          }
        </app-card>
      </div>

      <app-reservation-detail-modal
        [reservationId]="detailId()"
        (closed)="detailId.set(null)"
        (changed)="load()"
      />
    </div>
  `,
})
export class HospitalityRackPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly windowOptions = WINDOW_OPTIONS;

  readonly from = signal(toDateString(new Date()));
  readonly days = signal(14);
  readonly rack = signal<Rack | null>(null);
  readonly loading = signal(false);
  readonly detailId = signal<number | null>(null);

  readonly gridColumns = computed(
    () => `minmax(6.5rem, 9rem) repeat(${this.days()}, minmax(2.5rem, 1fr))`,
  );

  readonly rangeLabel = computed(() => {
    const start = parseISO(this.from());
    const last = addDays(start, this.days() - 1);
    return `${format(start, 'd MMM', { locale: es })} – ${format(last, 'd MMM yyyy', { locale: es })}`;
  });

  readonly nightHeaders = computed(() => {
    const today = toDateString(new Date());
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
    for (const type of this.rack()?.types ?? []) {
      push({ kind: 'type', key: `t${type.id}`, label: type.name, typeId: type.id, free: type.free });
      for (const unit of type.units) {
        const outOfOrder =
          unit.housekeeping_status === 'out_of_order' ||
          unit.housekeeping_status === 'out_of_service';
        const row = push({
          kind: 'unit',
          key: `u${unit.id}`,
          label: unit.floor ? `${unit.code} · ${unit.floor}` : unit.code,
          typeId: type.id,
          muted: !unit.is_active || outOfOrder,
          hint: !unit.is_active ? 'Inactiva' : outOfOrder ? 'Fuera de servicio' : undefined,
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
    return (this.rack()?.types ?? []).flatMap((type) =>
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
          },
        ];
      }),
    );
  });

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

  move(direction: 1 | -1): void {
    this.from.set(toDateString(addDays(parseISO(this.from()), direction * STEP_DAYS)));
    this.load();
  }

  goToday(): void {
    this.from.set(toDateString(new Date()));
    this.load();
  }

  setDays(value: string | number | null): void {
    const days = Number(value);
    if (days !== 14 && days !== 30) return;
    this.days.set(days);
    this.load();
  }
}
