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
import { RequestContext } from '../../common/decorators/request-context.decorator';
import { ResponseService } from '../../common/responses/response.service';

@Controller('brands')
@UseGuards(PermissionsGuard)
export class BrandsController {
  constructor(
    private readonly brandsService: BrandsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('brands:create')
  async create(
    @Body() createBrandDto: CreateBrandDto,
    @RequestContext() user: any,
  ) {
    try {
      const brand = await this.brandsService.create(createBrandDto, user);
      return this.responseService.created(brand, 'Marca creada exitosamente');
    } catch (error) {
      return this.responseService.error('Error al crear marca', error.message);
    }
  }

  @Get()
  @Permissions('brands:read')
  async findAll(@Query() query: BrandQueryDto) {
    try {
      const result = await this.brandsService.findAll(query);

      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Marcas obtenidas exitosamente',
        );
      } else {
        return this.responseService.success(
          result,
          'Marcas obtenidas exitosamente',
        );
      }
    } catch (error) {
      return this.responseService.error(
        'Error al obtener marcas',
        error.message,
      );
    }
  }

  @Get('store/:storeId')
  @Permissions('brands:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query() query: BrandQueryDto,
  ) {
    try {
      const result = await this.brandsService.findByStore(storeId, query);

      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Marcas de la tienda obtenidas exitosamente',
        );
      } else {
        return this.responseService.success(
          result,
          'Marcas de la tienda obtenidas exitosamente',
        );
      }
    } catch (error) {
      return this.responseService.error(
        'Error al obtener marcas de la tienda',
        error.message,
      );
    }
  }

  @Get(':id')
  @Permissions('brands:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    try {
      const brand = await this.brandsService.findOne(id, {
        includeInactive: includeInactive === 'true',
      });
      return this.responseService.success(brand, 'Marca obtenida exitosamente');
    } catch (error) {
      return this.responseService.error(
        'Error al obtener marca',
        error.message,
      );
    }
  }

  @Get('slug/:slug/store/:storeId')
  @Permissions('brands:read')
  async findBySlug(
    @Param('slug') slug: string,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    try {
      const brand = await this.brandsService.findBySlug(slug, storeId, {
        includeInactive: includeInactive === 'true',
      });
      return this.responseService.success(
        brand,
        'Marca obtenida exitosamente por slug',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener marca por slug',
        error.message,
      );
    }
  }

  @Patch(':id')
  @Permissions('brands:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBrandDto: UpdateBrandDto,
    @RequestContext() user: any,
  ) {
    try {
      const brand = await this.brandsService.update(id, updateBrandDto, user);
      return this.responseService.updated(
        brand,
        'Marca actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al actualizar marca',
        error.message,
      );
    }
  }

  @Patch(':id/activate')
  @Permissions('brands:update')
  async activate(
    @Param('id', ParseIntPipe) id: number,
    @RequestContext() user: any,
  ) {
    try {
      const brand = await this.brandsService.activate(id, user);
      return this.responseService.updated(brand, 'Marca activada exitosamente');
    } catch (error) {
      return this.responseService.error(
        'Error al activar marca',
        error.message,
      );
    }
  }

  @Patch(':id/deactivate')
  @Permissions('brands:delete')
  async deactivate(
    @Param('id', ParseIntPipe) id: number,
    @RequestContext() user: any,
  ) {
    try {
      await this.brandsService.deactivate(id, user);
      return this.responseService.deleted('Marca desactivada exitosamente');
    } catch (error) {
      return this.responseService.error(
        'Error al desactivar marca',
        error.message,
      );
    }
  }

  @Delete(':id')
  @Permissions('brands:admin_delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @RequestContext() user: any,
  ) {
    try {
      await this.brandsService.remove(id, user);
      return this.responseService.deleted('Marca eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        'Error al eliminar marca',
        error.message,
      );
    }
  }
}
