import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { MenuSectionsService } from './menu-sections.service';
import {
  AddMenuSectionItemDto,
  CreateMenuSectionDto,
  SortMenuSectionItemsDto,
  SortMenuSectionsDto,
  UpdateMenuSectionDto,
} from './dto';

/**
 * Sections and items nested under `/api/store/menus/:menuId/sections`.
 *
 * The drag-sort endpoints accept an ordered id list and update `sort_order`
 * to match the index of each id. Items omitted from the array keep their
 * old sort_order. Idempotent.
 */
@Controller('store/menus/:menuId/sections')
@UseGuards(PermissionsGuard)
export class MenuSectionsController {
  constructor(
    private readonly sectionsService: MenuSectionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:menus:read')
  async list(@Param('menuId', ParseIntPipe) menuId: number) {
    try {
      const data = await this.sectionsService.listSections(menuId);
      return this.responseService.success(data, 'Secciones obtenidas');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener secciones',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post()
  @Permissions('store:menus:update')
  async create(
    @Param('menuId', ParseIntPipe) menuId: number,
    @Body() dto: CreateMenuSectionDto,
  ) {
    try {
      const data = await this.sectionsService.createSection(menuId, dto);
      return this.responseService.created(data, 'Sección creada');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al crear la sección',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Patch('sort')
  @Permissions('store:menus:update')
  async sort(
    @Param('menuId', ParseIntPipe) menuId: number,
    @Body() dto: SortMenuSectionsDto,
  ) {
    try {
      const data = await this.sectionsService.sortSections(menuId, dto);
      return this.responseService.success(data, 'Orden de secciones guardado');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al reordenar secciones',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Patch(':sectionId')
  @Permissions('store:menus:update')
  async update(
    @Param('menuId', ParseIntPipe) menuId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: UpdateMenuSectionDto,
  ) {
    try {
      const data = await this.sectionsService.updateSection(menuId, sectionId, dto);
      return this.responseService.updated(data, 'Sección actualizada');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al actualizar la sección',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Delete(':sectionId')
  @Permissions('store:menus:update')
  async remove(
    @Param('menuId', ParseIntPipe) menuId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
  ) {
    try {
      const data = await this.sectionsService.deleteSection(menuId, sectionId);
      return this.responseService.deleted('Sección eliminada');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al eliminar la sección',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  // --------------------- section items ---------------------

  @Post(':sectionId/items')
  @Permissions('store:menus:update')
  async addItem(
    @Param('menuId', ParseIntPipe) menuId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: AddMenuSectionItemDto,
  ) {
    try {
      const data = await this.sectionsService.addItem(menuId, sectionId, dto);
      return this.responseService.created(data, 'Producto agregado a la sección');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al agregar el producto',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Patch(':sectionId/items/sort')
  @Permissions('store:menus:update')
  async sortItems(
    @Param('menuId', ParseIntPipe) menuId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: SortMenuSectionItemsDto,
  ) {
    try {
      const data = await this.sectionsService.sortItems(menuId, sectionId, dto);
      return this.responseService.success(data, 'Orden de productos guardado');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al reordenar productos',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Delete(':sectionId/items/:itemId')
  @Permissions('store:menus:update')
  async removeItem(
    @Param('menuId', ParseIntPipe) menuId: number,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    try {
      await this.sectionsService.removeItem(menuId, sectionId, itemId);
      return this.responseService.deleted('Producto eliminado de la sección');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al eliminar el producto',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }
}
