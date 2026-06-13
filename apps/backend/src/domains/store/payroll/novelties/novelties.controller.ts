import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NoveltiesService } from './novelties.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CreateNoveltyDto, QueryNoveltyDto, UpdateNoveltyDto } from './dto';

@Controller('store/payroll/novelties')
@UseGuards(PermissionsGuard)
export class NoveltiesController {
  constructor(
    private readonly novelties_service: NoveltiesService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:payroll:novelties:read')
  async findAll(@Query() query_dto: QueryNoveltyDto) {
    const result = await this.novelties_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Get(':id')
  @Permissions('store:payroll:novelties:read')
  async findOne(@Param('id') id: string) {
    const result = await this.novelties_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:payroll:novelties:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateNoveltyDto) {
    const result = await this.novelties_service.create(create_dto);
    return this.response_service.created(
      result,
      'Novelty created successfully',
    );
  }

  @Patch(':id')
  @Permissions('store:payroll:novelties:update')
  async update(@Param('id') id: string, @Body() update_dto: UpdateNoveltyDto) {
    const result = await this.novelties_service.update(+id, update_dto);
    return this.response_service.updated(
      result,
      'Novelty updated successfully',
    );
  }

  @Delete(':id')
  @Permissions('store:payroll:novelties:delete')
  async remove(@Param('id') id: string) {
    await this.novelties_service.remove(+id);
    return this.response_service.deleted('Novelty deleted successfully');
  }
}
