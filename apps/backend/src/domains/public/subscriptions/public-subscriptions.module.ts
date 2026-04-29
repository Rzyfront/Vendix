import { Module } from '@nestjs/common';
import { PublicPlansController } from './public-plans.controller';
import { PublicPlansService } from './public-plans.service';
import { ResponseModule } from '@common/responses';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [PublicPlansController],
  providers: [PublicPlansService],
})
export class PublicSubscriptionsModule {}
