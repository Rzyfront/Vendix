import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import {
  InputComponent,
  SelectorComponent,
} from '../../../../../../../shared/components/index';
import type { SelectorOption } from '../../../../../../../shared/components/index';
import type {
  CarrierSettings,
  CarrierTariffMode,
} from '../../../../../../../core/models/store-settings.interface';

const DEFAULT_MODE: CarrierTariffMode = 'per_stop';

/**
 * Reparto — default store carrier tariff (Vendix Repartos F9). Follows the
 * `input(settings) + output(settingsChange)` pattern of the sibling
 * `DispatchSettingsForm`, representing
 * `store_settings.settings.carrier.default_tariff`.
 *
 * Money travels as a Decimal string (never a float); the currency input keeps a
 * raw numeric CVA value, so it is stringified with 2 decimals on emit. Zoneless:
 * form state is patched with `emitEvent: false` and user edits are surfaced via
 * `valueChanges` (no NgZone / manual change detection).
 */
@Component({
  selector: 'app-carrier-settings-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, InputComponent, SelectorComponent],
  template: `
    <div class="carrier-settings-form space-y-3">
      <div>
        <h4
          class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1"
        >
          Tarifa por defecto del repartidor
        </h4>
        <p class="text-xs text-text-secondary">
          Se aplica a los repartidores que no tienen una tarifa propia
          configurada en su perfil.
        </p>
      </div>

      <form [formGroup]="form" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <app-selector
          formControlName="mode"
          label="Modo de tarifa"
          [options]="modeOptions"
        />
        <app-input
          formControlName="amount"
          label="Monto"
          [currency]="true"
          placeholder="0"
        />
      </form>
    </div>
  `,
})
export class CarrierSettingsForm {
  readonly settings = input.required<CarrierSettings>();
  readonly settingsChange = output<CarrierSettings>();

  readonly modeOptions: SelectorOption[] = [
    { value: 'per_stop', label: 'Por parada' },
    { value: 'per_route', label: 'Por ruta' },
  ];

  readonly form = new FormGroup({
    mode: new FormControl<CarrierTariffMode>(DEFAULT_MODE, {
      nonNullable: true,
    }),
    amount: new FormControl<number>(0, { nonNullable: true }),
  });

  constructor() {
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
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.emitChange());
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
