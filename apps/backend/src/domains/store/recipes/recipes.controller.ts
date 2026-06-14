import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { RecipesService } from './recipes.service';
import {
  CreateRecipeDto,
  UpdateRecipeDto,
  CreateRecipeItemDto,
  UpdateRecipeItemDto,
  RecipeQueryDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * Store-scoped CRUD for the Recipes / BOM domain of the Restaurant Suite.
 *
 * Permission policy (Phase B):
 *   - GET list/detail  → store:recipes:read
 *   - POST create      → store:recipes:create
 *   - PATCH update     → store:recipes:update
 *   - DELETE/Restore   → store:recipes:delete (soft delete: deactivate)
 *   - Items: POST/PATCH/DELETE under /:id/items
 *
 * Notes:
 *   - The BOM explosion (`POST /explode-bom`) is NOT exposed yet — it lives
 *     as a public method on `RecipesService` and is consumed by Phase D/F.
 *   - The "by product" lookup is a thin convenience for Phase B's frontend
 *     (recipes form pre-loads existing items by yield product_id).
 */
@Controller('store/recipes')
@UseGuards(PermissionsGuard)
export class RecipesController {
  constructor(
    private readonly recipesService: RecipesService,
    private readonly responseService: ResponseService,
  ) {}

  // --------------------------------------------------------- Recipe CRUD

  @Post()
  @Permissions('store:recipes:create')
  async create(@Body() dto: CreateRecipeDto) {
    try {
      const result = await this.recipesService.create(dto);
      return this.responseService.created(
        result,
        'Receta creada exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al crear la receta',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @Permissions('store:recipes:read')
  async findAll(@Query() query: RecipeQueryDto) {
    try {
      const result = await this.recipesService.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Recetas obtenidas exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener las recetas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('by-product/:productId')
  @Permissions('store:recipes:read')
  async findByProduct(
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    try {
      const result = await this.recipesService.findByProduct(productId);
      return this.responseService.success(
        result,
        'Receta del producto obtenida exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener la receta del producto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:recipes:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.recipesService.findOne(id);
      return this.responseService.success(
        result,
        'Receta obtenida exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener la receta',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:recipes:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRecipeDto,
  ) {
    try {
      const result = await this.recipesService.update(id, dto);
      return this.responseService.updated(
        result,
        'Receta actualizada exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al actualizar la receta',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:recipes:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.recipesService.softDelete(id);
      return this.responseService.deleted('Receta desactivada exitosamente');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al desactivar la receta',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/restore')
  @Permissions('store:recipes:update')
  async restore(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.recipesService.restore(id);
      return this.responseService.updated(
        result,
        'Receta restaurada exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al restaurar la receta',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ----------------------------------------------------- Recipe items CRUD

  @Post(':id/items')
  @Permissions('store:recipes:update')
  async addItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateRecipeItemDto,
  ) {
    try {
      const result = await this.recipesService.addItem(id, dto);
      return this.responseService.created(
        result,
        'Componente agregado a la receta',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al agregar el componente',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/items/:itemId')
  @Permissions('store:recipes:update')
  async updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateRecipeItemDto,
  ) {
    try {
      const result = await this.recipesService.updateItem(id, itemId, dto);
      return this.responseService.updated(
        result,
        'Componente actualizado exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al actualizar el componente',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id/items/:itemId')
  @Permissions('store:recipes:update')
  async removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    try {
      const result = await this.recipesService.removeItem(id, itemId);
      return this.responseService.success(
        result,
        'Componente eliminado exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al eliminar el componente',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
