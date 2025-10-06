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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DomainsService, DomainSettingResponse } from './domains.service';
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

  constructor(private readonly domainsService: DomainsService) {}

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
  ): Promise<any> {
    return this.domainsService.resolveDomain(hostname, subdomain, forwardedHost);
  }

  /**
   * 🔍 Verificar disponibilidad de hostname (PÚBLICO)
   */
  @Public()
  @Get('check/:hostname')
  @HttpCode(HttpStatus.OK)
  async checkHostnameAvailability(
    @Param('hostname') hostname: string,
  ): Promise<{ available: boolean; reason?: string }> {
    return this.domainsService.checkHostnameAvailability(hostname);
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
    @CurrentUser() user: any,
  ): Promise<DomainSettingResponse> {
    return this.domainsService.createDomainSetting(createDomainSettingDto);
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
  ): Promise<{
    data: DomainSettingResponse[];
    total: number;
    limit: number;
    offset: number;
  }> {
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

    return this.domainsService.getAllDomainSettings(filters);
  }

  /**
   * Obtener configuración por hostname
   */
  @Get('hostname/:hostname')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingByHostname(
    @Param('hostname') hostname: string,
  ): Promise<DomainSettingResponse> {
    return this.domainsService.getDomainSettingByHostname(hostname);
  }

  /**
   * Obtener configuración por ID
   */
  @Get(':id')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingById(@Param('id') id: string): Promise<DomainSettingResponse> {
    const domainId = parseInt(id, 10);
    if (isNaN(domainId)) {
      throw new BadRequestException('Invalid domain ID');
    }
    return this.domainsService.getDomainSettingById(domainId);
  }

  /**
   * Actualizar configuración de dominio
   */
  @Put('hostname/:hostname')
  @Roles('super_admin', 'admin', 'owner')
  async updateDomainSetting(
    @Param('hostname') hostname: string,
    @Body() updateDomainSettingDto: UpdateDomainSettingDto,
  ): Promise<DomainSettingResponse> {
    return this.domainsService.updateDomainSetting(hostname, updateDomainSettingDto);
  }

  /**
   * Eliminar configuración de dominio
   */
  @Delete('hostname/:hostname')
  @Roles('super_admin', 'admin', 'owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDomainSetting(@Param('hostname') hostname: string): Promise<void> {
    await this.domainsService.deleteDomainSetting(hostname);
  }

  /**
   * Duplicar configuración de dominio
   */
  @Post('hostname/:hostname/duplicate')
  @Roles('super_admin', 'admin', 'owner')
  async duplicateDomainSetting(
    @Param('hostname') hostname: string,
    @Body() duplicateData: DuplicateDomainDto,
  ): Promise<DomainSettingResponse> {
    return this.domainsService.duplicateDomainSetting(hostname, duplicateData.newHostname);
  }

  /**
   * Obtener configuraciones por organización
   */
  @Get('organization/:organizationId')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingsByOrganization(
    @Param('organizationId') organizationId: string,
  ): Promise<DomainSettingResponse[]> {
    const orgId = parseInt(organizationId, 10);
    if (isNaN(orgId)) {
      throw new BadRequestException('Invalid organization ID');
    }
    const result = await this.domainsService.getAllDomainSettings({ organizationId: orgId });
    return result.data;
  }

  /**
   * Obtener configuraciones por tienda
   */
  @Get('store/:storeId')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingsByStore(@Param('storeId') storeId: string): Promise<DomainSettingResponse[]> {
    const sId = parseInt(storeId, 10);
    if (isNaN(sId)) {
      throw new BadRequestException('Invalid store ID');
    }
    const result = await this.domainsService.getAllDomainSettings({ storeId: sId });
    return result.data;
  }

  /**
   * Validar hostname
   */
  @Post('validate-hostname')
  @Roles('super_admin', 'admin', 'owner')
  async validateHostname(
    @Body() data: ValidateHostnameDto,
  ): Promise<{ valid: boolean; reason?: string }> {
    return this.domainsService.validateHostname(data.hostname);
  }

  /**
   * Verificar configuración DNS
   */
  @Post('hostname/:hostname/verify')
  @Roles('super_admin', 'admin', 'owner')
  async verifyDomain(
    @Param('hostname') hostname: string,
    @Body() body: VerifyDomainDto,
  ): Promise<VerifyDomainResult> {
    return this.domainsService.verifyDomain(hostname, body);
  }
}
