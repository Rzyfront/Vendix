import { PermissionsService } from './permissions.service';
import { CreatePermissionDto, UpdatePermissionDto, PermissionFilterDto } from './dto/permission.dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class PermissionsController {
    private readonly permissionsService;
    private readonly responseService;
    constructor(permissionsService: PermissionsService, responseService: ResponseService);
    create(createPermissionDto: CreatePermissionDto, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(filterDto: PermissionFilterDto, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findOne(id: number, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updatePermissionDto: UpdatePermissionDto, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    findByName(name: string, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findByPathAndMethod(path: string, method: string, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
}
