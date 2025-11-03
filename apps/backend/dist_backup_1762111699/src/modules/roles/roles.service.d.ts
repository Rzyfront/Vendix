import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto, RemovePermissionsDto, AssignRoleToUserDto, RemoveRoleFromUserDto } from './dto/role.dto';
import { RoleDashboardStatsDto, RoleWithPermissionDescriptionsDto } from './dto/role.dto';
export declare class RolesService {
    private readonly prismaService;
    private readonly auditService;
    constructor(prismaService: PrismaService, auditService: AuditService);
    private transformRoleWithPermissionDescriptions;
    create(createRoleDto: CreateRoleDto, userId: number): Promise<RoleWithPermissionDescriptionsDto>;
    findAll(userId: number): Promise<any>;
    findOne(id: number, userId?: number): Promise<RoleWithPermissionDescriptionsDto>;
    update(id: number, updateRoleDto: UpdateRoleDto, userId: number): Promise<any>;
    remove(id: number, userId: number): Promise<{
        message: string;
    }>;
    assignPermissions(roleId: number, assignPermissionsDto: AssignPermissionsDto, userId: number): Promise<RoleWithPermissionDescriptionsDto>;
    removePermissions(roleId: number, removePermissionsDto: RemovePermissionsDto, userId: number): Promise<RoleWithPermissionDescriptionsDto>;
    getRolePermissions(roleId: number, userId?: number): Promise<{
        role_id: number;
        permission_ids: any;
        total_permissions: any;
    }>;
    assignRoleToUser(assignRoleToUserDto: AssignRoleToUserDto, adminUserId: number): Promise<any>;
    removeRoleFromUser(removeRoleFromUserDto: RemoveRoleFromUserDto, adminUserId: number): Promise<{
        message: string;
    }>;
    getUserPermissions(userId: number): Promise<any>;
    getUserRoles(userId: number): Promise<any>;
    getDashboardStats(userId: number): Promise<RoleDashboardStatsDto>;
}
