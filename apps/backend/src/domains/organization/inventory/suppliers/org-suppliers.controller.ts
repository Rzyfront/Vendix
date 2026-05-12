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

import { OrgSuppliersService } from './org-suppliers.service';
import { OrgSupplierQueryDto } from './dto/org-supplier-query.dto';
import { CreateOrgSupplierDto } from './dto/create-org-supplier.dto';
import { UpdateOrgSupplierDto } from './dto/update-org-supplier.dto';

/**
 * `/api/organization/inventory/suppliers` — org-level supplier CRUD.
 *
 * READ uses the existing `store:inventory:suppliers:read` permission (which
 * STORE_ADMIN keeps) so list/detail still works for stores via this org-side
 * endpoint when DomainScopeGuard rejects the `/store/*` route.
 *
 * WRITE uses the new `organization:inventory:suppliers:{create|update|delete}`
 * permission family. Per Plan §6.3.2, these are revoked from STORE_ADMIN in
 * the upcoming permissions seed pass; only ORG_ADMIN (and equivalents) can
 * mutate suppliers from now on. Stores keep the read endpoints listed above
 * but lose write capability operationally.
 */
@Controller('organization/inventory/suppliers')
@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
export class OrgSuppliersController {
  constructor(
    private readonly suppliers: OrgSuppliersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:inventory:suppliers:read')
  async findAll(@Query() query: OrgSupplierQueryDto) {
    const result = await this.suppliers.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Proveedores obtenidos exitosamente',
    );
  }

  @Get('active')
  @Permissions('store:inventory:suppliers:read')
  async findActive(@Query() query: OrgSupplierQueryDto) {
    const result = await this.suppliers.findAll({ ...query, is_active: true });
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Proveedores activos obtenidos exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:inventory:suppliers:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.suppliers.findOne(id);
    return this.responseService.success(data, 'Proveedor obtenido');
  }

  @Post()
  @Permissions('organization:inventory:suppliers:create')
  async create(@Body() dto: CreateOrgSupplierDto) {
    const data = await this.suppliers.create(dto);
    return this.responseService.created(data, 'Proveedor creado exitosamente');
  }

  @Patch(':id')
  @Permissions('organization:inventory:suppliers:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrgSupplierDto,
  ) {
    const data = await this.suppliers.update(id, dto);
    return this.responseService.updated(
      data,
      'Proveedor actualizado exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('organization:inventory:suppliers:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.suppliers.remove(id);
    return this.responseService.deleted('Proveedor eliminado exitosamente');
  }
}
