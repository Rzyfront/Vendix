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
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SettingToggleComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { ExpandableCardComponent } from '../../../../../../../shared/components/expandable-card/expandable-card.component';
import { SelectorComponent } from '../../../../../../../shared/components/selector/selector.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
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

/**
 * Lo que este formulario guarda: la sección sin `fulfillment_types` (obsoleto,
 * ver `ScheduledOrdersSettings`). La entrega usa los métodos de envío de la
 * tienda (Configuración → Envíos).
 */
export type ScheduledOrdersPayload = Omit<
  ScheduledOrdersSettings,
  'fulfillment_types'
>;

/** Ajuste apagado por defecto (igual que el backend). */
const DEFAULT_SETTINGS: ScheduledOrdersPayload = {
  enabled: false,
  weekly_schedule: [],
  slot_duration_minutes: 120,
  slot_capacity: 3,
  day_capacity: null,
  min_lead_time_hours: 24,
  max_days_ahead: 60,
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

/** Anticipaciones ofrecidas (minutos). Se agrega la actual si no está en la lista. */
const REMINDER_LEAD_OPTIONS: ReadonlyArray<number> = [
  30, 60, 120, 240, 720, 1440, 2880,
];

/** Límites de `minutes_before`: los mismos `@Min(5)` / `@Max(10080)` del DTO del backend. */
const REMINDER_LEAD_MIN = 5;
const REMINDER_LEAD_MAX = 10080;

/** `HH:mm` a minutos desde medianoche; `null` si el formato no es válido. */
export function timeToMinutes(time: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(time ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `08:00` se muestra como `8:00`. */
export function shortTime(time: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(String(time ?? ''));
  return m ? `${Number(m[1])}:${m[2]}` : String(time ?? '');
}

/**
 * Sección «Pedidos programados»: General, Horarios (tarjetas plegables por
 * día), Recordatorios y enlace a Configuración → Envíos; más el toggle
 * «Adiciones».
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
    ExpandableCardComponent,
    SelectorComponent,
    ToggleComponent,
    RouterLink,
  ],
  templateUrl: './scheduled-orders-settings-form.component.html',
  styleUrl: './scheduled-orders-settings-form.component.scss',
})
export class ScheduledOrdersSettingsForm {
  private readonly exceptionsService = inject(ScheduledOrderExceptionsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly settings = input<ScheduledOrdersSettings | undefined>();
  readonly productOptions = input<ProductOptionsSettings | undefined>();
  readonly settingsChange = output<ScheduledOrdersPayload>();
  readonly productOptionsChange = output<ProductOptionsSettings>();

  readonly days = DAYS;

  /** Valor en edición. Descarta la clave heredada `fulfillment_types`. */
  readonly value = computed<ScheduledOrdersPayload>(() => {
    const merged: Partial<ScheduledOrdersSettings> = {
      ...DEFAULT_SETTINGS,
      ...(this.settings() ?? {}),
    };
    delete merged.fulfillment_types;
    return merged as ScheduledOrdersPayload;
  });

  /** Días con la tarjeta desplegada (por defecto todas plegadas). */
  readonly openDays = signal<Readonly<Record<number, boolean>>>({});
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

  private emit(patch: Partial<ScheduledOrdersPayload>): void {
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
    this.emit({ [field]: n } as Partial<ScheduledOrdersPayload>);
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

  isDayOpen(day: number): boolean {
    return this.openDays()[day] === true;
  }

  setDayOpen(day: number, open: boolean): void {
    this.openDays.update((m) => ({ ...m, [day]: open }));
  }

  /** Franjas que caben entre desde y hasta con la duración configurada. */
  slotCount(day: number): number {
    const block = this.dayBlock(day);
    const duration = this.value().slot_duration_minutes;
    if (!block || !(duration > 0)) return 0;
    const start = timeToMinutes(block.start_time);
    const end = timeToMinutes(block.end_time);
    if (start === null || end === null || end <= start) return 0;
    return Math.floor((end - start) / duration);
  }

  /** Resumen de la tarjeta plegada: «8:00–18:00 · 4 franjas» o «Cerrado». */
  daySummary(day: number): string {
    const block = this.dayBlock(day);
    if (!block) return 'Cerrado';
    const n = this.slotCount(day);
    return `${shortTime(block.start_time)}–${shortTime(block.end_time)} · ${n} ${n === 1 ? 'franja' : 'franjas'}`;
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
    this.setDayOpen(day, true);
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

  // ---- Recordatorios ----------------------------------------------------

  reminderLabel(minutes: number): string {
    if (minutes % 60 === 0) {
      const h = minutes / 60;
      return `${h} ${h === 1 ? 'hora' : 'horas'} antes`;
    }
    return `${minutes} minutos antes`;
  }

  /** Anticipaciones que ya usan los otros recordatorios: dos reglas iguales avisarían dos veces. */
  private leadsTakenByOthers(index: number): Set<number> {
    return new Set(
      this.value()
        .reminders.filter((_, i) => i !== index)
        .map((r) => r.minutes_before),
    );
  }

  /**
   * Opciones del selector de anticipación del recordatorio `index`: incluye la
   * actual si es atípica y excluye las que ya usa otro recordatorio.
   */
  leadOptions(current: number, index: number): Array<{ value: number; label: string }> {
    const taken = this.leadsTakenByOthers(index);
    const values = REMINDER_LEAD_OPTIONS.includes(current)
      ? [...REMINDER_LEAD_OPTIONS]
      : [...REMINDER_LEAD_OPTIONS, current].sort((a, b) => a - b);
    return values
      .filter((v) => v === current || !taken.has(v))
      .map((v) => ({ value: v, label: this.reminderLabel(v) }));
  }

  onReminderLeadChange(index: number, raw: unknown): void {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < REMINDER_LEAD_MIN || n > REMINDER_LEAD_MAX) return;
    if (this.leadsTakenByOthers(index).has(n)) return;
    this.emit({
      reminders: this.value().reminders.map((r, i) =>
        i === index ? { ...r, minutes_before: n } : r,
      ),
    });
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
