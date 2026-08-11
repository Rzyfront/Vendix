import { Component, computed, effect, input, output, signal } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  AlertBannerComponent,
  BadgeComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';

export interface OperationsSettings {
  default_preparation_time_minutes: number;
  ticket_closing_hour?: number;
}

const DEFAULT_PREP_MINUTES = 15;
const DEFAULT_CLOSING_HOUR = 3;

/** Reference clock used by the on-screen examples (10:00 a. m.). */
const EXAMPLE_BASE_MINUTES = 10 * 60;

@Component({
  selector: 'app-operations-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    AlertBannerComponent,
    BadgeComponent,
    IconComponent,
  ],
  templateUrl: './operations-settings-form.component.html',
})
export class OperationsSettingsForm {
  readonly settings = input.required<OperationsSettings>();
  readonly settingsChange = output<OperationsSettings>();

  form: FormGroup = new FormGroup({
    default_preparation_time_minutes: new FormControl<number>(DEFAULT_PREP_MINUTES, {
      nonNullable: true,
    }),
    ticket_closing_hour: new FormControl<number>(DEFAULT_CLOSING_HOUR, { nonNullable: true }),
  });

  /**
   * Signal mirror of the live form value. `FormControl.value` is a plain getter,
   * so a `computed()` reading it would never recompute; every write path (the
   * `settings` effect below and `onFieldChange`) refreshes this signal instead,
   * and the on-screen examples derive from it.
   */
  private readonly currentValue = signal<OperationsSettings>({
    default_preparation_time_minutes: DEFAULT_PREP_MINUTES,
    ticket_closing_hour: DEFAULT_CLOSING_HOUR,
  });

  readonly prepMinutes = computed(() => {
    const raw = Number(this.currentValue().default_preparation_time_minutes);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
  });

  readonly closingHour = computed(() => {
    const raw = Number(this.currentValue().ticket_closing_hour ?? DEFAULT_CLOSING_HOUR);
    if (!Number.isFinite(raw)) return DEFAULT_CLOSING_HOUR;
    return Math.min(23, Math.max(0, Math.trunc(raw)));
  });

  /** `03:00` — the closing hour rendered as a wall clock. */
  readonly closingHourLabel = computed(
    () => `${String(this.closingHour()).padStart(2, '0')}:00`,
  );

  /** Concrete before/after example for the preparation time. */
  readonly prepExample = computed(() => {
    const minutes = this.prepMinutes();
    if (minutes === 0) {
      return 'Con 0 minutos el ticket nace sin holgura: el tablero lo trata como vencido desde el primer segundo.';
    }
    return `Con ${minutes} min, un ticket creado a las 10:00 tiene las ${this.clockAfter(minutes)} como hora de referencia: hasta ahí se considera a tiempo, y después el tablero lo escala a alerta.`;
  });

  /** True when the closing hour lands in the middle of a typical service. */
  readonly closingHourInServiceWindow = computed(() => {
    const hour = this.closingHour();
    return hour >= 7 && hour <= 22;
  });

  get defaultPrepTimeControl(): FormControl<number> {
    return this.form.get('default_preparation_time_minutes') as FormControl<number>;
  }

  get ticketClosingHourControl(): FormControl<number> {
    return this.form.get('ticket_closing_hour') as FormControl<number>;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
        this.currentValue.set({
          default_preparation_time_minutes:
            current.default_preparation_time_minutes ?? DEFAULT_PREP_MINUTES,
          ticket_closing_hour: current.ticket_closing_hour ?? DEFAULT_CLOSING_HOUR,
        });
      }
    });
  }

  onFieldChange() {
    if (this.form.valid) {
      const value = this.form.value as OperationsSettings;
      this.currentValue.set(value);
      this.settingsChange.emit(value);
    }
  }

  /** 10:00 + `minutes`, wrapped to a 24 h clock. */
  private clockAfter(minutes: number): string {
    const total = (EXAMPLE_BASE_MINUTES + minutes) % (24 * 60);
    const hh = String(Math.floor(total / 60)).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}
