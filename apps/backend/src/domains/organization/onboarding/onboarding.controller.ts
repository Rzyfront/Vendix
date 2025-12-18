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
  constructor(private readonly onboardingService: OnboardingService) { }

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
    if (req.user.organization_id !== orgId && !req.user.user_roles?.some(r => r.roles?.name === UserRole.SUPER_ADMIN)) {
      throw new UnauthorizedException('You can only access your own organization onboarding status');
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
    if (req.user.organization_id !== orgId && !req.user.user_roles?.some(r => r.roles?.name === UserRole.SUPER_ADMIN)) {
      throw new UnauthorizedException('You can only complete your own organization onboarding');
    }
    return this.onboardingService.completeOrganizationOnboarding(
      orgId,
      completeDto,
    );
  }

  @Put('organization/:organizationId/reset')
  async resetOrganizationOnboarding(
    @Param('organizationId') organizationId: number,
  ): Promise<OrganizationOnboardingStatusDto> {
    return this.onboardingService.resetOrganizationOnboarding(
      Number(organizationId),
    );
  }

  // ===== STORE ONBOARDING ENDPOINTS =====

  @Get('store/:storeId/status')
  async getStoreOnboardingStatus(
    @Param('storeId') storeId: number,
  ): Promise<StoreOnboardingStatusDto> {
    return this.onboardingService.getStoreOnboardingStatus(Number(storeId));
  }

  @Post('store/:storeId/complete')
  async completeStoreOnboarding(
    @Param('storeId') storeId: number,
    @Body() completeDto: CompleteStoreOnboardingDto,
    @Request() req,
  ): Promise<StoreOnboardingStatusDto> {
    return this.onboardingService.completeStoreOnboarding(Number(storeId), {
      ...completeDto,
      store_id: Number(storeId),
    });
  }

  @Put('store/:storeId/reset')
  async resetStoreOnboarding(
    @Param('storeId') storeId: number,
  ): Promise<StoreOnboardingStatusDto> {
    return this.onboardingService.resetStoreOnboarding(Number(storeId));
  }
}
