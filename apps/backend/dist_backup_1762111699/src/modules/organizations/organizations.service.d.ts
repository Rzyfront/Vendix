import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationDto, UpdateOrganizationDto, OrganizationQueryDto, OrganizationDashboardDto, OrganizationsDashboardStatsDto } from './dto';
export declare class OrganizationsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createOrganizationDto: CreateOrganizationDto): Promise<any>;
    findAll(query: OrganizationQueryDto): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number): Promise<any>;
    findBySlug(slug: string): Promise<any>;
    update(id: number, updateOrganizationDto: UpdateOrganizationDto): Promise<any>;
    remove(id: number): Promise<any>;
    getDashboard(id: number, query: OrganizationDashboardDto): Promise<{
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
    }>;
    getDashboardStats(): Promise<OrganizationsDashboardStatsDto>;
}
