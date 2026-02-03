import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OrderAutoFinishJob } from './order-auto-finish.job';
import { OrderFlowModule } from '../domains/store/orders/order-flow/order-flow.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OrderFlowModule,
  ],
  providers: [OrderAutoFinishJob],
})
export class JobsModule {}
