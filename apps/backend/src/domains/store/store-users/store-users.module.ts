import { Module } from '@nestjs/common';
import { StoreUsersService } from './store-users.service';
import { StoreUserManagementService } from './store-user-management.service';
import { StoreUsersController } from './store-users.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [StoreUsersController],
  providers: [StoreUsersService, StoreUserManagementService],
  exports: [StoreUsersService, StoreUserManagementService],
})
export class StoreUsersModule {}
