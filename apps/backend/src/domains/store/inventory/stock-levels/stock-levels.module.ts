import { Module } from '@nestjs/common';
import { StockLevelsController } from './stock-levels.controller';
import { StockLevelsService } from './stock-levels.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [StockLevelsController],
  providers: [StockLevelsService],
  exports: [StockLevelsService],
})
export class StockLevelsModule {}
