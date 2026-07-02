import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { GymMembershipsService } from './gym-memberships.service';
import {
  CreateGymMembershipDto,
  UpdateGymMembershipDto,
  GymMembershipQueryDto,
  RenewMembershipDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * Store-scoped gym memberships (Gym Suite — Ola 1).
 *
 * Permission policy:
 *   - GET list/detail        → store:gym_memberships:read
 *   - POST create            → store:gym_memberships:create
 *   - PATCH / transitions     → store:gym_memberships:update
 *   - POST :id/renew (charge) → store:gym_memberships:update
 */
@Controller('store/gym/memberships')
@UseGuards(PermissionsGuard)
export class GymMembershipsController {
  constructor(
    private readonly service: GymMembershipsService,
    private readonly responseService: ResponseService,
  ) {}

  private fail(error: any, fallback: string) {
    return this.responseService.error(
      error.response?.message || error.message || fallback,
      error.response?.message || error.message,
      error.getStatus?.() ?? error.status ?? 400,
      error.errorCode,
    );
  }

  @Post()
  @Permissions('store:gym_memberships:create')
  async create(@Body() dto: CreateGymMembershipDto) {
    try {
      const result = await this.service.create(dto);
      return this.responseService.created(
        result,
        'Membresía creada exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al crear la membresía');
    }
  }

  @Get()
  @Permissions('store:gym_memberships:read')
  async findAll(@Query() query: GymMembershipQueryDto) {
    try {
      const result = await this.service.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Membresías obtenidas exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al obtener las membresías');
    }
  }

  @Get(':id')
  @Permissions('store:gym_memberships:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.findOne(id);
      return this.responseService.success(
        result,
        'Membresía obtenida exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al obtener la membresía');
    }
  }

  @Patch(':id')
  @Permissions('store:gym_memberships:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGymMembershipDto,
  ) {
    try {
      const result = await this.service.update(id, dto);
      return this.responseService.updated(
        result,
        'Membresía actualizada exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al actualizar la membresía');
    }
  }

  @Post(':id/suspend')
  @Permissions('store:gym_memberships:update')
  async suspend(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.suspend(id);
      return this.responseService.updated(result, 'Membresía suspendida');
    } catch (error: any) {
      return this.fail(error, 'Error al suspender la membresía');
    }
  }

  @Post(':id/freeze')
  @Permissions('store:gym_memberships:update')
  async freeze(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.freeze(id);
      return this.responseService.updated(result, 'Membresía congelada');
    } catch (error: any) {
      return this.fail(error, 'Error al congelar la membresía');
    }
  }

  @Post(':id/cancel')
  @Permissions('store:gym_memberships:update')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.cancel(id);
      return this.responseService.updated(result, 'Membresía cancelada');
    } catch (error: any) {
      return this.fail(error, 'Error al cancelar la membresía');
    }
  }

  @Post(':id/reactivate')
  @Permissions('store:gym_memberships:update')
  async reactivate(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.reactivate(id);
      return this.responseService.updated(result, 'Membresía reactivada');
    } catch (error: any) {
      return this.fail(error, 'Error al reactivar la membresía');
    }
  }

  @Post(':id/renew')
  @Permissions('store:gym_memberships:update')
  async renew(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenewMembershipDto,
    @Request() req: any,
  ) {
    try {
      const result = await this.service.renew(id, dto, req.user);
      return this.responseService.success(
        result,
        result.renewed
          ? 'Membresía renovada y cobrada exitosamente'
          : 'Cobro iniciado; la membresía se activará al confirmarse el pago',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al renovar la membresía');
    }
  }
}
