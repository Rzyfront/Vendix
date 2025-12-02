import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationQueryDto,
  OrganizationDashboardDto,
  UsersDashboardDto,
  OrganizationsDashboardStatsDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';

@Controller('organization/organizations')
@UseGuards(PermissionsGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('organizations:create')
  async create(
    @Body() createOrganizationDto: CreateOrganizationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.organizationsService.create(
        createOrganizationDto,
      );
      return this.responseService.success(
        result,
        'Organización creada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al crear la organización',
        error.message,
      );
    }
  }

  @Get()
  @Permissions('organizations:read')
  async findAll(
    @Query() query: OrganizationQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.organizationsService.findAll(query);
      return this.responseService.success(
        result.data,
        'Organizaciones obtenidas exitosamente',
        result.meta,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las organizaciones',
        error.message,
      );
    }
  }

  @Get('stats')
  @Permissions('organizations:read')
  async getStats() {
    try {
      const result = await this.organizationsService.getDashboardStats();
      return this.responseService.success(
        result,
        'Estadísticas de organizaciones obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las estadísticas de organizaciones',
        error.message,
      );
    }
  }

  @Get(':id')
  @Permissions('organizations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.organizationsService.findOne(id);
      return this.responseService.success(
        result,
        'Organización obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener la organización',
        error.message,
      );
    }
  }

  @Get('slug/:slug')
  @Permissions('organizations:read')
  async findBySlug(@Param('slug') slug: string) {
    try {
      const result = await this.organizationsService.findBySlug(slug);
      return this.responseService.success(
        result,
        'Organización obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener la organización',
        error.message,
      );
    }
  }

  @Patch(':id')
  @Permissions('organizations:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    try {
      const result = await this.organizationsService.update(
        id,
        updateOrganizationDto,
      );
      return this.responseService.success(
        result,
        'Organización actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al actualizar la organización',
        error.message,
      );
    }
  }

  @Delete(':id')
  @Permissions('organizations:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.organizationsService.remove(id);
      return this.responseService.success(
        result,
        'Organización eliminada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al eliminar la organización',
        error.message,
      );
    }
  }

  @Get(':id/stats')
  @Permissions('organizations:read')
  async getOrganizationStats(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: OrganizationDashboardDto,
  ) {
    try {
      const result = await this.organizationsService.getDashboard(id, query);
      return this.responseService.success(
        result,
        'Estadísticas organizacionales obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las estadísticas organizacionales',
        error.message,
      );
    }
  }
}
