import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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

import { OrgAdjustmentsService } from './org-adjustments.service';
import {
  CreateOrgAdjustmentBulkDto,
  CreateOrgAdjustmentDto,
} from './dto/create-org-adjustment.dto';
import { QueryOrgAdjustmentDto } from './dto/query-org-adjustment.dto';

/**
 * `/api/organization/inventory/adjustments` — org-wide inventory adjustments
 * with full CRUD and mandatory audit-log entries on every mutation.
 *
 * - Reads are auto-scoped by `OrganizationPrismaService` and accept an
 *   optional `?store_id=X` breakdown filter (resolved via the location
 *   relation, since adjustments do not carry a `store_id` column).
 * - Writes delegate to the store-side service with the location's `store_id`
 *   transiently pinned in the request context, and emit an `audit_logs`
 *   row through the global `AuditService` after every successful mutation.
 * - Permissions follow the `organization:inventory:adjustments:*` namespace.
 */
@Controller('organization/inventory/adjustments')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgAdjustmentsController {
  constructor(
    private readonly adjustments: OrgAdjustmentsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:inventory:adjustments:read')
  async findAll(@Query() query: QueryOrgAdjustmentDto) {
    const result = await this.adjustments.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Ajustes de inventario obtenidos exitosamente',
    );
  }

  @Get(':id')
  @Permissions('organization:inventory:adjustments:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.adjustments.findOne(id);
    return this.responseService.success(data, 'Ajuste de inventario obtenido');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('organization:inventory:adjustments:create')
  async create(@Body() dto: CreateOrgAdjustmentDto) {
    const data = await this.adjustments.create(dto);
    return this.responseService.success(
      data,
      'Ajuste de inventario creado exitosamente',
    );
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('organization:inventory:adjustments:create')
  async createBulk(@Body() dto: CreateOrgAdjustmentBulkDto) {
    const result = await this.adjustments.createBulk(dto);
    return this.responseService.success(
      result.data,
      `${result.meta.total} ajustes de inventario creados exitosamente`,
    );
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('organization:inventory:adjustments:approve')
  async approve(@Param('id', ParseIntPipe) id: number) {
    const data = await this.adjustments.approve(id);
    return this.responseService.success(
      data,
      'Ajuste de inventario aprobado exitosamente',
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('organization:inventory:adjustments:delete')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    const data = await this.adjustments.cancel(id);
    return this.responseService.success(
      data,
      'Ajuste de inventario cancelado exitosamente',
    );
  }
}
