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
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { CrmSegmentsService } from './crm-segments.service';
import {
  CreateCrmSegmentDto,
  CrmSegmentCustomersQueryDto,
  PreviewCrmSegmentDto,
  UpdateCrmSegmentDto,
} from './dto/crm-segments.dto';

/** Saved customer segments (PLAN-CRM §4.5). */
@Controller('store/customers/crm/segments')
@UseGuards(PermissionsGuard)
export class CrmSegmentsController {
  constructor(
    private readonly service: CrmSegmentsService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('store:customers:read')
  async list() {
    return this.response.success(await this.service.list());
  }

  @Post('preview')
  @Permissions('store:customers:read')
  async preview(@Body() dto: PreviewCrmSegmentDto) {
    return this.response.success(await this.service.preview(dto.filter));
  }

  @Post()
  @Permissions('store:crm_segments:manage')
  async create(@Body() dto: CreateCrmSegmentDto) {
    return this.response.success(
      await this.service.create(dto),
      'Segmento creado',
    );
  }

  @Get(':id')
  @Permissions('store:customers:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.get(id));
  }

  @Get(':id/customers')
  @Permissions('store:customers:read')
  async customers(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CrmSegmentCustomersQueryDto,
  ) {
    const result = await this.service.customers(id, query);
    return this.response.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Patch(':id')
  @Permissions('store:crm_segments:manage')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCrmSegmentDto,
  ) {
    return this.response.success(
      await this.service.update(id, dto),
      'Segmento actualizado',
    );
  }

  @Delete(':id')
  @Permissions('store:crm_segments:manage')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.service.remove(id),
      'Segmento eliminado',
    );
  }
}
