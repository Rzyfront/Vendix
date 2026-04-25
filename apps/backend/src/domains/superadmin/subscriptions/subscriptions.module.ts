import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { NotificationsModule } from '../../store/notifications/notifications.module';
import { PlansController } from './controllers/plans.controller';
import { PlansService } from './services/plans.service';
import { PartnersController } from './controllers/partners.controller';
import { PartnersService } from './services/partners.service';
import { PromotionalController } from './controllers/promotional.controller';
import { PromotionalService } from './services/promotional.service';
import { ActiveSubscriptionsController } from './controllers/active-subscriptions.controller';
import { ActiveSubscriptionsService } from './services/active-subscriptions.service';
import { DunningController } from './controllers/dunning.controller';
import { DunningService } from './services/dunning.service';
import { PayoutsController } from './controllers/payouts.controller';
import { PayoutsService } from './services/payouts.service';
import { EventsController } from './controllers/events.controller';
import { EventsService } from './services/events.service';
import { SubscriptionsStatsController } from './controllers/stats.controller';
import { SubscriptionsStatsService } from './services/stats.service';

@Module({
  imports: [PrismaModule, ResponseModule, NotificationsModule],
  controllers: [
    PlansController,
    PartnersController,
    PromotionalController,
    ActiveSubscriptionsController,
    DunningController,
    PayoutsController,
    EventsController,
    SubscriptionsStatsController,
  ],
  providers: [
    PlansService,
    PartnersService,
    PromotionalService,
    ActiveSubscriptionsService,
    DunningService,
    PayoutsService,
    EventsService,
    SubscriptionsStatsService,
  ],
  exports: [
    PlansService,
    PartnersService,
    PromotionalService,
    ActiveSubscriptionsService,
    DunningService,
    PayoutsService,
    EventsService,
    SubscriptionsStatsService,
  ],
})
export class SuperadminSubscriptionsModule {}
