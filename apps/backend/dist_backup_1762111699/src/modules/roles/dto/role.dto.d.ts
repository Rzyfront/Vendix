export declare class CreateRoleDto {
    name: string;
    description?: string;
    is_system_role?: boolean;
}
export declare class UpdateRoleDto {
    name?: string;
    description?: string;
}
export declare class AssignPermissionsDto {
    permissionIds: number[];
}
export declare class RemovePermissionsDto {
    permissionIds: number[];
}
export declare class AssignRoleToUserDto {
    userId: number;
    roleId: number;
}
export declare class RemoveRoleFromUserDto {
    userId: number;
    roleId: number;
}
export declare class RoleDashboardStatsDto {
    total_roles: number;
    system_roles: number;
    custom_roles: number;
    total_permissions: number;
}
export declare class RoleWithPermissionDescriptionsDto {
    id: number;
    name: string;
    description?: string;
    is_system_role: boolean;
    created_at?: Date;
    updated_at?: Date;
    permissions: string[];
    user_roles?: any[];
    _count?: {
        user_roles: number;
    };
}
