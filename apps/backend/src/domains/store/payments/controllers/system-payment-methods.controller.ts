import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { SystemPaymentMethodsService } from '../services/system-payment-methods.service';
import {
  CreateSystemPaymentMethodDto,
  UpdateSystemPaymentMethodDto,
} from '../dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';

@ApiTags('System Payment Methods')
@Controller('system-payment-methods')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class SystemPaymentMethodsController {
  constructor(
    private readonly systemPaymentMethodsService: SystemPaymentMethodsService,
  ) {}

  @Get()
  @Permissions('superadmin:system_payment_methods:read')
  @ApiOperation({ summary: 'Get all system payment methods' })
  @ApiResponse({
    status: 200,
    description: 'System payment methods retrieved successfully',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(@Request() req) {
    return this.systemPaymentMethodsService.findAll(req.user);
  }

  @Get(':id')
  @Permissions('superadmin:system_payment_methods:read')
  @ApiOperation({ summary: 'Get system payment method by ID' })
  @ApiResponse({
    status: 200,
    description: 'System payment method retrieved successfully',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'System payment method not found' })
  async findOne(@Param('id') id: string, @Request() req) {
    return this.systemPaymentMethodsService.findOne(parseInt(id), req.user);
  }

  @Post()
  @Permissions('superadmin:system_payment_methods:write')
  @ApiOperation({
    summary: 'Create system payment method (super_admin only)',
  })
  @ApiResponse({
    status: 201,
    description: 'System payment method created successfully',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(
    @Body() createDto: CreateSystemPaymentMethodDto,
    @Request() req,
  ) {
    return this.systemPaymentMethodsService.create(createDto, req.user);
  }

  @Patch(':id')
  @Permissions('superadmin:system_payment_methods:write')
  @ApiOperation({
    summary: 'Update system payment method (super_admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'System payment method updated successfully',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'System payment method not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateSystemPaymentMethodDto,
    @Request() req,
  ) {
    return this.systemPaymentMethodsService.update(
      parseInt(id),
      updateDto,
      req.user,
    );
  }

  @Patch(':id/toggle')
  @Permissions('superadmin:system_payment_methods:write')
  @ApiOperation({
    summary: 'Toggle active status (super_admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'System payment method toggled successfully',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'System payment method not found' })
  async toggleActive(@Param('id') id: string, @Request() req) {
    return this.systemPaymentMethodsService.toggleActive(
      parseInt(id),
      req.user,
    );
  }

  @Delete(':id')
  @Permissions('superadmin:system_payment_methods:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete system payment method (super_admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'System payment method deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Payment method is in use' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'System payment method not found' })
  async remove(@Param('id') id: string, @Request() req) {
    return this.systemPaymentMethodsService.remove(parseInt(id), req.user);
  }
}
