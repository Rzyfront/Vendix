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
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  UpdateProductDto,
  CreateProductVariantDto,
  UpdateProductVariantDto,
  ProductImageDto,
  ProductQueryDto,
} from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('products')
@UseGuards(PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}
  @Post()
  @Permissions('products:create')
  async create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  @Get()
  @Permissions('products:read')
  async findAll(@Query() query: ProductQueryDto) {
    return this.productsService.findAll(query);
  }

  @Get(':id')
  @Permissions('products:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id);
  }

  @Get('store/:storeId')
  @Permissions('products:read')
  async findByStore(@Param('storeId', ParseIntPipe) storeId: number) {
    return this.productsService.getProductsByStore(storeId);
  }

  @Get('slug/:slug/store/:storeId')
  @Permissions('products:read')
  async findBySlug(
    @Param('slug') slug: string,
    @Param('storeId', ParseIntPipe) storeId: number,
  ) {
    return this.productsService.findBySlug(storeId, slug);
  }

  @Patch(':id')
  @Permissions('products:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.update(id, updateProductDto);
  }

  @Patch(':id/deactivate')
  @Permissions('products:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.deactivate(id);
  }

  @Delete(':id')
  @Permissions('products:admin_delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.remove(id);
  }
  // Product Variants endpoints
  @Post(':id/variants')
  @Permissions('products:create')
  async createVariant(
    @Param('id', ParseIntPipe) productId: number,
    @Body() createVariantDto: CreateProductVariantDto,
  ) {
    // Set the product_id in the variant DTO
    createVariantDto.product_id = productId;
    return this.productsService.createVariant(createVariantDto);
  }

  @Patch('variants/:variantId')
  @Permissions('products:update')
  async updateVariant(
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() updateVariantDto: UpdateProductVariantDto,
  ) {
    return this.productsService.updateVariant(variantId, updateVariantDto);
  }

  @Delete('variants/:variantId')
  @Permissions('products:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeVariant(@Param('variantId', ParseIntPipe) variantId: number) {
    return this.productsService.removeVariant(variantId);
  }

  // Product Images endpoints
  @Post(':id/images')
  @Permissions('products:update')
  async addImage(
    @Param('id', ParseIntPipe) productId: number,
    @Body() imageDto: ProductImageDto,
  ) {
    return this.productsService.addImage(productId, imageDto);
  }

  @Delete('images/:imageId')
  @Permissions('products:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeImage(@Param('imageId', ParseIntPipe) imageId: number) {
    return this.productsService.removeImage(imageId);
  }
}
