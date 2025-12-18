import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ReturnOrdersController } from './return-orders.controller';
import { ReturnOrdersService } from './return-orders.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReturnOrdersController],
  providers: [ReturnOrdersService],
  exports: [ReturnOrdersService],
})
export class ReturnOrdersModule {}
