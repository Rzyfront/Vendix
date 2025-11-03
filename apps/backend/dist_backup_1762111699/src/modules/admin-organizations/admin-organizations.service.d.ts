import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationDto, UpdateOrganizationDto, AdminOrganizationQueryDto, OrganizationDashboardDto } from '../organizations/dto';
export declare class AdminOrganizationsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createOrganizationDto: CreateOrganizationDto): Promise<any>;
    findAll(query: AdminOrganizationQueryDto): Promise<{
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
    getDashboardStats(): Promise<{
        totalOrganizations: any;
        activeOrganizations: any;
        inactiveOrganizations: any;
        recentOrganizations: any;
        organizationsByStatus: any;
    }>;
    getDashboard(id: number, query: OrganizationDashboardDto): Promise<{
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
    }>;
}
