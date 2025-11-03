import { MovementsService } from './movements.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';
import { ResponseService } from '../../../common/responses/response.service';
export declare class MovementsController {
    private readonly movementsService;
    private readonly responseService;
    constructor(movementsService: MovementsService, responseService: ResponseService);
    create(createMovementDto: CreateMovementDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findAll(query: MovementQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any> | import("../../../common").PaginatedResponse<unknown>>;
    findByProduct(productId: string, query: MovementQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findByLocation(locationId: string, query: MovementQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findByUser(userId: string, query: MovementQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findOne(id: string): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
}
