import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OnboardingWizardService } from './onboarding-wizard.service';
import { SetupUserWizardDto } from './dto/setup-user-wizard.dto';
import { SetupOrganizationWizardDto } from './dto/setup-organization-wizard.dto';
import { SetupStoreWizardDto } from './dto/setup-store-wizard.dto';
import { SetupAppConfigWizardDto } from './dto/setup-app-config-wizard.dto';
import { SelectAppTypeDto } from './dto/select-app-type.dto';
import { ResponseService } from '@common/responses/response.service';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';

@ApiTags('Onboarding Wizard')
@ApiBearerAuth()
@Controller('organization/onboarding-wizard')
export class OnboardingWizardController {
  constructor(
    private readonly wizardService: OnboardingWizardService,
    private readonly responseService: ResponseService,
  ) { }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get wizard status',
    description:
      'Returns the current state of the onboarding wizard for the user',
  })
  @ApiResponse({
    status: 200,
    description: 'Wizard status retrieved successfully',
  })
  async getWizardStatus(@Req() req: AuthenticatedRequest) {
    try {
      const status = await this.wizardService.getWizardStatus(req.user.id);
      return this.responseService.success(
        status,
        'Wizard status retrieved successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error retrieving wizard status',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('verify-email-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check email verification status',
    description: 'Checks if the user email has been verified',
  })
  @ApiResponse({
    status: 200,
    description: 'Email verification status checked successfully',
  })
  async checkEmailVerification(@Req() req: AuthenticatedRequest) {
    try {
      const status = await this.wizardService.checkEmailVerification(
        req.user.id,
      );
      return this.responseService.success(
        status,
        'Email verification status checked',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error checking email verification',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('select-app-type')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Select application type',
    description:
      'Select the type of application for the user (STORE_ADMIN or ORG_ADMIN)',
  })
  @ApiResponse({
    status: 200,
    description: 'Application type selected successfully',
  })
  async selectAppType(
    @Req() req: AuthenticatedRequest,
    @Body() selectAppTypeDto: SelectAppTypeDto,
  ) {
    try {
      const result = await this.wizardService.selectAppType(
        req.user.id,
        selectAppTypeDto,
      );
      return this.responseService.success(
        result,
        'Application type selected successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error selecting application type',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('setup-user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Setup user profile and address',
    description:
      'Updates user personal information and optionally their address',
  })
  @ApiResponse({
    status: 200,
    description: 'User setup completed successfully',
  })
  async setupUser(
    @Req() req: AuthenticatedRequest,
    @Body() setupUserDto: SetupUserWizardDto,
  ) {
    try {
      const updatedUser = await this.wizardService.setupUser(
        req.user.id,
        setupUserDto,
      );
      return this.responseService.success(
        updatedUser,
        'User setup completed successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error setting up user',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('setup-organization')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Setup organization details',
    description: 'Updates organization information and address',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization setup completed successfully',
  })
  async setupOrganization(
    @Req() req: AuthenticatedRequest,
    @Body() setupOrgDto: SetupOrganizationWizardDto,
  ) {
    try {
      const updatedOrg = await this.wizardService.setupOrganization(
        req.user.id,
        setupOrgDto,
      );
      return this.responseService.success(
        updatedOrg,
        'Organization setup completed successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error setting up organization',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('setup-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Setup first store',
    description:
      'Creates the first store for the organization with its address',
  })
  @ApiResponse({
    status: 200,
    description: 'Store setup completed successfully',
  })
  async setupStore(
    @Req() req: AuthenticatedRequest,
    @Body() setupStoreDto: SetupStoreWizardDto,
  ) {
    try {
      const store = await this.wizardService.setupStore(
        req.user.id,
        setupStoreDto,
      );
      return this.responseService.success(
        store,
        'Store setup completed successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error setting up store',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('setup-app-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Setup app configuration',
    description: 'Configures app type, branding colors, and domain settings',
  })
  @ApiResponse({
    status: 200,
    description: 'App configuration completed successfully',
  })
  async setupAppConfig(
    @Req() req: AuthenticatedRequest,
    @Body() setupAppConfigDto: SetupAppConfigWizardDto,
  ) {
    try {
      const config = await this.wizardService.setupAppConfig(
        req.user.id,
        setupAppConfigDto,
      );
      return this.responseService.success(
        config,
        'App configuration completed successfully',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error setting up app configuration',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete wizard',
    description:
      'Marks the onboarding wizard as completed and activates all entities',
  })
  @ApiResponse({
    status: 200,
    description: 'Wizard completed successfully',
  })
  async completeWizard(@Req() req: AuthenticatedRequest) {
    try {
      const result = await this.wizardService.completeWizard(req.user.id);
      return this.responseService.success(
        result,
        'Wizard completed successfully! Welcome to Vendix! 🎉',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error completing wizard',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
