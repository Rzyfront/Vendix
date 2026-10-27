import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingRoomChargesService } from './room-charges.service';
import { CreateRoomChargeDto, InHouseRoomsQueryDto } from './room-charges.dto';

/** Hospitality Suite (H3.6) — charge a POS sale or a table bill to a room. */
@Controller('store/hospitality/room-charges')
@UseGuards(PermissionsGuard)
export class LodgingRoomChargesController {
  constructor(
    private readonly roomChargesService: LodgingRoomChargesService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Habitaciones con huésped en casa a las que se puede cargar' })
  @Get('rooms')
  @Permissions('store:lodging:folio:charge')
  async rooms(@Query() query: InHouseRoomsQueryDto) {
    const result = await this.roomChargesService.listInHouseRooms(query);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Cargar una venta del POS o la cuenta de una mesa a la habitación' })
  @Post()
  @Permissions('store:lodging:folio:charge')
  async create(@Body() dto: CreateRoomChargeDto) {
    const result = await this.roomChargesService.chargeToRoom(dto);
    return this.responseService.success(result, result.message);
  }
}
