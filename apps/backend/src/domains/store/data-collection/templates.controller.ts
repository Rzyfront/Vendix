import { Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/data-collection/templates')
@UseGuards(PermissionsGuard)
export class TemplatesController {
  constructor(
    private readonly service: TemplatesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:settings:read')
  async findAll(@Query('status') status?: string) {
    const result = await this.service.findAll(status);
    return this.responseService.success(result);
  }

  @Get(':id')
  @Permissions('store:settings:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.findOne(id);
    return this.responseService.success(result);
  }

  @Post()
  @Permissions('store:settings:write')
  async create(@Body() dto: CreateTemplateDto) {
    const result = await this.service.createTemplate(dto);
    return this.responseService.success(result, 'Plantilla creada correctamente');
  }

  @Patch(':id')
  @Permissions('store:settings:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTemplateDto,
  ) {
    const result = await this.service.updateTemplate(id, dto);
    return this.responseService.success(result, 'Plantilla actualizada correctamente');
  }

  @Post(':id/duplicate')
  @Permissions('store:settings:write')
  async duplicate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.duplicateTemplate(id);
    return this.responseService.success(result, 'Plantilla duplicada correctamente');
  }

  @Delete(':id')
  @Permissions('store:settings:write')
  async delete(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.deleteTemplate(id);
    return this.responseService.success(result, 'Plantilla eliminada correctamente');
  }

  @Post(':id/products')
  @Permissions('store:settings:write')
  async assignProducts(
    @Param('id', ParseIntPipe) id: number,
    @Body('product_ids') productIds: number[],
  ) {
    const result = await this.service.assignProducts(id, productIds);
    return this.responseService.success(result, 'Productos asignados correctamente');
  }
}
