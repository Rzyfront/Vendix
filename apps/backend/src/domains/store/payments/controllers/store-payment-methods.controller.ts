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
import { ResponseService } from '../../../../common/responses/response.service';
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
    private readonly responseService: ResponseService,
  ) { }

  @Get('available')
  @ApiOperation({ summary: 'Get available payment methods to enable' })
  @ApiResponse({
    status: 200,
    description: 'Available payment methods retrieved successfully',
  })
  async getAvailable() {
    try {
      const result = await this.storePaymentMethodsService.getAvailableForStore();
      return this.responseService.success(
        result,
        'Available payment methods retrieved successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to retrieve available payment methods',
        error,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get enabled payment methods for store' })
  @ApiResponse({
    status: 200,
    description: 'Enabled payment methods retrieved successfully',
  })
  async getEnabled() {
    try {
      const result = await this.storePaymentMethodsService.getEnabledForStore();
      return this.responseService.success(
        result,
        'Enabled payment methods retrieved successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to retrieve enabled payment methods',
        error,
      );
    }
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get payment method statistics' })
  @ApiResponse({
    status: 200,
    description: 'Payment method statistics retrieved successfully',
  })
  async getStats() {
    try {
      const result = await this.storePaymentMethodsService.getStats();
      return this.responseService.success(
        result,
        'Payment method statistics retrieved successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to retrieve payment method statistics',
        error,
      );
    }
  }

  @Get(':methodId')
  @ApiOperation({ summary: 'Get single store payment method' })
  @ApiResponse({
    status: 200,
    description: 'Payment method retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async findOne(@Param('methodId') methodId: string) {
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid payment method ID', '', 400);
      }

      const result = await this.storePaymentMethodsService.findOne(method_id_num);
      return this.responseService.success(
        result,
        'Payment method retrieved successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to retrieve payment method',
        error,
      );
    }
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
    try {
      const system_method_id_num = parseInt(systemMethodId);
      if (!system_method_id_num || isNaN(system_method_id_num)) {
        return this.responseService.error('Invalid system payment method ID', '', 400);
      }

      const result = await this.storePaymentMethodsService.enableForStore(
        system_method_id_num,
        enableDto,
      );
      return this.responseService.created(
        result,
        'Payment method enabled successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to enable payment method',
        error,
      );
    }
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
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid payment method ID', '', 400);
      }

      const result = await this.storePaymentMethodsService.updateStoreMethod(
        method_id_num,
        updateDto,
      );
      return this.responseService.updated(
        result,
        'Payment method updated successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to update payment method',
        error,
      );
    }
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
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid payment method ID', '', 400);
      }

      const result = await this.storePaymentMethodsService.disableForStore(method_id_num);
      return this.responseService.success(
        result,
        'Payment method disabled successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to disable payment method',
        error,
      );
    }
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
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid payment method ID', '', 400);
      }

      await this.storePaymentMethodsService.removeFromStore(method_id_num);
      return this.responseService.deleted(
        'Payment method removed successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to remove payment method',
        error,
      );
    }
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
    try {
      const result = await this.storePaymentMethodsService.reorderMethods(reorderDto);
      return this.responseService.success(
        result,
        'Payment methods reordered successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to reorder payment methods',
        error,
      );
    }
  }
}
