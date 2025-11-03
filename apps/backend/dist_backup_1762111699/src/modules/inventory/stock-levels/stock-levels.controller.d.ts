import { StockLevelsService } from './stock-levels.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';
import { ResponseService } from '../../../common/responses/response.service';
export declare class StockLevelsController {
    private readonly stockLevelsService;
    private readonly responseService;
    constructor(stockLevelsService: StockLevelsService, responseService: ResponseService);
    findAll(query: StockLevelQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any> | import("../../../common").PaginatedResponse<unknown>>;
    findByProduct(productId: string, query: StockLevelQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findByLocation(locationId: string, query: StockLevelQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    getStockAlerts(query: StockLevelQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findOne(id: string): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
}
