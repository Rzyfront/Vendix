import { Injectable, inject, signal } from '@angular/core';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import {
  AgendaPreference,
  AgendaViewMode,
  ScheduledOrderStatus,
  STATUS_ORDER,
} from '../interfaces/scheduled-order.interface';

const CACHE_KEY = 'vendix_scheduled_orders_agenda';
const DEFAULTS: AgendaPreference = { view: 'week', status: 'all' };

/**
 * Preferencia de la agenda (vista + filtro de estado). Fuente de verdad en
 * servidor: `user_settings.config.preferences.scheduled_orders_agenda`
 * (`PUT /auth/settings`). `localStorage` solo acelera el arranque.
 *
 * El backend REEMPLAZA `config` completo, así que se guarda mezclando sobre el
 * `config` vigente del store de auth para no pisar otras preferencias.
 */
@Injectable({ providedIn: 'root' })
export class AgendaPreferencesService {
  private readonly authFacade = inject(AuthFacade);

  private readonly _preference = signal<AgendaPreference>(this.initial());
  readonly preference = this._preference.asReadonly();

  private initial(): AgendaPreference {
    const server = this.authFacade.userSettings()?.config?.preferences
      ?.scheduled_orders_agenda;
    const parsedServer = this.sanitize(server);
    if (parsedServer) return parsedServer;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const parsedCache = cached ? this.sanitize(JSON.parse(cached)) : null;
      if (parsedCache) return parsedCache;
    } catch {
      // Caché ilegible: se usan los valores por defecto.
    }
    return { ...DEFAULTS };
  }

  private sanitize(raw: unknown): AgendaPreference | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const view: AgendaViewMode = r['view'] === 'day' ? 'day' : 'week';
    const status =
      typeof r['status'] === 'string' &&
      STATUS_ORDER.includes(r['status'] as ScheduledOrderStatus)
        ? (r['status'] as ScheduledOrderStatus)
        : 'all';
    return { view, status };
  }

  save(next: AgendaPreference): void {
    this._preference.set(next);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      // Sin almacenamiento local: la preferencia igual viaja al servidor.
    }
    const current = this.authFacade.userSettings();
    const config = current?.config ?? {};
    this.authFacade.updateUserSettings({
      config: {
        ...config,
        preferences: {
          ...(config.preferences ?? {}),
          scheduled_orders_agenda: next,
        },
      },
    });
  }
}
