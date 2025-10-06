import { Injectable } from '@nestjs/common';
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
   * @param statusCode Código de estado HTTP (opcional)
   * @returns Respuesta de error estandarizada
   */
  error(
    message: string,
    error: string | Record<string, any> = 'An error occurred',
    statusCode?: number,
  ): ErrorResponse {
    return {
      success: false,
      message,
      error,
      ...(statusCode && { statusCode }),
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
}
