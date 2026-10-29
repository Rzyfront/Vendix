import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TraRecord } from './tra-record';

/**
 * Hospitality Suite (H4.1, D2) — the channel to the TRA of the MinCIT.
 *
 * The MinCIT gives its technical manual only to registered PMS vendors, so
 * the endpoint, payload names and answers are not public. `HttpTraProvider`
 * is configurable (`LODGING_TRA_API_URL`) and, while it is unset, answers
 * `not_configured`: every record stays "Pendiente" and the hotel uses the
 * assisted path (export file + "Marcar reportado"). A real client replaces
 * this class behind `TRA_PROVIDER` without touching the queue or the screen.
 */

export type TraFailureCode =
  | 'not_configured'
  | 'token_missing'
  | 'token_expired'
  | 'missing_data'
  | 'unavailable'
  | 'rejected';

export type TraResult =
  | { ok: true; reference?: string | null; raw?: unknown }
  | { ok: false; code: TraFailureCode; message: string; raw?: unknown };

export interface TraProvider {
  /** False while no endpoint is configured (assisted mode only). */
  readonly automatic: boolean;
  send(token: string, record: TraRecord): Promise<TraResult>;
  test(token: string): Promise<TraResult>;
}

export const TRA_PROVIDER = Symbol('TRA_PROVIDER');

export const TRA_MESSAGES: Record<TraFailureCode, string> = {
  not_configured:
    'El envío automático a la TRA aún no está disponible: descarga el archivo y repórtalo en tramincit.gov.co.',
  token_missing: 'Falta el token TRA: pídelo en pms.mincit.gov.co y pégalo en Cumplimiento → TRA.',
  token_expired: 'Token TRA vencido: renueva en pms.mincit.gov.co',
  missing_data: 'Faltan datos del huésped para la TRA.',
  unavailable: 'El portal de la TRA no respondió. Se reintentará.',
  rejected: 'La TRA rechazó el registro.',
};

const TIMEOUT_MS = 15_000;

@Injectable()
export class HttpTraProvider implements TraProvider {
  private readonly logger = new Logger(HttpTraProvider.name);
  private readonly url: string;

  constructor(config: ConfigService) {
    this.url = (config.get<string>('LODGING_TRA_API_URL') ?? '').trim();
  }

  get automatic(): boolean {
    return this.url !== '';
  }

  send(token: string, record: TraRecord): Promise<TraResult> {
    return this.call(token, 'POST', record);
  }

  test(token: string): Promise<TraResult> {
    return this.call(token, 'GET');
  }

  /** Assumed REST contract (to confirm with the manual): Bearer token, JSON body. */
  private async call(token: string, method: 'GET' | 'POST', body?: TraRecord): Promise<TraResult> {
    if (!this.automatic) {
      return { ok: false, code: 'not_configured', message: TRA_MESSAGES.not_configured };
    }
    try {
      const response = await fetch(this.url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        return { ok: false, code: 'token_expired', message: TRA_MESSAGES.token_expired, raw };
      }
      if (response.status >= 500) {
        return { ok: false, code: 'unavailable', message: TRA_MESSAGES.unavailable, raw };
      }
      if (!response.ok) {
        return { ok: false, code: 'rejected', message: `${TRA_MESSAGES.rejected} (HTTP ${response.status})`, raw };
      }
      const reference =
        raw && typeof raw === 'object' && 'id' in raw ? String((raw as { id: unknown }).id) : null;
      return { ok: true, reference, raw };
    } catch (error: unknown) {
      this.logger.warn(`TRA call failed: ${error instanceof Error ? error.message : error}`);
      return { ok: false, code: 'unavailable', message: TRA_MESSAGES.unavailable };
    }
  }
}
