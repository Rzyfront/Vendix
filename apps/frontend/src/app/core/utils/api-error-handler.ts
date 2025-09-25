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

/**
 * Extrae el mensaje de error de una respuesta de API
 * @param response Respuesta de la API
 * @returns Mensaje de error formateado
 */
export function extractApiErrorMessage(response: any): string {
  // Si es una respuesta de API con nuestra estructura estandarizada
  if (response && typeof response === 'object' && 'success' in response) {
    const apiResponse = response as ApiResponse;
    
    if (!apiResponse.success && apiResponse.error) {
      // Usar el mensaje de error específico si está disponible
      return apiResponse.error.message || apiResponse.message || 'Error en la operación';
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