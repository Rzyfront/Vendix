import { AdminDomainsService } from './admin-domains.service';
import { CreateDomainSettingDto, UpdateDomainSettingDto } from '../domains/dto/domain-settings.dto';
export declare class AdminDomainsController {
    private readonly adminDomainsService;
    constructor(adminDomainsService: AdminDomainsService);
    create(createDomainSettingDto: CreateDomainSettingDto): Promise<any>;
    findAll(query: any): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    getDashboardStats(): Promise<{
        totalDomains: any;
        activeDomains: any;
        domainsByType: any;
        domainsByOwnership: any;
        recentDomains: any;
    }>;
    findOne(id: string): Promise<any>;
    update(id: string, updateDomainSettingDto: UpdateDomainSettingDto): Promise<any>;
    remove(id: string): Promise<any>;
    verifyDomain(id: string): Promise<any>;
}
