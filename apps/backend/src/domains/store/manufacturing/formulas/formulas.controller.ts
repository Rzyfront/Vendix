import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { FormulasService } from './formulas.service';
import {
  CreateFormulaDto,
  FormulaExplosionQueryDto,
  FormulaQueryDto,
  ReplaceFormulaItemsDto,
  UpdateFormulaDto,
} from '../dto';

/**
 * Fórmulas de manufactura (recetas con código/versión/estado).
 * Sin try/catch: las excepciones llegan al filtro global con su status real.
 */
@Controller('store/manufacturing/formulas')
@UseGuards(PermissionsGuard)
export class FormulasController {
  constructor(
    private readonly formulasService: FormulasService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:manufacturing:formulas:read')
  async findAll(@Query() query: FormulaQueryDto) {
    const result = await this.formulasService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Fórmulas obtenidas exitosamente',
    );
  }

  @Post()
  @Permissions('store:manufacturing:formulas:create')
  async create(@Body() dto: CreateFormulaDto) {
    const result = await this.formulasService.create(dto);
    return this.responseService.created(result, 'Fórmula creada exitosamente');
  }

  @Get(':id')
  @Permissions('store:manufacturing:formulas:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.formulasService.findOne(id);
    return this.responseService.success(result, 'Fórmula obtenida exitosamente');
  }

  @Patch(':id')
  @Permissions('store:manufacturing:formulas:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFormulaDto,
  ) {
    const result = await this.formulasService.update(id, dto);
    return this.responseService.updated(
      result,
      'Fórmula actualizada exitosamente',
    );
  }

  @Put(':id/items')
  @Permissions('store:manufacturing:formulas:update')
  async replaceItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplaceFormulaItemsDto,
  ) {
    const result = await this.formulasService.replaceItems(id, dto.items);
    return this.responseService.updated(
      result,
      'Componentes de la fórmula actualizados exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:manufacturing:formulas:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.formulasService.archive(id);
    return this.responseService.deleted('Fórmula archivada exitosamente');
  }

  @Get(':id/cost')
  @Permissions('store:manufacturing:formulas:read')
  async cost(@Param('id', ParseIntPipe) id: number) {
    const result = await this.formulasService.calculateCost(id);
    return this.responseService.success(
      result,
      'Costo teórico calculado exitosamente',
    );
  }

  @Get(':id/explosion')
  @Permissions('store:manufacturing:formulas:read')
  async explosion(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: FormulaExplosionQueryDto,
  ) {
    const result = await this.formulasService.explosion(id, query);
    return this.responseService.success(
      result,
      'Explosión de materiales obtenida exitosamente',
    );
  }
}
