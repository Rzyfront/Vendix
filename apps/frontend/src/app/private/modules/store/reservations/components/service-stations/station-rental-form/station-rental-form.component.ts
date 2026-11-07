import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components';
import {
  BookingPrepayMode,
  RentalBlockUnit,
  StationBookingDurationMode,
  StationRentalRules,
} from '../service-stations.service';

/** Minutes in each display unit (the stored measure is always minutes). */
export const RENTAL_UNIT_MINUTES: Record<RentalBlockUnit, number> = { minute: 1, hour: 60, day: 1440 };

const MAX_BLOCK_MINUTES = 1440;

/** Defaults of a new station: no rental rate, charge the time used at the end, no prepay. */
export const DEFAULT_RENTAL_RULES: StationRentalRules = {
  rental_block_minutes: null,
  rental_block_price: null,
  rental_block_unit: 'hour',
  rental_billing_mode: 'elapsed',
  rental_charge_timing: 'at_end',
  booking_prepay_mode: 'none',
  booking_prepay_percent: null,
  booking_prepay_amount: null,
};

type StationRentalSource = Partial<
  Omit<StationRentalRules, 'rental_block_price' | 'booking_prepay_percent' | 'booking_prepay_amount'>
> & {
  rental_block_price?: number | string | null;
  booking_prepay_percent?: number | string | null;
  booking_prepay_amount?: number | string | null;
};

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Builds the form value from a station row (missing fields fall back to the defaults). */
export function stationRentalFrom(station: StationRentalSource | null | undefined): StationRentalRules {
  const minutes = toNullableNumber(station?.rental_block_minutes);
  return {
    rental_block_minutes: minutes,
    rental_block_price: toNullableNumber(station?.rental_block_price),
    rental_block_unit: station?.rental_block_unit ?? DEFAULT_RENTAL_RULES.rental_block_unit,
    rental_billing_mode: station?.rental_billing_mode ?? DEFAULT_RENTAL_RULES.rental_billing_mode,
    rental_charge_timing: station?.rental_charge_timing ?? DEFAULT_RENTAL_RULES.rental_charge_timing,
    booking_prepay_mode: station?.booking_prepay_mode ?? DEFAULT_RENTAL_RULES.booking_prepay_mode,
    booking_prepay_percent: toNullableNumber(station?.booking_prepay_percent),
    booking_prepay_amount: toNullableNumber(station?.booking_prepay_amount),
  };
}

/** Payload fragment: block fields travel together; prepay percent/amount only in partial mode (exactly one). */
export function stationRentalPayload(rules: StationRentalRules): StationRentalRules {
  const hasBlock = rules.rental_block_minutes != null && rules.rental_block_price != null;
  const partial = rules.booking_prepay_mode === 'partial';
  const usesAmount = partial && rules.booking_prepay_amount != null;
  return {
    ...rules,
    rental_block_minutes: hasBlock ? rules.rental_block_minutes : null,
    rental_block_price: hasBlock ? rules.rental_block_price : null,
    booking_prepay_percent: partial && !usesAmount ? rules.booking_prepay_percent : null,
    booking_prepay_amount: usesAmount ? rules.booking_prepay_amount : null,
  };
}

/** Returns an error message when the rental rules cannot be saved, null otherwise. */
export function stationRentalError(rules: StationRentalRules): string | null {
  const hasMinutes = rules.rental_block_minutes != null;
  const hasPrice = rules.rental_block_price != null;
  if (hasMinutes !== hasPrice) {
    return hasMinutes ? 'Indica el precio del bloque de alquiler.' : 'Indica la duración del bloque de alquiler.';
  }
  if (hasMinutes) {
    const minutes = Number(rules.rental_block_minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_BLOCK_MINUTES) {
      return 'El bloque de alquiler debe durar entre 1 minuto y 1 día.';
    }
    if (Number(rules.rental_block_price) < 0) return 'El precio del bloque no puede ser negativo.';
  }
  if (rules.booking_prepay_mode === 'partial') {
    const percent = rules.booking_prepay_percent;
    const amount = rules.booking_prepay_amount;
    if ((percent == null) === (amount == null)) return 'Indica el porcentaje o el monto del abono para reservar.';
    if (percent != null && !(percent >= 0.01 && percent <= 99.99)) {
      return 'El porcentaje del abono debe estar entre 0,01 y 99,99.';
    }
    if (amount != null && !(amount > 0)) return 'El monto del abono debe ser mayor que cero.';
  }
  return null;
}

/** One-line summary of the rule for the station card, e.g. "Alquiler $80.000 / 1 h · Abono 30 %". */
export function stationRentalSummary(
  station: StationRentalSource | null | undefined,
  formatMoney: (amount: number) => string,
): string | null {
  const rules = stationRentalFrom(station);
  const parts: string[] = [];
  if (rules.rental_block_minutes != null && rules.rental_block_price != null) {
    parts.push(
      `Alquiler ${formatMoney(rules.rental_block_price)} / ${formatBlock(rules.rental_block_minutes, rules.rental_block_unit)}`,
    );
  }
  if (rules.booking_prepay_mode === 'full') parts.push('Pago total para reservar');
  if (rules.booking_prepay_mode === 'partial') {
    if (rules.booking_prepay_percent != null) parts.push(`Abono ${rules.booking_prepay_percent} %`);
    else if (rules.booking_prepay_amount != null) parts.push(`Abono ${formatMoney(rules.booking_prepay_amount)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** "1 h", "90 min", "2 días" from stored minutes and the display unit (exact multiples only). */
export function formatBlock(minutes: number, unit: RentalBlockUnit): string {
  const factor = RENTAL_UNIT_MINUTES[unit];
  if (unit !== 'minute' && minutes % factor === 0) {
    const amount = minutes / factor;
    if (unit === 'hour') return `${amount} h`;
    return amount === 1 ? '1 día' : `${amount} días`;
  }
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** "Tarifa de alquiler y cobro para reservar" section of the station create/edit forms (S1, phase 3). */
@Component({
  selector: 'app-station-rental-form',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../station-form-section.scss',
  template: `
    <section class="station-section" aria-labelledby="station-rental-title">
      <div class="station-section__head">
        <h4 id="station-rental-title" class="station-section__title">Tarifa de alquiler</h4>
        <p class="station-section__hint">
          Deja la duración y el precio vacíos si la estación no cobra alquiler por tiempo.
        </p>
      </div>

      <div class="station-section__grid station-section__grid--3">
        <app-input
          label="Duración del bloque"
          type="number"
          min="0"
          step="any"
          [ngModel]="blockAmount()"
          (ngModelChange)="setBlockAmount($event)"
          placeholder="Ej. 1"
        />
        <app-selector
          label="Unidad"
          [options]="unitOptions"
          [ngModel]="value().rental_block_unit"
          (ngModelChange)="setUnit($event)"
        />
        <app-input
          label="Precio del bloque"
          [currency]="true"
          [ngModel]="value().rental_block_price"
          (ngModelChange)="patch({ rental_block_price: toNullableNumber($event) })"
          placeholder="Ej. 80000"
        />
      </div>

      @if (hasBlock()) {
        <div class="station-section__grid">
          <app-selector
            label="Qué se cobra"
            [options]="billingOptions"
            [ngModel]="value().rental_billing_mode"
            (ngModelChange)="patch({ rental_billing_mode: $event })"
          />
          <app-selector
            label="Cuándo se cobra"
            [options]="timingOptions"
            [ngModel]="value().rental_charge_timing"
            (ngModelChange)="patch({ rental_charge_timing: $event })"
          />
        </div>

        @if (suggestPlanned()) {
          <p
            class="flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)] p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
          >
            <app-icon name="info" [size]="14" class="shrink-0 mt-px text-[var(--color-primary)]" />
            <span>
              Esta estación se reserva con inicio y fin fijos: te conviene
              <strong>Cobrar el tiempo reservado</strong>, así el alquiler no cambia si el cliente se va antes.
            </span>
          </p>
        }
      }

      <div class="station-section__group">
        <div>
          <h4 class="station-section__title">Cobro para reservar</h4>
          <p class="station-section__hint">
            Lo que el cliente paga al reservar. Es independiente del anticipo consumible.
          </p>
        </div>

        <app-selector
          label="Para reservar se cobra"
          [options]="prepayOptions"
          [ngModel]="value().booking_prepay_mode"
          (ngModelChange)="setPrepayMode($event)"
        />

        @if (value().booking_prepay_mode === 'partial') {
          <div class="station-section__grid">
            <app-selector
              label="El abono se define como"
              [options]="basisOptions"
              [ngModel]="prepayBasis()"
              (ngModelChange)="setPrepayBasis($event)"
            />
            @if (prepayBasis() === 'percent') {
              <app-input
                label="Porcentaje de la tarifa (%)"
                type="number"
                min="0.01"
                max="99.99"
                step="0.01"
                [ngModel]="value().booking_prepay_percent"
                (ngModelChange)="patch({ booking_prepay_percent: toNullableNumber($event) })"
                placeholder="Ej. 30"
              />
            } @else {
              <app-input
                label="Monto del abono"
                [currency]="true"
                [ngModel]="value().booking_prepay_amount"
                (ngModelChange)="patch({ booking_prepay_amount: toNullableNumber($event) })"
                placeholder="Ej. 50000"
              />
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class StationRentalFormComponent {
  /** Two-way bound form value. */
  readonly value = model.required<StationRentalRules>();
  /** Booking duration mode of the station rules form; `fixed` nudges "planned" billing; a new station starts `free`. */
  readonly bookingDurationMode = input<StationBookingDurationMode>('free');

  readonly unitOptions: SelectorOption[] = [
    { value: 'minute', label: 'Minutos' },
    { value: 'hour', label: 'Horas' },
    { value: 'day', label: 'Días' },
  ];
  readonly billingOptions: SelectorOption[] = [
    { value: 'elapsed', label: 'Cobrar el tiempo usado' },
    { value: 'planned', label: 'Cobrar el tiempo reservado' },
  ];
  readonly timingOptions: SelectorOption[] = [
    { value: 'at_end', label: 'Al cerrar la atención' },
    { value: 'at_start', label: 'Al abrir la atención' },
  ];
  readonly prepayOptions: SelectorOption[] = [
    { value: 'none', label: 'Nada' },
    { value: 'full', label: 'Pago total del alquiler' },
    { value: 'partial', label: 'Abono' },
  ];
  readonly basisOptions: SelectorOption[] = [
    { value: 'percent', label: 'Porcentaje de la tarifa' },
    { value: 'amount', label: 'Monto fijo' },
  ];

  /** Percent-or-amount choice of the partial prepay; starts from whichever the station already has. */
  private readonly basisOverride = signal<'percent' | 'amount' | null>(null);
  readonly prepayBasis = computed<'percent' | 'amount'>(
    () => this.basisOverride() ?? (this.value().booking_prepay_amount != null ? 'amount' : 'percent'),
  );

  readonly hasBlock = computed(() => this.value().rental_block_minutes != null && this.value().rental_block_price != null);
  readonly suggestPlanned = computed(
    () => this.bookingDurationMode() === 'fixed' && this.value().rental_billing_mode === 'elapsed',
  );

  /** Block length shown in the chosen unit (the model keeps minutes). */
  readonly blockAmount = computed(() => {
    const minutes = this.value().rental_block_minutes;
    if (minutes == null) return null;
    return Number((minutes / RENTAL_UNIT_MINUTES[this.value().rental_block_unit]).toFixed(2));
  });

  protected readonly toNullableNumber = toNullableNumber;

  patch(change: Partial<StationRentalRules>): void {
    this.value.update((current) => ({ ...current, ...change }));
  }

  setBlockAmount(raw: unknown): void {
    const amount = toNullableNumber(raw);
    if (amount == null || amount <= 0) {
      this.patch({ rental_block_minutes: null });
      return;
    }
    const factor = RENTAL_UNIT_MINUTES[this.value().rental_block_unit];
    this.patch({ rental_block_minutes: Math.round(amount * factor) });
  }

  /** Changing the unit keeps the number on screen and recomputes the stored minutes. */
  setUnit(unit: RentalBlockUnit): void {
    const amount = this.blockAmount();
    this.patch({
      rental_block_unit: unit,
      ...(amount != null ? { rental_block_minutes: Math.round(amount * RENTAL_UNIT_MINUTES[unit]) } : {}),
    });
  }

  setPrepayMode(mode: BookingPrepayMode): void {
    this.basisOverride.set(null);
    this.patch({
      booking_prepay_mode: mode,
      booking_prepay_percent: mode === 'partial' ? (this.value().booking_prepay_percent ?? 30) : null,
      booking_prepay_amount: null,
    });
  }

  setPrepayBasis(basis: 'percent' | 'amount'): void {
    this.basisOverride.set(basis);
    this.patch(
      basis === 'percent'
        ? { booking_prepay_amount: null, booking_prepay_percent: this.value().booking_prepay_percent ?? 30 }
        : { booking_prepay_percent: null },
    );
  }
}
