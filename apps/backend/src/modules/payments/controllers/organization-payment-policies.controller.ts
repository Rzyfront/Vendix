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
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { OrganizationPaymentPoliciesService } from '../services/organization-payment-policies.service';
import {
  CreateOrganizationPaymentPolicyDto,
  UpdateOrganizationPaymentPolicyDto,
} from '../dto/organization-payment-policy.dto';

@ApiTags('Organization Payment Policies')
@Controller('organizations/:organizationId/payment-policies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class OrganizationPaymentPoliciesController {
  constructor(
    private readonly organizationPaymentPoliciesService: OrganizationPaymentPoliciesService,
  ) {}

  @Post()
  @Permissions('organizations:update')
  @ApiOperation({ summary: 'Create payment policy for organization' })
  @ApiResponse({
    status: 201,
    description: 'Payment policy created successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  @ApiResponse({ status: 409, description: 'Policy already exists' })
  async create(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Body() createDto: CreateOrganizationPaymentPolicyDto,
  ) {
    return this.organizationPaymentPoliciesService.create(
      organizationId,
      createDto,
    );
  }

  @Get()
  @Permissions('organizations:read')
  @ApiOperation({ summary: 'Get payment policy for organization' })
  @ApiResponse({
    status: 200,
    description: 'Payment policy retrieved successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  async findOne(@Param('organizationId', ParseIntPipe) organizationId: number) {
    return this.organizationPaymentPoliciesService.findOne(organizationId);
  }

  @Patch()
  @Permissions('organizations:update')
  @ApiOperation({ summary: 'Update payment policy for organization' })
  @ApiResponse({
    status: 200,
    description: 'Payment policy updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  async update(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Body() updateDto: UpdateOrganizationPaymentPolicyDto,
  ) {
    return this.organizationPaymentPoliciesService.update(
      organizationId,
      updateDto,
    );
  }

  @Delete()
  @Permissions('organizations:update')
  @ApiOperation({ summary: 'Delete payment policy for organization' })
  @ApiResponse({
    status: 200,
    description: 'Payment policy deleted successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  async remove(@Param('organizationId', ParseIntPipe) organizationId: number) {
    return this.organizationPaymentPoliciesService.remove(organizationId);
  }

  @Get('stores/:storeId/effective-methods')
  @Permissions('organizations:read')
  @ApiOperation({
    summary:
      'Get effective payment methods for store considering organization policies',
  })
  @ApiResponse({
    status: 200,
    description: 'Effective payment methods retrieved successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async getEffectivePaymentMethods(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Param('storeId', ParseIntPipe) storeId: number,
  ) {
    // Verify store belongs to organization
    const store = await this.organizationPaymentPoliciesService[
      'prisma'
    ].stores.findFirst({
      where: {
        id: storeId,
        organization_id: organizationId,
      },
    });

    if (!store) {
      throw new Error('Store not found in this organization');
    }

    return this.organizationPaymentPoliciesService.getEffectivePaymentMethods(
      storeId,
    );
  }

  @Get('stores/:storeId/validate-method/:systemMethodId')
  @Permissions('organizations:read')
  @ApiOperation({
    summary: 'Validate if payment method can be enabled for store',
  })
  @ApiResponse({
    status: 200,
    description: 'Validation result retrieved successfully',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async validatePaymentMethod(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Param('systemMethodId', ParseIntPipe) systemMethodId: number,
  ) {
    // Verify store belongs to organization
    const store = await this.organizationPaymentPoliciesService[
      'prisma'
    ].stores.findFirst({
      where: {
        id: storeId,
        organization_id: organizationId,
      },
    });

    if (!store) {
      throw new Error('Store not found in this organization');
    }

    return this.organizationPaymentPoliciesService.validatePaymentMethodForStore(
      storeId,
      systemMethodId,
    );
  }
}
