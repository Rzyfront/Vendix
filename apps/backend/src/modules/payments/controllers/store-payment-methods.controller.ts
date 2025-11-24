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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StorePaymentMethodsService } from '../services/store-payment-methods.service';
import {
  EnablePaymentMethodDto,
  UpdateStorePaymentMethodDto,
  ReorderPaymentMethodsDto,
} from '../dto';

@ApiTags('Store Payment Methods')
@Controller('stores/:storeId/payment-methods')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StorePaymentMethodsController {
  constructor(
    private readonly storePaymentMethodsService: StorePaymentMethodsService,
  ) {}

  @Get('available')
  @ApiOperation({ summary: 'Get available payment methods to enable' })
  @ApiResponse({
    status: 200,
    description: 'Available payment methods retrieved successfully',
  })
  async getAvailable(@Param('storeId') storeId: string, @Request() req) {
    return this.storePaymentMethodsService.getAvailableForStore(
      parseInt(storeId),
      req.user,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get enabled payment methods for store' })
  @ApiResponse({
    status: 200,
    description: 'Enabled payment methods retrieved successfully',
  })
  async getEnabled(@Param('storeId') storeId: string, @Request() req) {
    return this.storePaymentMethodsService.getEnabledForStore(
      parseInt(storeId),
      req.user,
    );
  }

  @Get(':methodId')
  @ApiOperation({ summary: 'Get single store payment method' })
  @ApiResponse({
    status: 200,
    description: 'Payment method retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async findOne(
    @Param('storeId') storeId: string,
    @Param('methodId') methodId: string,
    @Request() req,
  ) {
    return this.storePaymentMethodsService.findOne(
      parseInt(storeId),
      parseInt(methodId),
      req.user,
    );
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
    @Param('storeId') storeId: string,
    @Param('systemMethodId') systemMethodId: string,
    @Body() enableDto: EnablePaymentMethodDto,
    @Request() req,
  ) {
    return this.storePaymentMethodsService.enableForStore(
      parseInt(storeId),
      parseInt(systemMethodId),
      enableDto,
      req.user,
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
    @Param('storeId') storeId: string,
    @Param('methodId') methodId: string,
    @Body() updateDto: UpdateStorePaymentMethodDto,
    @Request() req,
  ) {
    return this.storePaymentMethodsService.updateStoreMethod(
      parseInt(storeId),
      parseInt(methodId),
      updateDto,
      req.user,
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
  async disable(
    @Param('storeId') storeId: string,
    @Param('methodId') methodId: string,
    @Request() req,
  ) {
    return this.storePaymentMethodsService.disableForStore(
      parseInt(storeId),
      parseInt(methodId),
      req.user,
    );
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
  async remove(
    @Param('storeId') storeId: string,
    @Param('methodId') methodId: string,
    @Request() req,
  ) {
    return this.storePaymentMethodsService.removeFromStore(
      parseInt(storeId),
      parseInt(methodId),
      req.user,
    );
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder payment methods display' })
  @ApiResponse({
    status: 200,
    description: 'Payment methods reordered successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async reorder(
    @Param('storeId') storeId: string,
    @Body() reorderDto: ReorderPaymentMethodsDto,
    @Request() req,
  ) {
    return this.storePaymentMethodsService.reorderMethods(
      parseInt(storeId),
      reorderDto,
      req.user,
    );
  }
}
