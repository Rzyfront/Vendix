import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SettingToggleComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import {
  ProductOptionsSettings,
  ScheduledOrderReminderRule,
  ScheduledOrdersSettings,
} from '../../../../../../../core/models/store-settings.interface';
import { extractApiErrorMessage } from '../../../../../../../core/utils';
import {
  FulfillmentException,
  ScheduledOrderExceptionsService,
} from '../../services/scheduled-order-exceptions.service';

/** Ajuste apagado por defecto (igual que el backend). */
const DEFAULT_SETTINGS: ScheduledOrdersSettings = {
  enabled: false,
  weekly_schedule: [],
  slot_duration_minutes: 120,
  slot_capacity: 3,
  day_capacity: null,
  min_lead_time_hours: 24,
  max_days_ahead: 60,
  fulfillment_types: ['pickup'],
  reminders: [],
};

const DEFAULT_REMINDERS: ScheduledOrderReminderRule[] = [
  { minutes_before: 1440, enabled: true, notify_staff: true, notify_customer: true },
  { minutes_before: 120, enabled: true, notify_staff: true, notify_customer: false },
];

const DAYS: ReadonlyArray<{ day: number; label: string }> = [
  { day: 1, label: 'Lunes' },
  { day: 2, label: 'Martes' },
  { day: 3, label: 'Miércoles' },
  { day: 4, label: 'Jueves' },
  { day: 5, label: 'Viernes' },
  { day: 6, label: 'Sábado' },
  { day: 0, label: 'Domingo' },
];

const FULFILLMENT_LABELS: ReadonlyArray<{
  value: 'pickup' | 'delivery';
  label: string;
}> = [
  { value: 'pickup', label: 'Recogida en tienda' },
  { value: 'delivery', label: 'Domicilio' },
];

/**
 * Sección «Pedidos programados» (S1) + toggle «Adiciones» (S3).
 *
 * Recibe las dos secciones como señales de entrada y emite la sección completa
 * en cada cambio; el store de ajustes la guarda como un todo con el resto.
 * Las excepciones por fecha viven en su propia tabla (endpoint propio) y solo
 * se muestran con el ajuste activo.
 */
@Component({
  selector: 'app-scheduled-orders-settings-form',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SettingToggleComponent,
  ],
  templateUrl: './scheduled-orders-settings-form.component.html',
})
export class ScheduledOrdersSettingsForm {
  private readonly exceptionsService = inject(ScheduledOrderExceptionsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly settings = input<ScheduledOrdersSettings | undefined>();
  readonly productOptions = input<ProductOptionsSettings | undefined>();
  readonly settingsChange = output<ScheduledOrdersSettings>();
  readonly productOptionsChange = output<ProductOptionsSettings>();

  readonly days = DAYS;
  readonly fulfillmentOptions = FULFILLMENT_LABELS;

  readonly value = computed<ScheduledOrdersSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...(this.settings() ?? {}),
  }));
  readonly optionsEnabled = computed(() => this.productOptions()?.enabled === true);

  // Excepciones por fecha
  readonly exceptions = signal<FulfillmentException[]>([]);
  readonly exceptionsLoaded = signal(false);
  readonly savingException = signal(false);
  readonly newDate = signal('');
  readonly newClosed = signal(true);
  readonly newStart = signal('');
  readonly newEnd = signal('');
  readonly newSlotCapacity = signal('');
  readonly newReason = signal('');

  constructor() {
    // Carga perezosa: solo cuando el ajuste está activo y una sola vez.
    effect(() => {
      if (this.value().enabled && !this.exceptionsLoaded()) {
        this.exceptionsLoaded.set(true);
        this.loadExceptions();
      }
    });
  }

  // ---- Ajustes ----------------------------------------------------------

  private emit(patch: Partial<ScheduledOrdersSettings>): void {
    this.settingsChange.emit({ ...this.value(), ...patch });
  }

  onEnabledChange(enabled: boolean): void {
    const current = this.value();
    this.emit({
      enabled,
      // Al activar por primera vez se siembran los recordatorios de 24 h y 2 h.
      reminders:
        enabled && current.reminders.length === 0
          ? DEFAULT_REMINDERS.map((r) => ({ ...r }))
          : current.reminders,
    });
  }

  onOptionsEnabledChange(enabled: boolean): void {
    this.productOptionsChange.emit({ enabled });
  }

  onNumberChange(
    field:
      | 'slot_duration_minutes'
      | 'slot_capacity'
      | 'min_lead_time_hours'
      | 'max_days_ahead',
    raw: unknown,
  ): void {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    this.emit({ [field]: n } as Partial<ScheduledOrdersSettings>);
  }

  onDayCapacityChange(raw: unknown): void {
    const text = String(raw ?? '').trim();
    if (text === '') {
      this.emit({ day_capacity: null });
      return;
    }
    const n = Number(text);
    if (Number.isFinite(n) && n >= 0) this.emit({ day_capacity: n });
  }

  // ---- Horario semanal --------------------------------------------------

  /** Primer bloque del día (la UI edita uno por día; los demás se conservan). */
  dayBlock(day: number) {
    return this.value().weekly_schedule.find((b) => b.day_of_week === day);
  }

  onDayToggle(day: number, enabled: boolean): void {
    const schedule = this.value().weekly_schedule;
    if (!enabled) {
      this.emit({ weekly_schedule: schedule.filter((b) => b.day_of_week !== day) });
      return;
    }
    if (this.dayBlock(day)) return;
    this.emit({
      weekly_schedule: [
        ...schedule,
        { day_of_week: day, start_time: '08:00', end_time: '18:00' },
      ],
    });
  }

  onDayTimeChange(day: number, field: 'start_time' | 'end_time', time: unknown): void {
    const text = String(time ?? '');
    if (!/^\d{2}:\d{2}$/.test(text)) return;
    const first = this.dayBlock(day);
    if (!first) return;
    this.emit({
      weekly_schedule: this.value().weekly_schedule.map((b) =>
        b === first ? { ...b, [field]: text } : b,
      ),
    });
  }

  // ---- Tipos de cumplimiento -------------------------------------------

  hasFulfillment(type: 'pickup' | 'delivery'): boolean {
    return this.value().fulfillment_types.includes(type);
  }

  onFulfillmentToggle(type: 'pickup' | 'delivery', enabled: boolean): void {
    const current = this.value().fulfillment_types;
    const next = enabled
      ? current.includes(type)
        ? current
        : [...current, type]
      : current.filter((t) => t !== type);
    this.emit({ fulfillment_types: next });
  }

  // ---- Recordatorios ----------------------------------------------------

  reminderLabel(minutes: number): string {
    if (minutes % 60 === 0) {
      const h = minutes / 60;
      return `${h} ${h === 1 ? 'hora' : 'horas'} antes`;
    }
    return `${minutes} minutos antes`;
  }

  onReminderChange(
    index: number,
    field: 'enabled' | 'notify_staff' | 'notify_customer',
    checked: boolean,
  ): void {
    this.emit({
      reminders: this.value().reminders.map((r, i) =>
        i === index ? { ...r, [field]: checked } : r,
      ),
    });
  }

  // ---- Excepciones por fecha -------------------------------------------

  private loadExceptions(): void {
    const today = new Date();
    const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    this.exceptionsService
      .list(from)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.exceptions.set(rows),
        error: (error) => this.toast.error(extractApiErrorMessage(error)),
      });
  }

  /** `YYYY-MM-DD` sin convertir zona horaria (la fecha se guarda a medianoche UTC). */
  dateOnly(date: string): string {
    return String(date).slice(0, 10);
  }

  exceptionSummary(e: FulfillmentException): string {
    if (e.is_closed) return 'Cerrado';
    const parts: string[] = [];
    if (e.start_time && e.end_time) parts.push(`${e.start_time} - ${e.end_time}`);
    if (e.slot_capacity != null) parts.push(`${e.slot_capacity} pedidos por franja`);
    return parts.length ? parts.join(' · ') : 'Horario especial';
  }

  addException(): void {
    const date = String(this.newDate() ?? '').trim();
    if (!date) {
      this.toast.error('Elige la fecha de la excepción.');
      return;
    }
    const closed = this.newClosed();
    const start = String(this.newStart() ?? '').trim();
    const end = String(this.newEnd() ?? '').trim();
    const capacityText = String(this.newSlotCapacity() ?? '').trim();
    if (!closed && (!start || !end)) {
      this.toast.error('Indica hora de inicio y fin del horario especial.');
      return;
    }
    const body = {
      date,
      is_closed: closed,
      ...(!closed && start && end ? { start_time: start, end_time: end } : {}),
      ...(!closed && capacityText !== '' && Number.isFinite(Number(capacityText))
        ? { slot_capacity: Number(capacityText) }
        : {}),
      ...(this.newReason().trim() ? { reason: this.newReason().trim() } : {}),
    };
    this.savingException.set(true);
    this.exceptionsService
      .create(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingException.set(false);
          this.newDate.set('');
          this.newStart.set('');
          this.newEnd.set('');
          this.newSlotCapacity.set('');
          this.newReason.set('');
          this.newClosed.set(true);
          this.loadExceptions();
        },
        error: (error) => {
          this.savingException.set(false);
          this.toast.error(extractApiErrorMessage(error));
        },
      });
  }

  removeException(e: FulfillmentException): void {
    this.exceptionsService
      .remove(e.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.exceptions.update((list) => list.filter((x) => x.id !== e.id)),
        error: (error) => this.toast.error(extractApiErrorMessage(error)),
      });
  }
}
