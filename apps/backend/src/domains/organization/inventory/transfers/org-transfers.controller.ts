import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgTransfersService } from './org-transfers.service';
import { OrgTransferQueryDto } from './dto/org-transfer-query.dto';
import { CreateOrgTransferDto } from './dto/create-org-transfer.dto';
import { CompleteOrgTransferDto } from './dto/complete-org-transfer.dto';
import { CancelOrgTransferDto } from './dto/cancel-org-transfer.dto';
import { DispatchOrgTransferDto } from './dto/dispatch-org-transfer.dto';

/**
 * `/api/organization/inventory/transfers` — org-level stock transfer
 * lifecycle (Plan P2.4).
 *
 * Five-step lifecycle (TWO-STEP approve+dispatch, §13#1):
 *   POST  /                  → create (logical: pending)
 *   POST  /:id/approve       → approve (no stock change)
 *   POST  /:id/dispatch      → decrement origin (logical: in_transit)
 *   POST  /:id/complete      → increment destination (logical: received)
 *   POST  /:id/cancel        → cancel; if in_transit returns origin stock
 *
 * Reads are inherited from the previous read-only iteration (`/`, `/:id`,
 * `/stats`).
 *
 * Permissions follow the standard
 * `organization:inventory:transfers:{action}` pattern (seeded in
 * `permissions-roles.seed.ts` — NOT touched in this round).
 */
@Controller('organization/inventory/transfers')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgTransfersController {
  constructor(
    private readonly transfers: OrgTransfersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('stats')
  @Permissions('organization:inventory:transfers:read')
  async getStats() {
    const data = await this.transfers.getStats();
    return this.responseService.success(
      data,
      'Estadísticas de traslados obtenidas',
    );
  }

  @Get()
  @Permissions('organization:inventory:transfers:read')
  async findAll(@Query() query: OrgTransferQueryDto) {
    const result = await this.transfers.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Traslados obtenidos exitosamente',
    );
  }

  @Get(':id')
  @Permissions('organization:inventory:transfers:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.transfers.findOne(id);
    return this.responseService.success(data, 'Traslado obtenido');
  }

  @Post()
  @Permissions('organization:inventory:transfers:create')
  async create(@Body() dto: CreateOrgTransferDto) {
    const data = await this.transfers.create(dto);
    return this.responseService.success(
      data,
      'Traslado creado exitosamente',
    );
  }

  @Post(':id/approve')
  @Permissions('organization:inventory:transfers:approve')
  async approve(@Param('id', ParseIntPipe) id: number) {
    const data = await this.transfers.approve(id);
    return this.responseService.success(data, 'Traslado aprobado');
  }

  @Post(':id/dispatch')
  @Permissions('organization:inventory:transfers:dispatch')
  async dispatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() body?: DispatchOrgTransferDto,
  ) {
    const data = await this.transfers.dispatch(id, body);
    return this.responseService.success(data, 'Traslado despachado');
  }

  @Post(':id/complete')
  @Permissions('organization:inventory:transfers:complete')
  async complete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteOrgTransferDto,
  ) {
    const data = await this.transfers.complete(id, dto);
    return this.responseService.success(data, 'Traslado recibido');
  }

  @Post(':id/cancel')
  @Permissions('organization:inventory:transfers:cancel')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CancelOrgTransferDto,
  ) {
    const data = await this.transfers.cancel(id, body ?? {});
    return this.responseService.success(data, 'Traslado cancelado');
  }
}
