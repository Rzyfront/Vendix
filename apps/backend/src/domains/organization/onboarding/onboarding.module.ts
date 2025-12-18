import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingWizardController } from './onboarding-wizard.controller';
import { OnboardingWizardService } from './onboarding-wizard.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [OnboardingController, OnboardingWizardController],
  providers: [OnboardingService, OnboardingWizardService],
  exports: [OnboardingService, OnboardingWizardService],
})
export class OnboardingModule {}
