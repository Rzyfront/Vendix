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
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import { UnitTypesService } from '../../../rooms/services/unit-types.service';
import { ReservationFormModalComponent } from '../../components/reservation-form-modal/reservation-form-modal.component';
import {
  countNights,
  LodgingReservation,
  RESERVATION_STATUS_LABELS,
  toDateOnly,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

interface ReservationRow extends LodgingReservation {
  guest: string;
  room_type: string;
  stay: string;
  nights: string;
  total: string;
}

/**
 * Hospitality Suite — Reservas. H1.1: create a nightly reservation and see it
 * in the list with its number and status. Search, detail and cancellation
 * arrive in H1.2.
 */
@Component({
  selector: 'app-hospitality-reservations-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StickyHeaderComponent,
    EmptyStateComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    ResponsiveDataViewComponent,
    ReservationFormModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Reservas"
        subtitle="Reservas por noches de tu hotel"
        icon="calendar-check"
        variant="glass"
      />

      <div class="p-2 md:p-4">
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex items-center justify-between gap-2">
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
              >
                Reservas ({{ reservations().length }})
              </h2>
              <app-button
                variant="primary"
                size="md"
                [disabled]="!hasActiveTypes()"
                (clicked)="isFormOpen.set(true)"
              >
                <app-icon slot="icon" name="plus" [size]="16" />
                Nueva reserva
              </app-button>
            </div>
          </div>

          <div class="px-2 pb-2 pt-3 md:p-4">
            @if (isLoading()) {
              <div class="flex flex-col items-center gap-2 py-8">
                <app-spinner size="md" />
                <p class="text-sm text-text-secondary">Cargando reservas…</p>
              </div>
            } @else if (reservations().length === 0 && !hasActiveTypes()) {
              <app-empty-state
                icon="bed-double"
                title="Primero crea tus habitaciones"
                description="Las reservas se hacen sobre los tipos de habitación activos de Hotelería → Habitaciones."
              />
            } @else if (reservations().length === 0) {
              <app-empty-state
                icon="calendar-check"
                title="Aún no tienes reservas"
                description="Crea una reserva por noches para bloquear las habitaciones de esas fechas."
                actionButtonText="Nueva reserva"
                actionButtonIcon="plus"
                [showActionButton]="true"
                (actionClick)="isFormOpen.set(true)"
              />
            } @else {
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [loading]="isLoading()"
                [striped]="true"
                [hoverable]="true"
              />
            }
          </div>
        </app-card>
      </div>

      <app-reservation-form-modal
        [isOpen]="isFormOpen()"
        [unitTypes]="unitTypes()"
        (isOpenChange)="isFormOpen.set($event)"
        (saved)="loadReservations()"
      />
    </div>
  `,
})
export class HospitalityReservationsPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly unitTypesService = inject(UnitTypesService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly reservations = signal<LodgingReservation[]>([]);
  readonly unitTypes = signal<UnitType[]>([]);
  readonly isLoading = signal(true);
  readonly isFormOpen = signal(false);

  readonly hasActiveTypes = computed(() => this.unitTypes().some((t) => t.is_active));

  readonly rows = computed<ReservationRow[]>(() =>
    this.reservations().map((r) => {
      const arrival = toDateOnly(r.arrival_date);
      const departure = toDateOnly(r.departure_date);
      return {
        ...r,
        guest: [r.customer.first_name, r.customer.last_name].filter(Boolean).join(' '),
        room_type: r.rooms.map((room) => room.unit_type.name).join(', '),
        stay: `${arrival} → ${departure}`,
        nights: String(countNights(arrival, departure)),
        total: this.currency.format(Number(r.total_amount), 0),
      };
    }),
  );

  readonly columns: TableColumn[] = [
    { key: 'reservation_number', label: 'Reserva', sortable: true },
    { key: 'guest', label: 'Huésped' },
    { key: 'room_type', label: 'Tipo' },
    { key: 'stay', label: 'Llegada → Salida' },
    { key: 'nights', label: 'Noches', align: 'center' },
    { key: 'total', label: 'Total', align: 'right' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (value: keyof typeof RESERVATION_STATUS_LABELS) =>
        RESERVATION_STATUS_LABELS[value] ?? value,
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'reservation_number',
    subtitleKey: 'guest',
    badgeKey: 'status',
    badgeConfig: { type: 'status' },
    badgeTransform: (value: keyof typeof RESERVATION_STATUS_LABELS) =>
      RESERVATION_STATUS_LABELS[value] ?? value,
    detailKeys: [
      { key: 'room_type', label: 'Tipo' },
      { key: 'stay', label: 'Estadía' },
      { key: 'nights', label: 'Noches' },
    ],
    footerKey: 'total',
    footerLabel: 'Total',
  };

  ngOnInit(): void {
    this.loadReservations();
    this.unitTypesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.unitTypes.set(list),
        error: (message: unknown) =>
          this.toastService.error(
            typeof message === 'string'
              ? message
              : 'No se pudieron cargar los tipos de habitación',
          ),
      });
  }

  loadReservations(): void {
    this.isLoading.set(true);
    this.reservationsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.reservations.set(list);
          this.isLoading.set(false);
        },
        error: (message: unknown) => {
          this.isLoading.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar las reservas',
          );
        },
      });
  }
}
