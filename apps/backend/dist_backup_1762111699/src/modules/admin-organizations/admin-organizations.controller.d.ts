import { AdminOrganizationsService } from './admin-organizations.service';
import { CreateOrganizationDto, UpdateOrganizationDto, AdminOrganizationQueryDto, OrganizationDashboardDto } from '../organizations/dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class AdminOrganizationsController {
    private readonly adminOrganizationsService;
    private readonly responseService;
    constructor(adminOrganizationsService: AdminOrganizationsService, responseService: ResponseService);
    create(createOrganizationDto: CreateOrganizationDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findAll(query: AdminOrganizationQueryDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getStats(): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        totalOrganizations: any;
        activeOrganizations: any;
        inactiveOrganizations: any;
        recentOrganizations: any;
        organizationsByStatus: any;
    }>>;
    findOne(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    findBySlug(slug: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    update(id: number, updateOrganizationDto: UpdateOrganizationDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    remove(id: number): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    getOrganizationStats(id: number, query: OrganizationDashboardDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        organization: any;
        stats: {
            totalStores: any;
            activeStores: any;
            totalUsers: any;
            activeUsers: any;
            totalOrders: any;
            totalRevenue: any;
        };
        recentOrders: any;
        topStores: any;
    }>>;
}
