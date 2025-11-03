import { AddressesService } from './addresses.service';
import { CreateAddressDto, UpdateAddressDto, AddressQueryDto } from './dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class AddressesController {
    private readonly addressesService;
    private readonly responseService;
    constructor(addressesService: AddressesService, responseService: ResponseService);
    create(createAddressDto: CreateAddressDto, user: any, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: AddressQueryDto, user: any, req: any): Promise<import("../../common").ErrorResponse | import("../../common").PaginatedResponse<unknown> | import("../../common").SuccessResponse<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>>;
    findByStore(storeId: number, user: any, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any> | import("../../common").PaginatedResponse<unknown>>;
    findOne(id: number, user: any, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateAddressDto: UpdateAddressDto, user: any, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number, user: any, req: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<null>>;
}
