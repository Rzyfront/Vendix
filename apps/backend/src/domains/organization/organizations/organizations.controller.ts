import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import {
  UpdateOrganizationDto,
  OrganizationDashboardDto,
  UpgradeAccountTypeDto,
  UpdateOperatingScopeDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('organization/organizations')
@UseGuards(PermissionsGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('profile')
  @Permissions('organization:organizations:read')
  async getProfile() {
    const result = await this.organizationsService.getProfile();
    return this.responseService.success(
      result,
      'Perfil de organización obtenido exitosamente',
    );
  }

  @Patch('profile')
  @Permissions('organization:organizations:update')
  async updateProfile(@Body() update_organization_dto: UpdateOrganizationDto) {
    const result = await this.organizationsService.updateProfile(
      update_organization_dto,
    );
    return this.responseService.success(
      result,
      'Perfil de organización actualizado exitosamente',
    );
  }

  @Get('dashboard')
  @Permissions('organization:organizations:read')
  async getDashboard(@Query() dashboard_query: OrganizationDashboardDto) {
    const result = await this.organizationsService.getDashboard(dashboard_query);
    return this.responseService.success(
      result,
      'Dashboard de organización obtenido exitosamente',
    );
  }

  @Patch('upgrade-account-type')
  @Permissions('organization:organizations:update')
  async upgradeAccountType(@Body() dto: UpgradeAccountTypeDto) {
    const result = await this.organizationsService.upgradeAccountType(dto);
    return this.responseService.success(result, result.message);
  }

  @Get('config')
  @Permissions('organization:settings:read')
  async getConfig() {
    const result = await this.organizationsService.getConfig();
    return this.responseService.success(
      result,
      'Configuración de organización obtenida exitosamente',
    );
  }

  @Patch('operating-scope')
  @Permissions('organization:settings:update')
  async updateOperatingScope(@Body() dto: UpdateOperatingScopeDto) {
    const result = await this.organizationsService.updateOperatingScope(dto);
    return this.responseService.success(
      result,
      result.changed
        ? 'Alcance operativo actualizado exitosamente'
        : 'El alcance operativo no cambió',
    );
  }

  @Get(':id/stats')
  @Permissions('organization:organizations:read')
  async getStats(
    @Param('id') organizationId: string,
    @Query() dashboard_query: OrganizationDashboardDto,
  ) {
    const result = await this.organizationsService.getOrganizationStats(
      Number(organizationId),
      dashboard_query,
    );
    return this.responseService.success(
      result,
      'Estadísticas de organización obtenidas exitosamente',
    );
  }
}
