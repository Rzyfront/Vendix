import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { UnauthorizedException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import {
  OrganizationOnboardingStatusDto,
  StoreOnboardingStatusDto,
  CompleteOrganizationOnboardingDto,
  CompleteStoreOnboardingDto,
} from './dto/onboarding-status.dto';

@Controller('organization/onboarding')
@UseGuards(RolesGuard, PermissionsGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  // ===== USER ONBOARDING ENDPOINTS =====

  @Get('status')
  @Permissions('organization:onboarding:read')
  async getUserOnboardingStatus(@Request() req) {
    return this.onboardingService.getUserOnboardingStatus(req.user.id);
  }

  // ===== ORGANIZATION ONBOARDING ENDPOINTS =====

  @Get('organization/:organizationId/status')
  @Permissions('organization:onboarding:read')
  async getOrganizationOnboardingStatus(
    @Param('organizationId') organizationId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrganizationOnboardingStatusDto> {
    const orgId = Number(organizationId);
    if (
      req.user.organization_id !== orgId &&
      !req.user.user_roles?.some((r) => r.roles?.name === UserRole.SUPER_ADMIN)
    ) {
      throw new UnauthorizedException(
        'You can only access your own organization onboarding status',
      );
    }
    return this.onboardingService.getOrganizationOnboardingStatus(orgId);
  }

  @Post('organization/:organizationId/complete')
  @Permissions('organization:onboarding:update')
  async completeOrganizationOnboarding(
    @Param('organizationId') organizationId: number,
    @Body() completeDto: CompleteOrganizationOnboardingDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrganizationOnboardingStatusDto> {
    const orgId = Number(organizationId);
    if (
      req.user.organization_id !== orgId &&
      !req.user.user_roles?.some((r) => r.roles?.name === UserRole.SUPER_ADMIN)
    ) {
      throw new UnauthorizedException(
        'You can only complete your own organization onboarding',
      );
    }
    return this.onboardingService.completeOrganizationOnboarding(
      orgId,
      completeDto,
    );
  }

  @Put('organization/:organizationId/reset')
  @Permissions('organization:onboarding:update')
  async resetOrganizationOnboarding(
    @Param('organizationId') organizationId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrganizationOnboardingStatusDto> {
    const orgId = Number(organizationId);
    this.assertOwnOrganization(req, orgId);
    return this.onboardingService.resetOrganizationOnboarding(orgId);
  }

  // ===== STORE ONBOARDING ENDPOINTS =====

  @Get('store/:storeId/status')
  @Permissions('organization:onboarding:read')
  async getStoreOnboardingStatus(
    @Param('storeId') storeId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<StoreOnboardingStatusDto> {
    await this.assertOwnStore(req, Number(storeId));
    return this.onboardingService.getStoreOnboardingStatus(Number(storeId));
  }

  @Post('store/:storeId/complete')
  @Permissions('organization:onboarding:update')
  async completeStoreOnboarding(
    @Param('storeId') storeId: number,
    @Body() completeDto: CompleteStoreOnboardingDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<StoreOnboardingStatusDto> {
    await this.assertOwnStore(req, Number(storeId));
    return this.onboardingService.completeStoreOnboarding(Number(storeId), {
      ...completeDto,
      store_id: Number(storeId),
    });
  }

  @Put('store/:storeId/reset')
  @Permissions('organization:onboarding:update')
  async resetStoreOnboarding(
    @Param('storeId') storeId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<StoreOnboardingStatusDto> {
    await this.assertOwnStore(req, Number(storeId));
    return this.onboardingService.resetStoreOnboarding(Number(storeId));
  }

  private assertOwnOrganization(req: AuthenticatedRequest, organizationId: number): void {
    if (
      req.user.organization_id !== organizationId &&
      !req.user.user_roles?.some((r) => r.roles?.name === UserRole.SUPER_ADMIN)
    ) {
      throw new UnauthorizedException(
        'You can only access your own organization onboarding',
      );
    }
  }

  private async assertOwnStore(
    req: AuthenticatedRequest,
    storeId: number,
  ): Promise<void> {
    const status = await this.onboardingService.getStoreOnboardingStatus(storeId);
    if (
      req.user.organization_id !== status.organization_id &&
      !req.user.user_roles?.some((r) => r.roles?.name === UserRole.SUPER_ADMIN)
    ) {
      throw new UnauthorizedException(
        'You can only access stores from your organization',
      );
    }
  }
}
