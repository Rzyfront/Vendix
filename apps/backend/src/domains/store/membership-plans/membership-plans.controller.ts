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
import { MembershipPlansService } from './membership-plans.service';
import {
  CreateMembershipPlanDto,
  UpdateMembershipPlanDto,
  MembershipPlanQueryDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * Store-scoped CRUD for membership plans (generalized membership core).
 *
 * Permission policy:
 *   - GET list/detail → store:membership_plans:read
 *   - POST create     → store:membership_plans:create
 *   - PATCH update    → store:membership_plans:update
 *   - DELETE          → store:membership_plans:delete (soft when referenced, else hard)
 */
@Controller('store/memberships/plans')
@UseGuards(PermissionsGuard)
export class MembershipPlansController {
  constructor(
    private readonly membershipPlansService: MembershipPlansService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:membership_plans:create')
  async create(@Body() dto: CreateMembershipPlanDto) {
    try {
      const result = await this.membershipPlansService.create(dto);
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
  @Permissions('store:membership_plans:read')
  async findAll(@Query() query: MembershipPlanQueryDto) {
    try {
      const result = await this.membershipPlansService.findAll(query);
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
  @Permissions('store:membership_plans:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.membershipPlansService.findOne(id);
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
  @Permissions('store:membership_plans:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMembershipPlanDto,
  ) {
    try {
      const result = await this.membershipPlansService.update(id, dto);
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
  @Permissions('store:membership_plans:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.membershipPlansService.remove(id);
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
