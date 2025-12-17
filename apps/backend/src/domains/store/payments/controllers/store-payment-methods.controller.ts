import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { StorePaymentMethodsService } from '../services/store-payment-methods.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  EnablePaymentMethodDto,
  UpdateStorePaymentMethodDto,
  ReorderPaymentMethodsDto,
} from '../dto';

@ApiTags('Store Payment Methods')
@Controller('store/payment-methods')
@ApiBearerAuth()
export class StorePaymentMethodsController {
  constructor(
    private readonly storePaymentMethodsService: StorePaymentMethodsService,
  ) { }

  @Get('available')
  @ApiOperation({ summary: 'Get available payment methods to enable' })
  @ApiResponse({
    status: 200,
    description: 'Available payment methods retrieved successfully',
  })
  async getAvailable() {
    return this.storePaymentMethodsService.getAvailableForStore();
  }

  @Get()
  @ApiOperation({ summary: 'Get enabled payment methods for store' })
  @ApiResponse({
    status: 200,
    description: 'Enabled payment methods retrieved successfully',
  })
  async getEnabled() {
    return this.storePaymentMethodsService.getEnabledForStore();
  }

  @Get(':methodId')
  @ApiOperation({ summary: 'Get single store payment method' })
  @ApiResponse({
    status: 200,
    description: 'Payment method retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async findOne(@Param('methodId') methodId: string) {
    return this.storePaymentMethodsService.findOne(parseInt(methodId));
  }

  @Post('enable/:systemMethodId')
  @ApiOperation({ summary: 'Enable a system payment method for this store' })
  @ApiResponse({
    status: 201,
    description: 'Payment method enabled successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async enable(
    @Param('systemMethodId') systemMethodId: string,
    @Body() enableDto: EnablePaymentMethodDto,
  ) {
    return this.storePaymentMethodsService.enableForStore(
      parseInt(systemMethodId),
      enableDto,
    );
  }

  @Patch(':methodId')
  @ApiOperation({ summary: 'Update store payment method configuration' })
  @ApiResponse({
    status: 200,
    description: 'Payment method updated successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async update(
    @Param('methodId') methodId: string,
    @Body() updateDto: UpdateStorePaymentMethodDto,
  ) {
    return this.storePaymentMethodsService.updateStoreMethod(
      parseInt(methodId),
      updateDto,
    );
  }

  @Patch(':methodId/disable')
  @ApiOperation({ summary: 'Disable payment method for store' })
  @ApiResponse({
    status: 200,
    description: 'Payment method disabled successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async disable(@Param('methodId') methodId: string) {
    return this.storePaymentMethodsService.disableForStore(parseInt(methodId));
  }

  @Delete(':methodId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove payment method from store' })
  @ApiResponse({
    status: 200,
    description: 'Payment method removed successfully',
  })
  @ApiResponse({ status: 400, description: 'Payment method is in use' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async remove(@Param('methodId') methodId: string) {
    return this.storePaymentMethodsService.removeFromStore(parseInt(methodId));
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder payment methods display' })
  @ApiResponse({
    status: 200,
    description: 'Payment methods reordered successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async reorder(@Body() reorderDto: ReorderPaymentMethodsDto) {
    return this.storePaymentMethodsService.reorderMethods(reorderDto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get payment method statistics' })
  @ApiResponse({
    status: 200,
    description: 'Payment method statistics retrieved successfully',
  })
  async getStats() {
    return this.storePaymentMethodsService.getStats();
  }
}
