import { Module } from '@nestjs/common';
import { AdminStoresController } from './admin-stores.controller';
import { AdminStoresService } from './admin-stores.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ResponseModule } from 'src/common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [AdminStoresController],
  providers: [AdminStoresService],
  exports: [AdminStoresService],
})
export class AdminStoresModule {}
