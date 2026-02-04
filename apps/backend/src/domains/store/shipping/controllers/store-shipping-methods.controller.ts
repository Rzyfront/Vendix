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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { StoreShippingMethodsService } from '../services/store-shipping-methods.service';
import { ResponseService } from '../../../../common/responses/response.service';
import {
  EnableShippingMethodDto,
  UpdateStoreShippingMethodDto,
  ReorderShippingMethodsDto,
} from '../dto/store-shipping-method.dto';

@ApiTags('Store Shipping Methods')
@Controller('store/shipping-methods')
@ApiBearerAuth()
export class StoreShippingMethodsController {
  constructor(
    private readonly storeShippingMethodsService: StoreShippingMethodsService,
    private readonly responseService: ResponseService,
  ) {}

  @Patch(':methodId/enable')
  @ApiOperation({ summary: 'Re-enable shipping method for store' })
  @ApiResponse({
    status: 200,
    description: 'Shipping method enabled successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Shipping method not found' })
  async reEnable(@Param('methodId') methodId: string) {
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid shipping method ID', '', 400);
      }

      const result =
        await this.storeShippingMethodsService.reEnableForStore(method_id_num);
      return this.responseService.success(
        result,
        'Shipping method enabled successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to enable shipping method',
        error,
      );
    }
  }

  @Get('available')
  @ApiOperation({ summary: 'Get available shipping methods to enable' })
  @ApiResponse({
    status: 200,
    description: 'Available shipping methods retrieved successfully',
  })
  async getAvailable() {
    try {
      const result =
        await this.storeShippingMethodsService.getAvailableForStore();
      return this.responseService.success(
        result,
        'Available shipping methods retrieved successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to retrieve available shipping methods',
        error,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get enabled shipping methods for store' })
  @ApiResponse({
    status: 200,
    description: 'Enabled shipping methods retrieved successfully',
  })
  async getEnabled() {
    try {
      const result =
        await this.storeShippingMethodsService.getEnabledForStore();
      return this.responseService.success(
        result,
        'Enabled shipping methods retrieved successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to retrieve enabled shipping methods',
        error,
      );
    }
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get shipping method statistics' })
  @ApiResponse({
    status: 200,
    description: 'Shipping method statistics retrieved successfully',
  })
  async getStats() {
    try {
      const result = await this.storeShippingMethodsService.getStats();
      return this.responseService.success(
        result,
        'Shipping method statistics retrieved successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to retrieve shipping method statistics',
        error,
      );
    }
  }

  @Get(':methodId')
  @ApiOperation({ summary: 'Get single store shipping method' })
  @ApiResponse({
    status: 200,
    description: 'Shipping method retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Shipping method not found' })
  async findOne(@Param('methodId') methodId: string) {
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid shipping method ID', '', 400);
      }

      const result =
        await this.storeShippingMethodsService.findOne(method_id_num);
      return this.responseService.success(
        result,
        'Shipping method retrieved successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to retrieve shipping method',
        error,
      );
    }
  }

  @Post('enable/:systemMethodId')
  @ApiOperation({ summary: 'Enable a system shipping method for this store' })
  @ApiResponse({
    status: 201,
    description: 'Shipping method enabled successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async enable(
    @Param('systemMethodId') systemMethodId: string,
    @Body() enableDto: EnableShippingMethodDto,
  ) {
    try {
      const system_method_id_num = parseInt(systemMethodId);
      if (!system_method_id_num || isNaN(system_method_id_num)) {
        return this.responseService.error(
          'Invalid system shipping method ID',
          '',
          400,
        );
      }

      const result = await this.storeShippingMethodsService.enableForStore(
        system_method_id_num,
        enableDto,
      );
      return this.responseService.created(
        result,
        'Shipping method enabled successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to enable shipping method',
        error,
      );
    }
  }

  @Patch(':methodId')
  @ApiOperation({ summary: 'Update store shipping method configuration' })
  @ApiResponse({
    status: 200,
    description: 'Shipping method updated successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Shipping method not found' })
  async update(
    @Param('methodId') methodId: string,
    @Body() updateDto: UpdateStoreShippingMethodDto,
  ) {
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid shipping method ID', '', 400);
      }

      const result = await this.storeShippingMethodsService.updateStoreMethod(
        method_id_num,
        updateDto,
      );
      return this.responseService.updated(
        result,
        'Shipping method updated successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to update shipping method',
        error,
      );
    }
  }

  @Patch(':methodId/disable')
  @ApiOperation({ summary: 'Disable shipping method for store' })
  @ApiResponse({
    status: 200,
    description: 'Shipping method disabled successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Shipping method not found' })
  async disable(@Param('methodId') methodId: string) {
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid shipping method ID', '', 400);
      }

      const result =
        await this.storeShippingMethodsService.disableForStore(method_id_num);
      return this.responseService.success(
        result,
        'Shipping method disabled successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to disable shipping method',
        error,
      );
    }
  }

  @Delete(':methodId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove shipping method from store' })
  @ApiResponse({
    status: 200,
    description: 'Shipping method removed successfully',
  })
  @ApiResponse({ status: 400, description: 'Shipping method is in use' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Shipping method not found' })
  async remove(@Param('methodId') methodId: string) {
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid shipping method ID', '', 400);
      }

      await this.storeShippingMethodsService.removeFromStore(method_id_num);
      return this.responseService.deleted('Shipping method removed successfully');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to remove shipping method',
        error,
      );
    }
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder shipping methods display' })
  @ApiResponse({
    status: 200,
    description: 'Shipping methods reordered successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async reorder(@Body() reorderDto: ReorderShippingMethodsDto) {
    try {
      const result =
        await this.storeShippingMethodsService.reorderMethods(reorderDto);
      return this.responseService.success(
        result,
        'Shipping methods reordered successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Failed to reorder shipping methods',
        error,
      );
    }
  }
}
