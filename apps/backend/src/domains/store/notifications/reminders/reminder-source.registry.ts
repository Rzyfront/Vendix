import { Injectable } from '@nestjs/common';
import { NotifyInput } from '../notification-dispatcher.service';

/** Fila de `scheduled_reminders` que el cron acaba de reclamar. */
export interface ClaimedReminder {
  id: number;
  store_id: number;
  source_type: string;
  source_id: number;
  kind: string;
  fire_at: Date;
  attempts: number;
}

/**
 * Qué hacer con un recordatorio al dispararlo, decidido releyendo la fuente:
 * - `skip`: la fuente ya no lo justifica (resuelta, re-fechada, sin
 *   destinatarios…). Queda `skipped` con el motivo.
 * - `notify`: los avisos a entregar por `NotificationDispatcher`.
 */
export type ReminderResolution =
  | { action: 'skip'; reason: string }
  | { action: 'notify'; notifications: NotifyInput[] };

/**
 * Dueño de un `source_type` (p. ej. `crm_task`). El motor no conoce los
 * módulos: cada uno registra cómo releer su fuente y armar el aviso.
 */
export interface ReminderSourceHandler {
  readonly source_types: readonly string[];
  resolve(reminder: ClaimedReminder, now: Date): Promise<ReminderResolution>;
}

/**
 * Registro de fuentes de recordatorios. El módulo dueño se registra en su
 * `onModuleInit` (mismo patrón que `AIToolRegistry`), así el motor de
 * notificaciones no importa al CRM y no hay ciclo de módulos.
 */
@Injectable()
export class ReminderSourceRegistry {
  private readonly handlers = new Map<string, ReminderSourceHandler>();

  register(handler: ReminderSourceHandler): void {
    for (const source_type of handler.source_types) {
      this.handlers.set(source_type, handler);
    }
  }

  get(source_type: string): ReminderSourceHandler | undefined {
    return this.handlers.get(source_type);
  }
}
