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

import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { SkipSubscriptionGate } from '../../../store/subscriptions/decorators/skip-subscription-gate.decorator';

import { OrgLocationsService } from './org-locations.service';
import { OrgLocationQueryDto } from './dto/org-location-query.dto';
import { CreateOrgLocationDto } from './dto/create-org-location.dto';
import { UpdateOrgLocationDto } from './dto/update-org-location.dto';

/**
 * `/api/organization/inventory/locations` — org-level CRUD for inventory
 * locations. Reads (list/findOne) consolidate across the organization with an
 * optional `store_id` breakdown. Writes (create/update/delete) enforce the
 * central-warehouse rules in {@link OrgLocationsService}.
 *
 * Per-store CRUD remains under `/store/inventory/locations` for STORE_ADMIN.
 */
@Controller('organization/inventory/locations')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgLocationsController {
  constructor(
    private readonly locations: OrgLocationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:inventory:locations:read')
  async findAll(@Query() query: OrgLocationQueryDto) {
    const result = await this.locations.findAll(query);
    const response = this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Ubicaciones obtenidas exitosamente',
    );
    // Augment meta with org-wide central warehouse count so the frontend
    // banner reflects the whole org, not the visible (paginated/filtered) page.
    (response as any).meta = {
      ...response.meta,
      central_count: result.meta.central_count,
    };
    return response;
  }

  @Post('central-warehouse/ensure')
  @Permissions('organization:inventory:locations:create')
  async ensureCentral() {
    const data = await this.locations.ensureCentralForCurrentOrg();
    return this.responseService.success(data, 'Bodega central asegurada exitosamente');
  }

  @Get(':id')
  @Permissions('store:inventory:locations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.locations.findOne(id);
    return this.responseService.success(data, 'Ubicación obtenida');
  }

  @Post()
  @Permissions('organization:inventory:locations:create')
  async create(@Body() dto: CreateOrgLocationDto) {
    const data = await this.locations.create(dto);
    return this.responseService.created(
      data,
      'Ubicación creada exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('organization:inventory:locations:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrgLocationDto,
  ) {
    const data = await this.locations.update(id, dto);
    return this.responseService.updated(
      data,
      'Ubicación actualizada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('organization:inventory:locations:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.locations.remove(id);
    return this.responseService.deleted('Ubicación eliminada exitosamente');
  }
}
