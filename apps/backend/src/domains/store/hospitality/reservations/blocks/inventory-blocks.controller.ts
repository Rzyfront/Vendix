import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingInventoryBlocksService } from './inventory-blocks.service';
import { CreateInventoryBlockDto } from './inventory-block.dto';

/**
 * Hospitality Suite (H5.3) — maintenance/owner-use blocks. The manager edits
 * the room inventory, so it takes the inventory write permission; the rack
 * shows the active blocks.
 */
@Controller('store/hospitality/blocks')
@UseGuards(PermissionsGuard)
export class LodgingInventoryBlocksController {
  constructor(
    private readonly blocksService: LodgingInventoryBlocksService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Bloquear una habitación por mantenimiento o uso del propietario' })
  @Post()
  @Permissions('store:lodging:inventory:write')
  async create(@Body() dto: CreateInventoryBlockDto) {
    const result = await this.blocksService.create(dto);
    return this.responseService.created(result, 'Habitación bloqueada');
  }

  @ApiOperation({ summary: 'Liberar un bloqueo (cerrar el ticket de mantenimiento)' })
  @Post(':id/release')
  @Permissions('store:lodging:inventory:write')
  async release(@Param('id', ParseIntPipe) id: number) {
    const result = await this.blocksService.release(id);
    return this.responseService.updated(result, 'Habitación liberada');
  }
}
