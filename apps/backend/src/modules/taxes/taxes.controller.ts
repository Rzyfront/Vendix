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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TaxesService } from './taxes.service';
import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
} from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequestContext } from '../../common/decorators/request-context.decorator';
import { ResponseService } from '../../common/responses/response.service';

@Controller('taxes')
@UseGuards(PermissionsGuard)
export class TaxesController {
  constructor(
    private readonly taxesService: TaxesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('taxes:create')
  async create(
    @Body() createTaxCategoryDto: CreateTaxCategoryDto,
    @RequestContext() user: any,
  ) {
    try {
      const tax = await this.taxesService.create(createTaxCategoryDto, user);
      return this.responseService.created(
        tax,
        'Categoría de impuesto creada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al crear categoría de impuesto',
        error.message,
      );
    }
  }

  @Get()
  @Permissions('taxes:read')
  async findAll(@Query() query: TaxCategoryQueryDto) {
    try {
      const result = await this.taxesService.findAll(query);

      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Categorías de impuestos obtenidas exitosamente',
        );
      } else {
        return this.responseService.success(
          result,
          'Categorías de impuestos obtenidas exitosamente',
        );
      }
    } catch (error) {
      return this.responseService.error(
        'Error al obtener categorías de impuestos',
        error.message,
      );
    }
  }

  @Get(':id')
  @Permissions('taxes:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @RequestContext() user: any,
  ) {
    try {
      const tax = await this.taxesService.findOne(id, user);
      return this.responseService.success(
        tax,
        'Categoría de impuesto obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener categoría de impuesto',
        error.message,
      );
    }
  }

  @Patch(':id')
  @Permissions('taxes:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTaxCategoryDto: UpdateTaxCategoryDto,
    @RequestContext() user: any,
  ) {
    try {
      const tax = await this.taxesService.update(
        id,
        updateTaxCategoryDto,
        user,
      );
      return this.responseService.updated(
        tax,
        'Categoría de impuesto actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al actualizar categoría de impuesto',
        error.message,
      );
    }
  }

  @Delete(':id')
  @Permissions('taxes:delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @RequestContext() user: any,
  ) {
    try {
      await this.taxesService.remove(id, user);
      return this.responseService.deleted(
        'Categoría de impuesto eliminada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al eliminar categoría de impuesto',
        error.message,
      );
    }
  }
}
