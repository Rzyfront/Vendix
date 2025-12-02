/**
 * Utilidad para manejo de errores de API con estructura estandarizada
 *
 * Estructura de respuesta de API:
 * {
 *   success: boolean,
 *   message: string,
 *   data: any,
 *   error: {
 *     code: string,
 *     message: string,
 *     details: any
 *   }
 * }
 */

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    details: any;
  };
}

export interface NormalizedApiPayload {
  success?: boolean;
  message?: string;
  error?: string;
  statusCode?: number;
  timestamp?: string;
}

/**
 * Extrae el mensaje de error de una respuesta de API
 * @param response Respuesta de la API
 * @returns Mensaje de error formateado
 */
export function extractApiErrorMessage(response: any): string {
  // Algunos errores HTTP vienen envueltos en un HttpErrorResponse donde
  // el body real está en `response.error`. Normalizamos ese caso primero.
  if (
    response &&
    typeof response === 'object' &&
    response.error &&
    typeof response.error === 'object'
  ) {
    // Reemplazamos `response` por su body para continuar con la extracción
    response = response.error;
  }

  // Si es una respuesta de API con nuestra estructura estandarizada
  if (response && typeof response === 'object' && 'success' in response) {
    const apiResponse = response as ApiResponse;

    if (!apiResponse.success) {
      // Caso 1: Si hay un objeto error con mensaje
      if (
        apiResponse.error &&
        typeof apiResponse.error === 'object' &&
        apiResponse.error.message
      ) {
        return apiResponse.error.message;
      }
      // Caso 2: Si error es un string
      if (typeof apiResponse.error === 'string') {
        return apiResponse.error;
      }
      // Caso 3: Si hay un mensaje en la raíz
      if (apiResponse.message) {
        return apiResponse.message;
      }
      // Caso por defecto
      return 'Error en la operación';
    }

    // Si success es true pero hay algún problema, usar el mensaje general
    if (apiResponse.success) {
      return apiResponse.message || 'Operación completada';
    }
  }

  // Para errores HTTP estándar
  if (response && typeof response === 'object' && 'status' in response) {
    switch (response.status) {
      case 400:
        return 'Solicitud inválida';
      case 401:
        return 'No autorizado. Por favor inicie sesión';
      case 403:
        return 'Acceso denegado';
      case 404:
        return 'Recurso no encontrado';
      case 429:
        return 'Demasiadas solicitudes. Intente más tarde';
      case 500:
        return 'Error interno del servidor';
      case 502:
        return 'Error de gateway';
      case 503:
        return 'Servicio no disponible';
      case 504:
        return 'Tiempo de espera agotado';
      default:
        return `Error ${response.status}: ${response.message || 'Error desconocido'}`;
    }
  }

  // Para errores genéricos
  if (response && typeof response === 'object' && 'message' in response) {
    return response.message as string;
  }

  // Valor por defecto
  return 'Error desconocido';
}

/**
 * Normaliza la carga útil de respuesta de la API para que tenga siempre
 * una forma predecible y serializable. Útil para despachar a la store.
 */
export function normalizeApiPayload(response: any): NormalizedApiPayload {
  if (!response || typeof response !== 'object') {
    return { message: String(response) };
  }

  // Desenvaina HttpErrorResponse si está presente
  if (response.error && typeof response.error === 'object') {
    response = response.error;
  }

  const payload: NormalizedApiPayload = {};

  if ('success' in response) {
    payload.success = Boolean(response.success);
  }

  if (typeof response.message === 'string') {
    payload.message = response.message;
  } else if (response.error && typeof response.error === 'string') {
    // caso en el que `error` es string y contiene mensaje
    payload.message = response.error;
  }

  // Extraer `error` si existe y es string o contiene message
  if (typeof response.error === 'string') {
    payload.error = response.error;
  } else if (
    response.error &&
    typeof response.error === 'object' &&
    response.error.message
  ) {
    payload.error = response.error.message;
  }

  if (typeof response.statusCode === 'number') {
    payload.statusCode = response.statusCode;
  } else if (typeof response.status === 'number') {
    payload.statusCode = response.status;
  }

  if (typeof response.timestamp === 'string') {
    payload.timestamp = response.timestamp;
  }

  return payload;
}

/**
 * Verifica si una respuesta de API fue exitosa
 * @param response Respuesta de la API
 * @returns true si la operación fue exitosa, false en caso contrario
 */
export function isApiSuccess(response: any): boolean {
  if (response && typeof response === 'object' && 'success' in response) {
    return (response as ApiResponse).success === true;
  }
  return false;
}
