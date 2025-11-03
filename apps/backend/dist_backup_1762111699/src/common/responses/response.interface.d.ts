export interface SuccessResponse<T = any> {
    success: true;
    message: string;
    data: T;
    meta?: Record<string, any>;
}
export interface ErrorResponse {
    success: false;
    message: string;
    error: string | Record<string, any>;
    statusCode?: number;
    timestamp?: string;
}
export type StandardResponse<T = any> = SuccessResponse<T> | ErrorResponse;
export interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}
export interface PaginatedResponse<T> {
    success: true;
    message: string;
    data: T[];
    meta: PaginationMeta;
}
export declare function createPaginationMeta(total: number, page: number, limit: number): PaginationMeta;
