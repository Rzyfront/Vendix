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
 *
 * CONTRATO DE ERROR: los handlers NO atrapan. Cada uno estaba envuelto en un
 * `try/catch` que devolvía `responseService.error(...)`, y eso convertía un
 * rechazo en una respuesta EXITOSA: el estado HTTP quedaba en `201`/`200` y el
 * fallo viajaba enterrado en `success:false` dentro del cuerpo. Se comprobó en
 * ejecución: bloquear un insumo con variantes respondía
 * `HTTP=201` con `statusCode: 422` en el body. Un cliente que mira el estado
 * HTTP —o sea, cualquier cliente— leía "creado" sobre algo que nunca se creó.
 * Dejando propagar la excepción, el filtro global emite el estado real.
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
    const result = await this.recipesService.create(dto);
    return this.responseService.created(result, 'Receta creada exitosamente');
  }

  @Get()
  @Permissions('store:recipes:read')
  async findAll(@Query() query: RecipeQueryDto) {
    const result = await this.recipesService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Recetas obtenidas exitosamente',
    );
  }

  @Get('by-product/:productId')
  @Permissions('store:recipes:read')
  async findByProduct(@Param('productId', ParseIntPipe) productId: number) {
    const result = await this.recipesService.findByProduct(productId);
    return this.responseService.success(
      result,
      'Receta del producto obtenida exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:recipes:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.recipesService.findOne(id);
    return this.responseService.success(result, 'Receta obtenida exitosamente');
  }

  @Patch(':id')
  @Permissions('store:recipes:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRecipeDto,
  ) {
    const result = await this.recipesService.update(id, dto);
    return this.responseService.updated(
      result,
      'Receta actualizada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:recipes:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.recipesService.softDelete(id);
    return this.responseService.deleted('Receta desactivada exitosamente');
  }

  @Post(':id/restore')
  @Permissions('store:recipes:update')
  async restore(@Param('id', ParseIntPipe) id: number) {
    const result = await this.recipesService.restore(id);
    return this.responseService.updated(
      result,
      'Receta restaurada exitosamente',
    );
  }

  // ----------------------------------------------------- Recipe items CRUD

  @Post(':id/items')
  @Permissions('store:recipes:update')
  async addItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateRecipeItemDto,
  ) {
    const result = await this.recipesService.addItem(id, dto);
    return this.responseService.created(
      result,
      'Componente agregado a la receta',
    );
  }

  @Patch(':id/items/:itemId')
  @Permissions('store:recipes:update')
  async updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateRecipeItemDto,
  ) {
    const result = await this.recipesService.updateItem(id, itemId, dto);
    return this.responseService.updated(
      result,
      'Componente actualizado exitosamente',
    );
  }

  @Delete(':id/items/:itemId')
  @Permissions('store:recipes:update')
  async removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    const result = await this.recipesService.removeItem(id, itemId);
    return this.responseService.success(
      result,
      'Componente eliminado exitosamente',
    );
  }
}
