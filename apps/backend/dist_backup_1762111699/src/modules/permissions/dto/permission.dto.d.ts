import { http_method_enum, permission_status_enum } from '@prisma/client';
export declare class CreatePermissionDto {
    name: string;
    description?: string;
    path: string;
    method: http_method_enum;
    status?: permission_status_enum;
}
export declare class UpdatePermissionDto {
    name?: string;
    description?: string;
    path?: string;
    method?: http_method_enum;
    status?: permission_status_enum;
}
export declare class PermissionFilterDto {
    method?: http_method_enum;
    status?: permission_status_enum;
    search?: string;
}
