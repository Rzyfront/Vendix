import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import {
  UpdateOrganizationDto,
  OrganizationDashboardDto,
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
  @Permissions('organizations:read')
  async getProfile() {
    try {
      const result = await this.organizationsService.getProfile();
      return this.responseService.success(
        result,
        'Perfil de organización obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener el perfil de la organización',
        error.message,
      );
    }
  }

  @Patch('profile')
  @Permissions('organizations:update')
  async updateProfile(@Body() update_organization_dto: UpdateOrganizationDto) {
    try {
      const result = await this.organizationsService.updateProfile(update_organization_dto);
      return this.responseService.success(
        result,
        'Perfil de organización actualizado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al actualizar el perfil de la organización',
        error.message,
      );
    }
  }

  @Get('dashboard')
  @Permissions('organizations:read')
  async getDashboard(@Query() dashboard_query: OrganizationDashboardDto) {
    try {
      const result = await this.organizationsService.getDashboard(dashboard_query);
      return this.responseService.success(
        result,
        'Dashboard de organización obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener el dashboard de la organización',
        error.message,
      );
    }
  }
}
