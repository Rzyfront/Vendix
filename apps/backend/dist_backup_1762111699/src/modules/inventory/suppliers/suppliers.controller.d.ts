import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { ResponseService } from '../../../common/responses/response.service';
export declare class SuppliersController {
    private readonly suppliersService;
    private readonly responseService;
    constructor(suppliersService: SuppliersService, responseService: ResponseService);
    create(createSupplierDto: CreateSupplierDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findAll(query: SupplierQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any> | import("../../../common").PaginatedResponse<unknown>>;
    findActive(query: SupplierQueryDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findOne(id: string): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findSupplierProducts(id: string): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    update(id: string, updateSupplierDto: UpdateSupplierDto): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    remove(id: string): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<null>>;
}
