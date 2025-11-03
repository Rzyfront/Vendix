import { SuccessResponse, ErrorResponse, PaginatedResponse } from './response.interface';
export declare class ResponseService {
    success<T>(data: T, message?: string, meta?: Record<string, any>): SuccessResponse<T>;
    error(message: string, error?: string | Record<string, any>, statusCode?: number): ErrorResponse;
    paginated<T>(data: T[], total: number, page: number, limit: number, message?: string): PaginatedResponse<T>;
    noContent(message?: string): SuccessResponse<null>;
    created<T>(data: T, message?: string): SuccessResponse<T>;
    updated<T>(data: T, message?: string): SuccessResponse<T>;
    deleted(message?: string): SuccessResponse<null>;
    notFound(message?: string, resource?: string): ErrorResponse;
    unauthorized(message?: string): ErrorResponse;
    forbidden(message?: string): ErrorResponse;
    conflict(message?: string, details?: string | Record<string, any>): ErrorResponse;
    validationError(message: string | undefined, validationErrors: Record<string, any>): ErrorResponse;
    internalError(message?: string, error?: string): ErrorResponse;
}
