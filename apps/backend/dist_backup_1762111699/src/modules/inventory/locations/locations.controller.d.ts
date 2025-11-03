import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationQueryDto } from './dto/location-query.dto';
import { ResponseService } from '../../../common/responses/response.service';
export declare class LocationsController {
    private readonly locationsService;
    private readonly responseService;
    constructor(locationsService: LocationsService, responseService: ResponseService);
    create(createLocationDto: CreateLocationDto, user: any): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    findAll(query: LocationQueryDto, user: any): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any> | import("../../../common").PaginatedResponse<unknown>>;
    findOne(id: string, user: any): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    update(id: string, updateLocationDto: UpdateLocationDto, user: any): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<any>>;
    remove(id: string, user: any): Promise<import("../../../common").ErrorResponse | import("../../../common").SuccessResponse<null>>;
}
