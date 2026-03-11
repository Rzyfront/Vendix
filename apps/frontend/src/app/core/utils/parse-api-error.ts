import { ERROR_MESSAGES, DEFAULT_ERROR_MESSAGE } from './error-messages';

export interface ParsedApiError {
  errorCode: string | null;
  userMessage: string;
  devMessage: string | null;
  details: any;
}

/**
 * Parsea una respuesta de error de API y retorna un mensaje UX seguro.
 * El devMessage se loguea en consola pero NUNCA se muestra al usuario.
 */
export function parseApiError(error: any): ParsedApiError {
  const body = error?.error ?? error;
  const errorCode = body?.error_code ?? null;
  const devMessage = body?.message ?? null;
  const details = body?.details ?? null;

  return {
    errorCode,
    userMessage: errorCode
      ? (ERROR_MESSAGES[errorCode] ?? DEFAULT_ERROR_MESSAGE)
      : DEFAULT_ERROR_MESSAGE,
    devMessage,
    details,
  };
}
