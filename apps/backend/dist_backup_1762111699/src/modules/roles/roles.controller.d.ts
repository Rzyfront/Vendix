import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto, RemovePermissionsDto, AssignRoleToUserDto, RemoveRoleFromUserDto, RoleDashboardStatsDto, RoleWithPermissionDescriptionsDto } from './dto/role.dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class RolesController {
    private readonly rolesService;
    private readonly responseService;
    constructor(rolesService: RolesService, responseService: ResponseService);
    create(createRoleDto: CreateRoleDto, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<RoleWithPermissionDescriptionsDto>>;
    findAll(req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getStats(req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<RoleDashboardStatsDto>>;
    getRolePermissions(id: number, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        role_id: number;
        permission_ids: any;
        total_permissions: any;
    }>>;
    assignPermissions(roleId: number, assignPermissionsDto: AssignPermissionsDto, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<RoleWithPermissionDescriptionsDto>>;
    removePermissions(roleId: number, removePermissionsDto: RemovePermissionsDto, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<RoleWithPermissionDescriptionsDto>>;
    findOne(id: number, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<RoleWithPermissionDescriptionsDto>>;
    update(id: number, updateRoleDto: UpdateRoleDto, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    assignRoleToUser(assignRoleToUserDto: AssignRoleToUserDto, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    removeRoleFromUser(removeRoleFromUserDto: RemoveRoleFromUserDto, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    getUserPermissions(userId: number, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getUserRoles(userId: number, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
}
