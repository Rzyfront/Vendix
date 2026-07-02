import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { GymPlansService } from './gym-plans.service';
import { CreateGymPlanDto, UpdateGymPlanDto, GymPlanQueryDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * Store-scoped CRUD for gym plans (Gym Suite — Ola 1).
 *
 * Permission policy:
 *   - GET list/detail → store:gym_plans:read
 *   - POST create     → store:gym_plans:create
 *   - PATCH update    → store:gym_plans:update
 *   - DELETE          → store:gym_plans:delete (soft when referenced, else hard)
 */
@Controller('store/gym/plans')
@UseGuards(PermissionsGuard)
export class GymPlansController {
  constructor(
    private readonly gymPlansService: GymPlansService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:gym_plans:create')
  async create(@Body() dto: CreateGymPlanDto) {
    try {
      const result = await this.gymPlansService.create(dto);
      return this.responseService.created(result, 'Plan creado exitosamente');
    } catch (error: any) {
      return this.responseService.error(
        error.response?.message || error.message || 'Error al crear el plan',
        error.response?.message || error.message,
        error.getStatus?.() ?? error.status ?? 400,
        error.errorCode,
      );
    }
  }

  @Get()
  @Permissions('store:gym_plans:read')
  async findAll(@Query() query: GymPlanQueryDto) {
    try {
      const result = await this.gymPlansService.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Planes obtenidos exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.response?.message || error.message || 'Error al obtener los planes',
        error.response?.message || error.message,
        error.getStatus?.() ?? error.status ?? 400,
        error.errorCode,
      );
    }
  }

  @Get(':id')
  @Permissions('store:gym_plans:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.gymPlansService.findOne(id);
      return this.responseService.success(result, 'Plan obtenido exitosamente');
    } catch (error: any) {
      return this.responseService.error(
        error.response?.message || error.message || 'Error al obtener el plan',
        error.response?.message || error.message,
        error.getStatus?.() ?? error.status ?? 400,
        error.errorCode,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:gym_plans:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGymPlanDto,
  ) {
    try {
      const result = await this.gymPlansService.update(id, dto);
      return this.responseService.updated(
        result,
        'Plan actualizado exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.response?.message ||
          error.message ||
          'Error al actualizar el plan',
        error.response?.message || error.message,
        error.getStatus?.() ?? error.status ?? 400,
        error.errorCode,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:gym_plans:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.gymPlansService.remove(id);
      return this.responseService.success(
        result,
        result.deleted
          ? 'Plan eliminado exitosamente'
          : 'Plan desactivado (tiene membresías asociadas)',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.response?.message || error.message || 'Error al eliminar el plan',
        error.response?.message || error.message,
        error.getStatus?.() ?? error.status ?? 400,
        error.errorCode,
      );
    }
  }
}
