import { Module } from '@nestjs/common';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

@Module({
  imports: [ResponseModule],
  controllers: [CurrenciesController],
  providers: [CurrenciesService, GlobalPrismaService],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
