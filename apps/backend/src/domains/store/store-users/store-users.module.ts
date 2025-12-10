import { Module } from '@nestjs/common';
import { StoreUsersService } from './store-users.service';
import { StoreUsersController } from './store-users.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [StoreUsersController],
  providers: [StoreUsersService],
  exports: [StoreUsersService],
})
export class StoreUsersModule {}
