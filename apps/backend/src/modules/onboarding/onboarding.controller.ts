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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestContext } from '../../common/decorators/request-context.decorator';
import { OnboardingService } from './onboarding.service';
import {
  OrganizationOnboardingStatusDto,
  StoreOnboardingStatusDto,
  CompleteOrganizationOnboardingDto,
  CompleteStoreOnboardingDto,
} from './dto/onboarding-status.dto';

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  // ===== USER ONBOARDING ENDPOINTS =====

  @Get('status')
  async getUserOnboardingStatus(@Request() req) {
    return this.onboardingService.getUserOnboardingStatus(req.user.id);
  }

  // ===== ORGANIZATION ONBOARDING ENDPOINTS =====

  @Get('organization/:organizationId/status')
  async getOrganizationOnboardingStatus(
    @Param('organizationId') organizationId: number,
  ): Promise<OrganizationOnboardingStatusDto> {
    return this.onboardingService.getOrganizationOnboardingStatus(
      Number(organizationId),
    );
  }

  @Post('organization/:organizationId/complete')
  async completeOrganizationOnboarding(
    @Param('organizationId') organizationId: number,
    @Body() completeDto: CompleteOrganizationOnboardingDto,
    @Request() req,
  ): Promise<OrganizationOnboardingStatusDto> {
    return this.onboardingService.completeOrganizationOnboarding(
      Number(organizationId),
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
