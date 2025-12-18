import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import {
  ResponseService,
  SuccessResponse,
  PaginatedResponse,
} from '@common/responses';
import { DomainsService } from './domains.service';
import {
  DomainSettingResponse,
  DomainListResponse,
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
@Controller('organization/domains')
@UseGuards(RolesGuard, PermissionsGuard)
export class DomainsController {
  private readonly logger = new Logger(DomainsController.name);

  constructor(
    private readonly domainsService: DomainsService,
    private readonly responseService: ResponseService,
  ) { }

  // ========== ENDPOINTS PRIVADOS (requieren autenticación) ==========

  /**
   * Crear configuración de dominio
   */
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:create')
  @HttpCode(HttpStatus.CREATED)
  async createDomainSetting(
    @Body() create_domain_setting_dto: CreateDomainSettingDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SuccessResponse<DomainSettingResponse>> {
    const result = await this.domainsService.createDomainSetting(
      create_domain_setting_dto,
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
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:read')
  async getAllDomainSettings(
    @Query('organizationId') organization_id: string,
    @Query('storeId') store_id: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: AuthenticatedRequest,
  ): Promise<PaginatedResponse<DomainSettingResponse>> {
    const filters: any = {};
    const user_role = req?.user?.user_roles?.[0]?.roles?.name; // Simple check, ideally use helper
    const is_super_admin = user_role === UserRole.SUPER_ADMIN;

    if (is_super_admin) {
      if (organization_id) {
        const org_id = parseInt(organization_id, 10);
        if (!isNaN(org_id)) filters.organization_id = org_id;
      }
    } else {
      // Auto-scope for non-super-admins
      filters.organization_id = req?.user?.organization_id;
    }

    if (store_id) {
      const s_id = parseInt(store_id, 10);
      if (isNaN(s_id)) {
        throw new BadRequestException('Invalid storeId parameter');
      }
      filters.store_id = s_id;
    }

    if (search) filters.search = search;
    if (limit) {
      const val = parseInt(limit, 10);
      if (isNaN(val) || val <= 0) {
        throw new BadRequestException('Invalid limit parameter');
      }
      filters.limit = val;
    }
    if (offset) {
      const val = parseInt(offset, 10);
      if (isNaN(val) || val < 0) {
        throw new BadRequestException('Invalid offset parameter');
      }
      filters.offset = val;
    }

    const result = await this.domainsService.getAllDomainSettings(filters);
    const page = Math.floor((filters.offset || 0) / (filters.limit || 10)) + 1;
    const limit_value = filters.limit || 10;

    return this.responseService.paginated(
      result.data,
      result.total,
      page,
      limit_value,
      'Domain settings retrieved successfully',
    );
  }

  /**
   * 📊 Obtener estadísticas de dominios
   */
  @Get('stats')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:read')
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:read')
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:read')
  async getDomainSettingById(
    @Param('id') id: string,
  ): Promise<SuccessResponse<DomainSettingResponse>> {
    const domain_id = parseInt(id, 10);
    if (isNaN(domain_id)) {
      throw new BadRequestException('Invalid domain ID');
    }
    const result = await this.domainsService.getDomainSettingById(domain_id);
    return this.responseService.success(
      result,
      'Domain setting retrieved successfully',
    );
  }

  /**
   * Actualizar configuración de dominio
   */
  @Put('hostname/:hostname')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:update')
  async updateDomainSetting(
    @Param('hostname') hostname: string,
    @Body() update_domain_setting_dto: UpdateDomainSettingDto,
  ): Promise<SuccessResponse<DomainSettingResponse>> {
    const result = await this.domainsService.updateDomainSetting(
      hostname,
      update_domain_setting_dto,
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:delete')
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:create')
  async duplicateDomainSetting(
    @Param('hostname') hostname: string,
    @Body() duplicate_data: DuplicateDomainDto,
  ): Promise<SuccessResponse<DomainSettingResponse>> {
    const result = await this.domainsService.duplicateDomainSetting(
      hostname,
      duplicate_data.new_hostname,
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:read')
  async getDomainSettingsByOrganization(
    @Param('organizationId') organization_id: string,
  ): Promise<SuccessResponse<DomainSettingResponse[]>> {
    const org_id = parseInt(organization_id, 10);
    if (isNaN(org_id)) {
      throw new BadRequestException('Invalid organization ID');
    }
    const result = await this.domainsService.getAllDomainSettings({
      organization_id: org_id,
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:read')
  async getDomainSettingsByStore(
    @Param('storeId') store_id: string,
  ): Promise<SuccessResponse<DomainSettingResponse[]>> {
    const s_id = parseInt(store_id, 10);
    if (isNaN(s_id)) {
      throw new BadRequestException('Invalid store ID');
    }
    const result = await this.domainsService.getAllDomainSettings({
      store_id: s_id,
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:read')
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
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OWNER)
  @Permissions('organization:domains:verify')
  async verifyDomain(
    @Param('hostname') hostname: string,
    @Body() body: VerifyDomainDto,
  ): Promise<SuccessResponse<VerifyDomainResult>> {
    const result = await this.domainsService.verifyDomain(hostname, body);
    return this.responseService.success(result, 'Domain verified successfully');
  }
}
