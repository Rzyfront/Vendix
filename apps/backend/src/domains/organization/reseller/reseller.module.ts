import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { PartnerPlansController } from './partner-plans/partner-plans.controller';
import { PartnerPlansService } from './partner-plans/partner-plans.service';
import { PartnerCommissionsController } from './partner-commissions/partner-commissions.controller';
import { PartnerCommissionsService } from './partner-commissions/partner-commissions.service';
import { PartnerBrandingController } from './partner-branding/partner-branding.controller';
import { PartnerBrandingService } from './partner-branding/partner-branding.service';
import { PartnerOrgGuard } from './guards/partner-org.guard';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [
    PartnerPlansController,
    PartnerCommissionsController,
    PartnerBrandingController,
  ],
  providers: [
    PartnerPlansService,
    PartnerCommissionsService,
    PartnerBrandingService,
    PartnerOrgGuard,
  ],
  exports: [
    PartnerPlansService,
    PartnerCommissionsService,
    PartnerBrandingService,
  ],
})
export class ResellerModule {}
