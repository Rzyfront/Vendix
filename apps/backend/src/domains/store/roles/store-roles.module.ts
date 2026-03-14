import { Module } from '@nestjs/common';
import { StoreRolesController } from './store-roles.controller';
import { StoreRolesService } from './store-roles.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [StoreRolesController],
  providers: [StoreRolesService],
  exports: [StoreRolesService],
})
export class StoreRolesModule {}
