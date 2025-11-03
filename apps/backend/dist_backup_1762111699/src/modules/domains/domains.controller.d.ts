import { ResponseService, SuccessResponse, PaginatedResponse } from '../../common/responses';
import { DomainsService } from './domains.service';
import { DomainSettingResponse, DomainResolutionResponse, DomainAvailabilityResponse, DomainValidationResponse } from './types/domain.types';
import { CreateDomainSettingDto, UpdateDomainSettingDto, ValidateHostnameDto, DuplicateDomainDto, VerifyDomainDto, VerifyDomainResult } from './dto/domain-settings.dto';
export declare class DomainsController {
    private readonly domainsService;
    private readonly responseService;
    private readonly logger;
    constructor(domainsService: DomainsService, responseService: ResponseService);
    resolveDomain(hostname: string, subdomain?: string, forwardedHost?: string): Promise<SuccessResponse<DomainResolutionResponse>>;
    checkHostnameAvailability(hostname: string): Promise<SuccessResponse<DomainAvailabilityResponse>>;
    createDomainSetting(createDomainSettingDto: CreateDomainSettingDto, user: any): Promise<SuccessResponse<DomainSettingResponse>>;
    getAllDomainSettings(organizationId?: string, storeId?: string, search?: string, limit?: string, offset?: string): Promise<PaginatedResponse<DomainSettingResponse>>;
    getDomainStats(): Promise<SuccessResponse<any>>;
    getDomainSettingByHostname(hostname: string): Promise<SuccessResponse<DomainSettingResponse>>;
    getDomainSettingById(id: string): Promise<SuccessResponse<DomainSettingResponse>>;
    updateDomainSetting(hostname: string, updateDomainSettingDto: UpdateDomainSettingDto): Promise<SuccessResponse<DomainSettingResponse>>;
    deleteDomainSetting(hostname: string): Promise<SuccessResponse<null>>;
    duplicateDomainSetting(hostname: string, duplicateData: DuplicateDomainDto): Promise<SuccessResponse<DomainSettingResponse>>;
    getDomainSettingsByOrganization(organizationId: string): Promise<SuccessResponse<DomainSettingResponse[]>>;
    getDomainSettingsByStore(storeId: string): Promise<SuccessResponse<DomainSettingResponse[]>>;
    validateHostname(data: ValidateHostnameDto): Promise<SuccessResponse<DomainValidationResponse>>;
    verifyDomain(hostname: string, body: VerifyDomainDto): Promise<SuccessResponse<VerifyDomainResult>>;
}
