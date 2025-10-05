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
import { RolesGuard } from '../../modules/auth/guards/roles.guard';
import { Roles } from '../../modules/auth/decorators/roles.decorator';
import { CurrentUser } from '../../modules/auth/decorators/current-user.decorator';
import {
  DomainSettingsService,
  DomainSettingResponse,
} from '../services/domain-settings.service';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
  ValidateHostnameDto,
  DuplicateDomainDto,
  VerifyDomainDto,
  VerifyDomainResult,
} from '../dto/domain-settings.dto';

@Controller('domain-settings')
@UseGuards(RolesGuard)
export class DomainSettingsController {
  private readonly logger = new Logger(DomainSettingsController.name);

  constructor(private readonly domainSettingsService: DomainSettingsService) {}

  /**
   * Crear una nueva configuración de dominio
   * Solo usuarios con permisos de administración pueden crear dominios
   */
  @Post()
  @Roles('super_admin', 'admin', 'owner')
  @HttpCode(HttpStatus.CREATED)
  async createDomainSetting(
    @Body() createDomainSettingDto: CreateDomainSettingDto,
    @CurrentUser() user: any,
  ): Promise<DomainSettingResponse> {
    this.logger.log(
      `Creating domain setting for hostname: ${createDomainSettingDto.hostname}`,
    );

    // Validar que el usuario tiene permisos sobre la organización
    // TODO: Implementar validación de permisos organizacionales

    return this.domainSettingsService.create(createDomainSettingDto);
  }

  /**
   * Obtener todas las configuraciones de dominio con filtros
   */
  @Get()
  @Roles('super_admin', 'admin', 'owner')
  async getAllDomainSettings(
    @Query('organizationId') organizationId?: string,
    @Query('storeId') storeId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @CurrentUser() user?: any,
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

    if (search) {
      filters.search = search;
    }

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

    // TODO: Filtrar por permisos del usuario
    return this.domainSettingsService.findAll(filters);
  }

  /**
   * Obtener configuración de dominio por hostname
   */
  @Get('hostname/:hostname')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingByHostname(
    @Param('hostname') hostname: string,
    @CurrentUser() user?: any,
  ): Promise<DomainSettingResponse> {
    // TODO: Validar permisos del usuario sobre el dominio
    return this.domainSettingsService.findByHostname(hostname);
  }

  /**
   * Obtener configuración de dominio por ID
   */
  @Get(':id')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingById(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ): Promise<DomainSettingResponse> {
    const domainId = parseInt(id, 10);
    if (isNaN(domainId)) {
      throw new BadRequestException('Invalid domain ID');
    }

    // TODO: Validar permisos del usuario sobre el dominio
    return this.domainSettingsService.findById(domainId);
  }

  /**
   * Actualizar configuración de dominio
   */
  @Put('hostname/:hostname')
  @Roles('super_admin', 'admin', 'owner')
  async updateDomainSetting(
    @Param('hostname') hostname: string,
    @Body() updateDomainSettingDto: UpdateDomainSettingDto,
    @CurrentUser() user?: any,
  ): Promise<DomainSettingResponse> {
    this.logger.log(`Updating domain setting for hostname: ${hostname}`);

    // TODO: Validar permisos del usuario sobre el dominio
    return this.domainSettingsService.update(hostname, updateDomainSettingDto);
  }

  /**
   * Eliminar configuración de dominio
   */
  @Delete('hostname/:hostname')
  @Roles('super_admin', 'admin', 'owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDomainSetting(
    @Param('hostname') hostname: string,
    @CurrentUser() user?: any,
  ): Promise<void> {
    this.logger.log(`Deleting domain setting for hostname: ${hostname}`);

    // TODO: Validar permisos del usuario sobre el dominio
    await this.domainSettingsService.delete(hostname);
  }

  /**
   * Duplicar configuración de dominio
   */
  @Post('hostname/:hostname/duplicate')
  @Roles('super_admin', 'admin', 'owner')
  async duplicateDomainSetting(
    @Param('hostname') hostname: string,
    @Body() duplicateData: DuplicateDomainDto,
    @CurrentUser() user?: any,
  ): Promise<DomainSettingResponse> {
    this.logger.log(
      `Duplicating domain setting from ${hostname} to ${duplicateData.newHostname}`,
    );

    // TODO: Validar permisos del usuario sobre el dominio original y destino
    return this.domainSettingsService.duplicate(
      hostname,
      duplicateData.newHostname,
    );
  }

  /**
   * Obtener configuraciones de dominio por organización
   */
  @Get('organization/:organizationId')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingsByOrganization(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user?: any,
  ): Promise<DomainSettingResponse[]> {
    const orgId = parseInt(organizationId, 10);
    if (isNaN(orgId)) {
      throw new BadRequestException('Invalid organization ID');
    }

    // TODO: Validar permisos del usuario sobre la organización
    const result = await this.domainSettingsService.findAll({
      organizationId: orgId,
    });
    return result.data;
  }

  /**
   * Obtener configuraciones de dominio por tienda
   */
  @Get('store/:storeId')
  @Roles('super_admin', 'admin', 'owner')
  async getDomainSettingsByStore(
    @Param('storeId') storeId: string,
    @CurrentUser() user?: any,
  ): Promise<DomainSettingResponse[]> {
    const sId = parseInt(storeId, 10);
    if (isNaN(sId)) {
      throw new BadRequestException('Invalid store ID');
    }

    // TODO: Validar permisos del usuario sobre la tienda
    const result = await this.domainSettingsService.findAll({ storeId: sId });
    return result.data;
  }

  /**
   * Validar hostname (endpoint de utilidad)
   */
  @Post('validate-hostname')
  @Roles('super_admin', 'admin', 'owner')
  async validateHostname(
    @Body() data: ValidateHostnameDto,
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      // Usar el método privado del servicio de forma indirecta
      await this.domainSettingsService.findByHostname(data.hostname);
      return { valid: false, reason: 'Hostname already exists' };
    } catch (error) {
      // Si no se encuentra, el hostname está disponible
      if (error.message.includes('not found')) {
        return { valid: true };
      }
      return { valid: false, reason: 'Invalid hostname format' };
    }
  }

  /**
   * Verificar configuración DNS de un dominio custom
   */
  @Post('hostname/:hostname/verify')
  @Roles('super_admin', 'admin', 'owner')
  async verifyDomain(
    @Param('hostname') hostname: string,
    @Body() body: VerifyDomainDto,
    @CurrentUser() user?: any,
  ): Promise<VerifyDomainResult> {
    this.logger.log(`Verifying domain DNS for hostname: ${hostname}`);
    return this.domainSettingsService.verify(hostname, body);
  }
}
