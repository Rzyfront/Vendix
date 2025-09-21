import { Injectable } from '@nestjs/common';
import { StandardResponse, PaginatedResponse, PaginationMeta } from './response.interface';

@Injectable()
export class ResponseService {
  /**
   * Creates a standardized success response
   * @param data The data to return
   * @param message Optional success message
   * @param path Optional path for the request
   * @returns Standardized success response
   */
  success<T>(
    data: T,
    message: string = 'Operation completed successfully',
    path?: string,
  ): StandardResponse<T> {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
      ...(path && { path }),
    };
  }

  /**
   * Creates a standardized error response
   * @param message Error message
   * @param error Optional error details
   * @param path Optional path for the request
   * @returns Standardized error response
   */
  error(
    message: string,
    error?: any,
    path?: string,
  ): StandardResponse<null> {
    return {
      success: false,
      message,
      data: null,
      error: error ? { details: error } : undefined,
      timestamp: new Date().toISOString(),
      ...(path && { path }),
    };
  }

  /**
   * Creates a standardized paginated response
   * @param data Array of data items
   * @param meta Pagination metadata
   * @param message Optional success message
   * @param path Optional path for the request
   * @returns Standardized paginated response
   */
  paginated<T>(
    data: T[],
    meta: PaginationMeta,
    message: string = 'Data retrieved successfully',
    path?: string,
  ): PaginatedResponse<T> {
    return {
      success: true,
      message,
      data,
      meta,
      timestamp: new Date().toISOString(),
      ...(path && { path }),
    };
  }

  /**
   * Creates a standardized response for created resources
   * @param data The created resource data
   * @param message Optional success message
   * @param path Optional path for the request
   * @returns Standardized success response with 201 status indication
   */
  created<T>(
    data: T,
    message: string = 'Resource created successfully',
    path?: string,
  ): StandardResponse<T> {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
      ...(path && { path }),
    };
  }

  /**
   * Creates a standardized response for deleted resources
   * @param message Optional success message
   * @param path Optional path for the request
   * @returns Standardized success response for deletion
   */
  deleted(
    message: string = 'Resource deleted successfully',
    path?: string,
  ): StandardResponse<null> {
    return {
      success: true,
      message,
      data: null,
      timestamp: new Date().toISOString(),
      ...(path && { path }),
    };
  }
}