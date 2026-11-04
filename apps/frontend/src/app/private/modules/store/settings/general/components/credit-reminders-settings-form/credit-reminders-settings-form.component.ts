import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SettingToggleComponent } from '../../../../../../../shared/components/index';
import {
  CreditReminderRule,
  CreditRemindersSettings,
} from '../../../../../../../core/models/store-settings.interface';

/** Ajuste apagado por defecto (igual que el backend). */
const DEFAULT_SETTINGS: CreditRemindersSettings = {
  enabled: false,
  reminders: [],
};

/** Reglas que se siembran al activar por primera vez (espejo del backend). */
const DEFAULT_REMINDERS: CreditReminderRule[] = [
  { days_before: 3, enabled: true, notify_staff: true, notify_customer: true },
  { days_before: 0, enabled: true, notify_staff: true, notify_customer: false },
];

/** Tope de anticipación (igual que `CreditReminderRuleDto`). */
export const MAX_DAYS_BEFORE = 30;

/**
 * Sección «Ventas a crédito»: recordatorios de cuotas antes del vencimiento.
 *
 * Mismo flujo que los recordatorios de Pedidos programados: recibe la sección
 * como señal de entrada y emite la sección completa en cada cambio; el store
 * de ajustes la guarda como un todo con el resto. El envío lo hace el job
 * `CreditInstallmentRemindersJob` del backend (cada hora, desde las 8:00
 * locales), una sola vez por cuota, regla y canal.
 */
@Component({
  selector: 'app-credit-reminders-settings-form',
  standalone: true,
  imports: [FormsModule, SettingToggleComponent],
  templateUrl: './credit-reminders-settings-form.component.html',
})
export class CreditRemindersSettingsForm {
  readonly settings = input<CreditRemindersSettings | undefined>();
  readonly settingsChange = output<CreditRemindersSettings>();

  readonly maxDaysBefore = MAX_DAYS_BEFORE;

  readonly value = computed<CreditRemindersSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...(this.settings() ?? {}),
  }));

  private emit(patch: Partial<CreditRemindersSettings>): void {
    this.settingsChange.emit({ ...this.value(), ...patch });
  }

  onEnabledChange(enabled: boolean): void {
    const current = this.value();
    this.emit({
      enabled,
      // Al activar por primera vez se siembran 3 días antes y el mismo día.
      reminders:
        enabled && current.reminders.length === 0
          ? DEFAULT_REMINDERS.map((r) => ({ ...r }))
          : current.reminders,
    });
  }

  reminderLabel(days: number): string {
    if (days === 0) return 'El día del vencimiento';
    return `${days} ${days === 1 ? 'día' : 'días'} antes`;
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

  /** Días de anticipación: entero 0–30; lo demás se ignora (el campo vuelve). */
  onDaysChange(index: number, raw: unknown): void {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_DAYS_BEFORE) return;
    this.emit({
      reminders: this.value().reminders.map((r, i) =>
        i === index ? { ...r, days_before: n } : r,
      ),
    });
  }
}
