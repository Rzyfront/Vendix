import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQueryDto,
  AssignProductToCategoryDto,
} from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Permissions('categories:create')
  async create(@Body() createCategoryDto: CreateCategoryDto, @CurrentUser() user: any) {
    return this.categoriesService.create(createCategoryDto, user);
  }

  @Get()
  @Permissions('categories:read')
  async findAll(@Query() query: CategoryQueryDto) {
    return this.categoriesService.findAll(query);
  }

  @Get('tree/store/:storeId')
  @Permissions('categories:read')
  async getCategoryTree(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.categoriesService.getCategoryTree(
      storeId,
      includeInactive === 'true',
    );
  }

  @Get('store/:storeId')
  @Permissions('categories:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query() query: CategoryQueryDto,
  ) {
    return this.categoriesService.findByStore(storeId, query);
  }

  @Get(':id')
  @Permissions('categories:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.categoriesService.findOne(id, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Get('slug/:slug/store/:storeId')
  @Permissions('categories:read')
  async findBySlug(
    @Param('slug') slug: string,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.categoriesService.findBySlug(slug, storeId, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Patch(':id')
  @Permissions('categories:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @CurrentUser() user: any,
  ) {
    return this.categoriesService.update(id, updateCategoryDto, user);
  }

  @Patch(':id/activate')
  @Permissions('categories:update')
  async activate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.categoriesService.activate(id, user);
  }

  @Patch(':id/deactivate')
  @Permissions('categories:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.categoriesService.deactivate(id, user);
  }

  @Delete(':id')
  @Permissions('categories:admin_delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.categoriesService.remove(id, user);
  }

  // Product assignment endpoints
  @Post(':id/products')
  @Permissions('categories:update')
  async assignProduct(
    @Param('id', ParseIntPipe) categoryId: number,
    @Body() assignProductDto: AssignProductToCategoryDto,
    @CurrentUser() user: any,
  ) {
    return this.categoriesService.assignProduct(categoryId, assignProductDto, user);
  }

  @Delete(':id/products/:productId')
  @Permissions('categories:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeProduct(
    @Param('id', ParseIntPipe) categoryId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @CurrentUser() user: any,
  ) {
    return this.categoriesService.removeProduct(categoryId, productId, user);
  }
}
