import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { MembershipsService } from './memberships.service';
import {
  CreateMembershipDto,
  UpdateMembershipDto,
  MembershipQueryDto,
  RenewMembershipDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * Store-scoped memberships (generalized membership core).
 *
 * Permission policy:
 *   - GET list/detail        → store:memberships:read
 *   - POST create            → store:memberships:create
 *   - PATCH / transitions     → store:memberships:update
 *   - POST :id/renew (charge) → store:memberships:update
 */
@Controller('store/memberships')
@UseGuards(PermissionsGuard)
export class MembershipsController {
  constructor(
    private readonly service: MembershipsService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Fix H1: previously this returned `responseService.error(...)`, which made
   * NestJS answer with HTTP 2xx carrying an error body — the frontend then
   * treated failures as success. Now we THROW so Nest emits the correct HTTP
   * status + error code. Typed exceptions raised by the service (VendixHttp /
   * HttpException) are rethrown verbatim to preserve their status/code; any
   * opaque error is wrapped in a VendixHttpException with an existing code.
   */
  private fail(error: any, fallback: string): never {
    if (error instanceof VendixHttpException || error instanceof HttpException) {
      throw error;
    }
    throw new VendixHttpException(
      ErrorCodes.SYS_CONFLICT_001,
      error?.message || fallback,
    );
  }

  @Post()
  @Permissions('store:memberships:create')
  async create(@Body() dto: CreateMembershipDto) {
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
  @Permissions('store:memberships:read')
  async findAll(@Query() query: MembershipQueryDto) {
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
  @Permissions('store:memberships:read')
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
  @Permissions('store:memberships:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMembershipDto,
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
  @Permissions('store:memberships:update')
  async suspend(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.suspend(id);
      return this.responseService.updated(result, 'Membresía suspendida');
    } catch (error: any) {
      return this.fail(error, 'Error al suspender la membresía');
    }
  }

  @Post(':id/freeze')
  @Permissions('store:memberships:update')
  async freeze(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.freeze(id);
      return this.responseService.updated(result, 'Membresía congelada');
    } catch (error: any) {
      return this.fail(error, 'Error al congelar la membresía');
    }
  }

  @Post(':id/cancel')
  @Permissions('store:memberships:update')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.cancel(id);
      return this.responseService.updated(result, 'Membresía cancelada');
    } catch (error: any) {
      return this.fail(error, 'Error al cancelar la membresía');
    }
  }

  @Post(':id/reactivate')
  @Permissions('store:memberships:update')
  async reactivate(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.reactivate(id);
      return this.responseService.updated(result, 'Membresía reactivada');
    } catch (error: any) {
      return this.fail(error, 'Error al reactivar la membresía');
    }
  }

  @Post(':id/renew')
  @Permissions('store:memberships:update')
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
