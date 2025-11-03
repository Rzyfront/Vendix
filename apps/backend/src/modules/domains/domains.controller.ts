import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestContext } from '../../common/decorators/request-context.decorator';
import {
  ResponseService,
  SuccessResponse,
  PaginatedResponse,
} from '../../common/responses';
import { DomainsService } from './domains.service';
import {
  DomainSettingResponse,
  DomainResolutionResponse,
  DomainListResponse,
  DomainAvailabilityResponse,
  DomainValidationResponse,
} from './types/domain.types';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
  ValidateHostnameDto,
  DuplicateDomainDto,
  VerifyDomainDto,
  VerifyDomainResult,
} from './dto/domain-settings.dto';

/**
 * Controlador de Dominios
 * Maneja las peticiones HTTP relacionadas con dominios
 */
@Controller('domains')
@UseGuards(RolesGuard)
export class DomainsController {
  private readonly logger = new Logger(DomainsController.name);

  constructor(
    private readonly domainsService: DomainsService,
    private readonly responseService: ResponseService,
  ) {}

  // ========== ENDPOINTS PÚBLICOS ==========

  /**
   * 🌐 Resuelve la configuración de un dominio específico (PÚBLICO)
   */
  @Public()
  @Get('resolve/:hostname')
  @HttpCode(HttpStatus.OK)
  async resolveDomain(
    @Param('hostname') hostname: string,
    @Query('subdomain') subdomain?: string,
    @Headers('x-forwarded-host') forwardedHost?: string,
  ): Promise<SuccessResponse<DomainResolutionResponse>> {
    const result = await this.domainsService.resolveDomain(
      hostname,
      subdomain,
      forwardedHost,
    );
    return this.responseService.success(result, 'Domain resolved successfully');
  }

  /**
   * 🔍 Verificar disponibilidad de hostname (PÚBLICO)
   */
  @Public()
  @Get('check/:hostname')
  @HttpCode(HttpStatus.OK)
  async checkHostnameAvailability(
    @Param('hostname') hostname: string,
  ): Promise<SuccessResponse<DomainAvailabilityResponse>> {
    const result =
      await this.domainsService.checkHostnameAvailability(hostname);
    return this.responseService.success(
      result,
      'Hostname availability checked successfully',
    );
  }

  // ========== ENDPOINTS PRIVADOS (requieren autenticación) ==========

  /**
   * Crear configuración de dominio
   */
  @Post()
  @Roles('super_admin', 'admin', 'owner')
  @HttpCode(HttpStatus.CREATED)
  async createDomainSetting(
    @Body() createDomainSettingDto: CreateDomainSettingDto,
    @RequestContext() user: any,
  ): Promise<SuccessResponse<DomainSettingResponse>> {
    const result = await this.domainsService.createDomainSetting(
      createDomainSettingDto,
    );
    return this.responseService.created(
      result,
      'Domain setting created successfully',
    );
  }

  /**
   * Obtener todas las configuraciones con filtros
   */
  @Get()
  @Roles('super_admin', 'admin', 'owner')
  async getAllDomainSettings(
    @Query('organizationId') organizationId?: string,
    @Query('storeId') storeId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<PaginatedResponse<DomainSettingResponse>> {
    const filters: any = {};

    if (organizationId) {
      const orgId = parseInt(organizationId, 10);
      if (isNaN(orgId)) {
        throw new BadRequestException('Invalid organizationId parameter');
      }
      filters.organizationId = orgId;
    }

    if (storeId) {
      const sId = parseInt(storeId, 10);
      if (isNaN(sId)) {
        throw new BadRequestException('Invalid storeId parameter');
      }
      filters.storeId = sId;
    }

    if (search) filters.search = search;
    if (limit) {
      const lmt = parseInt(limit, 10);
      if (isNaN(lmt) || lmt <= 0) {
        throw new BadRequestException('Invalid limit parameter');
      }
      filters.limit = lmt;
    }
    if (offset) {
      const off = parseInt(offset, 10);
      if (isNaN(off) || off < 0) {
        throw new BadRequestException('Invalid offset parameter');
      }
      filters.offset = off;
    }

    const result = await this.domainsService.getAllDomainSettings(filters);
    const page = Math.floor((filters.offset || 0) / (filters.limit || 10)) + 1;
    const limitValue = filters.limit || 10;

    return this.responseService.paginated(
      result.data,
      result.total,
      page,
      limitValue,
      'Domain settings retrieved successfully',
    );
  }

  /**
   * 📊 Obtener estadísticas de dominios
   */
  @Get('stats')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainStats(): Promise<SuccessResponse<any>> {
    const stats = await this.domainsService.getDomainStats();
    return this.responseService.success(
      stats,
      'Domain statistics retrieved successfully',
    );
  }

  /**
   * Obtener configuración por hostname
   */
  @Get('hostname/:hostname')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingByHostname(
    @Param('hostname') hostname: string,
  ): Promise<SuccessResponse<DomainSettingResponse>> {
    const result =
      await this.domainsService.getDomainSettingByHostname(hostname);
    return this.responseService.success(
      result,
      'Domain setting retrieved successfully',
    );
  }

  /**
   * Obtener configuración por ID
   */
  @Get(':id')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingById(
    @Param('id') id: string,
  ): Promise<SuccessResponse<DomainSettingResponse>> {
    const domainId = parseInt(id, 10);
    if (isNaN(domainId)) {
      throw new BadRequestException('Invalid domain ID');
    }
    const result = await this.domainsService.getDomainSettingById(domainId);
    return this.responseService.success(
      result,
      'Domain setting retrieved successfully',
    );
  }

  /**
   * Actualizar configuración de dominio
   */
  @Put('hostname/:hostname')
  @Roles('super_admin', 'admin', 'owner')
  async updateDomainSetting(
    @Param('hostname') hostname: string,
    @Body() updateDomainSettingDto: UpdateDomainSettingDto,
  ): Promise<SuccessResponse<DomainSettingResponse>> {
    const result = await this.domainsService.updateDomainSetting(
      hostname,
      updateDomainSettingDto,
    );
    return this.responseService.updated(
      result,
      'Domain setting updated successfully',
    );
  }

  /**
   * Eliminar configuración de dominio
   */
  @Delete('hostname/:hostname')
  @Roles('super_admin', 'admin', 'owner')
  @HttpCode(HttpStatus.OK)
  async deleteDomainSetting(
    @Param('hostname') hostname: string,
  ): Promise<SuccessResponse<null>> {
    await this.domainsService.deleteDomainSetting(hostname);
    return this.responseService.deleted('Domain setting deleted successfully');
  }

  /**
   * Duplicar configuración de dominio
   */
  @Post('hostname/:hostname/duplicate')
  @Roles('super_admin', 'admin', 'owner')
  async duplicateDomainSetting(
    @Param('hostname') hostname: string,
    @Body() duplicateData: DuplicateDomainDto,
  ): Promise<SuccessResponse<DomainSettingResponse>> {
    const result = await this.domainsService.duplicateDomainSetting(
      hostname,
      duplicateData.new_hostname,
    );
    return this.responseService.created(
      result,
      'Domain setting duplicated successfully',
    );
  }

  /**
   * Obtener configuraciones por organización
   */
  @Get('organization/:organizationId')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingsByOrganization(
    @Param('organizationId') organizationId: string,
  ): Promise<SuccessResponse<DomainSettingResponse[]>> {
    const orgId = parseInt(organizationId, 10);
    if (isNaN(orgId)) {
      throw new BadRequestException('Invalid organization ID');
    }
    const result = await this.domainsService.getAllDomainSettings({
      organizationId: orgId,
    });
    return this.responseService.success(
      result.data,
      'Domain settings retrieved successfully',
    );
  }

  /**
   * Obtener configuraciones por tienda
   */
  @Get('store/:storeId')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingsByStore(
    @Param('storeId') storeId: string,
  ): Promise<SuccessResponse<DomainSettingResponse[]>> {
    const sId = parseInt(storeId, 10);
    if (isNaN(sId)) {
      throw new BadRequestException('Invalid store ID');
    }
    const result = await this.domainsService.getAllDomainSettings({
      storeId: sId,
    });
    return this.responseService.success(
      result.data,
      'Domain settings retrieved successfully',
    );
  }

  /**
   * Validar hostname
   */
  @Post('validate-hostname')
  @Roles('super_admin', 'admin', 'owner')
  async validateHostname(
    @Body() data: ValidateHostnameDto,
  ): Promise<SuccessResponse<DomainValidationResponse>> {
    const result = await this.domainsService.validateHostname(data.hostname);
    return this.responseService.success(
      result,
      'Hostname validated successfully',
    );
  }

  /**
   * Verificar configuración DNS
   */
  @Post('hostname/:hostname/verify')
  @Roles('super_admin', 'admin', 'owner')
  async verifyDomain(
    @Param('hostname') hostname: string,
    @Body() body: VerifyDomainDto,
  ): Promise<SuccessResponse<VerifyDomainResult>> {
    const result = await this.domainsService.verifyDomain(hostname, body);
    return this.responseService.success(result, 'Domain verified successfully');
  }
}
