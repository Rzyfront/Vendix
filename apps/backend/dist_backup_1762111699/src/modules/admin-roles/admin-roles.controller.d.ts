import { AdminRolesService } from './admin-roles.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto, RemovePermissionsDto } from '../roles/dto/role.dto';
export declare class AdminRolesController {
    private readonly adminRolesService;
    constructor(adminRolesService: AdminRolesService);
    create(createRoleDto: CreateRoleDto): Promise<any>;
    findAll(query: any): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
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
    findOne(id: string): Promise<any>;
    update(id: string, updateRoleDto: UpdateRoleDto): Promise<any>;
    remove(id: string): Promise<any>;
    assignPermissions(id: string, assignPermissionsDto: AssignPermissionsDto): Promise<any>;
    removePermissions(id: string, removePermissionsDto: RemovePermissionsDto): Promise<any>;
}
