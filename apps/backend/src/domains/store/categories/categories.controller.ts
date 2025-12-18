import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryQueryDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/categories')
@UseGuards(PermissionsGuard)
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:categories:create')
  async create(
    @Body() createCategoryDto: CreateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.categoriesService.create(
        createCategoryDto,
        req.user,
      );
      return this.responseService.created(
        result,
        'Categoría creada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear la categoría',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @Permissions('store:categories:read')
  async findAll(@Query() query: CategoryQueryDto) {
    try {
      const result = await this.categoriesService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Categorías obtenidas exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Categorías obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las categorías',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('search')
  @Permissions('store:categories:read')
  async search(@Query() query: CategoryQueryDto) {
    try {
      const result = await this.categoriesService.findAll({
        ...query,
        search: query.search || '',
      });
      return this.responseService.success(
        result.data || result,
        'Búsqueda de categorías completada',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error en la búsqueda de categorías',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:categories:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    try {
      const result = await this.categoriesService.findOne(id, {
        includeInactive: includeInactive === 'true',
      });
      return this.responseService.success(
        result,
        'Categoría obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la categoría',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:categories:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.categoriesService.update(
        id,
        updateCategoryDto,
        req.user,
      );
      return this.responseService.updated(
        result,
        'Categoría actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la categoría',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Put(':id')
  @Permissions('store:categories:update')
  async replace(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.categoriesService.update(
        id,
        updateCategoryDto,
        req.user,
      );
      return this.responseService.updated(
        result,
        'Categoría actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la categoría',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:categories:delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      await this.categoriesService.remove(id, req.user);
      return this.responseService.deleted('Categoría eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la categoría',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
