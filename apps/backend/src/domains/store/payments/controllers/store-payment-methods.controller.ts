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
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';

@ApiTags('Store Payment Methods')
@Controller('store/payment-methods')
@ApiBearerAuth()
/**
 * A.0 P0 — `PermissionsGuard` a nivel de CLASE + `@Permissions(...)` en cada
 * handler. Antes la clase no registraba el guard y los 10 handlers quedaban
 * fail-open: cualquier usuario autenticado de la tienda (mesero/cocina) podía
 * DELETE/PATCH/reorder los métodos de pago, y tras E.1 eso incluye reescribir
 * `custom_config.accounts` (a qué cuenta bancaria llega el dinero).
 *
 * Permiso por handler:
 *   - lectura (`getAvailable`, `getEnabled`, `getStats`, `findOne`): `store:settings:read`
 *   - escritura (`reEnable`, `enable`, `update`, `disable`, `remove`, `reorder`): `store:settings:write`
 *
 * No existe fila `store:payment_methods:*` en permissions-roles.seed.ts; las
 * filas `store:settings:read/write` son las más próximas que owner/admin ya
 * poseen. `cashier` solo tiene `store:settings:read`, así que los 6 writes
 * quedan reservados al admin — el cajero no puede tocar los métodos de pago.
 */
@UseGuards(PermissionsGuard)
export class StorePaymentMethodsController {
  constructor(
    private readonly storePaymentMethodsService: StorePaymentMethodsService,
    private readonly responseService: ResponseService,
  ) {}

  @Patch(':methodId/enable')
  @Permissions('store:settings:write')
  @ApiOperation({ summary: 'Re-enable payment method for store' })
  @ApiResponse({
    status: 200,
    description: 'Payment method enabled successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async reEnable(@Param('methodId') methodId: string) {
    try {
      const method_id_num = parseInt(methodId);
      if (!method_id_num || isNaN(method_id_num)) {
        return this.responseService.error('Invalid payment method ID', '', 400);
      }

      const result =
        await this.storePaymentMethodsService.reEnableForStore(method_id_num);
      return this.responseService.success(
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

  @Get('available')
  @Permissions('store:settings:read')
  @ApiOperation({ summary: 'Get available payment methods to enable' })
  @ApiResponse({
    status: 200,
    description: 'Available payment methods retrieved successfully',
  })
  async getAvailable() {
    try {
      const result =
        await this.storePaymentMethodsService.getAvailableForStore();
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
  @Permissions('store:settings:read')
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
  @Permissions('store:settings:read')
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
  @Permissions('store:settings:read')
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

      const result =
        await this.storePaymentMethodsService.findOne(method_id_num);
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
  @Permissions('store:settings:write')
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
        return this.responseService.error(
          'Invalid system payment method ID',
          '',
          400,
        );
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
  @Permissions('store:settings:write')
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
  @Permissions('store:settings:write')
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

      const result =
        await this.storePaymentMethodsService.disableForStore(method_id_num);
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
  @Permissions('store:settings:write')
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
  @Permissions('store:settings:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder payment methods display' })
  @ApiResponse({
    status: 200,
    description: 'Payment methods reordered successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async reorder(@Body() reorderDto: ReorderPaymentMethodsDto) {
    try {
      const result =
        await this.storePaymentMethodsService.reorderMethods(reorderDto);
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
