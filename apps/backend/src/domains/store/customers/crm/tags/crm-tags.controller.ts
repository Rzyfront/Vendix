import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { CrmTagsService } from './crm-tags.service';
import { CreateCrmTagDto, UpdateCrmTagDto } from '../profile/dto/customer-crm.dto';

/**
 * Tag catalog (PLAN-CRM §4.5). Assigning tags to a customer lives in
 * `PUT /store/customers/:customerId/crm/tags`.
 */
@Controller('store/customers/crm/tags')
@UseGuards(PermissionsGuard)
export class CrmTagsController {
  constructor(
    private readonly service: CrmTagsService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('store:customers:read')
  async list() {
    return this.response.success(await this.service.list());
  }

  @Post()
  @Permissions('store:crm_segments:manage')
  async create(@Body() dto: CreateCrmTagDto) {
    return this.response.success(
      await this.service.create(dto),
      'Etiqueta creada',
    );
  }

  @Patch(':id')
  @Permissions('store:crm_segments:manage')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCrmTagDto,
  ) {
    return this.response.success(
      await this.service.update(id, dto),
      'Etiqueta actualizada',
    );
  }

  @Delete(':id')
  @Permissions('store:crm_segments:manage')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.service.remove(id),
      'Etiqueta eliminada',
    );
  }
}
