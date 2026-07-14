import { createAction, props } from '@ngrx/store';
import { AppConfig } from '../../services/app-config.service';
import { AppEnvironment } from '../../models/domain-config.interface';

/**
 * Clasificación tipada del fallo de resolución de dominio/app_type.
 * - `not_found`: el backend respondió 404 (dominio inexistente). Definitivo,
 *   NO se reintenta.
 * - `transient`: error de red/CORS/cert (status 0), 5xx, timeout, o config
 *   inválida del backend (app_type vacío). Se puede reintentar.
 *
 * IMPORTANTE: ningún fallo debe degradar silenciosamente a VENDIX_LANDING.
 */
export type DomainResolutionErrorKind = 'not_found' | 'transient';

/** Payload tipado que transporta el fallo de resolución hacia el store. */
export interface DomainResolutionErrorPayload {
  kind: DomainResolutionErrorKind;
  message?: string;
}

export const initializeApp = createAction('[Config] Initialize App');

export const initializeAppSuccess = createAction(
  '[Config] Initialize App Success',
  props<{ config: AppConfig }>(),
);

export const initializeAppFailure = createAction(
  '[Config] Initialize App Failure',
  props<{ error: DomainResolutionErrorPayload }>(),
);

/** Re-dispara la cadena de resolución (mismo flujo que `initializeApp`). */
export const retryResolution = createAction('[Config] Retry Resolution');

export const updateEnvironment = createAction(
  '[Config] Update Environment',
  props<{ environment: AppEnvironment }>(),
);
