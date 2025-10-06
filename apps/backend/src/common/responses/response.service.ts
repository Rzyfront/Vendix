import { Injectable, HttpStatus } from '@nestjs/common';
import {
  SuccessResponse,
  ErrorResponse,
  PaginatedResponse,
  PaginationMeta,
  createPaginationMeta,
} from './response.interface';

/**
 * Servicio para crear respuestas estandarizadas
 */
@Injectable()
export class ResponseService {
  /**
   * Crea una respuesta de éxito estándar
   * @param data Los datos a retornar
   * @param message Mensaje de éxito (opcional)
   * @param meta Metadata adicional (opcional)
   * @returns Respuesta de éxito estandarizada
   */
  success<T>(
    data: T,
    message: string = 'Operation completed successfully',
    meta?: Record<string, any>,
  ): SuccessResponse<T> {
    return {
      success: true,
      message,
      data,
      ...(meta && { meta }),
    };
  }

  /**
   * Crea una respuesta de error estándar
   * @param message Mensaje de error principal
   * @param error Detalles del error
   * @param statusCode Código de estado HTTP (opcional, por defecto 400)
   * @returns Respuesta de error estandarizada
   */
  error(
    message: string,
    error: string | Record<string, any> = 'An error occurred',
    statusCode: number = HttpStatus.BAD_REQUEST,
  ): ErrorResponse {
    return {
      success: false,
      message,
      error,
      statusCode,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Crea una respuesta paginada
   * @param data Array de datos
   * @param total Total de elementos
   * @param page Página actual
   * @param limit Límite por página
   * @param message Mensaje de éxito (opcional)
   * @returns Respuesta paginada estandarizada
   */
  paginated<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
    message: string = 'Data retrieved successfully',
  ): PaginatedResponse<T> {
    const meta = createPaginationMeta(total, page, limit);
    
    return {
      success: true,
      message,
      data,
      meta,
    };
  }

  /**
   * Crea una respuesta de éxito sin datos (para operaciones que no retornan nada)
   * @param message Mensaje de éxito
   * @returns Respuesta de éxito sin datos
   */
  noContent(message: string = 'Operation completed successfully'): SuccessResponse<null> {
    return {
      success: true,
      message,
      data: null,
    };
  }

  /**
   * Crea una respuesta de recurso creado
   * @param data Datos del recurso creado
   * @param message Mensaje de éxito (opcional)
   * @returns Respuesta de éxito con datos
   */
  created<T>(
    data: T,
    message: string = 'Resource created successfully',
  ): SuccessResponse<T> {
    return this.success(data, message);
  }

  /**
   * Crea una respuesta de recurso actualizado
   * @param data Datos del recurso actualizado
   * @param message Mensaje de éxito (opcional)
   * @returns Respuesta de éxito con datos
   */
  updated<T>(
    data: T,
    message: string = 'Resource updated successfully',
  ): SuccessResponse<T> {
    return this.success(data, message);
  }

  /**
   * Crea una respuesta de recurso eliminado
   * @param message Mensaje de éxito (opcional)
   * @returns Respuesta de éxito sin datos
   */
  deleted(message: string = 'Resource deleted successfully'): SuccessResponse<null> {
    return this.noContent(message);
  }

  /**
   * Crea una respuesta de error "Not Found" (404)
   * @param message Mensaje de error
   * @param resource Recurso no encontrado (opcional)
   * @returns Respuesta de error 404
   */
  notFound(
    message: string = 'Resource not found',
    resource?: string,
  ): ErrorResponse {
    return this.error(
      message,
      resource ? `${resource} not found` : 'The requested resource was not found',
      HttpStatus.NOT_FOUND,
    );
  }

  /**
   * Crea una respuesta de error "Unauthorized" (401)
   * @param message Mensaje de error
   * @returns Respuesta de error 401
   */
  unauthorized(
    message: string = 'Unauthorized',
  ): ErrorResponse {
    return this.error(
      message,
      'Authentication is required to access this resource',
      HttpStatus.UNAUTHORIZED,
    );
  }

  /**
   * Crea una respuesta de error "Forbidden" (403)
   * @param message Mensaje de error
   * @returns Respuesta de error 403
   */
  forbidden(
    message: string = 'Forbidden',
  ): ErrorResponse {
    return this.error(
      message,
      'You do not have permission to access this resource',
      HttpStatus.FORBIDDEN,
    );
  }

  /**
   * Crea una respuesta de error "Conflict" (409)
   * @param message Mensaje de error
   * @param details Detalles del conflicto
   * @returns Respuesta de error 409
   */
  conflict(
    message: string = 'Conflict',
    details?: string | Record<string, any>,
  ): ErrorResponse {
    return this.error(
      message,
      details || 'The request could not be completed due to a conflict',
      HttpStatus.CONFLICT,
    );
  }

  /**
   * Crea una respuesta de error "Unprocessable Entity" (422)
   * @param message Mensaje de error
   * @param validationErrors Errores de validación
   * @returns Respuesta de error 422
   */
  validationError(
    message: string = 'Validation failed',
    validationErrors: Record<string, any>,
  ): ErrorResponse {
    return this.error(
      message,
      validationErrors,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /**
   * Crea una respuesta de error "Internal Server Error" (500)
   * @param message Mensaje de error
   * @param error Detalles del error (opcional en producción)
   * @returns Respuesta de error 500
   */
  internalError(
    message: string = 'Internal server error',
    error?: string,
  ): ErrorResponse {
    return this.error(
      message,
      error || 'An unexpected error occurred',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

