import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingWizardController } from './onboarding-wizard.controller';
import { OnboardingWizardService } from './onboarding-wizard.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { EmailModule } from '../../../email/email.module';
import { BrandingGeneratorHelper } from '../../../common/helpers/branding-generator.helper';
import { DomainGeneratorHelper } from '../../../common/helpers/domain-generator.helper';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';
import { StoreBootstrapHelper } from '../../shared/helpers/store-bootstrap.helper';
import { OrgInventoryModule } from '../inventory/inventory.module';
import { SettingsModule } from '../../store/settings/settings.module';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    EmailModule,
    OrgInventoryModule,
    SettingsModule,
  ],
  controllers: [OnboardingController, OnboardingWizardController],
  providers: [
    OnboardingService,
    OnboardingWizardService,
    BrandingGeneratorHelper,
    DomainGeneratorHelper,
    DefaultPanelUIService,
    StoreBootstrapHelper,
    // SubscriptionTrialService is exported by SubscriptionsModule (@Global),
    // so no import is needed here — Nest resolves it globally.
  ],
  exports: [OnboardingService, OnboardingWizardService],
})
export class OnboardingModule {}
