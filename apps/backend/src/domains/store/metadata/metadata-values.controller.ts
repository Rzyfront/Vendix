import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { MetadataValuesService } from './metadata-values.service';
import { BulkSetMetadataDto } from './dto/bulk-set-metadata.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/metadata-values')
@UseGuards(PermissionsGuard)
export class MetadataValuesController {
  constructor(
    private readonly service: MetadataValuesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get(':entityType/:entityId')
  @Permissions('store:settings:read')
  async getValues(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseIntPipe) entityId: number,
  ) {
    const result = await this.service.getValues(entityType, entityId);
    return this.responseService.success(result);
  }

  @Post()
  @Permissions('store:settings:write')
  async setValues(@Body() dto: BulkSetMetadataDto) {
    const result = await this.service.setValues(
      dto.entity_type,
      dto.entity_id,
      dto.values,
    );
    return this.responseService.success(
      result,
      'Metadatos guardados correctamente',
    );
  }

  @Delete(':entityType/:entityId/:fieldId')
  @Permissions('store:settings:write')
  async deleteValue(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseIntPipe) entityId: number,
    @Param('fieldId', ParseIntPipe) fieldId: number,
  ) {
    const result = await this.service.deleteValue(
      fieldId,
      entityType,
      entityId,
    );
    return this.responseService.success(
      result,
      'Valor eliminado correctamente',
    );
  }
}
