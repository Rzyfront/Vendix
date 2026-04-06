import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { FixedAssetsService } from './fixed-assets.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ModuleFlowGuard, RequireModuleFlow } from '../../../../common/guards/module-flow.guard';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { QueryFixedAssetsDto } from './dto/query-fixed-assets.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { RunDepreciationDto } from './dto/run-depreciation.dto';

@Controller('store/accounting/fixed-assets')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class FixedAssetsController {
  constructor(
    private readonly fixed_assets_service: FixedAssetsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:accounting:fixed_assets:read')
  async findAll(@Query() query_dto: QueryFixedAssetsDto) {
    const result = await this.fixed_assets_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static routes BEFORE :id ---

  @Get('reports/book-values')
  @Permissions('store:accounting:fixed_assets:read')
  async getAssetReport() {
    const result = await this.fixed_assets_service.getAssetReport();
    return this.response_service.success(result);
  }

  @Post('depreciation/run')
  @Permissions('store:accounting:fixed_assets:write')
  @HttpCode(HttpStatus.OK)
  async runMonthlyDepreciation(@Body() dto: RunDepreciationDto) {
    const result = await this.fixed_assets_service.runMonthlyDepreciation(dto);
    return this.response_service.success(result, 'Monthly depreciation run completed');
  }

  // --- Parameter routes ---

  @Get(':id')
  @Permissions('store:accounting:fixed_assets:read')
  async findOne(@Param('id') id: string) {
    const result = await this.fixed_assets_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:accounting:fixed_assets:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateFixedAssetDto) {
    const result = await this.fixed_assets_service.create(dto);
    return this.response_service.success(result, 'Fixed asset created successfully');
  }

  @Patch(':id')
  @Permissions('store:accounting:fixed_assets:write')
  async update(@Param('id') id: string, @Body() dto: UpdateFixedAssetDto) {
    const result = await this.fixed_assets_service.update(+id, dto);
    return this.response_service.success(result, 'Fixed asset updated successfully');
  }

  @Post(':id/retire')
  @Permissions('store:accounting:fixed_assets:write')
  @HttpCode(HttpStatus.OK)
  async retire(@Param('id') id: string) {
    const result = await this.fixed_assets_service.retire(+id);
    return this.response_service.success(result, 'Fixed asset retired successfully');
  }

  @Post(':id/dispose')
  @Permissions('store:accounting:fixed_assets:write')
  @HttpCode(HttpStatus.OK)
  async dispose(@Param('id') id: string, @Body() dto: DisposeAssetDto) {
    const result = await this.fixed_assets_service.dispose(+id, dto);
    return this.response_service.success(result, 'Fixed asset disposed successfully');
  }

  @Get(':id/schedule')
  @Permissions('store:accounting:fixed_assets:read')
  async getDepreciationSchedule(@Param('id') id: string) {
    const result = await this.fixed_assets_service.getDepreciationSchedule(+id);
    return this.response_service.success(result);
  }

  @Get(':id/history')
  @Permissions('store:accounting:fixed_assets:read')
  async getDepreciationHistory(@Param('id') id: string) {
    const result = await this.fixed_assets_service.getDepreciationHistory(+id);
    return this.response_service.success(result);
  }
}
