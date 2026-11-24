import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../environments/environment';

export interface NotificationChannelFlags {
  push: boolean;
  email: boolean;
}

export interface NotificationPreferenceType {
  type: string;
  label: string;
  description: string;
  channels: NotificationChannelFlags;
  defaults: NotificationChannelFlags;
  effective: NotificationChannelFlags;
  customized: boolean;
}

export interface NotificationPreferenceGroup {
  key: string;
  label: string;
  types: NotificationPreferenceType[];
}

export interface NotificationPreferences {
  groups: NotificationPreferenceGroup[];
  store_email_enabled: boolean;
  user_email: string | null;
}

export type TestEmailStatus =
  | 'sent'
  | 'off'
  | 'no_email'
  | 'store_disabled'
  | 'failed';

export interface NotificationTestResult {
  push: { enabled: boolean; devices: number };
  email: { status: TestEmailStatus; to: string | null };
}

/** Canal visible en pantalla: Dispositivo viaja como `in_app`, Correo como `email`. */
export type PreferenceChannel = 'push' | 'email';

export interface TestOutcome {
  variant: 'success' | 'warning';
  message: string;
}

export const TEST_RATE_LIMIT_MESSAGE = 'Espera unos segundos antes de otra prueba';
export const TEST_GENERIC_ERROR_MESSAGE =
  'No se pudo enviar la prueba. Intenta de nuevo.';

/** Arma el mensaje de negocio de la prueba a partir de la respuesta del backend. */
export function describeTestResult(result: NotificationTestResult): TestOutcome {
  const sentParts: string[] = [];
  if (result.push.enabled && result.push.devices > 0) {
    sentParts.push(
      result.push.devices === 1
        ? 'a 1 dispositivo'
        : `a ${result.push.devices} dispositivos`,
    );
  }
  if (result.email.status === 'sent') {
    sentParts.push(result.email.to ? `a ${result.email.to}` : 'a tu correo');
  }
  if (sentParts.length) {
    return {
      variant: 'success',
      message: `Prueba enviada: ${sentParts.join(' y ')}`,
    };
  }

  const reasons: string[] = [];
  if (!result.push.enabled) {
    reasons.push('No tienes ningún aviso encendido para dispositivo');
  } else {
    reasons.push('No hay dispositivos con avisos activados');
  }
  switch (result.email.status) {
    case 'store_disabled':
      reasons.push('Correo apagado para la tienda');
      break;
    case 'no_email':
      reasons.push('Tu usuario no tiene correo registrado');
      break;
    case 'failed':
      reasons.push('No se pudo enviar el correo');
      break;
    default:
      break;
  }
  return { variant: 'warning', message: reasons.join('. ') };
}

/** Mensaje de negocio para un fallo del endpoint de prueba (429 = demasiado seguido). */
export function describeTestError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 429) {
    return TEST_RATE_LIMIT_MESSAGE;
  }
  return TEST_GENERIC_ERROR_MESSAGE;
}

@Injectable({ providedIn: 'root' })
export class MyNotificationsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/notifications`;

  getPreferences(): Observable<NotificationPreferences> {
    return this.http
      .get<{ data: NotificationPreferences }>(`${this.baseUrl}/preferences`)
      .pipe(
        map((response) => ({
          groups: response.data?.groups ?? [],
          store_email_enabled: response.data?.store_email_enabled ?? false,
          user_email: response.data?.user_email ?? null,
        })),
      );
  }

  updatePreference(
    type: string,
    channel: PreferenceChannel,
    value: boolean,
  ): Observable<unknown> {
    const body =
      channel === 'push' ? { type, in_app: value } : { type, email: value };
    return this.http.patch(`${this.baseUrl}/subscriptions`, body);
  }

  sendTest(): Observable<NotificationTestResult> {
    return this.http
      .post<{ data: NotificationTestResult }>(
        `${this.baseUrl}/preferences/test`,
        {},
      )
      .pipe(map((response) => response.data));
  }
}
