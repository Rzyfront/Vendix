import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto, UsersDashboardDto } from './dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class UsersController {
    private readonly usersService;
    private readonly responseService;
    constructor(usersService: UsersService, responseService: ResponseService);
    create(createUserDto: CreateUserDto, currentUser: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: UserQueryDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    getStats(query: UsersDashboardDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        total_usuarios: any;
        activos: any;
        pendientes: any;
        con_2fa: any;
        inactivos: any;
        suspendidos: any;
        email_verificado: any;
        archivados: any;
    }>>;
    findOne(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateUserDto: UpdateUserDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
    archive(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    reactivate(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
}
