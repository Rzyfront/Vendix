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
import { BrandsService } from './brands.service';
import { CreateBrandDto, UpdateBrandDto, BrandQueryDto } from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('brands')
@UseGuards(PermissionsGuard)
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Post()
  @Permissions('brands:create')
  async create(
    @Body() createBrandDto: CreateBrandDto,
    @CurrentUser() user: any,
  ) {
    return this.brandsService.create(createBrandDto, user);
  }

  @Get()
  @Permissions('brands:read')
  async findAll(@Query() query: BrandQueryDto) {
    return this.brandsService.findAll(query);
  }

  @Get('store/:storeId')
  @Permissions('brands:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query() query: BrandQueryDto,
  ) {
    return this.brandsService.findByStore(storeId, query);
  }

  @Get(':id')
  @Permissions('brands:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.brandsService.findOne(id, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Get('slug/:slug/store/:storeId')
  @Permissions('brands:read')
  async findBySlug(
    @Param('slug') slug: string,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.brandsService.findBySlug(slug, storeId, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Patch(':id')
  @Permissions('brands:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBrandDto: UpdateBrandDto,
    @CurrentUser() user: any,
  ) {
    return this.brandsService.update(id, updateBrandDto, user);
  }

  @Patch(':id/activate')
  @Permissions('brands:update')
  async activate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.brandsService.activate(id, user);
  }

  @Patch(':id/deactivate')
  @Permissions('brands:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.brandsService.deactivate(id, user);
  }

  @Delete(':id')
  @Permissions('brands:admin_delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.brandsService.remove(id, user);
  }
}
