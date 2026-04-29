import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { MetadataFieldsService } from './metadata-fields.service';
import { CreateMetadataFieldDto } from './dto/create-metadata-field.dto';
import { UpdateMetadataFieldDto } from './dto/update-metadata-field.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/metadata-fields')
@UseGuards(PermissionsGuard)
export class MetadataFieldsController {
  constructor(
    private readonly service: MetadataFieldsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:settings:read')
  async listFields(
    @Query('entity_type') entityType?: string,
    @Query('include_inactive') includeInactive?: string,
  ) {
    const result = await this.service.listFields(
      entityType,
      includeInactive === 'true',
    );
    return this.responseService.success(result);
  }

  @Get(':id')
  @Permissions('store:settings:read')
  async getField(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.getField(id);
    return this.responseService.success(result);
  }

  @Post()
  @Permissions('store:settings:write')
  async createField(@Body() dto: CreateMetadataFieldDto) {
    const result = await this.service.createField(dto);
    return this.responseService.success(result, 'Campo creado correctamente');
  }

  @Patch(':id')
  @Permissions('store:settings:write')
  async updateField(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMetadataFieldDto,
  ) {
    const result = await this.service.updateField(id, dto);
    return this.responseService.success(
      result,
      'Campo actualizado correctamente',
    );
  }

  @Patch(':id/toggle')
  @Permissions('store:settings:write')
  async toggleField(
    @Param('id', ParseIntPipe) id: number,
    @Body('is_active') isActive: boolean,
  ) {
    const result = await this.service.toggleField(id, isActive);
    return this.responseService.success(result);
  }

  @Delete(':id')
  @Permissions('store:settings:write')
  async deleteField(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.deleteField(id);
    return this.responseService.success(
      result,
      'Campo eliminado correctamente',
    );
  }
}
