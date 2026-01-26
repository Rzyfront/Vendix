import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { ShippingService } from '../services/shipping.service';
import {
  CreateSystemShippingMethodDto,
  UpdateSystemShippingMethodDto,
  CreateSystemShippingZoneDto,
  UpdateSystemShippingZoneDto,
  CreateSystemShippingRateDto,
  UpdateSystemShippingRateDto,
} from '../dto/shipping.dto';

@ApiTags('Admin Shipping')
@Controller('admin/shipping')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@ApiBearerAuth()
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  // ==========================================
  // SYSTEM SHIPPING METHODS ENDPOINTS
  // ==========================================

  @Post('methods')
  @ApiOperation({ summary: 'Create a new system shipping method' })
  @ApiResponse({
    status: 201,
    description: 'System shipping method created successfully',
  })
  async createMethod(@Body() createDto: CreateSystemShippingMethodDto) {
    return this.shippingService.createMethod(createDto);
  }

  @Get('methods')
  @ApiOperation({ summary: 'Get all system shipping methods' })
  @ApiResponse({
    status: 200,
    description: 'System shipping methods retrieved successfully',
  })
  async getMethods() {
    return this.shippingService.getMethods();
  }

  @Get('methods/stats')
  @ApiOperation({ summary: 'Get system shipping methods statistics' })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  async getMethodStats() {
    return this.shippingService.getMethodStats();
  }

  @Get('methods/:id')
  @ApiOperation({ summary: 'Get system shipping method by ID' })
  @ApiResponse({
    status: 200,
    description: 'System shipping method retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'System shipping method not found' })
  async getMethod(@Param('id') id: string) {
    return this.shippingService.getMethod(parseInt(id));
  }

  @Patch('methods/:id')
  @ApiOperation({ summary: 'Update system shipping method' })
  @ApiResponse({
    status: 200,
    description: 'System shipping method updated successfully',
  })
  @ApiResponse({ status: 404, description: 'System shipping method not found' })
  async updateMethod(
    @Param('id') id: string,
    @Body() updateDto: UpdateSystemShippingMethodDto,
  ) {
    return this.shippingService.updateMethod(parseInt(id), updateDto);
  }

  @Delete('methods/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete system shipping method' })
  @ApiResponse({
    status: 200,
    description: 'System shipping method deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Shipping method is in use' })
  @ApiResponse({ status: 404, description: 'System shipping method not found' })
  async deleteMethod(@Param('id') id: string) {
    return this.shippingService.deleteMethod(parseInt(id));
  }

  // ==========================================
  // SYSTEM SHIPPING ZONES ENDPOINTS
  // ==========================================

  @Post('zones')
  @ApiOperation({ summary: 'Create a new system shipping zone' })
  @ApiResponse({
    status: 201,
    description: 'System shipping zone created successfully',
  })
  async createZone(@Body() createDto: CreateSystemShippingZoneDto) {
    return this.shippingService.createZone(createDto);
  }

  @Get('zones')
  @ApiOperation({ summary: 'Get all system shipping zones' })
  @ApiResponse({
    status: 200,
    description: 'System shipping zones retrieved successfully',
  })
  async getZones() {
    return this.shippingService.getZones();
  }

  @Get('zones/stats')
  @ApiOperation({ summary: 'Get system shipping zones statistics' })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  async getZoneStats() {
    return this.shippingService.getZoneStats();
  }

  @Get('zones/:id')
  @ApiOperation({ summary: 'Get system shipping zone by ID' })
  @ApiResponse({
    status: 200,
    description: 'System shipping zone retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'System shipping zone not found' })
  async getZone(@Param('id') id: string) {
    return this.shippingService.getZone(parseInt(id));
  }

  @Patch('zones/:id')
  @ApiOperation({ summary: 'Update system shipping zone' })
  @ApiResponse({
    status: 200,
    description: 'System shipping zone updated successfully',
  })
  @ApiResponse({ status: 404, description: 'System shipping zone not found' })
  async updateZone(
    @Param('id') id: string,
    @Body() updateDto: UpdateSystemShippingZoneDto,
  ) {
    return this.shippingService.updateZone(parseInt(id), updateDto);
  }

  @Delete('zones/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete system shipping zone' })
  @ApiResponse({
    status: 200,
    description: 'System shipping zone deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Shipping zone has rates' })
  @ApiResponse({ status: 404, description: 'System shipping zone not found' })
  async deleteZone(@Param('id') id: string) {
    return this.shippingService.deleteZone(parseInt(id));
  }

  // ==========================================
  // SYSTEM SHIPPING RATES ENDPOINTS
  // ==========================================

  @Get('zones/:zoneId/rates')
  @ApiOperation({ summary: 'Get rates for a system shipping zone' })
  @ApiResponse({
    status: 200,
    description: 'Shipping rates retrieved successfully',
  })
  async getRates(@Param('zoneId') zoneId: string) {
    return this.shippingService.getRates(parseInt(zoneId));
  }

  @Post('rates')
  @ApiOperation({ summary: 'Create a new system shipping rate' })
  @ApiResponse({
    status: 201,
    description: 'System shipping rate created successfully',
  })
  async createRate(@Body() createDto: CreateSystemShippingRateDto) {
    return this.shippingService.createRate(createDto);
  }

  @Patch('rates/:id')
  @ApiOperation({ summary: 'Update system shipping rate' })
  @ApiResponse({
    status: 200,
    description: 'System shipping rate updated successfully',
  })
  @ApiResponse({ status: 404, description: 'System shipping rate not found' })
  async updateRate(
    @Param('id') id: string,
    @Body() updateDto: UpdateSystemShippingRateDto,
  ) {
    return this.shippingService.updateRate(parseInt(id), updateDto);
  }

  @Delete('rates/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete system shipping rate' })
  @ApiResponse({
    status: 200,
    description: 'System shipping rate deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'System shipping rate not found' })
  async deleteRate(@Param('id') id: string) {
    return this.shippingService.deleteRate(parseInt(id));
  }
}
