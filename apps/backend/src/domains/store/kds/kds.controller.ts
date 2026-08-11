import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { KdsService } from './kds.service';
import { ResponseService } from '../../../common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { CreateKdsDto, UpdateKdsDto } from './dto';

/**
 * Estaciones de preparación (QUI-651). Rutas planas namespaced, igual que
 * `store/cash-registers`.
 */
@Controller('store/kds')
@UseGuards(PermissionsGuard)
export class KdsController {
  constructor(
    private readonly kdsService: KdsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:kds:read')
  async findAll() {
    const result = await this.kdsService.findAll();
    return this.responseService.success(result);
  }

  @Get(':id')
  @Permissions('store:kds:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.kdsService.findOne(id);
    return this.responseService.success(result);
  }

  @Post()
  @Permissions('store:kds:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateKdsDto) {
    const result = await this.kdsService.create(dto);
    return this.responseService.success(result, 'Estación de cocina creada');
  }

  @Put(':id')
  @Permissions('store:kds:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateKdsDto,
  ) {
    const result = await this.kdsService.update(id, dto);
    return this.responseService.updated(result, 'Estación de cocina actualizada');
  }

  /**
   * Baja lógica. No borra la fila: `kitchen_tickets.kds_id` es NOT NULL con FK
   * RESTRICT, así que una estación con historial no se puede eliminar — y no
   * debe, o los tickets quedarían sin tablero.
   */
  @Delete(':id')
  @Permissions('store:kds:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.kdsService.remove(id);
    return this.responseService.updated(result, 'Estación de cocina desactivada');
  }
}
