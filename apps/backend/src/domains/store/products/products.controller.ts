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
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/products')
@UseGuards(PermissionsGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly responseService: ResponseService,
  ) { }
  @Post()
  @Permissions('store:products:create')
  async create(
    @Body() createProductDto: CreateProductDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.productsService.create(createProductDto);
      return this.responseService.created(
        result,
        'Producto creado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear el producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @Permissions('store:products:read')
  async findAll(
    @Query() query: ProductQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.productsService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Productos obtenidos exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Productos obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los productos',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:products:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.productsService.findOne(id);
      return this.responseService.success(
        result,
        'Producto obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('store/:storeId')
  @Permissions('store:products:read')
  async findByStore(@Param('storeId', ParseIntPipe) storeId: number) {
    try {
      const result = await this.productsService.getProductsByStore(storeId);
      return this.responseService.success(
        result,
        'Productos de la tienda obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los productos de la tienda',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('slug/:slug/store/:storeId')
  @Permissions('store:products:read')
  async findBySlug(
    @Param('slug') slug: string,
    @Param('storeId', ParseIntPipe) storeId: number,
  ) {
    try {
      const result = await this.productsService.findBySlug(storeId, slug);
      return this.responseService.success(
        result,
        'Producto obtenido exitosamente por slug',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el producto por slug',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:products:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    try {
      const result = await this.productsService.update(id, updateProductDto);
      return this.responseService.updated(
        result,
        'Producto actualizado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar el producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/deactivate')
  @Permissions('store:products:delete')
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.productsService.deactivate(id);
      return this.responseService.success(
        null,
        'Producto desactivado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al desactivar el producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:products:admin_delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.productsService.remove(id);
      return this.responseService.deleted('Producto eliminado exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar el producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
  // Product Variants endpoints
  @Post(':id/variants')
  @Permissions('store:products:create')
  async createVariant(
    @Param('id', ParseIntPipe) productId: number,
    @Body() createVariantDto: CreateProductVariantDto,
  ) {
    try {
      // Pass productId directly to service
      const result = await this.productsService.createVariant(
        productId,
        createVariantDto,
      );
      return this.responseService.created(
        result,
        'Variante de producto creada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear la variante del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch('variants/:variantId')
  @Permissions('store:products:update')
  async updateVariant(
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() updateVariantDto: UpdateProductVariantDto,
  ) {
    try {
      const result = await this.productsService.updateVariant(
        variantId,
        updateVariantDto,
      );
      return this.responseService.updated(
        result,
        'Variante de producto actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la variante del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete('variants/:variantId')
  @Permissions('store:products:delete')
  async removeVariant(@Param('variantId', ParseIntPipe) variantId: number) {
    try {
      await this.productsService.removeVariant(variantId);
      return this.responseService.deleted(
        'Variante de producto eliminada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la variante del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // Product Images endpoints
  @Post(':id/images')
  @Permissions('store:products:update')
  async addImage(
    @Param('id', ParseIntPipe) productId: number,
    @Body() imageDto: ProductImageDto,
  ) {
    try {
      const result = await this.productsService.addImage(productId, imageDto);
      return this.responseService.created(
        result,
        'Imagen de producto agregada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al agregar la imagen del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete('images/:imageId')
  @Permissions('store:products:update')
  async removeImage(@Param('imageId', ParseIntPipe) imageId: number) {
    try {
      await this.productsService.removeImage(imageId);
      return this.responseService.deleted(
        'Imagen de producto eliminada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la imagen del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('stats/store/:storeId')
  @Permissions('store:products:read')
  async getProductStats(@Param('storeId', ParseIntPipe) storeId: number) {
    try {
      const result = await this.productsService.getProductStats(storeId);
      return this.responseService.success(
        result,
        'Estadísticas de productos obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las estadísticas de productos',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
