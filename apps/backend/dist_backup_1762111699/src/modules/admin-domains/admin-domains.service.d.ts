import { PrismaService } from '../../prisma/prisma.service';
import { CreateDomainSettingDto, UpdateDomainSettingDto } from '../domains/dto/domain-settings.dto';
export declare class AdminDomainsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createDomainSettingDto: CreateDomainSettingDto): Promise<any>;
    findAll(query: {
        page?: number;
        limit?: number;
        search?: string;
        domain_type?: string;
        status?: string;
        organization_id?: number;
        store_id?: number;
    }): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number): Promise<any>;
    update(id: number, updateDomainSettingDto: UpdateDomainSettingDto): Promise<any>;
    remove(id: number): Promise<any>;
    getDashboardStats(): Promise<{
        totalDomains: any;
        activeDomains: any;
        domainsByType: any;
        domainsByOwnership: any;
        recentDomains: any;
    }>;
    verifyDomain(id: number): Promise<any>;
}
