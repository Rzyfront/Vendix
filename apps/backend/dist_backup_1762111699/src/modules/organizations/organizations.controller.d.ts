import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, UpdateOrganizationDto, OrganizationQueryDto, OrganizationDashboardDto, OrganizationsDashboardStatsDto } from './dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class OrganizationsController {
    private readonly organizationsService;
    private readonly responseService;
    constructor(organizationsService: OrganizationsService, responseService: ResponseService);
    create(createOrganizationDto: CreateOrganizationDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: OrganizationQueryDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getStats(): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<OrganizationsDashboardStatsDto>>;
    findOne(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findBySlug(slug: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateOrganizationDto: UpdateOrganizationDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getOrganizationStats(id: number, query: OrganizationDashboardDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        organization_id: number;
        metrics: {
            active_users: any;
            active_stores: any;
            recent_orders: any;
            total_revenue: any;
            growth_trends: any;
        };
        store_activity: any;
        recent_audit: any;
    }>>;
}
