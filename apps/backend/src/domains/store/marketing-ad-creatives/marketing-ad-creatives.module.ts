import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { MarketingAdCreativesController } from './marketing-ad-creatives.controller';
import { MarketingAdCreativesService } from './marketing-ad-creatives.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [MarketingAdCreativesController],
  providers: [MarketingAdCreativesService],
  exports: [MarketingAdCreativesService],
})
export class MarketingAdCreativesModule {}
