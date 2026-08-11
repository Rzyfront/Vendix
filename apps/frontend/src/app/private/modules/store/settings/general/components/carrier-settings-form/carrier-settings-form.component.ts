import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import {
  AlertBannerComponent,
  BadgeComponent,
  ExpandableCardComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../../shared/components/index';
import type { SelectorOption } from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import type {
  CarrierSettings,
  CarrierTariffMode,
} from '../../../../../../../core/models/store-settings.interface';

const DEFAULT_MODE: CarrierTariffMode = 'per_stop';

/** Stop count used by the on-screen worked example. */
const EXAMPLE_STOPS = 12;

/**
 * Reparto — default store carrier tariff (Vendix Repartos F9). Follows the
 * `input(settings) + output(settingsChange)` pattern of the sibling
 * `DispatchSettingsForm`, representing
 * `store_settings.settings.carrier.default_tariff`.
 *
 * Money travels as a Decimal string (never a float); the currency input keeps a
 * raw numeric CVA value, so it is stringified with 2 decimals on emit. Zoneless:
 * form state is patched with `emitEvent: false` and user edits are surfaced via
 * `valueChanges` (no NgZone / manual change detection). The worked example reads
 * a signal mirror of the form (`FormControl.value` is a plain getter and would
 * never make a `computed` recompute) and formats money through
 * `CurrencyFormatService` so no currency symbol is hardcoded.
 */
@Component({
  selector: 'app-carrier-settings-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    AlertBannerComponent,
    BadgeComponent,
    ExpandableCardComponent,
    IconComponent,
  ],
  templateUrl: './carrier-settings-form.component.html',
})
export class CarrierSettingsForm {
  readonly settings = input.required<CarrierSettings>();
  readonly settingsChange = output<CarrierSettings>();

  private readonly currency = inject(CurrencyFormatService);

  readonly modeOptions: SelectorOption[] = [
    {
      value: 'per_stop',
      label: 'Por parada',
      description: 'Se multiplica por las paradas entregadas',
    },
    {
      value: 'per_route',
      label: 'Por ruta',
      description: 'Monto fijo por ruta cerrada',
    },
  ];

  readonly form = new FormGroup({
    mode: new FormControl<CarrierTariffMode>(DEFAULT_MODE, {
      nonNullable: true,
    }),
    amount: new FormControl<number>(0, { nonNullable: true }),
  });

  /** Signal mirror of the live form value; drives the worked example. */
  private readonly snapshot = signal<{ mode: CarrierTariffMode; amount: number }>({
    mode: DEFAULT_MODE,
    amount: 0,
  });

  readonly isPerStop = computed(() => this.snapshot().mode === 'per_stop');
  readonly amount = computed(() => this.snapshot().amount);
  readonly exampleStops = EXAMPLE_STOPS;

  /** `format()` reads the currency signal, so these recompute on tenant load. */
  readonly amountLabel = computed(() => this.formatMoney(this.amount()));
  readonly perStopTotalLabel = computed(() =>
    this.formatMoney(this.amount() * EXAMPLE_STOPS),
  );
  readonly zeroLabel = computed(() => this.formatMoney(0));

  constructor() {
    void this.currency.loadCurrency();

    // Mirror the incoming settings into the form without echoing back (so the
    // emit below only fires on genuine user edits).
    effect(() => {
      const tariff = this.settings()?.default_tariff;
      this.form.patchValue(
        {
          mode: tariff?.mode ?? DEFAULT_MODE,
          amount: tariff ? Number(tariff.amount) || 0 : 0,
        },
        { emitEvent: false },
      );
      this.syncSnapshot();
    });

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.syncSnapshot();
      this.emitChange();
    });
  }

  private syncSnapshot(): void {
    this.snapshot.set({
      mode: this.form.controls.mode.value ?? DEFAULT_MODE,
      amount: Number(this.form.controls.amount.value) || 0,
    });
  }

  private formatMoney(value: number): string {
    // Explicit read keeps the computed subscribed to the tenant currency even if
    // `format()` short-circuits before touching the signal.
    void this.currency.currentCurrency();
    return this.currency.format(value);
  }

  private emitChange(): void {
    const mode = this.form.controls.mode.value;
    const amount = this.form.controls.amount.value;
    this.settingsChange.emit({
      default_tariff: {
        mode,
        amount: (Number(amount) || 0).toFixed(2),
        currency: 'COP',
      },
    });
  }
}
