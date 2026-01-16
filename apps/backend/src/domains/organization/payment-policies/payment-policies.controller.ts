import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentPoliciesService } from './payment-policies.service';
import { UpdatePaymentPoliciesDto, UpdatePaymentMethodsDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Organization Payment Policies')
@Controller('organization/payment-policies')
@UseGuards(PermissionsGuard)
export class PaymentPoliciesController {
  constructor(
    private readonly paymentPoliciesService: PaymentPoliciesService,
  ) {}

  @Get()
  @Permissions('organization:payment_policies:read')
  @ApiOperation({ summary: 'Get organization payment policies' })
  @ApiResponse({
    status: 200,
    description: 'Organization payment policies retrieved successfully',
  })
  async findOne() {
    return this.paymentPoliciesService.findOne();
  }

  @Put()
  @Permissions('organization:payment_policies:update')
  @ApiOperation({ summary: 'Update organization payment policies' })
  @ApiResponse({
    status: 200,
    description: 'Organization payment policies updated successfully',
  })
  async update(@Body() updateDto: UpdatePaymentPoliciesDto) {
    return this.paymentPoliciesService.update(updateDto);
  }

  @Get('available-methods')
  @Permissions('organization:payment_policies:read')
  @ApiOperation({ summary: 'Get available payment methods for organization' })
  @ApiResponse({
    status: 200,
    description: 'Available payment methods retrieved successfully',
  })
  async getAvailableMethods() {
    return this.paymentPoliciesService.getAvailableMethods();
  }

  @Put('payment-methods')
  @Permissions('organization:payment_policies:update')
  @ApiOperation({ summary: 'Update organization allowed payment methods' })
  @ApiResponse({
    status: 200,
    description: 'Organization payment methods updated successfully',
  })
  async updatePaymentMethods(@Body() updateDto: UpdatePaymentMethodsDto) {
    return this.paymentPoliciesService.updatePaymentMethods(updateDto);
  }
}
