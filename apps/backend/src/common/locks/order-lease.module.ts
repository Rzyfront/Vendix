import { Module } from '@nestjs/common';
import { OrderLeaseService } from './order-lease.service';

/** `REDIS_CLIENT` comes from the @Global() `RedisModule`. */
@Module({
  providers: [OrderLeaseService],
  exports: [OrderLeaseService],
})
export class OrderLeaseModule {}
