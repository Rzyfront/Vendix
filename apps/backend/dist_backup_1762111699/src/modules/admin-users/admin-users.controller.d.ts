import { AdminUsersService } from './admin-users.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from '../users/dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class AdminUsersController {
    private readonly adminUsersService;
    private readonly responseService;
    constructor(adminUsersService: AdminUsersService, responseService: ResponseService);
    create(createUserDto: CreateUserDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: UserQueryDto): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    getDashboardStats(): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        totalUsers: any;
        activeUsers: any;
        inactiveUsers: any;
        pendingUsers: any;
        usersByRole: any;
        recentUsers: any;
    }>>;
    findOne(id: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: string, updateUserDto: UpdateUserDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
    activate(id: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    deactivate(id: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    assignRole(userId: string, roleId: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    removeRole(userId: string, roleId: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
}
