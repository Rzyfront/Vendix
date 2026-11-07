import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  InputComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components';
import { StationDepositPolicy, StationRules } from '../service-stations.service';

/**
 * Defaults applied to a new station. Booking duration starts free (the schema default is
 * still `fixed`, so a station row that lacks the field keeps `fixed`).
 */
export const DEFAULT_STATION_RULES: StationRules = {
  deposit_policy: 'none',
  deposit_amount: null,
  deposit_exhausted_policy: 'overflow',
  leftover_policy: 'refund_or_credit',
  booking_duration_mode: 'free',
  hold_minutes: 30,
  open_end_block_minutes: 360,
  cancel_refund_hours: null,
  reservation_fee_tax_category_id: null,
};

/** Builds the form value from a station row (missing fields fall back to the defaults). */
type StationRulesSource = Partial<Omit<StationRules, 'deposit_amount'>> & { deposit_amount?: number | string | null };

export function stationRulesFrom(station: StationRulesSource | null | undefined): StationRules {
  const amount = station?.deposit_amount;
  return {
    deposit_policy: station?.deposit_policy ?? DEFAULT_STATION_RULES.deposit_policy,
    deposit_amount: amount == null ? null : Number(amount),
    deposit_exhausted_policy: station?.deposit_exhausted_policy ?? DEFAULT_STATION_RULES.deposit_exhausted_policy,
    leftover_policy: station?.leftover_policy ?? DEFAULT_STATION_RULES.leftover_policy,
    // Editing keeps the stored value; only a new station (no row) starts free.
    booking_duration_mode: station
      ? (station.booking_duration_mode ?? 'fixed')
      : DEFAULT_STATION_RULES.booking_duration_mode,
    hold_minutes: station?.hold_minutes ?? DEFAULT_STATION_RULES.hold_minutes,
    open_end_block_minutes: station?.open_end_block_minutes ?? DEFAULT_STATION_RULES.open_end_block_minutes,
    cancel_refund_hours: station?.cancel_refund_hours ?? null,
    reservation_fee_tax_category_id: station?.reservation_fee_tax_category_id ?? null,
  };
}

/** Payload fragment: no amount without a policy, and a required deposit needs an amount. */
export function stationRulesPayload(rules: StationRules): StationRules {
  const hasDeposit = rules.deposit_policy !== 'none';
  return { ...rules, deposit_amount: hasDeposit ? rules.deposit_amount : null };
}

/** Returns an error message when the rules cannot be saved, null otherwise. */
export function stationRulesError(rules: StationRules): string | null {
  if (rules.deposit_policy !== 'none' && !(Number(rules.deposit_amount) > 0)) {
    return 'Indica el monto del anticipo.';
  }
  if (!(rules.hold_minutes >= 1)) return 'Los minutos de apartado deben ser al menos 1.';
  if (!(rules.open_end_block_minutes >= 1)) return 'El bloqueo de una reserva sin fin debe ser de al menos 1 minuto.';
  return null;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function toNullablePositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** "Reglas de uso y anticipo" section of the station create/edit forms (S1). */
@Component({
  selector: 'app-station-rules-form',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../station-form-section.scss',
  template: `
    <section class="station-section" aria-labelledby="station-rules-title">
      <div class="station-section__head">
        <h4 id="station-rules-title" class="station-section__title">Reglas de uso y anticipo</h4>
        <p class="station-section__hint">
          Cada atención copia estas reglas al abrirse; cambiarlas no altera las atenciones abiertas.
        </p>
      </div>

      <app-selector
        label="Anticipo"
        [options]="depositPolicyOptions"
        [ngModel]="value().deposit_policy"
        (ngModelChange)="setDepositPolicy($event)"
      />

      @if (hasDeposit()) {
        <app-input
          label="Monto del anticipo"
          [currency]="true"
          [ngModel]="value().deposit_amount"
          (ngModelChange)="patch({ deposit_amount: $event === '' || $event == null ? null : +$event })"
          placeholder="Ej. 400000"
        />
        <app-selector
          label="Cuando se agota"
          [options]="exhaustedOptions"
          [ngModel]="value().deposit_exhausted_policy"
          (ngModelChange)="patch({ deposit_exhausted_policy: $event })"
        />
        <app-selector
          label="Si sobra al cerrar"
          [options]="leftoverOptions"
          [ngModel]="value().leftover_policy"
          (ngModelChange)="patch({ leftover_policy: $event })"
        />
      }

      <app-selector
        label="Duración de reserva"
        [options]="durationOptions"
        [ngModel]="value().booking_duration_mode"
        (ngModelChange)="patch({ booking_duration_mode: $event })"
      />

      <div class="station-section__grid station-section__grid--3">
        <app-input
          label="Minutos de apartado"
          type="number"
          [ngModel]="value().hold_minutes"
          (ngModelChange)="patch({ hold_minutes: toPositiveInt($event, 30) })"
        />
        <app-input
          label="Bloqueo de una reserva sin fin (min)"
          type="number"
          [ngModel]="value().open_end_block_minutes"
          (ngModelChange)="patch({ open_end_block_minutes: toPositiveInt($event, 360) })"
        />
        <app-input
          label="Horas para cancelar con devolución"
          type="number"
          [ngModel]="value().cancel_refund_hours"
          (ngModelChange)="patch({ cancel_refund_hours: toNullablePositiveInt($event) })"
          placeholder="Vacío = sin devolución"
        />
      </div>

      @if (hasMinimumSpend()) {
        <app-selector
          label="Impuesto de Gastos de reserva (opcional)"
          [options]="taxOptions()"
          [ngModel]="value().reservation_fee_tax_category_id"
          (ngModelChange)="patch({ reservation_fee_tax_category_id: toTaxId($event) })"
          [helpText]="taxLoading() ? 'Cargando impuestos…' : 'Sin impuesto, la línea se factura tal cual.'"
        />
      }
    </section>
  `,
})
export class StationRulesFormComponent {
  /** Two-way bound form value. */
  readonly value = model.required<StationRules>();
  /** "Sin impuesto" + the tax category options built by the parent. */
  readonly taxOptions = input<SelectorOption[]>([]);
  readonly taxLoading = input(false);

  readonly depositPolicyOptions: SelectorOption[] = [
    { value: 'none', label: 'Sin anticipo' },
    { value: 'optional', label: 'Opcional' },
    { value: 'required', label: 'Obligatorio' },
  ];
  readonly exhaustedOptions: SelectorOption[] = [
    { value: 'recharge', label: 'Pedir recarga' },
    { value: 'overflow', label: 'Cobrar el excedente al final' },
  ];
  readonly leftoverOptions: SelectorOption[] = [
    { value: 'refund_or_credit', label: 'Devolver o dejar como saldo a favor' },
    { value: 'minimum_spend', label: 'Consumo mínimo (se factura como Gastos de reserva)' },
  ];
  readonly durationOptions: SelectorOption[] = [
    { value: 'fixed', label: 'Fija (inicio y fin)' },
    { value: 'free', label: 'Libre (solo inicio)' },
  ];

  readonly hasDeposit = computed(() => this.value().deposit_policy !== 'none');
  readonly hasMinimumSpend = computed(() => this.hasDeposit() && this.value().leftover_policy === 'minimum_spend');

  protected readonly toPositiveInt = toPositiveInt;
  protected readonly toNullablePositiveInt = toNullablePositiveInt;

  patch(change: Partial<StationRules>): void {
    this.value.update((current) => ({ ...current, ...change }));
  }

  setDepositPolicy(policy: StationDepositPolicy): void {
    this.patch({ deposit_policy: policy, ...(policy === 'none' ? { deposit_amount: null } : {}) });
  }

  toTaxId(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
}
