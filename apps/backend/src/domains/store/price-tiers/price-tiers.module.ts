import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PriceTiersController } from './price-tiers.controller';
import { PriceTiersService } from './price-tiers.service';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [PriceTiersController],
  providers: [PriceTiersService],
  exports: [PriceTiersService],
})
export class PriceTiersModule {}
