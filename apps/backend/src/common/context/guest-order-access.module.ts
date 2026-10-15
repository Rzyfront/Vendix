import { Module } from '@nestjs/common';
import { GuestOrderAccessService } from './guest-order-access.service';
@Module({
  providers: [GuestOrderAccessService],
  exports: [GuestOrderAccessService],
})
export class GuestOrderAccessModule {}
