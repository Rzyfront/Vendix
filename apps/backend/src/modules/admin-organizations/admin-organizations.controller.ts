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
} from '@nestjs/common';
import { AdminOrganizationsService } from './admin-organizations.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  AdminOrganizationQueryDto,
  OrganizationDashboardDto,
} from '../organizations/dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/enums/user-role.enum';
import { ResponseService } from '../../common/responses/response.service';

@Controller('admin/organizations')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminOrganizationsController {
  constructor(
    private readonly adminOrganizationsService: AdminOrganizationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  async create(@Body() createOrganizationDto: CreateOrganizationDto) {
    try {
      const result = await this.adminOrganizationsService.create(
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
  async findAll(@Query() query: AdminOrganizationQueryDto) {
    try {
      const result = await this.adminOrganizationsService.findAll(query);
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
  async getStats() {
    try {
      const result = await this.adminOrganizationsService.getDashboardStats();
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
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.adminOrganizationsService.findOne(id);
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
  async findBySlug(@Param('slug') slug: string) {
    try {
      const result = await this.adminOrganizationsService.findBySlug(slug);
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
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    try {
      const result = await this.adminOrganizationsService.update(
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
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.adminOrganizationsService.remove(id);
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
  async getOrganizationStats(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: OrganizationDashboardDto,
  ) {
    try {
      const result = await this.adminOrganizationsService.getDashboard(
        id,
        query,
      );
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
