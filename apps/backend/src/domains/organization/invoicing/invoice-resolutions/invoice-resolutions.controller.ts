import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { CreateOrgInvoiceResolutionDto } from './dto/create-org-invoice-resolution.dto';
import { UpdateOrgInvoiceResolutionDto } from './dto/update-org-invoice-resolution.dto';
import { ArchiveResolutionDto } from '../../../store/invoicing/resolutions/dto/archive-resolution.dto';
import { ListOrgInvoiceResolutionsQueryDto } from './dto/list-org-invoice-resolutions-query.dto';
import { OrgInvoiceResolutionsService } from './invoice-resolutions.service';

@Controller('organization/invoicing/resolutions')
@UseGuards(PermissionsGuard)
export class OrgInvoiceResolutionsController {
  constructor(
    private readonly resolutionsService: OrgInvoiceResolutionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:invoicing:resolutions:read')
  async findAll(@Query() query: ListOrgInvoiceResolutionsQueryDto) {
    const result = await this.resolutionsService.findAll(
      query.store_id,
      query.include_archived === true,
    );
    return this.responseService.success(result, 'Resoluciones obtenidas');
  }

  /** Declarado ANTES de `:id` para que `ParseIntPipe` no capture `in-use`. */
  @Get('in-use')
  @Permissions('organization:invoicing:resolutions:read')
  async findInUse(@Query('store_id') storeIdRaw?: string) {
    const storeId = storeIdRaw ? Number(storeIdRaw) : undefined;
    const result = await this.resolutionsService.findInUse(storeId);
    return this.responseService.success(result, 'Resoluciones en uso obtenidas');
  }

  @Get(':id')
  @Permissions('organization:invoicing:resolutions:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.resolutionsService.findOne(id);
    return this.responseService.success(result, 'Resolución obtenida');
  }

  @Post()
  @Permissions('organization:invoicing:resolutions:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateOrgInvoiceResolutionDto) {
    const result = await this.resolutionsService.create(dto);
    return this.responseService.created(result, 'Resolución creada');
  }

  @Patch(':id')
  @Permissions('organization:invoicing:resolutions:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrgInvoiceResolutionDto,
  ) {
    const result = await this.resolutionsService.update(id, dto);
    return this.responseService.updated(result, 'Resolución actualizada');
  }

  @Post(':id/archive')
  @Permissions('organization:invoicing:resolutions:write')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ArchiveResolutionDto,
  ) {
    const result = await this.resolutionsService.archive(id, dto);
    return this.responseService.success(result, 'Resolution archived');
  }

  @Delete(':id')
  @Permissions('organization:invoicing:resolutions:write')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.resolutionsService.remove(id);
    return this.responseService.success(result, 'Resolution archived');
  }
}
