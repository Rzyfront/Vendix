import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { FixedAssetCategoriesService } from './fixed-asset-categories.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { CreateFixedAssetCategoryDto } from './dto/create-category.dto';
import { UpdateFixedAssetCategoryDto } from './dto/update-category.dto';

@Controller('store/accounting/fixed-asset-categories')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class FixedAssetCategoriesController {
  constructor(
    private readonly categories_service: FixedAssetCategoriesService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:accounting:fixed_assets:read')
  async findAll() {
    const result = await this.categories_service.findAll();
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('store:accounting:fixed_assets:read')
  async findOne(@Param('id') id: string) {
    const result = await this.categories_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:accounting:fixed_assets:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateFixedAssetCategoryDto) {
    const result = await this.categories_service.create(dto);
    return this.response_service.success(
      result,
      'Category created successfully',
    );
  }

  @Patch(':id')
  @Permissions('store:accounting:fixed_assets:write')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFixedAssetCategoryDto,
  ) {
    const result = await this.categories_service.update(+id, dto);
    return this.response_service.success(
      result,
      'Category updated successfully',
    );
  }

  @Delete(':id')
  @Permissions('store:accounting:fixed_assets:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.categories_service.remove(+id);
    return this.response_service.success(null, 'Category deleted successfully');
  }
}
