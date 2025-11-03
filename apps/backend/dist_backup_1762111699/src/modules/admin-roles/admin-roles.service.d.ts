import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto, RemovePermissionsDto } from '../roles/dto/role.dto';
export declare class AdminRolesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createRoleDto: CreateRoleDto): Promise<any>;
    findAll(query: {
        page?: number;
        limit?: number;
        search?: string;
        is_system_role?: boolean;
        organization_id?: number;
    }): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number): Promise<any>;
    update(id: number, updateRoleDto: UpdateRoleDto): Promise<any>;
    remove(id: number): Promise<any>;
    assignPermissions(roleId: number, assignPermissionsDto: AssignPermissionsDto): Promise<any>;
    removePermissions(roleId: number, removePermissionsDto: RemovePermissionsDto): Promise<any>;
    getDashboardStats(): Promise<{
        totalRoles: any;
        systemRoles: any;
        customRoles: any;
        totalPermissions: any;
        rolesByUserCountRanges: {
            empty: number;
            small: number;
            medium: number;
            large: number;
        };
        recentRoles: any;
    }>;
}
