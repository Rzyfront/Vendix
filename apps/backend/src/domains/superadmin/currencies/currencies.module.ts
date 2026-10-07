import { Module } from '@nestjs/common';
import { CurrenciesController } from './currencies.controller';
import { PublicCurrenciesController } from './public-currencies.controller';
import { CurrenciesService } from './currencies.service';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
  imports: [ResponseModule],
  controllers: [CurrenciesController, PublicCurrenciesController],
  providers: [CurrenciesService],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
