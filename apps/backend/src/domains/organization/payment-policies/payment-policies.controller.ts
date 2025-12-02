import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentPoliciesService } from './payment-policies.service';
import { UpdatePaymentPoliciesDto } from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Organization Payment Policies')
@Controller('organization/payment-policies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentPoliciesController {
  constructor(
    private readonly paymentPoliciesService: PaymentPoliciesService,
  ) {}

  @Get()
  @Permissions('organization_payment_policies:read')
  @ApiOperation({ summary: 'Get organization payment policies' })
  @ApiResponse({
    status: 200,
    description: 'Organization payment policies retrieved successfully',
  })
  async findOne() {
    return this.paymentPoliciesService.findOne();
  }

  @Put()
  @Permissions('organization_payment_policies:update')
  @ApiOperation({ summary: 'Update organization payment policies' })
  @ApiResponse({
    status: 200,
    description: 'Organization payment policies updated successfully',
  })
  async update(@Body() updateDto: UpdatePaymentPoliciesDto) {
    return this.paymentPoliciesService.update(updateDto);
  }
}
