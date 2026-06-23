import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { InventorySerialNumbersService } from './inventory-serial-numbers.service';
import {
  CreateInventorySerialNumberDto,
  GetSerialNumbersDto,
  GetAvailableSerialNumbersDto,
  UpdateInventorySerialNumberDto,
} from '../dto/create-inventory-serial-number.dto';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { serial_status_enum } from '@prisma/client';

@ApiTags('inventory-serial-numbers')
@Controller('store/inventory/serial-numbers')
@UseGuards(PermissionsGuard)
export class InventorySerialNumbersController {
  constructor(
    private readonly serialNumbersService: InventorySerialNumbersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:inventory:serial_numbers:read')
  @ApiOperation({ summary: 'List serial numbers (paginated, filterable)' })
  async list(@Query() filters: GetSerialNumbersDto) {
    const result = await this.serialNumbersService.list(filters);
    return this.responseService.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Seriales obtenidos exitosamente',
    );
  }

  @Get('available')
  @Permissions('store:inventory:serial_numbers:read')
  @ApiOperation({
    summary: 'List available (in_stock) serials for product/variant at location',
  })
  async listAvailable(@Query() query: GetAvailableSerialNumbersDto) {
    const data = await this.serialNumbersService.listAvailable(
      query.product_id,
      query.location_id,
      query.product_variant_id,
    );
    return this.responseService.success(
      data,
      'Seriales disponibles obtenidos exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:inventory:serial_numbers:read')
  @ApiOperation({ summary: 'Get serial number by id' })
  @ApiParam({ name: 'id', description: 'Serial number id' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.serialNumbersService.findOne(id);
    return this.responseService.success(data, 'Serial obtenido exitosamente');
  }

  @Post()
  @Permissions('store:inventory:serial_numbers:create')
  @ApiOperation({ summary: 'Create a single serial number in the pool' })
  async create(@Body() dto: CreateInventorySerialNumberDto) {
    const data = await this.serialNumbersService.createSerial(dto);
    return this.responseService.created(data, 'Serial creado exitosamente');
  }

  @Patch(':id/status')
  @Permissions('store:inventory:serial_numbers:update')
  @ApiOperation({ summary: 'Transition serial number status' })
  @ApiParam({ name: 'id', description: 'Serial number id' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInventorySerialNumberDto,
  ) {
    const data = await this.serialNumbersService.transition(
      id,
      dto.status as serial_status_enum,
    );
    return this.responseService.updated(
      data,
      'Estado del serial actualizado exitosamente',
    );
  }
}
