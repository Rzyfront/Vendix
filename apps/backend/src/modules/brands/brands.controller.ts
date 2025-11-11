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
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '../../common/interfaces/authenticated-request.interface';
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
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const brand = await this.brandsService.create(createBrandDto, req.user);
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

  @Patch(':id')
  @Permissions('brands:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBrandDto: UpdateBrandDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const brand = await this.brandsService.update(
        id,
        updateBrandDto,
        req.user,
      );
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

  @Delete(':id')
  @Permissions('brands:admin_delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      await this.brandsService.remove(id, req.user);
      return this.responseService.deleted('Marca eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        'Error al eliminar marca',
        error.message,
      );
    }
  }
}
