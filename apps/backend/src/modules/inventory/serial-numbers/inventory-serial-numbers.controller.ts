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
  Request,
} from '@nestjs/common';
import { InventorySerialNumbersService } from './inventory-serial-numbers.service';
import {
  CreateSerialNumbersForBatchDto,
  UpdateInventorySerialNumberDto,
  TransferSerialNumberDto,
  MarkAsSoldDto,
  MarkAsReturnedDto,
  MarkAsDamagedDto,
  GetSerialNumbersDto,
  GetAvailableSerialNumbersDto,
} from '../dto/create-inventory-serial-number.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
// Using local enum definition until Prisma client is regenerated
enum SerialNumberStatus {
  IN_STOCK = 'in_stock',
  RESERVED = 'reserved',
  SOLD = 'sold',
  RETURNED = 'returned',
  DAMAGED = 'damaged',
  EXPIRED = 'expired',
  IN_TRANSIT = 'in_transit',
}

@ApiTags('inventory-serial-numbers')
@Controller('inventory/serial-numbers')
@UseGuards(JwtAuthGuard)
export class InventorySerialNumbersController {
  constructor(
    private readonly serialNumbersService: InventorySerialNumbersService,
  ) {}

  @Post('batch')
  @ApiOperation({ summary: 'Create serial numbers for a batch' })
  @ApiResponse({
    status: 201,
    description: 'Serial numbers created successfully',
  })
  async createSerialNumbersForBatch(
    @Body() createDto: CreateSerialNumbersForBatchDto,
    @Request() req,
  ) {
    return this.serialNumbersService.createSerialNumbersForBatch(
      createDto.batchId,
      createDto.serialNumbers,
      createDto.organizationId || req.user.organizationId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all serial numbers for organization' })
  @ApiResponse({
    status: 200,
    description: 'Serial numbers retrieved successfully',
  })
  async getSerialNumbers(
    @Query() filters: GetSerialNumbersDto,
    @Request() req,
  ) {
    return this.serialNumbersService.getSerialNumbers(
      req.user.organizationId,
      filters,
    );
  }

  @Get('status/:status')
  @ApiOperation({ summary: 'Get serial numbers by status' })
  @ApiParam({ name: 'status', enum: SerialNumberStatus })
  @ApiResponse({
    status: 200,
    description: 'Serial numbers retrieved successfully',
  })
  async getSerialNumbersByStatus(
    @Param('status') status: SerialNumberStatus,
    @Query() filters: GetSerialNumbersDto,
    @Request() req,
  ) {
    return this.serialNumbersService.getSerialNumbersByStatus(
      status,
      req.user.organizationId,
      filters,
    );
  }

  @Get('available')
  @ApiOperation({
    summary: 'Get available serial numbers for product/variant at location',
  })
  @ApiResponse({
    status: 200,
    description: 'Available serial numbers retrieved successfully',
  })
  async getAvailableSerialNumbers(
    @Query() query: GetAvailableSerialNumbersDto,
    @Request() req,
  ) {
    return this.serialNumbersService.getAvailableSerialNumbers(
      query.productId,
      query.productVariantId,
      query.locationId,
      req.user.organizationId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get serial number by ID' })
  @ApiParam({ name: 'id', description: 'Serial number ID' })
  @ApiResponse({
    status: 200,
    description: 'Serial number retrieved successfully',
  })
  async getSerialNumberById(@Param('id') id: string, @Request() req) {
    return this.serialNumbersService.getSerialNumberById(
      id,
      req.user.organizationId,
    );
  }

  @Get('number/:serialNumber')
  @ApiOperation({ summary: 'Get serial number by serial number string' })
  @ApiParam({ name: 'serialNumber', description: 'Serial number string' })
  @ApiResponse({
    status: 200,
    description: 'Serial number retrieved successfully',
  })
  async getSerialNumberByNumber(
    @Param('serialNumber') serialNumber: string,
    @Request() req,
  ) {
    return this.serialNumbersService.getSerialNumberByNumber(
      serialNumber,
      req.user.organizationId,
    );
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update serial number status' })
  @ApiParam({ name: 'id', description: 'Serial number ID' })
  @ApiResponse({
    status: 200,
    description: 'Serial number status updated successfully',
  })
  async updateSerialNumberStatus(
    @Param('id') id: string,
    @Body() updateDto: UpdateInventorySerialNumberDto,
    @Request() req,
  ) {
    return this.serialNumbersService.updateSerialNumberStatus(
      id,
      updateDto.status!,
      req.user.organizationId,
      {
        salesOrderId: updateDto.salesOrderId,
        purchaseOrderId: updateDto.purchaseOrderId,
        locationId: updateDto.locationId,
        notes: updateDto.notes,
      },
    );
  }

  @Patch(':id/transfer')
  @ApiOperation({ summary: 'Transfer serial number to another location' })
  @ApiParam({ name: 'id', description: 'Serial number ID' })
  @ApiResponse({
    status: 200,
    description: 'Serial number transferred successfully',
  })
  async transferSerialNumber(
    @Param('id') id: string,
    @Body() transferDto: TransferSerialNumberDto,
    @Request() req,
  ) {
    return this.serialNumbersService.transferSerialNumber(
      id,
      transferDto.targetLocationId,
      req.user.organizationId,
      transferDto.notes,
    );
  }

  @Patch(':id/sold')
  @ApiOperation({ summary: 'Mark serial number as sold' })
  @ApiParam({ name: 'id', description: 'Serial number ID' })
  @ApiResponse({ status: 200, description: 'Serial number marked as sold' })
  async markAsSold(
    @Param('id') id: string,
    @Body() soldDto: MarkAsSoldDto,
    @Request() req,
  ) {
    return this.serialNumbersService.markAsSold(
      id,
      soldDto.salesOrderId,
      req.user.organizationId,
    );
  }

  @Patch(':id/returned')
  @ApiOperation({ summary: 'Mark serial number as returned' })
  @ApiParam({ name: 'id', description: 'Serial number ID' })
  @ApiResponse({ status: 200, description: 'Serial number marked as returned' })
  async markAsReturned(
    @Param('id') id: string,
    @Body() returnedDto: MarkAsReturnedDto,
    @Request() req,
  ) {
    return this.serialNumbersService.markAsReturned(
      id,
      returnedDto.locationId,
      req.user.organizationId,
      returnedDto.notes,
    );
  }

  @Patch(':id/damaged')
  @ApiOperation({ summary: 'Mark serial number as damaged' })
  @ApiParam({ name: 'id', description: 'Serial number ID' })
  @ApiResponse({ status: 200, description: 'Serial number marked as damaged' })
  async markAsDamaged(
    @Param('id') id: string,
    @Body() damagedDto: MarkAsDamagedDto,
    @Request() req,
  ) {
    return this.serialNumbersService.markAsDamaged(
      id,
      req.user.organizationId,
      damagedDto.notes,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete serial number' })
  @ApiParam({ name: 'id', description: 'Serial number ID' })
  @ApiResponse({
    status: 200,
    description: 'Serial number deleted successfully',
  })
  async deleteSerialNumber(@Param('id') id: string, @Request() req) {
    return this.serialNumbersService.deleteSerialNumber(
      id,
      req.user.organizationId,
    );
  }
}
